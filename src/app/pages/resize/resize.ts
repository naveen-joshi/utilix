import { Component, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SliderModule } from 'primeng/slider';
import { ProgressBarModule } from 'primeng/progressbar';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { TabsModule } from 'primeng/tabs';
import { FileDropzone, DropzoneFile } from '../../shared/file-dropzone/file-dropzone';
import { PreviewPanel } from '../../shared/preview-panel/preview-panel';
import { ElectronService } from '../../services/electron.service';

interface FileItem {
    file: DropzoneFile;
    status: 'pending' | 'processing' | 'done' | 'error';
    result?: ImageResizeResult;
    previewSrc?: string;
    resultPreviewSrc?: string;
}

interface ImageResizeResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    originalSize: number;
    newSize: number;
    width: number;
    height: number;
    format: string;
}

interface ImageMetadata {
    width: number;
    height: number;
    format: string;
    size: number;
}

@Component({
    selector: 'app-resize',
    imports: [
        FormsModule,
        ButtonModule,
        SelectModule,
        InputNumberModule,
        ToggleSwitchModule,
        SliderModule,
        ProgressBarModule,
        ToastModule,
        TabsModule,
        FileDropzone,
        PreviewPanel,
    ],
    providers: [MessageService],
    templateUrl: './resize.html',
    styleUrl: './resize.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Resize {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);

    // State
    protected readonly files = signal<FileItem[]>([]);
    protected readonly selectedFileIndex = signal<number>(-1);
    protected readonly resizeMode = signal<'dimensions' | 'filesize'>('dimensions');
    protected readonly targetWidth = signal<number | null>(null);
    protected readonly targetHeight = signal<number | null>(null);
    protected readonly maintainAspectRatio = signal(true);
    protected readonly targetSizeKB = signal<number>(500);
    protected readonly quality = signal<number>(80);
    protected readonly outputFormat = signal<string>('jpeg');
    protected readonly isProcessing = signal(false);
    protected readonly progress = signal(0);

    private readonly imageFormatOptions = [
        { label: 'JPEG', value: 'jpeg' },
        { label: 'PNG', value: 'png' },
        { label: 'WebP', value: 'webp' },
        { label: 'GIF', value: 'gif' },
        { label: 'AVIF', value: 'avif' },
    ];

    private readonly pdfFormatOptions = [
        { label: 'PDF', value: 'pdf' },
    ];

    protected readonly hasPdfFiles = computed(() =>
        this.files().some(f => f.file.type === 'application/pdf' || f.file.name.toLowerCase().endsWith('.pdf'))
    );

    protected readonly hasImageFiles = computed(() =>
        this.files().some(f => !this.isPdfFile(f.file))
    );

    protected readonly formatOptions = computed(() =>
        this.hasPdfFiles() && !this.hasImageFiles() ? this.pdfFormatOptions : this.imageFormatOptions
    );

    protected readonly selectedFile = computed(() => {
        const idx = this.selectedFileIndex();
        const fileList = this.files();
        return idx >= 0 && idx < fileList.length ? fileList[idx] : null;
    });

    protected readonly originalPreviewSrc = computed(() => this.selectedFile()?.previewSrc ?? '');
    protected readonly resultPreviewSrc = computed(() => this.selectedFile()?.resultPreviewSrc ?? '');
    protected readonly originalSize = computed(() => this.selectedFile()?.file.size ?? 0);
    protected readonly resultSize = computed(() => this.selectedFile()?.result?.newSize ?? 0);
    protected readonly originalDimensions = computed(() => '');
    protected readonly resultDimensions = computed(() => {
        const result = this.selectedFile()?.result;
        return result ? `${result.width} × ${result.height}` : '';
    });

    protected readonly isPdfOnlyMode = computed(() =>
        this.hasPdfFiles() && !this.hasImageFiles()
    );

    protected readonly hasFiles = computed(() => this.files().length > 0);
    protected readonly processedCount = computed(() =>
        this.files().filter(f => f.status === 'done').length
    );
    protected readonly totalCount = computed(() => this.files().length);

    async onFilesSelected(dropzoneFiles: DropzoneFile[]): Promise<void> {
        const newFiles: FileItem[] = dropzoneFiles.map(f => ({
            file: f,
            status: 'pending' as const,
        }));

        this.files.update(existing => [...existing, ...newFiles]);

        // Auto-select first file if none selected
        if (this.selectedFileIndex() < 0 && this.files().length > 0) {
            this.selectedFileIndex.set(0);
        }

        // Auto-switch format and mode for PDF-only batches
        if (this.isPdfOnlyMode()) {
            this.outputFormat.set('pdf');
            this.resizeMode.set('filesize');
        } else if (this.outputFormat() === 'pdf') {
            this.outputFormat.set('jpeg');
        }

        // Generate previews
        for (let i = 0; i < this.files().length; i++) {
            const item = this.files()[i];
            if (!item.previewSrc && item.file.path && this.electronService.isElectron) {
                try {
                    const preview = (await this.electronService.imageGeneratePreview(
                        item.file.path, 600, 400
                    )) as { buffer: string };
                    this.files.update(files => {
                        const updated = [...files];
                        updated[i] = { ...updated[i], previewSrc: `data:image/png;base64,${preview.buffer}` };
                        return updated;
                    });
                } catch {
                    // Preview generation failed — not critical
                }
            }
        }
    }

    selectFile(index: number): void {
        this.selectedFileIndex.set(index);
    }

    removeFile(index: number): void {
        this.files.update(files => files.filter((_, i) => i !== index));
        if (this.selectedFileIndex() >= this.files().length) {
            this.selectedFileIndex.set(this.files().length - 1);
        }
    }

    clearAll(): void {
        this.files.set([]);
        this.selectedFileIndex.set(-1);
    }

    async processFiles(): Promise<void> {
        if (!this.electronService.isElectron) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Desktop Only',
                detail: 'File processing requires the Electron desktop app.',
            });
            return;
        }

        this.isProcessing.set(true);
        this.progress.set(0);

        const fileList = this.files();
        const total = fileList.length;

        for (let i = 0; i < total; i++) {
            const item = fileList[i];
            if (item.status === 'done') continue;

            // Mark processing
            this.files.update(files => {
                const updated = [...files];
                updated[i] = { ...updated[i], status: 'processing' };
                return updated;
            });

            try {
                const isPdf = this.isPdfFile(item.file);
                let result: ImageResizeResult;

                if (isPdf) {
                    result = (await this.electronService.pdfCompress({
                        filePath: item.file.path,
                        targetSizeKB: this.targetSizeKB(),
                    })) as ImageResizeResult;
                } else {
                    result = (await this.electronService.imageResize({
                        filePath: item.file.path,
                        mode: this.resizeMode(),
                        width: this.targetWidth(),
                        height: this.targetHeight(),
                        maintainAspectRatio: this.maintainAspectRatio(),
                        targetSizeKB: this.targetSizeKB(),
                        quality: this.quality(),
                        outputFormat: this.outputFormat(),
                    })) as ImageResizeResult;
                }

                this.files.update(files => {
                    const updated = [...files];
                    updated[i] = {
                        ...updated[i],
                        status: 'done',
                        result,
                        resultPreviewSrc: isPdf
                            ? undefined
                            : result.buffer ? `data:image/${result.format};base64,${result.buffer}` : undefined,
                    };
                    return updated;
                });
            } catch (error) {
                this.files.update(files => {
                    const updated = [...files];
                    updated[i] = { ...updated[i], status: 'error' };
                    return updated;
                });
                this.messageService.add({
                    severity: 'error',
                    summary: 'Error',
                    detail: `Failed to process ${item.file.name}`,
                });
            }

            this.progress.set(Math.round(((i + 1) / total) * 100));
        }

        this.isProcessing.set(false);
        this.messageService.add({
            severity: 'success',
            summary: 'Complete',
            detail: `Processed ${this.processedCount()} of ${total} files`,
        });
    }

    async saveResult(index: number): Promise<void> {
        const item = this.files()[index];
        if (!item?.result?.buffer) return;

        try {
            const binaryString = atob(item.result.buffer);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const result = (await this.electronService.saveWithPreferences({
                suggestedName: item.file.name.replace(/\.[^.]+$/, `.${item.result.format}`),
                filters: [{ name: item.result.format === 'pdf' ? 'PDF' : 'Images', extensions: [item.result.format] }],
                data: bytes.buffer,
            })) as { saved: boolean; filePath?: string };

            if (result.saved) {
                this.messageService.add({
                    severity: 'success',
                    summary: 'Saved',
                    detail: result.filePath ? `File saved to ${result.filePath}` : 'File saved successfully.',
                });
            }
        } catch {
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to save file',
            });
        }
    }

    async saveAllResults(): Promise<void> {
        for (let i = 0; i < this.files().length; i++) {
            if (this.files()[i].status === 'done') {
                await this.saveResult(i);
            }
        }
    }

    private isPdfFile(file: DropzoneFile): boolean {
        return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
    }
}
