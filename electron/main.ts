import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import * as fs from 'fs';
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

function startupLogPath(): string {
    return path.join(app.getPath('userData'), 'startup.log');
}

function writeStartupLog(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        fs.appendFileSync(startupLogPath(), line, 'utf-8');
    } catch {
        // Logging must never block startup.
    }
}

function buildStartupErrorHtml(message: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Utilix Startup Error</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; background: #111827; color: #e5e7eb; }
    .card { max-width: 900px; margin: 0 auto; border: 1px solid #374151; border-radius: 10px; padding: 20px; background: #1f2937; }
    h1 { margin-top: 0; font-size: 20px; }
    p, pre { font-size: 14px; line-height: 1.5; }
    pre { white-space: pre-wrap; word-break: break-word; background: #111827; border-radius: 8px; padding: 12px; border: 1px solid #374151; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Utilix Could Not Start Correctly</h1>
    <p>The app could not load the renderer. Please reinstall or contact support with the message below.</p>
    <pre>${message}</pre>
  </div>
</body>
</html>`;
}

function showStartupErrorPage(window: BrowserWindow, message: string): void {
    writeStartupLog(`Startup error: ${message}`);
    const html = buildStartupErrorHtml(message);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function resolveRendererEntryPath(): string {
    const appPath = app.getAppPath();
    const candidates = [
        path.join(appPath, 'dist', 'utilix', 'browser', 'index.html'),
        path.join(appPath, 'dist', 'browser', 'index.html'),
        path.join(__dirname, '../dist/utilix/browser/index.html'),
        path.join(__dirname, '../dist/browser/index.html'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            writeStartupLog(`Renderer entry resolved: ${candidate}`);
            return candidate;
        }
    }

    const tried = candidates.join(' | ');
    throw new Error(`Renderer index not found. Tried: ${tried}`);
}

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

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        if (!mainWindow) {
            return;
        }

        const details = `did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`;
        showStartupErrorPage(mainWindow, details);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        if (!mainWindow) {
            return;
        }

        const info = `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`;
        showStartupErrorPage(mainWindow, info);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        const currentUrl = mainWindow?.webContents.getURL() ?? 'unknown';
        writeStartupLog(`Renderer loaded URL: ${currentUrl}`);
    });

    // In development, load from Angular dev server
    // In production, load the built index.html
    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:4200');
        mainWindow.webContents.openDevTools();
    } else {
        try {
            const entryPath = resolveRendererEntryPath();
            void mainWindow.loadFile(entryPath).catch(error => {
                if (mainWindow) {
                    const message = error instanceof Error ? error.message : 'Unknown loadFile error.';
                    showStartupErrorPage(mainWindow, `loadFile failure: ${message}`);
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown renderer path resolution error.';
            showStartupErrorPage(mainWindow, message);
        }
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
