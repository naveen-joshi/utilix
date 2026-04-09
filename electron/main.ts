import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import * as path from 'path';
import { registerImageHandlers } from './services/image-service';
import { registerPdfHandlers } from './services/pdf-service';
import { registerFileConversionHandlers } from './services/file-conversion-service';
import { registerSavePreferenceHandlers } from './services/save-preferences-service';
import { registerVideoHandlers } from './services/video-service';
import { cleanupStaleTempDirs } from './services/temp-file-manager';
import {
    ensurePdfBackendRunning,
    registerPdfBackendHandlers,
    stopPdfBackend,
} from './services/pdf-backend-bridge';

// Must be called before app is ready.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'utilix-media',
        privileges: { secure: true, stream: true, bypassCSP: true, corsEnabled: true },
    },
]);

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
    // Serve local media files through a secure custom scheme so the renderer's
    // <video> element can stream them (including Range/seek support).
    protocol.handle('utilix-media', request => {
        const withoutScheme = request.url.slice('utilix-media://'.length);
        // Unix absolute paths start with '/', Windows paths start with a drive letter.
        const fileUrl = withoutScheme.startsWith('/')
            ? `file://${withoutScheme}`
            : `file:///${withoutScheme}`;
        // Forward headers so Range requests (video seeking) work correctly.
        return net.fetch(fileUrl, { headers: request.headers });
    });

    // Remove abandoned temp job folders older than one day.
    void cleanupStaleTempDirs(24 * 60 * 60 * 1000);

    registerImageHandlers();
    registerPdfHandlers();
    registerPdfBackendHandlers();
    registerFileConversionHandlers();
    registerSavePreferenceHandlers();
    registerVideoHandlers();

    // Best-effort warm-up for PDF backend so advanced actions are ready faster.
    void ensurePdfBackendRunning().catch(() => {
        // Backend stays optional in local builds if Python deps are not installed.
    });

    createWindow();
});

app.on('before-quit', () => {
    void stopPdfBackend();
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
