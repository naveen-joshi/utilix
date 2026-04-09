import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard),
    },
    {
        path: 'resize',
        loadComponent: () => import('./pages/resize/resize').then(m => m.Resize),
    },
    {
        path: 'convert',
        loadComponent: () => import('./pages/convert/convert').then(m => m.Convert),
    },
    {
        path: 'image-tools',
        loadComponent: () => import('./pages/image-tools/image-tools').then(m => m.ImageTools),
    },
    {
        path: 'pdf-tools',
        loadComponent: () => import('./pages/pdf-tools/pdf-tools').then(m => m.PdfTools),
    },
    {
        path: 'video',
        loadComponent: () => import('./pages/video/video').then(m => m.VideoPage),
    },
    {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings').then(m => m.Settings),
    },
];
