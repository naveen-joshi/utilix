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
import { PreviewPanel } from '../../shared/preview-panel/preview-panel';

type ConvertCategory = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'unknown';

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
    strategy: 'sharp' | 'pdf-lib' | 'libreoffice' | 'copy' | 'local';
    message?: string;
}

interface FileConversionCapabilities {
    libreOfficeAvailable: boolean;
    libreOfficePath?: string;
    message: string;
}

interface ConvertFileItem {
    file: DropzoneFile;
    category: ConvertCategory;
    sourceFormat: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    error?: string;
    previewSrc?: string;
    resultPreviewSrc?: string;
    result?: FileConversionResult;
}

const imageFormats = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg']);
const documentFormats = new Set(['doc', 'docx', 'odt', 'rtf']);
const spreadsheetFormats = new Set(['xls', 'xlsx', 'ods', 'csv']);
const presentationFormats = new Set(['ppt', 'pptx', 'odp']);
const textFormats = new Set(['txt', 'md', 'html', 'htm']);

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
    unknown: [],
};

const localTargetsByCategory: Record<ConvertCategory, ReadonlySet<string>> = {
    image: new Set(['png', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'pdf']),
    pdf: new Set(['pdf', 'txt', 'png', 'jpeg']),
    document: new Set(),
    spreadsheet: new Set(),
    presentation: new Set(),
    text: new Set(['txt', 'html', 'pdf']),
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
        PreviewPanel,
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

    protected readonly originalPreviewSrc = computed(() => this.selectedFile()?.previewSrc ?? '');
    protected readonly resultPreviewSrc = computed(() => this.selectedFile()?.resultPreviewSrc ?? '');
    protected readonly originalSize = computed(() => this.selectedFile()?.file.size ?? 0);
    protected readonly resultSize = computed(() => this.selectedFile()?.result?.newSize ?? 0);
    protected readonly resultDimensions = computed(() => {
        const result = this.selectedFile()?.result;
        if (!result) {
            return '';
        }

        const selected = this.selectedFile();
        if (selected?.category !== 'image') {
            return '';
        }

        return selected.resultPreviewSrc ? 'Preview available' : '';
    });

    protected readonly hasFiles = computed(() => this.files().length > 0);
    protected readonly processedCount = computed(() => this.files().filter(item => item.status === 'done').length);

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
            return {
                file,
                sourceFormat,
                category: this.getCategory(sourceFormat),
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

        const firstCategory = this.files()[0]?.category ?? known[0].category;
        const sameCategory = known.filter(item => item.category === firstCategory);
        const skipped = known.length - sameCategory.length;

        if (skipped > 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Mixed Types Skipped',
                detail: 'Please add one source type at a time (images, PDFs, docs, etc.).',
            });
        }

        this.files.update(existing => [...existing, ...sameCategory]);

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

        const targetFormat = this.outputFormat();
        if (this.requiresLibreOfficeForCurrentType()) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Engine Required',
                detail: 'This source type needs LibreOffice for format conversion. Install LibreOffice to continue.',
            });
            return;
        }

        if (!targetFormat) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Target Required',
                detail: 'Select a target format before converting.',
            });
            return;
        }

        this.isProcessing.set(true);
        this.progress.set(0);

        const items = this.files();
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (item.status === 'done') {
                this.progress.set(Math.round(((index + 1) / items.length) * 100));
                continue;
            }

            this.files.update(files => {
                const updated = [...files];
                updated[index] = { ...updated[index], status: 'processing' };
                return updated;
            });

            try {
                const result = (await this.electronService.fileConvert({
                    filePath: item.file.path,
                    targetFormat,
                    quality: this.quality(),
                })) as FileConversionResult;

                this.files.update(files => {
                    const updated = [...files];
                    const resultPreviewSrc = this.toPreviewDataUrl(result);
                    updated[index] = {
                        ...updated[index],
                        status: 'done',
                        result,
                        resultPreviewSrc,
                    };
                    return updated;
                });
            } catch (error) {
                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        status: 'error',
                        error: this.getErrorMessage(error),
                    };
                    return updated;
                });

                this.messageService.add({
                    severity: 'error',
                    summary: 'Conversion Failed',
                    detail: `Could not convert ${item.file.name}: ${this.getErrorMessage(error)}`,
                });
            }

            this.progress.set(Math.round(((index + 1) / items.length) * 100));
        }

        this.isProcessing.set(false);
        this.messageService.add({
            severity: 'success',
            summary: 'Done',
            detail: `Converted ${this.processedCount()} of ${this.files().length} files`,
        });
    }

    async saveResult(index: number): Promise<void> {
        const item = this.files()[index];
        if (!item?.result?.buffer) {
            return;
        }

        const targetExtension = item.result.targetFormat;
        const defaultName = this.replaceExtension(item.file.name, targetExtension);
        const bytes = this.base64ToArrayBuffer(item.result.buffer);

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

    private async generateMissingPreviews(): Promise<void> {
        const items = this.files();
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (item.previewSrc || !item.file.path || item.category !== 'image') {
                continue;
            }

            try {
                const preview = (await this.electronService.imageGeneratePreview(item.file.path, 600, 400)) as {
                    buffer: string;
                };

                this.files.update(files => {
                    const updated = [...files];
                    updated[index] = {
                        ...updated[index],
                        previewSrc: `data:image/png;base64,${preview.buffer}`,
                    };
                    return updated;
                });
            } catch {
                // Preview generation is non-blocking.
            }
        }
    }

    private toPreviewDataUrl(result: FileConversionResult): string | undefined {
        if (!result.buffer) {
            return undefined;
        }

        if (result.targetFormat === 'svg') {
            return `data:image/svg+xml;base64,${result.buffer}`;
        }

        if (['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif'].includes(result.targetFormat)) {
            const format = result.targetFormat === 'jpg' ? 'jpeg' : result.targetFormat;
            return `data:image/${format};base64,${result.buffer}`;
        }

        return undefined;
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

        return 'unknown';
    }

    private syncTargetFormat(): void {
        const options = this.targetOptions();
        if (!options.length) {
            this.outputFormat.set('');
            return;
        }

        const current = this.outputFormat();
        if (!options.some(option => option.value === current)) {
            this.outputFormat.set(options[0].value);
        }
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
