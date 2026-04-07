import { ipcMain, dialog } from 'electron';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import pngToIco from 'png-to-ico';

type RasterFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

export interface ImageResizeOptions {
    filePath: string;
    mode: 'dimensions' | 'filesize';
    width?: number;
    height?: number;
    maintainAspectRatio?: boolean;
    targetSizeKB?: number;
    quality?: number;
    outputFormat?: RasterFormat;
    outputPath?: string;
}

export interface ImageMetadata {
    width: number;
    height: number;
    format: string;
    size: number;
    channels: number;
    hasAlpha: boolean;
}

export interface ImageResizeResult {
    success: boolean;
    outputPath?: string;
    buffer?: string; // base64
    originalSize: number;
    newSize: number;
    width: number;
    height: number;
    format: string;
}

export interface ImageConvertOptions {
    filePath: string;
    outputFormat: RasterFormat;
    quality?: number;
    outputPath?: string;
}

export interface ImageCropOptions {
    filePath: string;
    left: number;
    top: number;
    width: number;
    height: number;
    outputFormat?: RasterFormat;
    quality?: number;
    outputPath?: string;
}

export interface ImageRotateOptions {
    filePath: string;
    angle: number;
    outputFormat?: RasterFormat;
    quality?: number;
    background?: string;
    outputPath?: string;
}

export interface ImageSvgConvertOptions {
    filePath: string;
    targetFormat: RasterFormat | 'svg';
    quality?: number;
    outputPath?: string;
}

export interface RemoveBackgroundOptions {
    filePath: string;
    threshold?: number;
    outputFormat?: 'png' | 'webp';
    quality?: number;
    outputPath?: string;
}

export interface FaviconGenerateOptions {
    filePath: string;
    sizes?: number[];
    outputPath?: string;
}

export interface FaviconGenerateResult {
    success: boolean;
    outputPath?: string;
    originalSize: number;
    icoSize: number;
    icoBuffer: string;
    pngs: Array<{ size: number; buffer: string }>;
}

function ensureFilePath(filePath: string): void {
    if (!filePath) {
        throw new Error('No file path provided. Please select files from the desktop app.');
    }
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function mimeTypeForFormat(format: string): string {
    switch (format) {
        case 'jpeg':
        case 'jpg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'avif':
            return 'image/avif';
        case 'svg':
            return 'image/svg+xml';
        default:
            return 'image/png';
    }
}

async function getMetadata(filePath: string): Promise<ImageMetadata> {
    ensureFilePath(filePath);

    const stats = await fs.stat(filePath);
    const metadata = await sharp(filePath).metadata();

    return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? 'unknown',
        size: stats.size,
        channels: metadata.channels ?? 0,
        hasAlpha: metadata.hasAlpha ?? false,
    };
}

async function generatePreview(
    filePath: string,
    maxWidth: number,
    maxHeight: number
): Promise<{ buffer: string; width: number; height: number; format: string }> {
    ensureFilePath(filePath);

    const result = await sharp(filePath)
        .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });

    return {
        buffer: result.data.toString('base64'),
        width: result.info.width,
        height: result.info.height,
        format: 'png',
    };
}

async function resizeImage(options: ImageResizeOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    let pipeline = sharp(options.filePath);

    if (options.mode === 'dimensions') {
        pipeline = pipeline.resize(options.width, options.height, {
            fit: options.maintainAspectRatio ? 'inside' : 'fill',
            withoutEnlargement: false,
        });
    }

    // Apply output format
    const format: RasterFormat = options.outputFormat ?? 'jpeg';
    let quality = options.quality ?? 80;

    if (options.mode === 'filesize' && options.targetSizeKB) {
        // Iterative quality reduction to meet target file size
        const targetBytes = options.targetSizeKB * 1024;
        let currentBuffer: Buffer;
        let minQuality = 1;
        let maxQuality = 100;

        // Binary search for optimal quality
        for (let i = 0; i < 10; i++) {
            quality = Math.round((minQuality + maxQuality) / 2);
            const tempPipeline = sharp(options.filePath);

            if (options.width || options.height) {
                tempPipeline.resize(options.width, options.height, {
                    fit: options.maintainAspectRatio ? 'inside' : 'fill',
                });
            }

            currentBuffer = await applyFormat(tempPipeline, format, quality).toBuffer();

            if (currentBuffer.length > targetBytes) {
                maxQuality = quality - 1;
            } else {
                minQuality = quality + 1;
            }

            if (Math.abs(currentBuffer.length - targetBytes) / targetBytes < 0.05) {
                break; // Within 5% of target
            }
        }

        // Final pass with determined quality
        pipeline = sharp(options.filePath);
        if (options.width || options.height) {
            pipeline = pipeline.resize(options.width, options.height, {
                fit: options.maintainAspectRatio ? 'inside' : 'fill',
            });
        }
    }

    pipeline = applyFormat(pipeline, format, quality);

    const resultBuffer = await pipeline.toBuffer({ resolveWithObject: true });

    // Save if output path provided
    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format,
    };
}

async function convertImage(options: ImageConvertOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const quality = options.quality ?? 85;
    const format = options.outputFormat;

    const resultBuffer = await applyFormat(sharp(options.filePath), format, quality).toBuffer({
        resolveWithObject: true,
    });

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format,
    };
}

async function cropImage(options: ImageCropOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const metadata = await sharp(options.filePath).metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Unable to read image dimensions for crop operation.');
    }

    const left = clampNumber(Math.floor(options.left), 0, metadata.width - 1);
    const top = clampNumber(Math.floor(options.top), 0, metadata.height - 1);
    const width = clampNumber(Math.floor(options.width), 1, metadata.width - left);
    const height = clampNumber(Math.floor(options.height), 1, metadata.height - top);
    const format: RasterFormat = options.outputFormat ?? 'png';
    const quality = options.quality ?? 90;

    const resultBuffer = await applyFormat(
        sharp(options.filePath).extract({ left, top, width, height }),
        format,
        quality
    ).toBuffer({ resolveWithObject: true });

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format,
    };
}

async function rotateImage(options: ImageRotateOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const format: RasterFormat = options.outputFormat ?? 'png';
    const quality = options.quality ?? 90;
    const angle = Number.isFinite(options.angle) ? options.angle : 90;

    const resultBuffer = await applyFormat(
        sharp(options.filePath).rotate(angle, { background: options.background ?? '#00000000' }),
        format,
        quality
    ).toBuffer({ resolveWithObject: true });

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format,
    };
}

async function convertSvg(options: ImageSvgConvertOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const metadata = await sharp(options.filePath).metadata();
    const quality = options.quality ?? 90;

    if (options.targetFormat === 'svg') {
        const sourceBuffer = await fs.readFile(options.filePath);
        const inputFormat = metadata.format ?? path.extname(options.filePath).replace('.', '').toLowerCase();

        let svgBuffer: Buffer;
        if (inputFormat === 'svg') {
            svgBuffer = sourceBuffer;
        } else {
            const width = metadata.width ?? 512;
            const height = metadata.height ?? 512;
            const mimeType = mimeTypeForFormat(inputFormat);
            const embeddedImage = sourceBuffer.toString('base64');

            const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <image href="data:${mimeType};base64,${embeddedImage}" x="0" y="0" width="${width}" height="${height}" />\n</svg>`;
            svgBuffer = Buffer.from(svgText, 'utf-8');
        }

        if (options.outputPath) {
            await fs.writeFile(options.outputPath, svgBuffer);
        }

        return {
            success: true,
            outputPath: options.outputPath,
            buffer: svgBuffer.toString('base64'),
            originalSize: originalStats.size,
            newSize: svgBuffer.length,
            width: metadata.width ?? 512,
            height: metadata.height ?? 512,
            format: 'svg',
        };
    }

    const resultBuffer = await applyFormat(
        sharp(options.filePath),
        options.targetFormat,
        quality
    ).toBuffer({ resolveWithObject: true });

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format: options.targetFormat,
    };
}

async function removeBackground(options: RemoveBackgroundOptions): Promise<ImageResizeResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const threshold = clampNumber(options.threshold ?? 28, 5, 120);
    const format = options.outputFormat ?? 'png';
    const quality = options.quality ?? 90;

    const source = await sharp(options.filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = Buffer.from(source.data);
    const channels = source.info.channels;

    if (channels < 4) {
        throw new Error('Image does not contain alpha channel data for background removal.');
    }

    const width = source.info.width;
    const height = source.info.height;

    const corners = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1],
    ];

    let backgroundRed = 0;
    let backgroundGreen = 0;
    let backgroundBlue = 0;

    corners.forEach(([x, y]) => {
        const index = (y * width + x) * channels;
        backgroundRed += pixels[index];
        backgroundGreen += pixels[index + 1];
        backgroundBlue += pixels[index + 2];
    });

    backgroundRed = Math.round(backgroundRed / corners.length);
    backgroundGreen = Math.round(backgroundGreen / corners.length);
    backgroundBlue = Math.round(backgroundBlue / corners.length);

    const blendThreshold = threshold * 1.35;

    for (let index = 0; index < pixels.length; index += channels) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];

        const distance = Math.sqrt(
            Math.pow(red - backgroundRed, 2) +
            Math.pow(green - backgroundGreen, 2) +
            Math.pow(blue - backgroundBlue, 2)
        );

        if (distance <= threshold) {
            pixels[index + 3] = 0;
        } else if (distance <= blendThreshold) {
            const alphaRatio = (distance - threshold) / (blendThreshold - threshold);
            pixels[index + 3] = Math.round(alphaRatio * 255);
        } else {
            pixels[index + 3] = 255;
        }
    }

    let output = sharp(pixels, {
        raw: {
            width,
            height,
            channels,
        },
    });

    output =
        format === 'webp'
            ? output.webp({ quality })
            : output.png({ quality });

    const resultBuffer = await output.toBuffer({ resolveWithObject: true });

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, resultBuffer.data);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: resultBuffer.data.toString('base64'),
        originalSize: originalStats.size,
        newSize: resultBuffer.data.length,
        width: resultBuffer.info.width,
        height: resultBuffer.info.height,
        format,
    };
}

async function generateFavicon(options: FaviconGenerateOptions): Promise<FaviconGenerateResult> {
    ensureFilePath(options.filePath);

    const originalStats = await fs.stat(options.filePath);
    const defaultSizes = [16, 32, 48, 64, 128, 180];

    const sizes = [...new Set((options.sizes?.length ? options.sizes : defaultSizes)
        .map(size => Math.round(size))
        .filter(size => Number.isInteger(size) && size >= 16 && size <= 512))]
        .sort((left, right) => left - right);

    if (sizes.length === 0) {
        throw new Error('No valid favicon sizes provided.');
    }

    const pngBuffers: Buffer[] = [];
    const pngs: Array<{ size: number; buffer: string }> = [];

    for (const size of sizes) {
        const pngBuffer = await sharp(options.filePath)
            .resize(size, size, { fit: 'cover', position: 'attention' })
            .png()
            .toBuffer();

        pngBuffers.push(pngBuffer);
        pngs.push({
            size,
            buffer: pngBuffer.toString('base64'),
        });
    }

    const icoBuffer = await pngToIco(pngBuffers);

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, icoBuffer);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        originalSize: originalStats.size,
        icoSize: icoBuffer.length,
        icoBuffer: icoBuffer.toString('base64'),
        pngs,
    };
}

function applyFormat(pipeline: sharp.Sharp, format: string, quality: number): sharp.Sharp {
    switch (format) {
        case 'jpeg':
            return pipeline.jpeg({ quality, mozjpeg: true });
        case 'png':
            return pipeline.png({ quality });
        case 'webp':
            return pipeline.webp({ quality });
        case 'gif':
            return pipeline.gif();
        case 'avif':
            return pipeline.avif({ quality });
        default:
            return pipeline.jpeg({ quality, mozjpeg: true });
    }
}

export function registerImageHandlers(): void {
    ipcMain.handle('image:resize', async (_event, options: ImageResizeOptions) => {
        return resizeImage(options);
    });

    ipcMain.handle('image:convert', async (_event, options: ImageConvertOptions) => {
        return convertImage(options);
    });

    ipcMain.handle('image:crop', async (_event, options: ImageCropOptions) => {
        return cropImage(options);
    });

    ipcMain.handle('image:rotate', async (_event, options: ImageRotateOptions) => {
        return rotateImage(options);
    });

    ipcMain.handle('image:svg-convert', async (_event, options: ImageSvgConvertOptions) => {
        return convertSvg(options);
    });

    ipcMain.handle('image:remove-background', async (_event, options: RemoveBackgroundOptions) => {
        return removeBackground(options);
    });

    ipcMain.handle('image:favicon', async (_event, options: FaviconGenerateOptions) => {
        return generateFavicon(options);
    });

    ipcMain.handle('image:get-metadata', async (_event, filePath: string) => {
        return getMetadata(filePath);
    });

    ipcMain.handle('image:generate-preview', async (_event, filePath: string, maxWidth: number, maxHeight: number) => {
        return generatePreview(filePath, maxWidth, maxHeight);
    });

    ipcMain.handle('dialog:save', async (_event, options: Electron.SaveDialogOptions) => {
        return dialog.showSaveDialog(options);
    });

    ipcMain.handle('dialog:open', async (_event, options: Electron.OpenDialogOptions) => {
        return dialog.showOpenDialog(options);
    });

    ipcMain.handle('file:save', async (_event, filePath: string, data: ArrayBuffer) => {
        await fs.writeFile(filePath, Buffer.from(data));
    });

    ipcMain.handle('file:read-base64', async (_event, filePath: string) => {
        ensureFilePath(filePath);
        const buffer = await fs.readFile(filePath);
        return buffer.toString('base64');
    });
}
