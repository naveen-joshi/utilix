import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

export interface CropSelection {
    x: number;
    y: number;
    width: number;
    height: number;
}

type DragMode = 'idle' | 'drawing' | 'moving';

@Component({
    selector: 'app-image-cropper',
    templateUrl: './image-cropper.html',
    styleUrl: './image-cropper.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageCropper {
    readonly src = input<string>('');
    readonly selectionChanged = output<CropSelection>();

    protected readonly selection = signal<CropSelection>({
        x: 0.15,
        y: 0.15,
        width: 0.7,
        height: 0.7,
    });

    private readonly dragMode = signal<DragMode>('idle');
    private readonly startX = signal(0);
    private readonly startY = signal(0);
    private readonly moveOffsetX = signal(0);
    private readonly moveOffsetY = signal(0);

    onPointerDown(event: PointerEvent): void {
        const stage = event.currentTarget as HTMLElement;
        if (!stage) {
            return;
        }

        stage.setPointerCapture(event.pointerId);
        const point = this.toNormalizedPoint(event, stage);
        const current = this.selection();

        if (this.isPointInside(point.x, point.y, current)) {
            this.dragMode.set('moving');
            this.moveOffsetX.set(point.x - current.x);
            this.moveOffsetY.set(point.y - current.y);
            return;
        }

        this.dragMode.set('drawing');
        this.startX.set(point.x);
        this.startY.set(point.y);
        this.selection.set({ x: point.x, y: point.y, width: 0.001, height: 0.001 });
        this.emitSelection();
    }

    onPointerMove(event: PointerEvent): void {
        const mode = this.dragMode();
        if (mode === 'idle') {
            return;
        }

        const stage = event.currentTarget as HTMLElement;
        if (!stage) {
            return;
        }

        const point = this.toNormalizedPoint(event, stage);

        if (mode === 'drawing') {
            const left = Math.min(this.startX(), point.x);
            const top = Math.min(this.startY(), point.y);
            const right = Math.max(this.startX(), point.x);
            const bottom = Math.max(this.startY(), point.y);

            this.selection.set({
                x: left,
                y: top,
                width: Math.max(0.001, right - left),
                height: Math.max(0.001, bottom - top),
            });
            this.emitSelection();
            return;
        }

        const current = this.selection();
        const width = current.width;
        const height = current.height;

        const nextX = this.clamp(point.x - this.moveOffsetX(), 0, 1 - width);
        const nextY = this.clamp(point.y - this.moveOffsetY(), 0, 1 - height);

        this.selection.set({
            x: nextX,
            y: nextY,
            width,
            height,
        });
        this.emitSelection();
    }

    onPointerUp(event: PointerEvent): void {
        const stage = event.currentTarget as HTMLElement;
        if (stage?.hasPointerCapture(event.pointerId)) {
            stage.releasePointerCapture(event.pointerId);
        }

        this.dragMode.set('idle');
        this.emitSelection();
    }

    protected resetSelection(): void {
        this.selection.set({
            x: 0.15,
            y: 0.15,
            width: 0.7,
            height: 0.7,
        });
        this.emitSelection();
    }

    private emitSelection(): void {
        const next = this.selection();
        this.selectionChanged.emit({
            x: this.clamp(next.x, 0, 1),
            y: this.clamp(next.y, 0, 1),
            width: this.clamp(next.width, 0.001, 1),
            height: this.clamp(next.height, 0.001, 1),
        });
    }

    private toNormalizedPoint(event: PointerEvent, stage: HTMLElement): { x: number; y: number } {
        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return { x: 0, y: 0 };
        }

        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        return {
            x: this.clamp(x, 0, 1),
            y: this.clamp(y, 0, 1),
        };
    }

    private isPointInside(x: number, y: number, selection: CropSelection): boolean {
        return (
            x >= selection.x &&
            x <= selection.x + selection.width &&
            y >= selection.y &&
            y <= selection.y + selection.height
        );
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}
