import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface ElectronAPI {
    getPathForFile: (file: File) => string;
    getSavePreferences: () => Promise<unknown>;
    updateSavePreferences: (preferences: unknown) => Promise<unknown>;
    pickSaveDirectory: () => Promise<string | null>;
    saveWithPreferences: (options: unknown) => Promise<unknown>;
    fileConvert: (options: unknown) => Promise<unknown>;
    fileCancelConversion: (jobId: string) => Promise<unknown>;
    fileConversionCapabilities: () => Promise<unknown>;
    filePreview: (filePath: string, category?: string) => Promise<unknown>;
    imageResize: (options: unknown) => Promise<unknown>;
    imageConvert: (options: unknown) => Promise<unknown>;
    imageCrop: (options: unknown) => Promise<unknown>;
    imageRotate: (options: unknown) => Promise<unknown>;
    imageSvgConvert: (options: unknown) => Promise<unknown>;
    imageRemoveBackground: (options: unknown) => Promise<unknown>;
    imageGenerateFavicon: (options: unknown) => Promise<unknown>;
    imageGetMetadata: (filePath: string) => Promise<unknown>;
    imageGeneratePreview: (filePath: string, maxWidth: number, maxHeight: number) => Promise<unknown>;
    pdfCompress: (options: unknown) => Promise<unknown>;
    pdfMerge: (options: unknown) => Promise<unknown>;
    pdfExtractRange: (options: unknown) => Promise<unknown>;
    pdfRotatePages: (options: unknown) => Promise<unknown>;
    pdfDeletePages: (options: unknown) => Promise<unknown>;
    pdfUpdateMetadata: (options: unknown) => Promise<unknown>;
    pdfGetMetadata: (filePath: string, password?: string) => Promise<unknown>;
    pdfGeneratePreview: (filePath: string, pageNumber: number, password?: string) => Promise<unknown>;
    pdfEncrypt: (options: unknown) => Promise<unknown>;
    pdfDecrypt: (options: unknown) => Promise<unknown>;
    pdfWatermarkText: (options: unknown) => Promise<unknown>;
    pdfBackendStatus: () => Promise<unknown>;
    pdfBackendRestart: () => Promise<unknown>;
    videoConvert: (options: unknown) => Promise<unknown>;
    fileCopyTo: (sourcePath: string, destPath: string) => Promise<void>;
    getLocalVideoUrl: (filePath: string) => string;
    onVideoProgress: (callback: (data: { percent: number | undefined; timemark: string; currentKbps: number | undefined }) => void) => (() => void);
    showSaveDialog: (options: unknown) => Promise<unknown>;
    showOpenDialog: (options: unknown) => Promise<unknown>;
    saveFile: (filePath: string, data: ArrayBuffer) => Promise<void>;
    readFileBase64: (filePath: string) => Promise<string>;
}

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    getSavePreferences: () => ipcRenderer.invoke('settings:get-save-preferences'),
    updateSavePreferences: (preferences: unknown) => ipcRenderer.invoke('settings:update-save-preferences', preferences),
    pickSaveDirectory: () => ipcRenderer.invoke('settings:pick-save-directory'),
    saveWithPreferences: (options: unknown) => ipcRenderer.invoke('file:save-with-preferences', options),
    fileConvert: (options: unknown) => ipcRenderer.invoke('file:convert', options),
    fileCancelConversion: (jobId: string) => ipcRenderer.invoke('file:cancel-conversion', jobId),
    fileConversionCapabilities: () => ipcRenderer.invoke('file:conversion-capabilities'),
    filePreview: (filePath: string, category?: string) => ipcRenderer.invoke('file:preview', filePath, category),
    imageResize: (options: unknown) => ipcRenderer.invoke('image:resize', options),
    imageConvert: (options: unknown) => ipcRenderer.invoke('image:convert', options),
    imageCrop: (options: unknown) => ipcRenderer.invoke('image:crop', options),
    imageRotate: (options: unknown) => ipcRenderer.invoke('image:rotate', options),
    imageSvgConvert: (options: unknown) => ipcRenderer.invoke('image:svg-convert', options),
    imageRemoveBackground: (options: unknown) => ipcRenderer.invoke('image:remove-background', options),
    imageGenerateFavicon: (options: unknown) => ipcRenderer.invoke('image:favicon', options),
    imageGetMetadata: (filePath: string) => ipcRenderer.invoke('image:get-metadata', filePath),
    imageGeneratePreview: (filePath: string, maxWidth: number, maxHeight: number) =>
        ipcRenderer.invoke('image:generate-preview', filePath, maxWidth, maxHeight),

    pdfCompress: (options: unknown) => ipcRenderer.invoke('pdf:compress', options),
    pdfMerge: (options: unknown) => ipcRenderer.invoke('pdf:merge', options),
    pdfExtractRange: (options: unknown) => ipcRenderer.invoke('pdf:extract-range', options),
    pdfRotatePages: (options: unknown) => ipcRenderer.invoke('pdf:rotate-pages', options),
    pdfDeletePages: (options: unknown) => ipcRenderer.invoke('pdf:delete-pages', options),
    pdfUpdateMetadata: (options: unknown) => ipcRenderer.invoke('pdf:update-metadata', options),
    pdfGetMetadata: (filePath: string, password?: string) => ipcRenderer.invoke('pdf:get-metadata', filePath, password),
    pdfGeneratePreview: (filePath: string, pageNumber: number, password?: string) =>
        ipcRenderer.invoke('pdf:generate-preview', filePath, pageNumber, password),
    pdfEncrypt: (options: unknown) => ipcRenderer.invoke('pdf:encrypt', options),
    pdfDecrypt: (options: unknown) => ipcRenderer.invoke('pdf:decrypt', options),
    pdfWatermarkText: (options: unknown) => ipcRenderer.invoke('pdf:watermark-text', options),
    pdfBackendStatus: () => ipcRenderer.invoke('pdf-backend:status'),
    pdfBackendRestart: () => ipcRenderer.invoke('pdf-backend:restart'),

    videoConvert: (options: unknown) => ipcRenderer.invoke('video:convert', options),
    fileCopyTo: (sourcePath: string, destPath: string) => ipcRenderer.invoke('file:copy-to', sourcePath, destPath),
    getLocalVideoUrl: (filePath: string) => {
        const normalized = filePath.replace(/\\/g, '/');
        return `utilix-media://${normalized}`;
    },
    onVideoProgress: (callback) => {
        type ProgressData = { percent: number | undefined; timemark: string; currentKbps: number | undefined };
        const listener = (_: Electron.IpcRendererEvent, data: ProgressData) => callback(data);
        ipcRenderer.on('video:progress', listener);
        return () => ipcRenderer.removeListener('video:progress', listener);
    },
    showSaveDialog: (options: unknown) => ipcRenderer.invoke('dialog:save', options),
    showOpenDialog: (options: unknown) => ipcRenderer.invoke('dialog:open', options),
    saveFile: (filePath: string, data: ArrayBuffer) =>
        ipcRenderer.invoke('file:save', filePath, data),
    readFileBase64: (filePath: string) => ipcRenderer.invoke('file:read-base64', filePath),
} satisfies ElectronAPI);
