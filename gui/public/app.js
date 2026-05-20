// Global State Variables
let systemStatus = {
    isAdmin: false,
    drive: { totalGb: 0, freeGb: 0, usedGb: 0, percentUsed: 0 },
    scannedSizes: {
        temp: 0,
        update: 0,
        deliveryOpt: 0,
        recycleBin: 0,
        installers: 0
    }
};

let scanActive = false;
let cleanActive = false;
let activeTab = 'cleaner';
let monitorInterval = null;
let quarantineFiles = [];

// DOM Elements - Navigation & Main Status
const adminStatusEl = document.getElementById('admin-status');
const adminNoticeEl = document.getElementById('admin-notice');
const refreshBtn = document.getElementById('refresh-btn');
const navTabs = document.querySelectorAll('.nav-tab');

// DOM Elements - Cleaner Tab
const diskGauge = document.getElementById('disk-gauge');
const diskPercentEl = document.getElementById('disk-percent');
const diskTotalEl = document.getElementById('disk-total');
const diskUsedEl = document.getElementById('disk-used');
const diskFreeEl = document.getElementById('disk-free');

const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const scanBtn = document.getElementById('scan-btn');
const cleanBtn = document.getElementById('clean-btn');

// DOM Elements - Startup Tab
const refreshStartupBtn = document.getElementById('refresh-startup-btn');
const startupTableBody = document.getElementById('startup-table-body');

// DOM Elements - Quarantine Tab
const refreshQuarantineBtn = document.getElementById('refresh-quarantine-btn');
const quarantineTableBody = document.getElementById('quarantine-table-body');
const chkQuarantineAll = document.getElementById('chk-quarantine-all');
const restoreQuarantineBtn = document.getElementById('restore-quarantine-btn');
const deleteQuarantineBtn = document.getElementById('delete-quarantine-btn');

// DOM Elements - Monitor Tab
const cpuGauge = document.getElementById('cpu-gauge');
const cpuPercentEl = document.getElementById('cpu-percent');
const ramGauge = document.getElementById('ram-gauge');
const ramPercentEl = document.getElementById('ram-percent');
const ramDetailsEl = document.getElementById('ram-details');
const specOsEl = document.getElementById('spec-os');
const specCpuEl = document.getElementById('spec-cpu');

// DOM Elements - Console & Modals
const consoleOutput = document.getElementById('console-output');
const clearConsoleBtn = document.getElementById('clear-console-btn');
const currentActionEl = document.getElementById('current-action');
const celebrationModal = document.getElementById('celebration-modal');
const savedSpaceAmount = document.getElementById('saved-space-amount');
const modalCloseBtn = document.getElementById('modal-close-btn');

// Initial Setup Constants
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 60; // C: drive ring (r = 60)
const MONITOR_CIRCUMFERENCE = 2 * Math.PI * 60; // CPU/RAM rings (r = 60)

if (diskGauge) {
    diskGauge.style.strokeDasharray = GAUGE_CIRCUMFERENCE;
    diskGauge.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
}
if (cpuGauge) {
    cpuGauge.style.strokeDasharray = MONITOR_CIRCUMFERENCE;
    cpuGauge.style.strokeDashoffset = MONITOR_CIRCUMFERENCE;
}
if (ramGauge) {
    ramGauge.style.strokeDasharray = MONITOR_CIRCUMFERENCE;
    ramGauge.style.strokeDashoffset = MONITOR_CIRCUMFERENCE;
}

// Event Listeners
window.addEventListener('DOMContentLoaded', () => {
    fetchSystemStatus();
    setupTabSwitching();
});

refreshBtn.addEventListener('click', () => {
    if (activeTab === 'cleaner') fetchSystemStatus();
    else if (activeTab === 'startup') loadStartupPrograms();
    else if (activeTab === 'quarantine') loadQuarantineFiles();
    else if (activeTab === 'monitor') loadSystemMonitor();
});

clearConsoleBtn.addEventListener('click', clearConsole);
selectAllBtn.addEventListener('click', () => toggleAllCheckboxes(true));
deselectAllBtn.addEventListener('click', () => toggleAllCheckboxes(false));
scanBtn.addEventListener('click', startScanning);
cleanBtn.addEventListener('click', startCleaning);
modalCloseBtn.addEventListener('click', () => celebrationModal.classList.add('hide'));

refreshStartupBtn.addEventListener('click', loadStartupPrograms);
refreshQuarantineBtn.addEventListener('click', loadQuarantineFiles);

chkQuarantineAll.addEventListener('change', (e) => {
    const checkboxes = quarantineTableBody.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateQuarantineButtonsState();
});

restoreQuarantineBtn.addEventListener('click', handleRestoreQuarantine);
deleteQuarantineBtn.addEventListener('click', handleDeleteQuarantine);

// Navigation & Routing Tab Switching
function setupTabSwitching() {
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            if (targetTab === activeTab) return;

            // Remove active classes
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Switch tab content views
            document.querySelectorAll('.tab-content-left').forEach(el => el.classList.add('hide'));
            document.querySelectorAll('.tab-content-right').forEach(el => el.classList.add('hide'));

            document.querySelectorAll(`.tab-content-left[data-tab="${targetTab}"]`).forEach(el => el.classList.remove('hide'));
            document.querySelectorAll(`.tab-content-right[data-tab="${targetTab}"]`).forEach(el => el.classList.remove('hide'));

            activeTab = targetTab;

            // Stop polling if switching away from monitor tab
            if (monitorInterval) {
                clearInterval(monitorInterval);
                monitorInterval = null;
            }

            // Route actions
            if (targetTab === 'cleaner') {
                fetchSystemStatus();
            } else if (targetTab === 'startup') {
                loadStartupPrograms();
            } else if (targetTab === 'quarantine') {
                loadQuarantineFiles();
            } else if (targetTab === 'monitor') {
                loadSystemMonitor();
                monitorInterval = setInterval(loadSystemMonitor, 3000); // Polling system stats every 3s
            }
        });
    });
}

// Utilities
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '---';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function appendConsoleLine(text, type = 'system') {
    if (!text || !text.trim()) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${type}-line`;
    
    if (text.startsWith('[ERROR]')) {
        line.className = 'console-line error-line';
        text = text.substring(7).trim();
    } else if (text.startsWith('=====') || text.includes('SUMMARY') || text.includes('RESULT')) {
        line.className = 'console-line info-line';
    } else if (text.startsWith('WARNING:') || text.startsWith('Peringatan:')) {
        line.className = 'console-line warn-line';
    } else if (text.toLowerCase().includes('selesai') || text.toLowerCase().includes('success') || text.toLowerCase().includes('reclaimed') || text.toLowerCase().includes('freed')) {
        line.className = 'console-line success-line';
    }

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    line.textContent = `[${timeStr}] ${text}`;
    
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearConsole() {
    consoleOutput.innerHTML = '';
    appendConsoleLine('[SYSTEM] Console screen cleared.', 'system');
}

function updateDiskGauge(percent, total, used, free) {
    if (diskPercentEl) diskPercentEl.textContent = `${percent}%`;
    if (diskTotalEl) diskTotalEl.textContent = `${total} GB`;
    if (diskUsedEl) diskUsedEl.textContent = `${used} GB`;
    if (diskFreeEl) diskFreeEl.textContent = `${free} GB`;
    
    if (diskGauge) {
        const offset = GAUGE_CIRCUMFERENCE - (percent / 100) * GAUGE_CIRCUMFERENCE;
        diskGauge.style.strokeDashoffset = offset;
    }
}

function toggleAllCheckboxes(checked) {
    const checkboxes = document.querySelectorAll('.category-item:not(.dism-item) input[type="checkbox"]');
    checkboxes.forEach(chk => chk.checked = checked);
}

// Fetch System Administrator & C: Drive Status
async function fetchSystemStatus() {
    try {
        appendConsoleLine('[SYSTEM] Fetching drive status information...', 'system');
        adminStatusEl.className = 'status-pill status-loading';
        adminStatusEl.querySelector('.status-text').textContent = 'Checking...';
        
        const response = await fetch('/api/status');
        const data = await response.json();
        
        systemStatus.isAdmin = data.isAdmin;
        systemStatus.drive = data.drive;
        
        if (systemStatus.isAdmin) {
            adminStatusEl.className = 'status-pill status-admin';
            adminStatusEl.querySelector('.status-text').textContent = 'Access: Administrator';
            adminNoticeEl.classList.add('hide');
            appendConsoleLine('[SYSTEM] Running with full Administrator privileges.', 'success');
        } else {
            adminStatusEl.className = 'status-pill status-standard';
            adminStatusEl.querySelector('.status-text').textContent = 'Access: Standard';
            adminNoticeEl.classList.remove('hide');
            appendConsoleLine('[SYSTEM] IMPORTANT: Running without Administrator privileges. Some features are disabled.', 'warn');
        }
        
        updateDiskGauge(
            systemStatus.drive.percentUsed,
            systemStatus.drive.totalGb,
            systemStatus.drive.usedGb,
            systemStatus.drive.freeGb
        );
    } catch (err) {
        appendConsoleLine(`[ERROR] Failed to load system status: ${err.message}`, 'error');
    }
}

// Cleaner Tab - Start Scan Process
function startScanning() {
    if (scanActive || cleanActive) return;
    
    scanActive = true;
    scanBtn.disabled = true;
    cleanBtn.disabled = true;
    refreshBtn.disabled = true;
    
    const sizeEls = ['size-temp', 'size-update', 'size-deliveryOpt', 'size-recycleBin', 'size-installers'];
    sizeEls.forEach(id => {
        const el = document.getElementById(id);
        el.textContent = 'Calculating...';
        el.className = 'size-val text-muted';
    });
    
    const dots = ['scan-dot-temp', 'scan-dot-update', 'scan-dot-deliveryOpt', 'scan-dot-recycleBin', 'scan-dot-installers'];
    dots.forEach(id => document.getElementById(id).classList.remove('hide'));
    
    appendConsoleLine('[SYSTEM] Starting junk file scan...', 'info');
    currentActionEl.textContent = 'Scanning...';
    
    const source = new EventSource('/api/scan');
    
    source.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(`[SCAN] ${data.message}`, 'system');
    });
    
    source.addEventListener('scanning', (e) => {
        const data = JSON.parse(e.data);
        const row = document.querySelector(`.category-item[data-category="${data.category}"]`);
        if (row) row.classList.add('scanning-glow');
    });
    
    source.addEventListener('scanned', (e) => {
        const data = JSON.parse(e.data);
        const sizeEl = document.getElementById(`size-${data.category}`);
        const dotEl = document.getElementById(`scan-dot-${data.category}`);
        const row = document.querySelector(`.category-item[data-category="${data.category}"]`);
        
        if (row) row.classList.remove('scanning-glow');
        if (dotEl) dotEl.classList.add('hide');
        
        systemStatus.scannedSizes[data.category] = data.sizeBytes;
        
        if (sizeEl) {
            sizeEl.textContent = formatBytes(data.sizeBytes);
            sizeEl.className = data.sizeBytes > 0 ? 'size-val text-cyan' : 'size-val text-muted';
        }
        appendConsoleLine(`[SCAN] Category ${data.category} finished: ${formatBytes(data.sizeBytes)}`, 'system');
    });
    
    source.addEventListener('console', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(data.text, 'system');
    });
    
    source.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(`[SCAN] ${data.message}`, 'success');
        
        let totalTrashBytes = Object.values(systemStatus.scannedSizes).reduce((a, b) => a + b, 0);
        appendConsoleLine(`[SYSTEM] Total potential space reclaimable: ${formatBytes(totalTrashBytes)}`, 'info');
        
        currentActionEl.textContent = 'Scan Completed';
        scanActive = false;
        scanBtn.disabled = false;
        cleanBtn.disabled = false;
        refreshBtn.disabled = false;
        source.close();
    });
    
    source.onerror = () => {
        appendConsoleLine('[ERROR] Scanning connection disconnected or failed.', 'error');
        currentActionEl.textContent = 'Scan Failed';
        dots.forEach(id => document.getElementById(id).classList.add('hide'));
        sizeEls.forEach(id => {
            const el = document.getElementById(id);
            if (el.textContent === 'Calculating...') el.textContent = 'Failed';
        });
        scanActive = false;
        scanBtn.disabled = false;
        refreshBtn.disabled = false;
        source.close();
    };
}

// Cleaner Tab - Start Clean Process
async function startCleaning() {
    if (scanActive || cleanActive) return;
    
    const selected = [];
    if (document.getElementById('chk-temp').checked) selected.push('temp');
    if (document.getElementById('chk-update').checked) selected.push('update');
    if (document.getElementById('chk-deliveryOpt').checked) selected.push('deliveryOpt');
    if (document.getElementById('chk-recycleBin').checked) selected.push('recycleBin');
    if (document.getElementById('chk-installers').checked) selected.push('installers');
    if (document.getElementById('chk-dism').checked) selected.push('dism');
    
    if (selected.length === 0) {
        alert('Please select at least one category to clean!');
        return;
    }
    
    cleanActive = true;
    scanBtn.disabled = true;
    cleanBtn.disabled = true;
    refreshBtn.disabled = true;
    
    clearConsole();
    appendConsoleLine('[SYSTEM] Starting cleanup of selected categories...', 'info');
    currentActionEl.textContent = 'Cleaning...';
    
    const initialFreeGb = systemStatus.drive.freeGb;
    let expectedReclaimedBytes = 0;
    selected.forEach(cat => {
        if (cat !== 'dism') {
            expectedReclaimedBytes += systemStatus.scannedSizes[cat] || 0;
        }
    });

    const source = new EventSource(`/api/clean?categories=${selected.join(',')}`);
    
    source.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(`[CLEAN] ${data.message}`, 'info');
        currentActionEl.textContent = data.message;
    });
    
    source.addEventListener('console', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(data.text, 'system');
    });
    
    source.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        appendConsoleLine(`[SYSTEM] ${data.message}`, 'success');
        
        const newDrive = data.drive;
        const actualFreedGb = Math.max(0, Math.round((newDrive.freeGb - initialFreeGb) * 100) / 100);
        
        updateDiskGauge(
            newDrive.percentUsed,
            newDrive.totalGb,
            newDrive.usedGb,
            newDrive.freeGb
        );
        
        systemStatus.drive = newDrive;
        
        selected.forEach(cat => {
            if (cat !== 'dism') {
                systemStatus.scannedSizes[cat] = 0;
                document.getElementById(`size-${cat}`).textContent = '0 B';
                document.getElementById(`size-${cat}`).className = 'size-val text-muted';
            }
        });
        
        let displayFreedString = '';
        if (actualFreedGb > 0.01) {
            displayFreedString = `${actualFreedGb.toFixed(2)} GB`;
        } else {
            displayFreedString = formatBytes(expectedReclaimedBytes);
        }
        
        savedSpaceAmount.textContent = displayFreedString;
        celebrationModal.classList.remove('hide');
        
        currentActionEl.textContent = 'Cleanup Completed';
        cleanActive = false;
        scanBtn.disabled = false;
        cleanBtn.disabled = true;
        refreshBtn.disabled = false;
        source.close();
    });
    
    source.onerror = () => {
        appendConsoleLine('[ERROR] Cleanup connection disconnected or failed.', 'error');
        currentActionEl.textContent = 'Cleanup Failed';
        cleanActive = false;
        scanBtn.disabled = false;
        cleanBtn.disabled = false;
        refreshBtn.disabled = false;
        source.close();
        fetchSystemStatus();
    };
}

// STARTUP MANAGER LOGIC
async function loadStartupPrograms() {
    startupTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading startup programs...</td></tr>`;
    appendConsoleLine('[SYSTEM] Reading startup data from Windows Registry...', 'system');
    
    try {
        const response = await fetch('/api/startup');
        const list = await response.json();
        
        if (list.length === 0) {
            startupTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No startup programs found.</td></tr>`;
            return;
        }
        
        startupTableBody.innerHTML = '';
        list.forEach(item => {
            const tr = document.createElement('tr');
            
            // Format toggle switch
            const isChecked = item.status === 'Enabled' ? 'checked' : '';
            const hiveLabelClass = item.hive === 'HKLM' ? 'text-orange' : 'text-cyan';
            
            tr.innerHTML = `
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><code title="${escapeHtml(item.command)}">${escapeHtml(truncateString(item.command, 55))}</code></td>
                <td><span class="${hiveLabelClass}">${item.hive}</span></td>
                <td style="text-align: center;">
                    <label class="switch">
                        <input type="checkbox" class="startup-toggle" data-name="${escapeHtml(item.name)}" data-hive="${item.hive}" ${isChecked}>
                        <span class="slider"></span>
                    </label>
                </td>
            `;
            startupTableBody.appendChild(tr);
        });

        // Add toggle change event listeners
        document.querySelectorAll('.startup-toggle').forEach(toggle => {
            toggle.addEventListener('change', handleStartupToggle);
        });
        
        appendConsoleLine(`[SYSTEM] Successfully loaded ${list.length} startup programs.`, 'success');
    } catch (err) {
        startupTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-red">Failed to load startup programs: ${err.message}</td></tr>`;
        appendConsoleLine(`[ERROR] Failed to load startup data: ${err.message}`, 'error');
    }
}

async function handleStartupToggle(e) {
    const toggle = e.target;
    const name = toggle.getAttribute('data-name');
    const hive = toggle.getAttribute('data-hive');
    const enable = toggle.checked;
    
    toggle.disabled = true;
    appendConsoleLine(`[STARTUP] Changing status of '${name}' (${hive}) to: ${enable ? 'Enabled' : 'Disabled'}...`, 'info');
    
    try {
        const response = await fetch('/api/startup/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, hive, enable })
        });
        const result = await response.json();
        
        if (result.success) {
            appendConsoleLine(`[STARTUP] ${result.message}`, 'success');
        } else {
            // Revert state if failed
            toggle.checked = !enable;
            appendConsoleLine(`[ERROR] ${result.message}`, 'error');
        }
    } catch (err) {
        toggle.checked = !enable;
        appendConsoleLine(`[ERROR] Failed to modify registry status: ${err.message}`, 'error');
    } finally {
        toggle.disabled = false;
    }
}

// QUARANTINE MANAGER LOGIC
async function loadQuarantineFiles() {
    quarantineTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading quarantined files...</td></tr>`;
    chkQuarantineAll.checked = false;
    updateQuarantineButtonsState();
    
    try {
        appendConsoleLine('[SYSTEM] Scanning quarantine folder on D:...', 'system');
        const response = await fetch('/api/quarantine');
        quarantineFiles = await response.json();
        
        if (quarantineFiles.length === 0) {
            quarantineTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No installer files found in quarantine.</td></tr>`;
            return;
        }
        
        quarantineTableBody.innerHTML = '';
        quarantineFiles.forEach((file, index) => {
            const tr = document.createElement('tr');
            const dateStr = new Date(file.dateQuarantined).toLocaleString('id-ID');
            
            tr.innerHTML = `
                <td style="text-align: center;">
                    <label class="custom-checkbox">
                        <input type="checkbox" class="quarantine-chk" data-index="${index}">
                        <span class="checkmark"></span>
                    </label>
                </td>
                <td title="${escapeHtml(file.path)}"><strong>${escapeHtml(file.name)}</strong></td>
                <td><span class="text-cyan">${formatBytes(file.sizeBytes)}</span></td>
                <td>${dateStr}</td>
                <td><code style="font-size:10px;">${escapeHtml(file.folder)}</code></td>
            `;
            quarantineTableBody.appendChild(tr);
        });

        // Add checkbox listener
        document.querySelectorAll('.quarantine-chk').forEach(chk => {
            chk.addEventListener('change', () => {
                updateQuarantineButtonsState();
                
                // Toggle select all state appropriately
                const checkedCount = quarantineTableBody.querySelectorAll('.quarantine-chk:checked').length;
                chkQuarantineAll.checked = checkedCount === quarantineFiles.length;
            });
        });
        
        appendConsoleLine(`[SYSTEM] Detected ${quarantineFiles.length} files in quarantine folder.`, 'system');
    } catch (err) {
        quarantineTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-red">Failed to load quarantine folder: ${err.message}</td></tr>`;
        appendConsoleLine(`[ERROR] Failed to read quarantined files: ${err.message}`, 'error');
    }
}

function updateQuarantineButtonsState() {
    const checkedCount = quarantineTableBody.querySelectorAll('.quarantine-chk:checked').length;
    restoreQuarantineBtn.disabled = checkedCount === 0;
    deleteQuarantineBtn.disabled = checkedCount === 0;
}

// Restore Quarantined Items
async function handleRestoreQuarantine() {
    const checkedBoxes = quarantineTableBody.querySelectorAll('.quarantine-chk:checked');
    const filesToRestore = Array.from(checkedBoxes).map(chk => {
        const index = parseInt(chk.getAttribute('data-index'), 10);
        return quarantineFiles[index];
    });

    if (filesToRestore.length === 0) return;
    
    restoreQuarantineBtn.disabled = true;
    deleteQuarantineBtn.disabled = true;
    appendConsoleLine(`[QUARANTINE] Restoring ${filesToRestore.length} files back to C:\\Windows\\Installer...`, 'info');
    
    try {
        const response = await fetch('/api/quarantine/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesToRestore })
        });
        const result = await response.json();
        
        // Log individual status outputs
        result.message.split('\n').forEach(line => {
            if (line.trim()) {
                appendConsoleLine(line, line.includes('SUCCESS') ? 'success' : 'warn');
            }
        });
        
        appendConsoleLine('[QUARANTINE] File restoration completed.', 'success');
        loadQuarantineFiles();
    } catch (err) {
        appendConsoleLine(`[ERROR] Failed to restore files: ${err.message}`, 'error');
        updateQuarantineButtonsState();
    }
}

// Delete Quarantined Items Permanently
async function handleDeleteQuarantine() {
    const checkedBoxes = quarantineTableBody.querySelectorAll('.quarantine-chk:checked');
    const filesToDelete = Array.from(checkedBoxes).map(chk => {
        const index = parseInt(chk.getAttribute('data-index'), 10);
        return quarantineFiles[index];
    });

    if (filesToDelete.length === 0) return;
    
    const confirmed = confirm(`Warning: Are you sure you want to permanently delete ${filesToDelete.length} installer files? This action cannot be undone.`);
    if (!confirmed) return;

    restoreQuarantineBtn.disabled = true;
    deleteQuarantineBtn.disabled = true;
    appendConsoleLine(`[QUARANTINE] Permanently deleting ${filesToDelete.length} files from disk...`, 'info');
    
    try {
        const response = await fetch('/api/quarantine/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesToDelete })
        });
        const result = await response.json();
        
        appendConsoleLine(`[QUARANTINE] Selected files successfully deleted permanently.`, 'success');
        loadQuarantineFiles();
    } catch (err) {
        appendConsoleLine(`[ERROR] Failed to delete files: ${err.message}`, 'error');
        updateQuarantineButtonsState();
    }
}

// SYSTEM HARDWARE MONITOR LOGIC
async function loadSystemMonitor() {
    try {
        const response = await fetch('/api/system-monitor');
        const data = await response.json();
        
        // Update specs info card
        if (specOsEl) specOsEl.textContent = data.osName || 'Windows OS';
        if (specCpuEl) specCpuEl.textContent = data.cpuModel || 'Processor Intel/AMD';
        
        // Update CPU circular indicator
        if (cpuPercentEl) cpuPercentEl.textContent = `${data.cpuPercent}%`;
        if (cpuGauge) {
            const cpuOffset = MONITOR_CIRCUMFERENCE - (data.cpuPercent / 100) * MONITOR_CIRCUMFERENCE;
            cpuGauge.style.strokeDashoffset = cpuOffset;
        }

        // Update RAM circular indicator
        if (ramPercentEl) ramPercentEl.textContent = `${data.ramPercent}%`;
        if (ramDetailsEl) {
            ramDetailsEl.textContent = `${data.ramUsedGb.toFixed(1)} GB / ${data.ramTotalGb.toFixed(1)} GB`;
        }
        if (ramGauge) {
            const ramOffset = MONITOR_CIRCUMFERENCE - (data.ramPercent / 100) * MONITOR_CIRCUMFERENCE;
            ramGauge.style.strokeDashoffset = ramOffset;
        }
    } catch (err) {
        console.error("Failed to run system monitoring:", err);
    }
}

// Helper sanitization & string utilities
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function truncateString(str, num) {
    if (!str) return '';
    if (str.length <= num) return str;
    return str.slice(0, num) + '...';
}
