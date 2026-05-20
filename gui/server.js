const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper to check if server is running as administrator on Windows
async function checkIsAdmin() {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
        ]);
        
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ps.on('close', () => {
            resolve(output.trim().toLowerCase() === 'true');
        });
    });
}

// Helper to get C: drive space details
async function getDriveSpace() {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            "Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\" | ForEach-Object { \"$($_.Size);$($_.FreeSpace)\" }"
        ]);
        
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ps.on('close', () => {
            try {
                const parts = output.trim().split(';');
                if (parts.length === 2) {
                    const sizeBytes = parseInt(parts[0], 10);
                    const freeBytes = parseInt(parts[1], 10);
                    const usedBytes = sizeBytes - freeBytes;
                    
                    const totalGb = Math.round((sizeBytes / (1024 ** 3)) * 100) / 100;
                    const freeGb = Math.round((freeBytes / (1024 ** 3)) * 100) / 100;
                    const usedGb = Math.round((usedBytes / (1024 ** 3)) * 100) / 100;
                    const percentUsed = Math.round((usedBytes / sizeBytes) * 100);
                    
                    resolve({ totalGb, freeGb, usedGb, percentUsed });
                    return;
                }
            } catch (err) {
                console.error("Error parsing drive space:", err);
            }
            resolve({ totalGb: 0, freeGb: 0, usedGb: 0, percentUsed: 0 });
        });
    });
}

// Get directory size using PowerShell (avoiding node-side FS recursion permission issues)
async function getDirectorySize(dirPath) {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            `$size = 0; if (Test-Path -LiteralPath '${dirPath}') { $size = (Get-ChildItem -LiteralPath '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum }; if (-not $size) { $size = 0 }; Write-Output $size`
        ]);
        
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ps.on('close', () => {
            const bytes = parseInt(output.trim(), 10);
            resolve(isNaN(bytes) ? 0 : bytes);
        });
    });
}

// Get Recycle Bin size using PowerShell
async function getRecycleBinSize() {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            `$size = 0; try { $sh = New-Object -ComObject Shell.Application; $rb = $sh.Namespace(0x0a); $size = ($rb.Items() | Measure-Object -Property Size -Sum).Sum } catch {}; if (-not $size) { $size = 0 }; Write-Output $size`
        ]);
        
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ps.on('close', () => {
            const bytes = parseInt(output.trim(), 10);
            resolve(isNaN(bytes) ? 0 : bytes);
        });
    });
}

// Walk files inside D: drive quarantine folders
function getQuarantineFiles() {
    const results = [];
    try {
        const dDrive = 'D:\\';
        if (!fs.existsSync(dDrive)) return results;
        
        const items = fs.readdirSync(dDrive);
        items.forEach(item => {
            if (item.startsWith('InstallerQuarantine-')) {
                const fullFolder = path.join(dDrive, item);
                try {
                    const stat = fs.statSync(fullFolder);
                    if (stat.isDirectory()) {
                        const files = fs.readdirSync(fullFolder);
                        files.forEach(file => {
                            const filePath = path.join(fullFolder, file);
                            try {
                                const fileStat = fs.statSync(filePath);
                                results.push({
                                    folder: item,
                                    name: file,
                                    path: filePath,
                                    sizeBytes: fileStat.size,
                                    dateQuarantined: fileStat.mtime
                                });
                            } catch (e) {}
                        });
                    }
                } catch (e) {}
            }
        });
    } catch (err) {
        console.error("Error reading quarantine folders:", err);
    }
    return results;
}

// Status endpoint
app.get('/api/status', async (req, res) => {
    try {
        const isAdmin = await checkIsAdmin();
        const drive = await getDriveSpace();
        res.json({ isAdmin, drive });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SSE Scan endpoint
app.get('/api/scan', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', { message: 'Starting system scan...' });

    // 1. Temp Files
    sendEvent('scanning', { category: 'temp' });
    const tempSize = await getDirectorySize('C:\\Windows\\Temp');
    sendEvent('scanned', { category: 'temp', sizeBytes: tempSize });

    // 2. Windows Update Cache
    sendEvent('scanning', { category: 'update' });
    const updateSize = await getDirectorySize('C:\\Windows\\SoftwareDistribution\\Download');
    sendEvent('scanned', { category: 'update', sizeBytes: updateSize });

    // 3. Delivery Optimization Cache
    sendEvent('scanning', { category: 'deliveryOpt' });
    const deliveryOptSize = await getDirectorySize('C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache');
    sendEvent('scanned', { category: 'deliveryOpt', sizeBytes: deliveryOptSize });

    // 4. Recycle Bin
    sendEvent('scanning', { category: 'recycleBin' });
    const recycleBinSize = await getRecycleBinSize();
    sendEvent('scanned', { category: 'recycleBin', sizeBytes: recycleBinSize });

    // 5. Installer Orphans (MSI/MSP)
    sendEvent('scanning', { category: 'installers' });
    
    const scriptPath = path.join(__dirname, 'tier3-installer-analyze.ps1');
    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-NonInteractive'
    ]);

    ps.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
            sendEvent('console', { text });
        }
    });

    ps.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
            sendEvent('console', { text: `[ERROR] ${text}` });
        }
    });

    ps.on('close', async () => {
        const orphanListPath = path.join(__dirname, 'tier3-orphans.txt');
        let installerSize = 0;
        if (fs.existsSync(orphanListPath)) {
            try {
                const content = fs.readFileSync(orphanListPath, 'utf8');
                content.split(/\r?\n/).forEach(line => {
                    if (line.trim()) {
                        const parts = line.split('\t');
                        if (parts.length === 2) {
                            const size = parseInt(parts[1], 10);
                            if (!isNaN(size)) {
                                installerSize += size;
                            }
                        }
                    }
                });
            } catch (err) {
                console.error("Error reading orphans file:", err);
            }
        }
        sendEvent('scanned', { category: 'installers', sizeBytes: installerSize });
        sendEvent('complete', { message: 'Scan completed!' });
        res.end();
    });
});

// SSE Clean endpoint
app.get('/api/clean', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const categories = (req.query.categories || '').split(',');
    
    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', { message: 'Starting cleanup process...' });

    const runScript = (command, args = []) => {
        return new Promise((resolve) => {
            const ps = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                ...args,
                '-Command', command
            ]);

            ps.stdout.on('data', (data) => {
                sendEvent('console', { text: data.toString().trim() });
            });

            ps.stderr.on('data', (data) => {
                sendEvent('console', { text: `[ERROR] ${data.toString().trim()}` });
            });

            ps.on('close', (code) => {
                resolve(code);
            });
        });
    };

    // Clean Windows Temp
    if (categories.includes('temp')) {
        sendEvent('status', { message: 'Cleaning System Temp files...' });
        const cmd = `
            Write-Host "Clearing C:\\Windows\\Temp..." -ForegroundColor Cyan
            $winTemp = 'C:\\Windows\\Temp'
            if (Test-Path $winTemp) {
                $errors = 0
                Get-ChildItem -LiteralPath $winTemp -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch { $errors++ }
                }
                Write-Host "Completed. Locked/skipped files: $errors" -ForegroundColor Green
            } else {
                Write-Host "Folder not found." -ForegroundColor Yellow
            }
        `;
        await runScript(cmd);
    }

    // Clean Windows Update Cache
    if (categories.includes('update')) {
        sendEvent('status', { message: 'Cleaning Windows Update Cache...' });
        const cmd = `
            Write-Host "Clearing Windows Update download cache..." -ForegroundColor Cyan
            $swPath = 'C:\\Windows\\SoftwareDistribution\\Download'
            if (Test-Path $swPath) {
                Write-Host "Stopping wuauserv service..."
                & sc.exe stop wuauserv | Out-Null
                Start-Sleep -Seconds 2
                $deleted = 0
                Get-ChildItem -LiteralPath $swPath -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    try {
                        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
                        $deleted++
                    } catch {}
                }
                Write-Host "Successfully deleted $deleted cache files/folders." -ForegroundColor Green
                Write-Host "Restarting wuauserv service..."
                try { Start-Service wuauserv -ErrorAction Stop; Write-Host "wuauserv service restarted successfully." } catch { Write-Host "Failed to start wuauserv: $_" -ForegroundColor Yellow }
            } else {
                Write-Host "Folder not found." -ForegroundColor Yellow
            }
        `;
        await runScript(cmd);
    }

    // Clean Delivery Optimization Cache
    if (categories.includes('deliveryOpt')) {
        sendEvent('status', { message: 'Cleaning Delivery Optimization Cache...' });
        const cmd = `
            Write-Host "Clearing Delivery Optimization cache..." -ForegroundColor Cyan
            $doCache = 'C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache'
            if (Test-Path $doCache) {
                Write-Host "Stopping DoSvc service..."
                & sc.exe stop DoSvc | Out-Null
                Start-Sleep -Seconds 2
                Get-ChildItem -LiteralPath $doCache -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch {}
                }
                Write-Host "Cache cleared." -ForegroundColor Green
                Write-Host "Restarting DoSvc service..."
                try { Start-Service DoSvc -ErrorAction Stop } catch {}
            } else {
                Write-Host "Folder not found." -ForegroundColor Yellow
            }
        `;
        await runScript(cmd);
    }

    // Clean Recycle Bin
    if (categories.includes('recycleBin')) {
        sendEvent('status', { message: 'Emptying Recycle Bin...' });
        const cmd = `
            Write-Host "Emptying Recycle Bin..." -ForegroundColor Cyan
            try {
                Clear-RecycleBin -Force -ErrorAction Stop
                Write-Host "Recycle Bin successfully emptied." -ForegroundColor Green
            } catch {
                Write-Host "Recycle Bin empty or skipped: $_" -ForegroundColor Yellow
            }
        `;
        await runScript(cmd);
    }

    // Clean Installer Orphans (MSI/MSP Quarantine)
    if (categories.includes('installers')) {
        sendEvent('status', { message: 'Moving orphaned installer files (MSI/MSP) to quarantine...' });
        
        const scriptPath = path.join(__dirname, 'tier3-installer-move.ps1');
        
        await new Promise((resolve) => {
            const ps = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath,
                '-NonInteractive',
                '-Force'
            ]);

            ps.stdout.on('data', (data) => {
                sendEvent('console', { text: data.toString().trim() });
            });

            ps.stderr.on('data', (data) => {
                sendEvent('console', { text: `[ERROR] ${data.toString().trim()}` });
            });

            ps.on('close', () => {
                resolve();
            });
        });
    }

    // Run Full Deep System Optimization (DISM Cleanup)
    if (categories.includes('dism')) {
        sendEvent('status', { message: 'Running DISM Component Cleanup (May take 5-15 minutes)...' });
        const cmd = `
            Write-Host "Running DISM Analyze & Component Cleanup..." -ForegroundColor Cyan
            Write-Host "Analyzing component store..."
            & dism.exe /online /cleanup-image /analyzecomponentstore
            Write-Host "Starting component cleanup with ResetBase..."
            Write-Host "Warning: Installed Windows updates cannot be uninstalled after this." -ForegroundColor Yellow
            & dism.exe /online /cleanup-image /startcomponentcleanup /resetbase
            Write-Host "DISM Component Cleanup completed!" -ForegroundColor Green
        `;
        await runScript(cmd);
    }

    // Finished
    sendEvent('status', { message: 'Cleanup completed!' });
    
    // Get updated drive status
    const drive = await getDriveSpace();
    sendEvent('complete', { message: 'All cleaning operations completed!', drive });
    res.end();
});

// STARTUP ENDPOINTS
app.get('/api/startup', (req, res) => {
    const helperScript = path.join(__dirname, 'helpers.ps1');
    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', helperScript,
        '-Action', 'GetStartup'
    ]);

    let output = '';
    ps.stdout.on('data', (data) => { output += data.toString(); });
    ps.on('close', () => {
        try {
            res.json(JSON.parse(output.trim() || '[]'));
        } catch (e) {
            res.json([]);
        }
    });
});

app.post('/api/startup/toggle', (req, res) => {
    const { name, hive, enable } = req.body;
    const helperScript = path.join(__dirname, 'helpers.ps1');
    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', helperScript,
        '-Action', 'ToggleStartup',
        '-Name', name,
        '-Hive', hive,
        '-Enable', String(enable)
    ]);

    let output = '';
    ps.stdout.on('data', (data) => { output += data.toString(); });
    ps.on('close', () => {
        const text = output.trim();
        const success = text.startsWith('SUCCESS');
        res.json({ success, message: text });
    });
});

// QUARANTINE ENDPOINTS
app.get('/api/quarantine', (req, res) => {
    res.json(getQuarantineFiles());
});

app.post('/api/quarantine/restore', async (req, res) => {
    const { files } = req.body; // Array of { path, name }
    if (!files || files.length === 0) {
        return res.json({ success: true, message: 'No files to restore.' });
    }

    // Run powershell block to move files back to C:\Windows\Installer
    const commands = files.map(f => {
        const escapedPath = f.path.replace(/'/g, "''");
        const escapedName = f.name.replace(/'/g, "''");
        return `
            if (Test-Path -LiteralPath '${escapedPath}') {
                Move-Item -LiteralPath '${escapedPath}' -Destination 'C:\\Windows\\Installer\\${escapedName}' -Force
                Write-Host "SUCCESS: ${escapedName} restored"
            } else {
                Write-Host "ERROR: ${escapedName} not found in quarantine"
            }
        `;
    }).join('\n');

    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', commands
    ]);

    let output = '';
    ps.stdout.on('data', (data) => { output += data.toString(); });
    ps.on('close', () => {
        res.json({ success: true, message: output.trim() });
    });
});

app.post('/api/quarantine/delete', (req, res) => {
    const { files } = req.body; // Array of { path }
    if (!files || files.length === 0) {
        return res.json({ success: true, message: 'No files to delete.' });
    }

    const commands = files.map(f => {
        const escapedPath = f.path.replace(/'/g, "''");
        return `
            if (Test-Path -LiteralPath '${escapedPath}') {
                Remove-Item -LiteralPath '${escapedPath}' -Force
                Write-Host "DELETED: ${escapedPath}"
            }
        `;
    }).join('\n');

    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command', commands
    ]);

    let output = '';
    ps.stdout.on('data', (data) => { output += data.toString(); });
    ps.on('close', () => {
        res.json({ success: true, message: output.trim() });
    });
});

// SYSTEM MONITOR ENDPOINT
app.get('/api/system-monitor', (req, res) => {
    const helperScript = path.join(__dirname, 'helpers.ps1');
    const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', helperScript,
        '-Action', 'GetSystem'
    ]);

    let output = '';
    ps.stdout.on('data', (data) => { output += data.toString(); });
    ps.on('close', () => {
        try {
            res.json(JSON.parse(output.trim()));
        } catch (e) {
            res.status(500).json({ error: 'Failed to load hardware info.' });
        }
    });
});

// Start Express App
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});
