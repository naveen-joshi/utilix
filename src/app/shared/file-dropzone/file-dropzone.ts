import { Component, ChangeDetectionStrategy, output, input, signal, inject } from '@angular/core';
import { ElectronService } from '../../services/electron.service';

export interface DropzoneFile {
    file: File;
    name: string;
    size: number;
    type: string;
    path: string;
    preview?: string;
}

@Component({
    selector: 'app-file-dropzone',
    templateUrl: './file-dropzone.html',
    styleUrl: './file-dropzone.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileDropzone {
    private readonly electronService = inject(ElectronService);

    readonly accept = input<string>('image/*,.pdf');
    readonly multiple = input<boolean>(true);
    readonly maxFiles = input<number>(50);
    readonly filesSelected = output<DropzoneFile[]>();

    protected readonly isDragOver = signal(false);

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver.set(true);
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver.set(false);
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragOver.set(false);

        const files = event.dataTransfer?.files;
        if (files) {
            this.processFiles(files);
        }
    }

    onFileInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            this.processFiles(input.files);
        }
        input.value = '';
    }

    private processFiles(fileList: FileList): void {
        const files: DropzoneFile[] = [];
        const max = this.maxFiles();

        for (let i = 0; i < Math.min(fileList.length, max); i++) {
            const file = fileList[i];
            files.push({
                file,
                name: file.name,
                size: file.size,
                type: file.type,
                path: this.electronService.isElectron
                    ? this.electronService.getPathForFile(file)
                    : '',
            });
        }

        if (files.length > 0) {
            this.filesSelected.emit(files);
        }
    }
}
