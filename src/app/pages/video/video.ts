import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { ToastModule } from 'primeng/toast';
import { ElectronService } from '../../services/electron.service';
import { DropzoneFile, FileDropzone } from '../../shared/file-dropzone/file-dropzone';

const videoFormats = new Set([
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ts', 'mts', 'mxf',
]);

interface VideoTargetOption {
    label: string;
    value: string;
}

const TARGET_OPTIONS: VideoTargetOption[] = [
    { label: 'MP4 (H.264)', value: 'mp4' },
    { label: 'WebM (VP9)', value: 'webm' },
    { label: 'MKV', value: 'mkv' },
    { label: 'MOV', value: 'mov' },
    { label: 'AVI', value: 'avi' },
    { label: 'MP3 (Audio only)', value: 'mp3' },
    { label: 'GIF (Animated)', value: 'gif' },
];

interface VideoFileItem {
    dropzoneFile: DropzoneFile;
    status: 'pending' | 'converting' | 'done' | 'error';
    error?: string;
    convertedPath?: string;
    convertedSize?: number;
}

@Component({
    selector: 'app-video',
    imports: [
        FormsModule,
        ButtonModule,
        ProgressBarModule,
        SelectModule,
        SliderModule,
        ToastModule,
        FileDropzone,
    ],
    providers: [MessageService],
    templateUrl: './video.html',
    styleUrl: './video.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPage {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);
    private readonly destroyRef = inject(DestroyRef);
    private progressCleanup?: () => void;

    protected readonly files = signal<VideoFileItem[]>([]);
    protected readonly selectedFileIndex = signal(-1);
    protected readonly outputFormat = signal<string>('mp4');
    protected readonly quality = signal(80);
    protected readonly isConverting = signal(false);
    protected readonly conversionProgress = signal(0);
    protected readonly progressMode = signal<'determinate' | 'indeterminate'>('determinate');
    protected readonly timemark = signal('');
    protected readonly playerMode = signal<'original' | 'converted'>('original');

    protected readonly targetOptions = TARGET_OPTIONS;

    protected readonly selectedFile = computed(() => {
        const index = this.selectedFileIndex();
        const items = this.files();
        return index >= 0 && index < items.length ? items[index] : null;
    });

    protected readonly hasFiles = computed(() => this.files().length > 0);

    protected readonly hasConvertedResult = computed(
        () => this.selectedFile()?.status === 'done' && Boolean(this.selectedFile()?.convertedPath)
    );

    protected readonly originalVideoUrl = computed(() => {
        const file = this.selectedFile();
        if (!file?.dropzoneFile.path) {
            return null;
        }
        return this.electronService.getLocalVideoUrl(file.dropzoneFile.path);
    });

    protected readonly convertedVideoUrl = computed(() => {
        const file = this.selectedFile();
        if (!file?.convertedPath) {
            return null;
        }
        return this.electronService.getLocalVideoUrl(file.convertedPath);
    });

    protected readonly activeVideoUrl = computed(() =>
        this.playerMode() === 'converted' ? this.convertedVideoUrl() : this.originalVideoUrl()
    );

    protected readonly showQualitySlider = computed(() => this.outputFormat() !== 'gif');

    constructor() {
        this.destroyRef.onDestroy(() => this.progressCleanup?.());
    }

    onFilesSelected(dropzoneFiles: DropzoneFile[]): void {
        const videoFiles = dropzoneFiles.filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
            return videoFormats.has(ext) && Boolean(f.path);
        });

        if (videoFiles.length === 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Unsupported Files',
                detail: 'No recognized video files were found. Supported: MP4, MOV, AVI, MKV, WebM, and more.',
            });
            return;
        }

        const newItems: VideoFileItem[] = videoFiles.map(f => ({
            dropzoneFile: f,
            status: 'pending',
        }));

        this.files.update(existing => [...existing, ...newItems]);

        if (this.selectedFileIndex() < 0) {
            this.selectedFileIndex.set(0);
            this.playerMode.set('original');
        }
    }

    selectFile(index: number): void {
        this.selectedFileIndex.set(index);
        this.playerMode.set(this.files()[index]?.status === 'done' ? 'converted' : 'original');
    }

    removeFile(index: number): void {
        this.files.update(files => files.filter((_, i) => i !== index));
        const current = this.selectedFileIndex();
        if (current === index) {
            this.selectedFileIndex.set(this.files().length ? 0 : -1);
            this.playerMode.set('original');
        } else if (current > index) {
            this.selectedFileIndex.set(current - 1);
        }
    }

    clearAll(): void {
        this.files.set([]);
        this.selectedFileIndex.set(-1);
        this.conversionProgress.set(0);
        this.timemark.set('');
        this.playerMode.set('original');
        this.isConverting.set(false);
        this.progressCleanup?.();
        this.progressCleanup = undefined;
    }

    async convert(): Promise<void> {
        const index = this.selectedFileIndex();
        const file = this.selectedFile();

        if (!file || !this.electronService.isElectron) {
            return;
        }

        this.isConverting.set(true);
        this.conversionProgress.set(0);
        this.progressMode.set('determinate');
        this.timemark.set('');

        this.files.update(files => {
            const updated = [...files];
            updated[index] = { ...updated[index], status: 'converting', error: undefined };
            return updated;
        });

        // Subscribe to real-time FFmpeg progress events.
        this.progressCleanup?.();
        this.progressCleanup = this.electronService.onVideoProgress(data => {
            if (data.percent !== undefined && !Number.isNaN(data.percent)) {
                this.conversionProgress.set(Math.min(Math.round(data.percent), 99));
                this.progressMode.set('determinate');
            } else {
                // Duration unknown — show indeterminate animation.
                this.progressMode.set('indeterminate');
            }
            if (data.timemark) {
                this.timemark.set(data.timemark);
            }
        });

        try {
            const result = (await this.electronService.videoConvert({
                filePath: file.dropzoneFile.path,
                targetFormat: this.outputFormat(),
                quality: this.quality(),
            })) as { success: boolean; outputPath: string; newSize: number };

            this.progressCleanup?.();
            this.progressCleanup = undefined;
            this.conversionProgress.set(100);

            this.files.update(files => {
                const updated = [...files];
                updated[index] = {
                    ...updated[index],
                    status: 'done',
                    convertedPath: result.outputPath,
                    convertedSize: result.newSize,
                };
                return updated;
            });

            this.playerMode.set('converted');

            this.messageService.add({
                severity: 'success',
                summary: 'Done',
                detail: 'Conversion complete. Playing converted video.',
            });
        } catch (error) {
            this.progressCleanup?.();
            this.progressCleanup = undefined;

            const message = error instanceof Error ? error.message : 'Unexpected conversion failure.';

            this.files.update(files => {
                const updated = [...files];
                updated[index] = { ...updated[index], status: 'error', error: message };
                return updated;
            });

            this.messageService.add({
                severity: 'error',
                summary: 'Conversion Failed',
                detail: message,
            });
        }

        this.isConverting.set(false);
    }

    async saveConverted(): Promise<void> {
        const file = this.selectedFile();
        if (!file?.convertedPath) {
            return;
        }

        const ext = this.outputFormat();
        const defaultName = file.dropzoneFile.name.replace(/\.[^.]+$/, `.${ext}`);

        const dialogResult = (await this.electronService.showSaveDialog({
            defaultPath: defaultName,
            filters: [{ name: 'Video File', extensions: [ext] }],
        })) as { canceled: boolean; filePath?: string };

        if (dialogResult.canceled || !dialogResult.filePath) {
            return;
        }

        await this.electronService.fileCopyTo(file.convertedPath, dialogResult.filePath);

        this.messageService.add({
            severity: 'success',
            summary: 'Saved',
            detail: `Saved to ${dialogResult.filePath}`,
        });
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB'];
        const base = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(base));
        return `${(bytes / Math.pow(base, i)).toFixed(1)} ${units[i]}`;
    }
}
