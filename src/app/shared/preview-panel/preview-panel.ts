import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { UpperCasePipe } from '@angular/common';

@Component({
    selector: 'app-preview-panel',
    imports: [UpperCasePipe],
    templateUrl: './preview-panel.html',
    styleUrl: './preview-panel.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewPanel {
    readonly originalSrc = input<string>('');
    readonly resultSrc = input<string>('');
    readonly originalSize = input<number>(0);
    readonly resultSize = input<number>(0);
    readonly originalDimensions = input<string>('');
    readonly resultDimensions = input<string>('');
    readonly originalFormat = input<string>('');
    readonly resultFormat = input<string>('');

    protected readonly savings = computed(() => {
        const orig = this.originalSize();
        const result = this.resultSize();
        if (orig === 0 || result === 0) return 0;
        return Math.round(((orig - result) / orig) * 100);
    });

    protected formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
    }
}
