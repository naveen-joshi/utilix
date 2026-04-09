import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEMP_ROOT_NAME = 'temp-workspace';

function getTempRootPath(): string {
    return path.join(app.getPath('userData'), TEMP_ROOT_NAME);
}

async function ensureSecureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });

    if (process.platform !== 'win32') {
        await fs.chmod(dirPath, 0o700);
    }
}

export async function createScopedTempDir(prefix: string): Promise<string> {
    const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'tmp';
    const root = getTempRootPath();
    await ensureSecureDirectory(root);

    const dir = await fs.mkdtemp(path.join(root, `${safePrefix}-`));
    if (process.platform !== 'win32') {
        await fs.chmod(dir, 0o700);
    }

    return dir;
}

export function isManagedTempPath(targetPath: string): boolean {
    const root = path.resolve(getTempRootPath());
    const resolved = path.resolve(targetPath);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function removeManagedTempPath(targetPath: string): Promise<void> {
    if (!isManagedTempPath(targetPath)) {
        throw new Error('Path is outside managed temp workspace.');
    }

    await fs.rm(targetPath, { recursive: true, force: true });
}

export async function cleanupStaleTempDirs(maxAgeMs: number): Promise<void> {
    const root = getTempRootPath();

    try {
        await fs.access(root);
    } catch {
        return;
    }

    const now = Date.now();
    const entries = await fs.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const target = path.join(root, entry.name);
        try {
            const stats = await fs.stat(target);
            if (now - stats.mtimeMs > maxAgeMs) {
                await fs.rm(target, { recursive: true, force: true });
            }
        } catch {
            // Ignore cleanup failures for individual stale folders.
        }
    }
}
