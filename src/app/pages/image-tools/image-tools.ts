import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { ToastModule } from 'primeng/toast';
import { ElectronService } from '../../services/electron.service';
import { DropzoneFile, FileDropzone } from '../../shared/file-dropzone/file-dropzone';
import { CropSelection, ImageCropper } from '../../shared/image-cropper/image-cropper';
import { PreviewPanel } from '../../shared/preview-panel/preview-panel';

type ImageTool = 'resize' | 'crop' | 'rotate' | 'svg' | 'favicon' | 'remove-bg';
type RasterFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

type SvgTargetFormat = RasterFormat | 'svg';

interface ImageOperationResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    originalSize: number;
    newSize: number;
    width: number;
    height: number;
    format: string;
}

interface FaviconGenerateResult {
    success: boolean;
    outputPath?: string;
    originalSize: number;
    icoSize: number;
    icoBuffer: string;
    pngs: Array<{ size: number; buffer: string }>;
}

interface ToolResult {
    type: 'image' | 'favicon';
    format: string;
    previewFormat: string;
    originalSize: number;
    newSize: number;
    width: number;
    height: number;
    outputBuffer: string;
    previewBuffer?: string;
}

interface ImageMetadata {
    width: number;
    height: number;
    format: string;
    size: number;
}

@Component({
    selector: 'app-image-tools',
    imports: [
        FormsModule,
        ButtonModule,
        InputNumberModule,
        InputTextModule,
        SelectModule,
        SliderModule,
        ToastModule,
        FileDropzone,
        ImageCropper,
        PreviewPanel,
    ],
    providers: [MessageService],
    templateUrl: './image-tools.html',
    styleUrl: './image-tools.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageTools {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);

    protected readonly files = signal<DropzoneFile[]>([]);
    protected readonly selectedFileIndex = signal(-1);
    protected readonly tool = signal<ImageTool>('resize');
    protected readonly quality = signal(90);
    protected readonly outputFormat = signal<RasterFormat>('png');

    protected readonly resizeWidth = signal<number | null>(512);
    protected readonly resizeHeight = signal<number | null>(512);

    protected readonly cropLeft = signal(0);
    protected readonly cropTop = signal(0);
    protected readonly cropWidth = signal(256);
    protected readonly cropHeight = signal(256);

    protected readonly rotateAngle = signal(90);
    protected readonly svgTargetFormat = signal<SvgTargetFormat>('svg');

    protected readonly backgroundThreshold = signal(28);
    protected readonly backgroundOutputFormat = signal<'png' | 'webp'>('png');

    protected readonly faviconSizesInput = signal('16,32,48,64,128,180');

    protected readonly isProcessing = signal(false);
    protected readonly originalPreviewSrc = signal('');
    protected readonly toolResult = signal<ToolResult | null>(null);
    protected readonly selectedImageMetadata = signal<ImageMetadata | null>(null);
    protected readonly cropSelection = signal<CropSelection>({
        x: 0.15,
        y: 0.15,
        width: 0.7,
        height: 0.7,
    });

    protected readonly toolOptions = [
        { label: 'Resize', value: 'resize' },
        { label: 'Crop', value: 'crop' },
        { label: 'Rotate', value: 'rotate' },
        { label: 'SVG Converter', value: 'svg' },
        { label: 'Favicon Generator', value: 'favicon' },
        { label: 'Remove Background', value: 'remove-bg' },
    ];

    protected readonly formatOptions = [
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'WebP', value: 'webp' },
        { label: 'GIF', value: 'gif' },
        { label: 'AVIF', value: 'avif' },
    ];

    protected readonly svgTargetOptions = [
        { label: 'SVG', value: 'svg' },
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'WebP', value: 'webp' },
        { label: 'AVIF', value: 'avif' },
    ];

    protected readonly backgroundFormatOptions = [
        { label: 'PNG', value: 'png' },
        { label: 'WebP', value: 'webp' },
    ];

    protected readonly hasFiles = computed(() => this.files().length > 0);
    protected readonly selectedFile = computed(() => {
        const index = this.selectedFileIndex();
        const items = this.files();
        return index >= 0 && index < items.length ? items[index] : null;
    });

    protected readonly resultPreviewSrc = computed(() => {
        const result = this.toolResult();
        if (!result?.previewBuffer) {
            return '';
        }

        if (result.previewFormat === 'svg') {
            return `data:image/svg+xml;base64,${result.previewBuffer}`;
        }

        return `data:image/${result.previewFormat};base64,${result.previewBuffer}`;
    });

    protected readonly resultSize = computed(() => this.toolResult()?.newSize ?? 0);
    protected readonly resultDimensions = computed(() => {
        const result = this.toolResult();
        return result ? `${result.width} × ${result.height}` : '';
    });

    protected readonly isSvgTool = computed(() => this.tool() === 'svg');
    protected readonly isFaviconTool = computed(() => this.tool() === 'favicon');

    protected readonly cropPixelHint = computed(() => {
        const metadata = this.selectedImageMetadata();
        const selection = this.cropSelection();

        if (!metadata) {
            return '';
        }

        const left = Math.round(selection.x * metadata.width);
        const top = Math.round(selection.y * metadata.height);
        const width = Math.max(1, Math.round(selection.width * metadata.width));
        const height = Math.max(1, Math.round(selection.height * metadata.height));

        return `x:${left}, y:${top}, ${width}×${height}px`;
    });

    async onFilesSelected(dropzoneFiles: DropzoneFile[]): Promise<void> {
        const imageFiles = dropzoneFiles.filter(file => this.isImageFile(file));
        if (imageFiles.length === 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Unsupported Files',
                detail: 'Please select image files only.',
            });
            return;
        }

        const filesWithPath = imageFiles.filter(file => Boolean(file.path));
        if (filesWithPath.length < imageFiles.length) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Path Missing',
                detail: 'Some files could not be resolved to local paths. Re-select in desktop mode.',
            });
        }

        if (!filesWithPath.length) {
            return;
        }

        this.files.set(filesWithPath);
        this.selectedFileIndex.set(0);
        this.toolResult.set(null);

        await this.refreshOriginalPreview();
    }

    async onToolChanged(nextTool: ImageTool): Promise<void> {
        this.tool.set(nextTool);
        this.toolResult.set(null);

        const selected = this.selectedFile();
        if (!selected) {
            return;
        }

        if (nextTool === 'svg' && !this.isSvgFile(selected)) {
            this.svgTargetFormat.set('svg');
        }

        if (nextTool !== 'svg') {
            this.outputFormat.set('png');
        }
    }

    async selectFile(index: number): Promise<void> {
        this.selectedFileIndex.set(index);
        this.toolResult.set(null);
        await this.refreshOriginalPreview();
    }

    removeFile(index: number): void {
        this.files.update(items => items.filter((_, itemIndex) => itemIndex !== index));
        this.toolResult.set(null);

        if (!this.files().length) {
            this.selectedFileIndex.set(-1);
            this.originalPreviewSrc.set('');
            return;
        }

        const nextIndex = Math.min(this.selectedFileIndex(), this.files().length - 1);
        this.selectedFileIndex.set(Math.max(nextIndex, 0));
        void this.refreshOriginalPreview();
    }

    clearAll(): void {
        this.files.set([]);
        this.selectedFileIndex.set(-1);
        this.toolResult.set(null);
        this.originalPreviewSrc.set('');
    }

    async runTool(): Promise<void> {
        if (!this.electronService.isElectron) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Desktop Only',
                detail: 'Image tools require the desktop app runtime.',
            });
            return;
        }

        const selected = this.selectedFile();
        if (!selected?.path) {
            this.messageService.add({
                severity: 'warn',
                summary: 'No File Selected',
                detail: 'Add and select an image file first.',
            });
            return;
        }

        this.isProcessing.set(true);

        try {
            const activeTool = this.tool();
            let result: ToolResult;

            if (activeTool === 'resize') {
                const image = (await this.electronService.imageResize({
                    filePath: selected.path,
                    mode: 'dimensions',
                    width: this.resizeWidth(),
                    height: this.resizeHeight(),
                    maintainAspectRatio: true,
                    quality: this.quality(),
                    outputFormat: this.outputFormat(),
                })) as ImageOperationResult;

                result = this.toImageToolResult(image);
            } else if (activeTool === 'crop') {
                const metadata = this.selectedImageMetadata();
                const selection = this.cropSelection();
                const imageWidth = metadata?.width ?? 0;
                const imageHeight = metadata?.height ?? 0;

                if (!imageWidth || !imageHeight) {
                    throw new Error('Image dimensions are unavailable. Re-select the file and try again.');
                }

                const left = Math.round(selection.x * imageWidth);
                const top = Math.round(selection.y * imageHeight);
                const width = Math.max(1, Math.round(selection.width * imageWidth));
                const height = Math.max(1, Math.round(selection.height * imageHeight));

                const image = (await this.electronService.imageCrop({
                    filePath: selected.path,
                    left,
                    top,
                    width,
                    height,
                    quality: this.quality(),
                    outputFormat: this.outputFormat(),
                })) as ImageOperationResult;

                result = this.toImageToolResult(image);
            } else if (activeTool === 'rotate') {
                const image = (await this.electronService.imageRotate({
                    filePath: selected.path,
                    angle: this.rotateAngle(),
                    quality: this.quality(),
                    outputFormat: this.outputFormat(),
                })) as ImageOperationResult;

                result = this.toImageToolResult(image);
            } else if (activeTool === 'svg') {
                const image = (await this.electronService.imageSvgConvert({
                    filePath: selected.path,
                    targetFormat: this.svgTargetFormat(),
                    quality: this.quality(),
                })) as ImageOperationResult;

                result = this.toImageToolResult(image);
            } else if (activeTool === 'remove-bg') {
                const image = (await this.electronService.imageRemoveBackground({
                    filePath: selected.path,
                    threshold: this.backgroundThreshold(),
                    outputFormat: this.backgroundOutputFormat(),
                    quality: this.quality(),
                })) as ImageOperationResult;

                result = this.toImageToolResult(image);
            } else {
                const favicon = (await this.electronService.imageGenerateFavicon({
                    filePath: selected.path,
                    sizes: this.parseFaviconSizes(this.faviconSizesInput()),
                })) as FaviconGenerateResult;

                const preview = favicon.pngs[favicon.pngs.length - 1]?.buffer;
                result = {
                    type: 'favicon',
                    format: 'ico',
                    previewFormat: 'png',
                    originalSize: favicon.originalSize,
                    newSize: favicon.icoSize,
                    width: favicon.pngs[favicon.pngs.length - 1]?.size ?? 32,
                    height: favicon.pngs[favicon.pngs.length - 1]?.size ?? 32,
                    outputBuffer: favicon.icoBuffer,
                    previewBuffer: preview,
                };
            }

            this.toolResult.set(result);
            this.messageService.add({
                severity: 'success',
                summary: 'Done',
                detail: 'Image tool executed successfully.',
            });
        } catch (error) {
            this.messageService.add({
                severity: 'error',
                summary: 'Operation Failed',
                detail: this.getErrorMessage(error),
            });
        } finally {
            this.isProcessing.set(false);
        }
    }

    async saveResult(): Promise<void> {
        const selected = this.selectedFile();
        const result = this.toolResult();

        if (!selected || !result) {
            return;
        }

        const extension = result.format;
        const defaultName = this.withExtension(selected.name, extension);

        const saveResult = (await this.electronService.saveWithPreferences({
            suggestedName: defaultName,
            filters: [{ name: extension === 'ico' ? 'Icon' : 'Images', extensions: [extension] }],
            data: this.base64ToArrayBuffer(result.outputBuffer),
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

    formatFileSize(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        const base = 1024;
        const index = Math.floor(Math.log(bytes) / Math.log(base));
        return `${(bytes / Math.pow(base, index)).toFixed(1)} ${units[index]}`;
    }

    private async refreshOriginalPreview(): Promise<void> {
        const selected = this.selectedFile();
        if (!selected?.path || !this.electronService.isElectron) {
            this.originalPreviewSrc.set('');
            this.selectedImageMetadata.set(null);
            return;
        }

        try {
            const metadata = (await this.electronService.imageGetMetadata(selected.path)) as ImageMetadata;
            this.selectedImageMetadata.set(metadata);
            const preview = (await this.electronService.imageGeneratePreview(selected.path, 700, 450)) as {
                buffer: string;
            };
            this.originalPreviewSrc.set(`data:image/png;base64,${preview.buffer}`);
            this.applyDefaultCropSelection();
        } catch {
            this.originalPreviewSrc.set('');
            this.selectedImageMetadata.set(null);
        }
    }

    protected onCropSelectionChanged(selection: CropSelection): void {
        this.cropSelection.set(selection);

        const metadata = this.selectedImageMetadata();
        if (!metadata) {
            return;
        }

        this.cropLeft.set(Math.round(selection.x * metadata.width));
        this.cropTop.set(Math.round(selection.y * metadata.height));
        this.cropWidth.set(Math.max(1, Math.round(selection.width * metadata.width)));
        this.cropHeight.set(Math.max(1, Math.round(selection.height * metadata.height)));
    }

    private applyDefaultCropSelection(): void {
        const selection: CropSelection = {
            x: 0.15,
            y: 0.15,
            width: 0.7,
            height: 0.7,
        };

        this.cropSelection.set(selection);
        this.onCropSelectionChanged(selection);
    }

    private toImageToolResult(image: ImageOperationResult): ToolResult {
        return {
            type: 'image',
            format: image.format,
            previewFormat: image.format,
            originalSize: image.originalSize,
            newSize: image.newSize,
            width: image.width,
            height: image.height,
            outputBuffer: image.buffer ?? '',
            previewBuffer: image.buffer,
        };
    }

    private parseFaviconSizes(value: string): number[] {
        const items = value
            .split(',')
            .map(item => Number(item.trim()))
            .filter(item => Number.isInteger(item) && item >= 16 && item <= 512);

        if (!items.length) {
            return [16, 32, 48, 64, 128, 180];
        }

        return [...new Set(items)].sort((left, right) => left - right);
    }

    private isImageFile(file: DropzoneFile): boolean {
        return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name);
    }

    private isSvgFile(file: DropzoneFile): boolean {
        return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    }

    private withExtension(fileName: string, extension: string): string {
        return fileName.replace(/\.[^.]+$/, `.${extension}`);
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        return 'Unexpected error while processing image.';
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
