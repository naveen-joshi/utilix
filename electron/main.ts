import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { registerImageHandlers } from './services/image-service';
import { registerPdfHandlers } from './services/pdf-service';
import { registerFileConversionHandlers } from './services/file-conversion-service';
import { registerSavePreferenceHandlers } from './services/save-preferences-service';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Utilix',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    // In development, load from Angular dev server
    // In production, load the built index.html
    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:4200');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/utilix/browser/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    registerImageHandlers();
    registerPdfHandlers();
    registerFileConversionHandlers();
    registerSavePreferenceHandlers();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
