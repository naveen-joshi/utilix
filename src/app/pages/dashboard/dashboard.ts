import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

interface UtilityCard {
    title: string;
    description: string;
    icon: string;
    route: string;
    available: boolean;
}

@Component({
    selector: 'app-dashboard',
    imports: [RouterLink],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
    protected readonly utilities: UtilityCard[] = [
        {
            title: 'File Resize',
            description: 'Resize images by dimensions or compress to a target file size. Supports JPEG, PNG, WebP, GIF, and PDF.',
            icon: 'pi pi-arrows-h',
            route: '/resize',
            available: true,
        },
        {
            title: 'Format Converter',
            description: 'Convert image formats quickly: JPEG, PNG, WebP, GIF, and AVIF with quality control.',
            icon: 'pi pi-sync',
            route: '/convert',
            available: true,
        },
        {
            title: 'Image Tools',
            description: 'Crop, rotate, resize, SVG convert, favicon generator, and background removal tools.',
            icon: 'pi pi-images',
            route: '/image-tools',
            available: true,
        },
        {
            title: 'PDF Tools',
            description: 'Merge, extract pages, rotate pages, delete pages, and update PDF metadata.',
            icon: 'pi pi-file-edit',
            route: '/pdf-tools',
            available: true,
        },
        {
            title: 'Batch Rename',
            description: 'Rename multiple files at once with patterns, sequences, and find-replace.',
            icon: 'pi pi-pencil',
            route: '/rename',
            available: false,
        },
        {
            title: 'Metadata Editor',
            description: 'View and edit file metadata. Strip EXIF data for privacy.',
            icon: 'pi pi-info-circle',
            route: '/metadata',
            available: false,
        },
    ];
}
