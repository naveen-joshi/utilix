import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { ElectronService } from '../../services/electron.service';
import { DropzoneFile, FileDropzone } from '../../shared/file-dropzone/file-dropzone';

type PdfTool = 'merge' | 'extract' | 'rotate' | 'delete' | 'metadata';

interface PdfToolResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    pageCount: number;
    newSize: number;
}

interface PdfMetadata {
    pageCount: number;
    title?: string;
    author?: string;
    size: number;
}

@Component({
    selector: 'app-pdf-tools',
    imports: [
        FormsModule,
        ButtonModule,
        InputTextModule,
        ProgressBarModule,
        SelectModule,
        ToastModule,
        FileDropzone,
    ],
    providers: [MessageService],
    templateUrl: './pdf-tools.html',
    styleUrl: './pdf-tools.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfTools {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);
    private readonly sanitizer = inject(DomSanitizer);

    protected readonly files = signal<DropzoneFile[]>([]);
    protected readonly selectedTool = signal<PdfTool>('merge');
    protected readonly startPage = signal(1);
    protected readonly endPage = signal(1);
    protected readonly rotation = signal<90 | 180 | 270>(90);
    protected readonly metadataTitle = signal('');
    protected readonly metadataAuthor = signal('');
    protected readonly metadataSubject = signal('');
    protected readonly metadataKeywords = signal('');
    protected readonly isProcessing = signal(false);
    protected readonly progress = signal(0);
    protected readonly maxPages = signal(1);
    protected readonly selectedPages = signal<number[]>([]);
    protected readonly result = signal<PdfToolResult | null>(null);
    protected readonly suggestedFileName = signal('output.pdf');
    protected readonly originalPdfPreviewUrl = signal<SafeResourceUrl | null>(null);
    protected readonly resultPdfPreviewUrl = signal<SafeResourceUrl | null>(null);

    protected readonly toolOptions = [
        { label: 'Merge PDFs', value: 'merge' },
        { label: 'Extract Page Range', value: 'extract' },
        { label: 'Rotate Pages', value: 'rotate' },
        { label: 'Delete Pages', value: 'delete' },
        { label: 'Update Metadata', value: 'metadata' },
    ];

    protected readonly rotationOptions = [
        { label: '90°', value: 90 },
        { label: '180°', value: 180 },
        { label: '270°', value: 270 },
    ];

    protected readonly hasFiles = computed(() => this.files().length > 0);
    protected readonly activeFile = computed(() => this.files()[0] ?? null);
    protected readonly pageNumbers = computed(() =>
        Array.from({ length: this.maxPages() }, (_, index) => index + 1)
    );

    protected readonly selectedPagesSummary = computed(() => {
        const pages = this.selectedPages();
        if (pages.length === 0) {
            return 'No pages selected';
        }

        return `${pages.length} page(s) selected`;
    });

    protected readonly canRun = computed(() => {
        const tool = this.selectedTool();
        if (tool === 'merge') {
            return this.files().length >= 2;
        }

        if (tool === 'extract' || tool === 'rotate' || tool === 'delete') {
            return this.files().length >= 1 && this.selectedPages().length > 0;
        }

        return this.files().length >= 1;
    });

    protected readonly helperText = computed(() => {
        const tool = this.selectedTool();
        if (tool === 'merge') {
            return 'Pick two or more PDFs. Files are merged in list order.';
        }
        if (tool === 'extract') {
            return 'Select pages visually and extract them into a new PDF.';
        }
        if (tool === 'rotate') {
            return 'Select one or more pages and rotate only those pages.';
        }
        if (tool === 'delete') {
            return 'Select pages visually and delete only those pages.';
        }
        return 'Set metadata fields and export a refreshed PDF file.';
    });

    async onFilesSelected(dropzoneFiles: DropzoneFile[]): Promise<void> {
        const pdfFiles = dropzoneFiles.filter(file => this.isPdfFile(file));
        if (pdfFiles.length === 0) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Unsupported Files',
                detail: 'Only PDF files are accepted in this tool.',
            });
            return;
        }

        if (pdfFiles.length < dropzoneFiles.length) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Some Files Skipped',
                detail: 'Non-PDF files were ignored.',
            });
        }

        const filesWithPath = pdfFiles.filter(file => Boolean(file.path));
        if (filesWithPath.length < pdfFiles.length) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Path Missing',
                detail: 'Some files do not expose a local path. Re-select from the desktop app.',
            });
        }

        if (filesWithPath.length === 0) {
            return;
        }

        this.files.update(existing => [...existing, ...filesWithPath]);
        this.result.set(null);
        this.resultPdfPreviewUrl.set(null);

        await this.updatePrimaryFileMetadata();
        await this.refreshOriginalPdfPreview();
    }

    async onToolChanged(tool: PdfTool): Promise<void> {
        this.selectedTool.set(tool);
        this.result.set(null);

        if (tool !== 'merge') {
            const firstFile = this.files()[0];
            if (firstFile) {
                this.files.set([firstFile]);
            }
        }

        await this.updatePrimaryFileMetadata();
    }

    removeFile(index: number): void {
        this.files.update(files => files.filter((_, currentIndex) => currentIndex !== index));
        this.result.set(null);
        this.selectedPages.set([]);
        this.resultPdfPreviewUrl.set(null);

        if (this.files().length === 0) {
            this.maxPages.set(1);
            this.startPage.set(1);
            this.endPage.set(1);
            this.originalPdfPreviewUrl.set(null);
            return;
        }

        void this.updatePrimaryFileMetadata();
        void this.refreshOriginalPdfPreview();
    }

    clearAll(): void {
        this.files.set([]);
        this.result.set(null);
        this.progress.set(0);
        this.maxPages.set(1);
        this.startPage.set(1);
        this.endPage.set(1);
        this.selectedPages.set([]);
        this.originalPdfPreviewUrl.set(null);
        this.resultPdfPreviewUrl.set(null);
    }

    async runTool(): Promise<void> {
        if (!this.electronService.isElectron) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Desktop Only',
                detail: 'PDF editing tools require the Electron desktop runtime.',
            });
            return;
        }

        if (!this.canRun()) {
            const detail = this.selectedTool() === 'merge'
                ? 'Add at least two PDF files to merge.'
                : 'Add at least one PDF file.';

            this.messageService.add({
                severity: 'warn',
                summary: 'Not Enough Files',
                detail,
            });
            return;
        }

        this.isProcessing.set(true);
        this.progress.set(20);
        this.result.set(null);

        try {
            let output: PdfToolResult;
            const tool = this.selectedTool();
            const primaryFile = this.files()[0];

            if (!primaryFile && tool !== 'merge') {
                throw new Error('No PDF file selected.');
            }

            if (tool === 'merge') {
                output = (await this.electronService.pdfMerge({
                    filePaths: this.files().map(file => file.path),
                })) as PdfToolResult;
                this.suggestedFileName.set('merged.pdf');
            } else if (tool === 'extract') {
                const sourcePath = primaryFile?.path;
                const sourceName = primaryFile?.name ?? 'document.pdf';
                if (!sourcePath) {
                    throw new Error('No PDF file selected.');
                }

                const pages = this.selectedPages();
                if (pages.length === 0) {
                    throw new Error('Select at least one page to extract.');
                }

                output = (await this.electronService.pdfExtractRange({
                    filePath: sourcePath,
                    startPage: this.startPage(),
                    endPage: this.endPage(),
                    pageNumbers: pages,
                })) as PdfToolResult;
                this.suggestedFileName.set(
                    `${this.getFileBaseName(sourceName)}-selected-pages.pdf`
                );
            } else if (tool === 'rotate') {
                const sourcePath = primaryFile?.path;
                const sourceName = primaryFile?.name ?? 'document.pdf';
                if (!sourcePath) {
                    throw new Error('No PDF file selected.');
                }

                const pages = this.selectedPages();
                if (pages.length === 0) {
                    throw new Error('Select at least one page to rotate.');
                }

                output = (await this.electronService.pdfRotatePages({
                    filePath: sourcePath,
                    rotation: this.rotation(),
                    startPage: this.startPage(),
                    endPage: this.endPage(),
                    pageNumbers: pages,
                })) as PdfToolResult;
                this.suggestedFileName.set(`${this.getFileBaseName(sourceName)}-rotated.pdf`);
            } else if (tool === 'delete') {
                const sourcePath = primaryFile?.path;
                const sourceName = primaryFile?.name ?? 'document.pdf';
                if (!sourcePath) {
                    throw new Error('No PDF file selected.');
                }

                const pages = this.selectedPages();
                if (pages.length === 0) {
                    throw new Error('Select at least one page to delete.');
                }

                if (pages.length >= this.maxPages()) {
                    throw new Error('Cannot delete all pages. Keep at least one page in the PDF.');
                }

                output = (await this.electronService.pdfDeletePages({
                    filePath: sourcePath,
                    pageNumbers: pages,
                })) as PdfToolResult;
                this.suggestedFileName.set(`${this.getFileBaseName(sourceName)}-trimmed.pdf`);
            } else {
                const sourcePath = primaryFile?.path;
                const sourceName = primaryFile?.name ?? 'document.pdf';
                if (!sourcePath) {
                    throw new Error('No PDF file selected.');
                }

                output = (await this.electronService.pdfUpdateMetadata({
                    filePath: sourcePath,
                    title: this.metadataTitle(),
                    author: this.metadataAuthor(),
                    subject: this.metadataSubject(),
                    keywords: this.metadataKeywords(),
                })) as PdfToolResult;
                this.suggestedFileName.set(`${this.getFileBaseName(sourceName)}-metadata.pdf`);
            }

            this.progress.set(100);
            this.result.set(output);
            if (output.buffer) {
                this.resultPdfPreviewUrl.set(this.toSafePdfUrl(output.buffer));
            }

            this.messageService.add({
                severity: 'success',
                summary: 'Completed',
                detail: `PDF tool finished: ${this.getToolName(tool)}`,
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
        const output = this.result();
        if (!output?.buffer) {
            return;
        }

        const saveResult = (await this.electronService.saveWithPreferences({
            suggestedName: this.suggestedFileName(),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            data: this.base64ToArrayBuffer(output.buffer),
        })) as { saved: boolean; filePath?: string };

        if (!saveResult.saved) {
            return;
        }

        this.messageService.add({
            severity: 'success',
            summary: 'Saved',
            detail: saveResult.filePath ? `Saved to ${saveResult.filePath}` : `Saved ${this.suggestedFileName()}`,
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

    private async updatePrimaryFileMetadata(): Promise<void> {
        const primary = this.files()[0];
        if (!primary?.path || !this.electronService.isElectron) {
            return;
        }

        try {
            const metadata = (await this.electronService.pdfGetMetadata(primary.path)) as PdfMetadata;
            const pageCount = Math.max(1, metadata.pageCount);
            this.maxPages.set(pageCount);
            this.startPage.set(1);
            this.endPage.set(pageCount);
            this.selectedPages.set(Array.from({ length: pageCount }, (_, index) => index + 1));
        } catch {
            // Metadata is optional for operation setup.
        }
    }

    private async refreshOriginalPdfPreview(): Promise<void> {
        const primary = this.files()[0];
        if (!primary?.path || !this.electronService.isElectron) {
            this.originalPdfPreviewUrl.set(null);
            return;
        }

        try {
            const base64 = await this.electronService.readFileBase64(primary.path);
            this.originalPdfPreviewUrl.set(this.toSafePdfUrl(base64));
        } catch {
            this.originalPdfPreviewUrl.set(null);
        }
    }

    protected togglePage(page: number): void {
        this.selectedPages.update(current => {
            if (current.includes(page)) {
                return current.filter(item => item !== page);
            }

            return [...current, page].sort((left, right) => left - right);
        });
    }

    protected isPageSelected(page: number): boolean {
        return this.selectedPages().includes(page);
    }

    protected selectAllPages(): void {
        this.selectedPages.set(this.pageNumbers());
    }

    protected clearPageSelection(): void {
        this.selectedPages.set([]);
    }

    private getToolName(tool: PdfTool): string {
        if (tool === 'merge') {
            return 'Merge PDFs';
        }
        if (tool === 'extract') {
            return 'Extract Page Range';
        }
        if (tool === 'rotate') {
            return 'Rotate Pages';
        }
        if (tool === 'delete') {
            return 'Delete Pages';
        }
        return 'Update Metadata';
    }

    private getFileBaseName(fileName: string): string {
        return fileName.replace(/\.pdf$/i, '');
    }

    private isPdfFile(file: DropzoneFile): boolean {
        return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        return 'Unexpected error while processing the PDF.';
    }

    private base64ToArrayBuffer(value: string): ArrayBuffer {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    }

    private toSafePdfUrl(base64: string): SafeResourceUrl {
        return this.sanitizer.bypassSecurityTrustResourceUrl(`data:application/pdf;base64,${base64}`);
    }
}
