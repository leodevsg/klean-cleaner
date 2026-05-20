const { app, BrowserWindow } = require('electron');
const path = require('path');

// Launch the Express server in the background
require('./server.js');

function createWindow() {
    // Create the browser window.
    const win = new BrowserWindow({
        width: 1024,
        height: 768,
        minWidth: 900,
        minHeight: 650,
        title: 'Klean - Windows Optimizer',
        icon: path.join(__dirname, 'public', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Remove menu bar
    win.removeMenu();

    // Load the local Express server URL
    win.loadURL('http://127.0.0.1:3000');

    // Handle window close
    win.on('closed', () => {
        // App termination will clean up backend processes
    });
}

// Electron initialization completed
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
