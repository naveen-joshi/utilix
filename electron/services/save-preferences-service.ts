import { app, dialog, ipcMain, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export type SaveMode = 'ask' | 'auto';

export interface SavePreferences {
    mode: SaveMode;
    defaultDirectory: string;
}

export interface SaveWithPreferencesOptions {
    suggestedName: string;
    data: ArrayBuffer;
    filters?: Array<{ name: string; extensions: string[] }>;
    forceAsk?: boolean;
}

export interface SaveWithPreferencesResult {
    saved: boolean;
    canceled?: boolean;
    filePath?: string;
    usedMode: SaveMode;
}

const defaultPreferences: SavePreferences = {
    mode: 'ask',
    defaultDirectory: '',
};

let cachedPreferences: SavePreferences | null = null;

interface StoredPreferences {
    version: 1;
    algorithm: 'safeStorage' | 'plain';
    payload: string;
}

function getPreferencesFilePath(): string {
    return path.join(app.getPath('userData'), 'utilix-preferences.enc');
}

function getLegacyPreferencesFilePath(): string {
    return path.join(app.getPath('userData'), 'utilix-preferences.json');
}

function sanitizeFileName(name: string): string {
    const fallback = 'output.bin';
    const trimmed = (name || '').trim();
    const safe = trimmed.replace(/[\\/:*?"<>|]/g, '_');
    return safe.length > 0 ? safe : fallback;
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function getUniqueFilePath(targetPath: string): Promise<string> {
    if (!(await pathExists(targetPath))) {
        return targetPath;
    }

    const parsed = path.parse(targetPath);
    for (let attempt = 1; attempt < 500; attempt++) {
        const candidate = path.join(parsed.dir, `${parsed.name} (${attempt})${parsed.ext}`);
        if (!(await pathExists(candidate))) {
            return candidate;
        }
    }

    throw new Error('Could not resolve a unique output file name.');
}

function normalizePreferences(input: Partial<SavePreferences> | null | undefined): SavePreferences {
    const mode = input?.mode === 'auto' ? 'auto' : 'ask';
    const defaultDirectory = (input?.defaultDirectory ?? '').trim();

    return {
        mode,
        defaultDirectory,
    };
}

function encodeStoredPreferences(preferences: SavePreferences): string {
    const payloadJson = JSON.stringify(preferences);
    const canEncrypt = safeStorage.isEncryptionAvailable();

    if (canEncrypt) {
        const encrypted = safeStorage.encryptString(payloadJson);
        const stored: StoredPreferences = {
            version: 1,
            algorithm: 'safeStorage',
            payload: encrypted.toString('base64'),
        };
        return JSON.stringify(stored);
    }

    const stored: StoredPreferences = {
        version: 1,
        algorithm: 'plain',
        payload: Buffer.from(payloadJson, 'utf-8').toString('base64'),
    };
    return JSON.stringify(stored);
}

function decodeStoredPreferences(raw: string): SavePreferences {
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    const algorithm = parsed.algorithm;
    const payload = parsed.payload;

    if ((algorithm !== 'safeStorage' && algorithm !== 'plain') || !payload) {
        throw new Error('Invalid preferences format');
    }

    if (algorithm === 'safeStorage') {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Encrypted preferences are unavailable on this system session.');
        }

        const decrypted = safeStorage.decryptString(Buffer.from(payload, 'base64'));
        const preferences = JSON.parse(decrypted) as Partial<SavePreferences>;
        return {
            ...defaultPreferences,
            ...normalizePreferences(preferences),
        };
    }

    const plainText = Buffer.from(payload, 'base64').toString('utf-8');
    const preferences = JSON.parse(plainText) as Partial<SavePreferences>;
    return {
        ...defaultPreferences,
        ...normalizePreferences(preferences),
    };
}

async function loadPreferences(): Promise<SavePreferences> {
    if (cachedPreferences) {
        return cachedPreferences;
    }

    const filePath = getPreferencesFilePath();
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        cachedPreferences = decodeStoredPreferences(raw);
    } catch {
        try {
            const legacyPath = getLegacyPreferencesFilePath();
            const legacyRaw = await fs.readFile(legacyPath, 'utf-8');
            const legacyParsed = JSON.parse(legacyRaw) as Partial<SavePreferences>;
            const migrated = {
                ...defaultPreferences,
                ...normalizePreferences(legacyParsed),
            };

            await persistPreferences(migrated);
            cachedPreferences = migrated;

            // Best-effort cleanup of the legacy plaintext file after migration.
            await fs.rm(legacyPath, { force: true });
        } catch {
            cachedPreferences = { ...defaultPreferences };
        }
    }

    return cachedPreferences;
}

async function persistPreferences(preferences: SavePreferences): Promise<SavePreferences> {
    cachedPreferences = preferences;
    const filePath = getPreferencesFilePath();
    const encoded = encodeStoredPreferences(preferences);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, encoded, 'utf-8');
    return preferences;
}

async function updatePreferences(input: Partial<SavePreferences>): Promise<SavePreferences> {
    const current = await loadPreferences();
    const next = {
        ...current,
        ...normalizePreferences(input),
    };

    if (next.mode === 'auto' && !next.defaultDirectory) {
        throw new Error('Default directory is required when save mode is automatic.');
    }

    return persistPreferences(next);
}

async function pickSaveDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
}

async function saveWithPreferences(options: SaveWithPreferencesOptions): Promise<SaveWithPreferencesResult> {
    if (!options?.data) {
        throw new Error('No file data was provided.');
    }

    const preferences = await loadPreferences();
    const suggestedName = sanitizeFileName(options.suggestedName);
    const mode: SaveMode = options.forceAsk ? 'ask' : preferences.mode;

    let filePath: string | undefined;

    if (mode === 'auto' && preferences.defaultDirectory) {
        await fs.mkdir(preferences.defaultDirectory, { recursive: true });
        const targetPath = path.join(preferences.defaultDirectory, suggestedName);
        filePath = await getUniqueFilePath(targetPath);
    } else {
        const saveDialogResult = await dialog.showSaveDialog({
            defaultPath: suggestedName,
            filters: options.filters,
        });

        if (saveDialogResult.canceled || !saveDialogResult.filePath) {
            return {
                saved: false,
                canceled: true,
                usedMode: 'ask',
            };
        }

        filePath = saveDialogResult.filePath;
    }

    await fs.writeFile(filePath, Buffer.from(options.data));

    return {
        saved: true,
        filePath,
        usedMode: mode,
    };
}

export function registerSavePreferenceHandlers(): void {
    ipcMain.handle('settings:get-save-preferences', async () => {
        return loadPreferences();
    });

    ipcMain.handle('settings:update-save-preferences', async (_event, input: Partial<SavePreferences>) => {
        return updatePreferences(input);
    });

    ipcMain.handle('settings:pick-save-directory', async () => {
        return pickSaveDirectory();
    });

    ipcMain.handle('file:save-with-preferences', async (_event, options: SaveWithPreferencesOptions) => {
        return saveWithPreferences(options);
    });
}
