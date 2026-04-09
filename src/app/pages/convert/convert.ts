import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { ToastModule } from 'primeng/toast';
import { ElectronService } from '../../services/electron.service';
import { DropzoneFile, FileDropzone } from '../../shared/file-dropzone/file-dropzone';

type ConvertCategory = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'video' | 'unknown';

interface ConvertTargetOption {
    label: string;
    value: string;
}

interface FileConversionResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    originalSize: number;
    newSize: number;
    sourceFormat: string;
    targetFormat: string;
    strategy: 'sharp' | 'pdf-lib' | 'libreoffice' | 'copy' | 'local' | 'ffmpeg';
    message?: string;
}

interface FileConversionCapabilities {
    libreOfficeAvailable: boolean;
    libreOfficePath?: string;
    message: string;
}

interface FilePreviewResult {
    success: boolean;
    category: ConvertCategory;
    sourceFormat: string;
    thumbnailBase64?: string;
    excerpt?: string;
    pageCount?: number;
    message?: string;
}

interface ConvertPreviewData {
    kind: 'image' | 'pdf' | 'text' | 'office' | 'video' | 'unknown';
    thumbnailSrc?: string;
    pdfSrc?: string;
    excerpt?: string;
    pageCount?: number;
    message?: string;
}

interface ConvertFileItem {
    file: DropzoneFile;
    category: ConvertCategory;
    sourceFormat: string;
    targetFormat: string;
    status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
    error?: string;
    preview?: ConvertPreviewData;
    resultPreview?: ConvertPreviewData;
    result?: FileConversionResult;
}

const imageFormats = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg']);
const documentFormats = new Set(['doc', 'docx', 'odt', 'rtf']);
const spreadsheetFormats = new Set(['xls', 'xlsx', 'ods', 'csv']);
const presentationFormats = new Set(['ppt', 'pptx', 'odp']);
const textFormats = new Set(['txt', 'md', 'html', 'htm']);
const videoFormats = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ts', 'mts', 'mxf']);

const targetsByCategory: Record<ConvertCategory, ConvertTargetOption[]> = {
    image: [
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'WebP', value: 'webp' },
        { label: 'AVIF', value: 'avif' },
        { label: 'GIF', value: 'gif' },
        { label: 'SVG', value: 'svg' },
        { label: 'PDF', value: 'pdf' },
    ],
    pdf: [
        { label: 'PDF', value: 'pdf' },
        { label: 'DOCX', value: 'docx' },
        { label: 'TXT', value: 'txt' },
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
    ],
    document: [
        { label: 'PDF', value: 'pdf' },
        { label: 'DOCX', value: 'docx' },
        { label: 'ODT', value: 'odt' },
        { label: 'RTF', value: 'rtf' },
        { label: 'TXT', value: 'txt' },
        { label: 'HTML', value: 'html' },
    ],
    spreadsheet: [
        { label: 'PDF', value: 'pdf' },
        { label: 'XLSX', value: 'xlsx' },
        { label: 'ODS', value: 'ods' },
        { label: 'CSV', value: 'csv' },
    ],
    presentation: [
        { label: 'PDF', value: 'pdf' },
        { label: 'PPTX', value: 'pptx' },
        { label: 'ODP', value: 'odp' },
    ],
    text: [
        { label: 'PDF', value: 'pdf' },
        { label: 'DOCX', value: 'docx' },
        { label: 'HTML', value: 'html' },
        { label: 'TXT', value: 'txt' },
    ],
    video: [
        { label: 'MP4', value: 'mp4' },
        { label: 'WebM', value: 'webm' },
        { label: 'MKV', value: 'mkv' },
        { label: 'MOV', value: 'mov' },
        { label: 'AVI', value: 'avi' },
        { label: 'MP3 (Audio)', value: 'mp3' },
        { label: 'GIF', value: 'gif' },
    ],
    unknown: [],
};

const localTargetsByCategory: Record<ConvertCategory, ReadonlySet<string>> = {
    image: new Set(['png', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'pdf']),
    pdf: new Set(['pdf', 'txt', 'png', 'jpeg']),
    document: new Set(),
    spreadsheet: new Set(),
    presentation: new Set(),
    text: new Set(['txt', 'html', 'pdf']),
    video: new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'gif']),
    unknown: new Set(),
};

@Component({
    selector: 'app-convert',
    imports: [
        FormsModule,
        UpperCasePipe,
        ButtonModule,
        ProgressBarModule,
        SelectModule,
        SliderModule,
        ToastModule,
        FileDropzone,
    ],
    providers: [MessageService],
    templateUrl: './convert.html',
    styleUrl: './convert.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Convert {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);

    protected readonly files = signal<ConvertFileItem[]>([]);
    protected readonly selectedFileIndex = signal(-1);
    protected readonly outputFormat = signal<string>('pdf');
    protected readonly quality = signal(85);
    protected readonly isProcessing = signal(false);
    protected readonly progress = signal(0);
    protected readonly cancelRequested = signal(false);
    protected readonly isCancelling = signal(false);
    protected readonly currentJobId = signal<string | null>(null);
    protected readonly capabilities = signal<FileConversionCapabilities | null>(null);

    protected readonly selectedFileCategory = computed<ConvertCategory>(
        () => this.selectedFile()?.category ?? 'unknown'
    );

    protected readonly targetOptions = computed(() => {
        const category = this.selectedFileCategory();
        const options = targetsByCategory[category] ?? [];

        if (this.capabilities()?.libreOfficeAvailable) {
            return options;
        }

        const localTargets = new Set(localTargetsByCategory[category]);
        const sourceFormat = this.selectedFile()?.sourceFormat;
        if (sourceFormat && localTargets.size > 0) {
            localTargets.add(sourceFormat);
        }

        return options.filter(option => localTargets.has(option.value));
    });

    protected readonly requiresLibreOfficeForCurrentType = computed(() => {
        if (this.capabilities()?.libreOfficeAvailable) {
            return false;
        }

        if (!this.hasFiles()) {
            return false;
        }

        return this.targetOptions().length === 0;
    });

    protected readonly selectedFile = computed(() => {
        const index = this.selectedFileIndex();
        const items = this.files();
        return index >= 0 && index < items.length ? items[index] : null;
    });

    protected readonly selectedSourcePreview = computed(() => this.selectedFile()?.preview ?? null);
    protected readonly selectedResultPreview = computed(() => this.selectedFile()?.resultPreview ?? null);
    protected readonly originalSize = computed(() => this.selectedFile()?.file.size ?? 0);
    protected readonly resultSize = computed(() => this.selectedFile()?.result?.newSize ?? 0);

    protected readonly hasFiles = computed(() => this.files().length > 0);
    protected readonly processedCount = computed(() => this.files().filter(item => item.status === 'done').length);
    protected readonly retryableCount = computed(() =>
        this.files().filter(item => item.status === 'error' || item.status === 'cancelled').length
    );

    protected readonly libreOfficeNotice = computed(() => {
        const capabilities = this.capabilities();
        if (!capabilities) {
            return 'Checking conversion engines...';
        }

        return capabilities.libreOfficeAvailable
            ? 'Advanced office conversion engine detected. All listed routes are available.'
            : 'Running in local mode: image + basic PDF/TXT routes are available. Install LibreOffice for DOCX/XLSX/PPTX and advanced conversions.';
    });

    constructor() {
        void this.loadCapabilities();
    }

    async onFilesSelected(dropzoneFiles: DropzoneFile[]): Promise<void> {
        const filesWithPath = dropzoneFiles.filter(file => Boolean(file.path));
        if (filesWithPath.length === 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Path Missing',
                detail: 'Files did not expose local paths. Re-select in desktop mode.',
            });
            return;
        }

        const categorized = filesWithPath.map(file => {
            const sourceFormat = this.getSourceFormat(file.name);
            const category = this.getCategory(sourceFormat);
            return {
                file,
                sourceFormat,
                category,
                targetFormat: this.getDefaultTargetForCategory(category, sourceFormat),
                status: 'pending' as const,
            };
        });

        const known = categorized.filter(item => item.category !== 'unknown');
        if (known.length === 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Unsupported Files',
                detail: 'Could not determine file formats for conversion.',
            });
            return;
        }

        this.files.update(existing => [...existing, ...known]);

        if (this.selectedFileIndex() < 0) {
            this.selectedFileIndex.set(0);
        }

        this.syncTargetFormat();
        await this.generateMissingPreviews();
    }

    selectFile(index: number): void {
        this.selectedFileIndex.set(index);
        this.syncTargetFormat();
    }

    removeFile(index: number): void {
        this.files.update(files => files.filter((_, currentIndex) => currentIndex !== index));
        const current = this.selectedFileIndex();
        if (current === index) {
            this.selectedFileIndex.set(this.files().length ? 0 : -1);
        } else if (current > index) {
            this.selectedFileIndex.set(current - 1);
        }

        this.syncTargetFormat();
    }

    clearAll(): void {
        this.files.set([]);
        this.selectedFileIndex.set(-1);
        this.progress.set(0);
        this.outputFormat.set('');
    }

    async convertAll(): Promise<void> {
        if (!this.electronService.isElectron) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Desktop Only',
                detail: 'Conversion requires the Electron desktop app runtime.',
            });
            return;
        }

        if (this.isProcessing()) {
            return;
        }

        this.isProcessing.set(true);
        this.cancelRequested.set(false);
        this.currentJobId.set(null);
        this.progress.set(0);

        const items = this.files();
        let convertedCount = 0;

        for (let index = 0; index < items.length; index++) {
            if (this.cancelRequested()) {
                break;
            }

            const item = this.files()[index];
            if (!item) {
                continue;
            }

            if (item.status === 'done') {
                this.progress.set(Math.round(((index + 1) / items.length) * 100));
                continue;
            }

            if (!item.targetFormat) {
                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        status: 'error',
                        error: 'No target format selected for this file.',
                    };
                    return updated;
                });
                continue;
            }

            if (!this.canConvertFile(item, item.targetFormat)) {
                const message = `Conversion ${item.sourceFormat.toUpperCase()} -> ${item.targetFormat.toUpperCase()} requires LibreOffice.`;
                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        status: 'error',
                        error: message,
                    };
                    return updated;
                });
                continue;
            }

            this.files.update(files => {
                const updated = [...files];
                updated[index] = {
                    ...updated[index],
                    status: 'processing',
                    error: undefined,
                };
                return updated;
            });

            const jobId = this.createJobId(index, item.file.name);
            this.currentJobId.set(jobId);

            try {
                const result = (await this.electronService.fileConvert({
                    filePath: item.file.path,
                    targetFormat: item.targetFormat,
                    quality: this.quality(),
                    jobId,
                })) as FileConversionResult;

                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        status: 'done',
                        result,
                        resultPreview: this.buildResultPreview(result),
                        error: undefined,
                    };
                    return updated;
                });
                convertedCount += 1;
            } catch (error) {
                const message = this.getErrorMessage(error);
                const cancelled = this.cancelRequested()
                    && message.toLowerCase().includes('cancel');

                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        status: cancelled ? 'cancelled' : 'error',
                        error: message,
                    };
                    return updated;
                });

                if (!cancelled) {
                    this.messageService.add({
                        severity: 'error',
                        summary: 'Conversion Failed',
                        detail: `Could not convert ${item.file.name}: ${message}`,
                    });
                }

                if (cancelled) {
                    break;
                }
            } finally {
                this.currentJobId.set(null);
            }

            this.progress.set(Math.round(((index + 1) / items.length) * 100));

            if (this.cancelRequested()) {
                break;
            }
        }

        this.isProcessing.set(false);

        if (this.cancelRequested()) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Queue Cancelled',
                detail: `Converted ${convertedCount} file(s) before cancellation.`,
            });
            return;
        }

        this.messageService.add({
            severity: 'success',
            summary: 'Done',
            detail: `Converted ${this.processedCount()} of ${this.files().length} files`,
        });
    }

    async saveResult(index: number): Promise<void> {
        const item = this.files()[index];
        if (!item?.result) {
            return;
        }

        const result = item.result;
        const targetExtension = result.targetFormat;
        const defaultName = this.replaceExtension(item.file.name, targetExtension);

        // Video files are stored as temp files (too large for IPC buffer). Copy to user-chosen path.
        if (!result.buffer && result.outputPath) {
            const dialogResult = (await this.electronService.showSaveDialog({
                defaultPath: defaultName,
                filters: [{ name: 'Converted Files', extensions: [targetExtension] }],
            })) as { canceled: boolean; filePath?: string };

            if (dialogResult.canceled || !dialogResult.filePath) {
                return;
            }

            await this.electronService.fileCopyTo(result.outputPath, dialogResult.filePath);
            this.messageService.add({
                severity: 'success',
                summary: 'Saved',
                detail: `Saved to ${dialogResult.filePath}`,
            });
            return;
        }

        if (!result.buffer) {
            return;
        }

        const bytes = this.base64ToArrayBuffer(result.buffer);

        const saveResult = (await this.electronService.saveWithPreferences({
            suggestedName: defaultName,
            filters: [{ name: 'Converted Files', extensions: [targetExtension] }],
            data: bytes,
        })) as { saved: boolean; filePath?: string };

        if (!saveResult.saved) {
            return;
        }

        this.messageService.add({
            severity: 'success',
            summary: 'Saved',
            detail: saveResult.filePath ? `Saved to ${saveResult.filePath}` : `Saved ${defaultName}`,
        });
    }

    async saveAllResults(): Promise<void> {
        const items = this.files();
        for (let index = 0; index < items.length; index++) {
            if (items[index].status === 'done') {
                await this.saveResult(index);
            }
        }
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        const base = 1024;
        const unitIndex = Math.floor(Math.log(bytes) / Math.log(base));
        return `${(bytes / Math.pow(base, unitIndex)).toFixed(1)} ${units[unitIndex]}`;
    }

    protected async cancelQueue(): Promise<void> {
        if (!this.isProcessing()) {
            return;
        }

        this.cancelRequested.set(true);

        const jobId = this.currentJobId();
        if (!jobId) {
            return;
        }

        this.isCancelling.set(true);
        try {
            await this.electronService.fileCancelConversion(jobId);
        } catch {
            // Queue cancellation is best effort.
        } finally {
            this.isCancelling.set(false);
        }
    }

    protected retryFailed(): void {
        if (this.isProcessing()) {
            return;
        }

        this.files.update(files => files.map(item => {
            if (item.status !== 'error' && item.status !== 'cancelled') {
                return item;
            }

            return {
                ...item,
                status: 'pending',
                error: undefined,
                result: undefined,
                resultPreview: undefined,
            };
        }));

        void this.convertAll();
    }

    protected retryItem(index: number): void {
        if (this.isProcessing()) {
            return;
        }

        this.files.update(files => {
            const updated = [...files];
            const item = updated[index];
            if (!item || (item.status !== 'error' && item.status !== 'cancelled')) {
                return updated;
            }

            updated[index] = {
                ...item,
                status: 'pending',
                error: undefined,
                result: undefined,
                resultPreview: undefined,
            };

            return updated;
        });
    }

    protected formatStatus(status: ConvertFileItem['status']): string {
        if (status === 'pending') {
            return 'Pending';
        }

        if (status === 'processing') {
            return 'Processing';
        }

        if (status === 'done') {
            return 'Done';
        }

        if (status === 'cancelled') {
            return 'Cancelled';
        }

        return 'Error';
    }

    private async generateMissingPreviews(): Promise<void> {
        const items = this.files();
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (item.preview || !item.file.path) {
                continue;
            }

            try {
                const preview = (await this.electronService.filePreview(item.file.path, item.category)) as FilePreviewResult;

                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        preview: this.normalizePreviewResult(preview),
                    };
                    return updated;
                });
            } catch {
                // Preview generation is non-blocking.
            }
        }
    }

    private normalizePreviewResult(preview: FilePreviewResult): ConvertPreviewData {
        const previewKind = preview.category === 'document'
            || preview.category === 'spreadsheet'
            || preview.category === 'presentation'
            ? 'office'
            : preview.category;

        return {
            kind: previewKind,
            thumbnailSrc: preview.thumbnailBase64
                ? `data:image/png;base64,${preview.thumbnailBase64}`
                : undefined,
            excerpt: preview.excerpt,
            pageCount: preview.pageCount,
            message: preview.message,
        };
    }

    private buildResultPreview(result: FileConversionResult): ConvertPreviewData {
        const format = result.targetFormat;

        if (result.buffer && format === 'pdf') {
            return {
                kind: 'pdf',
                pdfSrc: `data:application/pdf;base64,${result.buffer}`,
                message: 'PDF output preview available.',
            };
        }

        if (result.buffer && format === 'svg') {
            return {
                kind: 'image',
                thumbnailSrc: `data:image/svg+xml;base64,${result.buffer}`,
                message: 'SVG output preview available.',
            };
        }

        if (result.buffer && ['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif'].includes(format)) {
            const normalized = format === 'jpg' ? 'jpeg' : format;
            return {
                kind: 'image',
                thumbnailSrc: `data:image/${normalized};base64,${result.buffer}`,
                message: 'Image output preview available.',
            };
        }

        if (result.buffer && ['txt', 'html'].includes(format)) {
            const raw = atob(result.buffer);
            const excerpt = raw
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 420);

            return {
                kind: 'text',
                excerpt,
                message: 'Text output preview available.',
            };
        }

        if (result.outputPath) {
            return {
                kind: 'video',
                message: 'Output created. Save to copy it from temporary workspace.',
            };
        }

        return {
            kind: 'unknown',
            message: 'Preview unavailable for this conversion output.',
        };
    }

    private canConvertFile(item: ConvertFileItem, targetFormat: string): boolean {
        if (this.capabilities()?.libreOfficeAvailable) {
            return true;
        }

        const localTargets = new Set(localTargetsByCategory[item.category]);
        localTargets.add(item.sourceFormat);
        return localTargets.has(targetFormat);
    }

    private createJobId(index: number, fileName: string): string {
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
        return `job-${Date.now()}-${index}-${sanitizedName}`;
    }

    private getSourceFormat(fileName: string): string {
        const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
        if (extension === 'jpg') {
            return 'jpeg';
        }

        if (extension === 'htm') {
            return 'html';
        }

        return extension;
    }

    private getCategory(format: string): ConvertCategory {
        if (imageFormats.has(format)) {
            return 'image';
        }

        if (format === 'pdf') {
            return 'pdf';
        }

        if (documentFormats.has(format)) {
            return 'document';
        }

        if (spreadsheetFormats.has(format)) {
            return 'spreadsheet';
        }

        if (presentationFormats.has(format)) {
            return 'presentation';
        }

        if (textFormats.has(format)) {
            return 'text';
        }

        if (videoFormats.has(format)) {
            return 'video';
        }

        return 'unknown';
    }

    private syncTargetFormat(): void {
        const selectedIndex = this.selectedFileIndex();
        const selected = this.selectedFile();
        if (!selected) {
            this.outputFormat.set('');
            return;
        }

        const options = this.targetOptions();
        if (!options.length) {
            this.outputFormat.set('');
            return;
        }

        const current = selected.targetFormat || this.outputFormat();
        const normalized = options.some(option => option.value === current)
            ? current
            : options[0].value;

        this.outputFormat.set(normalized);

        if (selected.targetFormat !== normalized && selectedIndex >= 0) {
            this.files.update(files => {
                const updated = [...files];
                updated[selectedIndex] = {
                    ...updated[selectedIndex],
                    targetFormat: normalized,
                };
                return updated;
            });
        }
    }

    protected onOutputFormatChanged(value: string): void {
        this.outputFormat.set(value);

        const selectedIndex = this.selectedFileIndex();
        if (selectedIndex < 0) {
            return;
        }

        this.files.update(files => {
            const updated = [...files];
            updated[selectedIndex] = {
                ...updated[selectedIndex],
                targetFormat: value,
            };
            return updated;
        });
    }

    private getDefaultTargetForCategory(category: ConvertCategory, sourceFormat: string): string {
        const options = targetsByCategory[category] ?? [];
        if (options.length === 0) {
            return sourceFormat;
        }

        if (options.some(option => option.value === sourceFormat)) {
            return sourceFormat;
        }

        return options[0].value;
    }

    private async loadCapabilities(): Promise<void> {
        if (!this.electronService.isElectron) {
            return;
        }

        try {
            const capabilities = (await this.electronService.fileConversionCapabilities()) as FileConversionCapabilities;
            this.capabilities.set(capabilities);
        } catch {
            this.capabilities.set({
                libreOfficeAvailable: false,
                message: 'Failed to check conversion engine capabilities.',
            });
        }
    }

    private replaceExtension(fileName: string, extension: string): string {
        return fileName.replace(/\.[^.]+$/, `.${extension}`);
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        return 'Unexpected conversion failure.';
    }

    private base64ToArrayBuffer(value: string): ArrayBuffer {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    }
}
