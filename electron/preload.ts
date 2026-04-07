import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface ElectronAPI {
    getPathForFile: (file: File) => string;
    getSavePreferences: () => Promise<unknown>;
    updateSavePreferences: (preferences: unknown) => Promise<unknown>;
    pickSaveDirectory: () => Promise<string | null>;
    saveWithPreferences: (options: unknown) => Promise<unknown>;
    fileConvert: (options: unknown) => Promise<unknown>;
    fileConversionCapabilities: () => Promise<unknown>;
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
    pdfGetMetadata: (filePath: string) => Promise<unknown>;
    pdfGeneratePreview: (filePath: string, pageNumber: number) => Promise<unknown>;
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
    fileConversionCapabilities: () => ipcRenderer.invoke('file:conversion-capabilities'),
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
    pdfGetMetadata: (filePath: string) => ipcRenderer.invoke('pdf:get-metadata', filePath),
    pdfGeneratePreview: (filePath: string, pageNumber: number) =>
        ipcRenderer.invoke('pdf:generate-preview', filePath, pageNumber),

    showSaveDialog: (options: unknown) => ipcRenderer.invoke('dialog:save', options),
    showOpenDialog: (options: unknown) => ipcRenderer.invoke('dialog:open', options),
    saveFile: (filePath: string, data: ArrayBuffer) =>
        ipcRenderer.invoke('file:save', filePath, data),
    readFileBase64: (filePath: string) => ipcRenderer.invoke('file:read-base64', filePath),
} satisfies ElectronAPI);
