import { app, ipcMain } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

type BackendMode = 'bundled' | 'dev' | 'unavailable';

interface BackendLaunchTarget {
    command: string;
    args: string[];
    cwd?: string;
    mode: BackendMode;
    message: string;
}

export interface PdfBackendStatus {
    running: boolean;
    mode: BackendMode;
    port?: number;
    message: string;
    lastError?: string;
}

const BACKEND_HOST = '127.0.0.1';
const START_PORT = 3400;
const MAX_PORT_ATTEMPTS = 80;
const HEALTH_TIMEOUT_MS = 25_000;
const HEALTH_RETRY_MS = 300;

let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendPort: number | null = null;
let backendMode: BackendMode = 'unavailable';
let backendMessage = 'PDF backend has not been started.';
let lastError: string | undefined;
let startingPromise: Promise<void> | null = null;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function findFreePort(startPort = START_PORT, attempts = MAX_PORT_ATTEMPTS): Promise<number> {
    for (let offset = 0; offset < attempts; offset++) {
        const port = startPort + offset;
        const available = await new Promise<boolean>(resolve => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port, BACKEND_HOST);
        });

        if (available) {
            return port;
        }
    }

    throw new Error('Could not find an open port for the PDF backend.');
}

async function resolveLaunchTarget(): Promise<BackendLaunchTarget> {
    if (app.isPackaged) {
        const resourceRoot = process.resourcesPath;
        const exeCandidates = process.platform === 'win32'
            ? [
                path.join(resourceRoot, 'python-backend', 'pdf_processor.exe'),
            ]
            : [
                path.join(resourceRoot, 'python-backend', 'pdf_processor'),
            ];

        for (const candidate of exeCandidates) {
            if (await fileExists(candidate)) {
                return {
                    command: candidate,
                    args: [],
                    cwd: path.dirname(candidate),
                    mode: 'bundled',
                    message: 'Using bundled Python PDF backend.',
                };
            }
        }

        return {
            command: '',
            args: [],
            mode: 'unavailable',
            message: 'Bundled PDF backend executable was not found in app resources.',
        };
    }

    const scriptPath = path.join(app.getAppPath(), 'python-backend', 'server.py');
    if (!(await fileExists(scriptPath))) {
        return {
            command: '',
            args: [],
            mode: 'unavailable',
            message: 'python-backend/server.py was not found in the project root.',
        };
    }

    const pythonBin = process.env.UTILIX_PYTHON_BIN
        || (process.platform === 'win32' ? 'python' : 'python3');

    return {
        command: pythonBin,
        args: [scriptPath],
        cwd: path.dirname(scriptPath),
        mode: 'dev',
        message: 'Using development Python PDF backend script.',
    };
}

async function waitForHealthyBackend(port: number): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    const healthUrl = `http://${BACKEND_HOST}:${port}/health`;

    while (Date.now() < deadline) {
        if (backendProcess?.killed) {
            throw new Error('PDF backend process exited before becoming healthy.');
        }

        try {
            const response = await fetch(healthUrl, { method: 'GET' });
            if (response.ok) {
                return;
            }
        } catch {
            // Backend might still be booting.
        }

        await new Promise(resolve => setTimeout(resolve, HEALTH_RETRY_MS));
    }

    throw new Error('Timed out while waiting for PDF backend health check.');
}

export async function ensurePdfBackendRunning(): Promise<void> {
    if (backendProcess && backendPort) {
        return;
    }

    if (startingPromise) {
        return startingPromise;
    }

    startingPromise = (async () => {
        const launchTarget = await resolveLaunchTarget();
        backendMode = launchTarget.mode;
        backendMessage = launchTarget.message;

        if (launchTarget.mode === 'unavailable') {
            throw new Error(launchTarget.message);
        }

        const port = await findFreePort();
        const args = [...launchTarget.args, '--port', String(port)];

        const processInstance = spawn(launchTarget.command, args, {
            cwd: launchTarget.cwd,
            windowsHide: true,
            stdio: 'pipe',
            env: {
                ...process.env,
                UTILIX_PDF_BACKEND_PORT: String(port),
            },
        });

        backendProcess = processInstance;
        backendPort = port;
        lastError = undefined;

        processInstance.on('exit', (_code, _signal) => {
            backendProcess = null;
            backendPort = null;
        });

        processInstance.on('error', error => {
            lastError = error.message;
        });

        try {
            await waitForHealthyBackend(port);
        } catch (error) {
            processInstance.kill();
            backendProcess = null;
            backendPort = null;
            throw error;
        }
    })();

    try {
        await startingPromise;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown backend startup failure.';
        lastError = message;
        throw error;
    } finally {
        startingPromise = null;
    }
}

export async function stopPdfBackend(): Promise<void> {
    const processInstance = backendProcess;
    if (!processInstance) {
        backendProcess = null;
        backendPort = null;
        return;
    }

    await new Promise<void>(resolve => {
        processInstance.once('exit', () => resolve());
        processInstance.kill();
    });

    backendProcess = null;
    backendPort = null;
}

export async function getPdfBackendStatus(): Promise<PdfBackendStatus> {
    if (!backendProcess || !backendPort) {
        return {
            running: false,
            mode: backendMode,
            message: backendMessage,
            lastError,
        };
    }

    try {
        const response = await fetch(`http://${BACKEND_HOST}:${backendPort}/health`, { method: 'GET' });
        if (!response.ok) {
            return {
                running: false,
                mode: backendMode,
                port: backendPort,
                message: 'PDF backend process exists but health check failed.',
                lastError,
            };
        }
    } catch (error) {
        return {
            running: false,
            mode: backendMode,
            port: backendPort,
            message: 'PDF backend process exists but is unreachable.',
            lastError: error instanceof Error ? error.message : lastError,
        };
    }

    return {
        running: true,
        mode: backendMode,
        port: backendPort,
        message: backendMessage,
        lastError,
    };
}

export async function callPdfBackend<TPayload extends object, TResult>(
    endpoint: string,
    payload: TPayload
): Promise<TResult> {
    await ensurePdfBackendRunning();

    if (!backendPort) {
        throw new Error('PDF backend port is unavailable.');
    }

    const response = await fetch(`http://${BACKEND_HOST}:${backendPort}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const text = await response.text();
        const fallback = `Backend request failed (${response.status}).`;
        throw new Error(text || fallback);
    }

    return response.json() as Promise<TResult>;
}

export function registerPdfBackendHandlers(): void {
    ipcMain.handle('pdf-backend:status', async () => {
        return getPdfBackendStatus();
    });

    ipcMain.handle('pdf-backend:restart', async () => {
        await stopPdfBackend();
        await ensurePdfBackendRunning();
        return getPdfBackendStatus();
    });
}
