import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ElectronService {
    private get api() {
        return window.electronAPI;
    }

    get isElectron(): boolean {
        return !!(window && window.electronAPI);
    }

    getPathForFile(file: File): string {
        if (!this.isElectron) {
            return '';
        }

        if (typeof this.api.getPathForFile === 'function') {
            return this.api.getPathForFile(file);
        }

        return (file as unknown as { path?: string }).path ?? '';
    }

    async getSavePreferences(): Promise<unknown> {
        return this.api.getSavePreferences();
    }

    async updateSavePreferences(preferences: unknown): Promise<unknown> {
        return this.api.updateSavePreferences(preferences);
    }

    async pickSaveDirectory(): Promise<string | null> {
        return this.api.pickSaveDirectory();
    }

    async saveWithPreferences(options: unknown): Promise<unknown> {
        return this.api.saveWithPreferences(options);
    }

    async fileConvert(options: unknown): Promise<unknown> {
        return this.api.fileConvert(options);
    }

    async fileCancelConversion(jobId: string): Promise<unknown> {
        return this.api.fileCancelConversion(jobId);
    }

    async fileConversionCapabilities(): Promise<unknown> {
        return this.api.fileConversionCapabilities();
    }

    async filePreview(filePath: string, category?: string): Promise<unknown> {
        return this.api.filePreview(filePath, category);
    }

    async imageResize(options: unknown): Promise<unknown> {
        return this.api.imageResize(options);
    }

    async imageConvert(options: unknown): Promise<unknown> {
        return this.api.imageConvert(options);
    }

    async imageCrop(options: unknown): Promise<unknown> {
        return this.api.imageCrop(options);
    }

    async imageRotate(options: unknown): Promise<unknown> {
        return this.api.imageRotate(options);
    }

    async imageSvgConvert(options: unknown): Promise<unknown> {
        return this.api.imageSvgConvert(options);
    }

    async imageRemoveBackground(options: unknown): Promise<unknown> {
        return this.api.imageRemoveBackground(options);
    }

    async imageGenerateFavicon(options: unknown): Promise<unknown> {
        return this.api.imageGenerateFavicon(options);
    }

    async imageGetMetadata(filePath: string): Promise<unknown> {
        return this.api.imageGetMetadata(filePath);
    }

    async imageGeneratePreview(filePath: string, maxWidth: number, maxHeight: number): Promise<unknown> {
        return this.api.imageGeneratePreview(filePath, maxWidth, maxHeight);
    }

    async pdfCompress(options: unknown): Promise<unknown> {
        return this.api.pdfCompress(options);
    }

    async pdfMerge(options: unknown): Promise<unknown> {
        return this.api.pdfMerge(options);
    }

    async pdfExtractRange(options: unknown): Promise<unknown> {
        return this.api.pdfExtractRange(options);
    }

    async pdfRotatePages(options: unknown): Promise<unknown> {
        return this.api.pdfRotatePages(options);
    }

    async pdfDeletePages(options: unknown): Promise<unknown> {
        return this.api.pdfDeletePages(options);
    }

    async pdfUpdateMetadata(options: unknown): Promise<unknown> {
        return this.api.pdfUpdateMetadata(options);
    }

    async pdfGetMetadata(filePath: string, password?: string): Promise<unknown> {
        return this.api.pdfGetMetadata(filePath, password);
    }

    async pdfEncrypt(options: unknown): Promise<unknown> {
        return this.api.pdfEncrypt(options);
    }

    async pdfDecrypt(options: unknown): Promise<unknown> {
        return this.api.pdfDecrypt(options);
    }

    async pdfWatermarkText(options: unknown): Promise<unknown> {
        return this.api.pdfWatermarkText(options);
    }

    async pdfBackendStatus(): Promise<unknown> {
        return this.api.pdfBackendStatus();
    }

    async pdfBackendRestart(): Promise<unknown> {
        return this.api.pdfBackendRestart();
    }

    async showSaveDialog(options: unknown): Promise<unknown> {
        return this.api.showSaveDialog(options);
    }

    async showOpenDialog(options: unknown): Promise<unknown> {
        return this.api.showOpenDialog(options);
    }

    async saveFile(filePath: string, data: ArrayBuffer): Promise<void> {
        return this.api.saveFile(filePath, data);
    }

    async readFileBase64(filePath: string): Promise<string> {
        return this.api.readFileBase64(filePath);
    }

    async videoConvert(options: unknown): Promise<unknown> {
        return this.api.videoConvert(options);
    }

    async fileCopyTo(sourcePath: string, destPath: string): Promise<void> {
        return this.api.fileCopyTo(sourcePath, destPath);
    }

    getLocalVideoUrl(filePath: string): string {
        return this.api.getLocalVideoUrl(filePath);
    }

    onVideoProgress(
        callback: (data: { percent: number | undefined; timemark: string; currentKbps: number | undefined }) => void
    ): () => void {
        return this.api.onVideoProgress(callback);
    }
}
