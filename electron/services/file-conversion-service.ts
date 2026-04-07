import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

type ConversionStrategy = 'sharp' | 'pdf-lib' | 'libreoffice' | 'copy';
type ConversionCategory = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'unknown';
type RasterFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

const execFileAsync = promisify(execFile);

const imageFormats = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg']);
const documentFormats = new Set(['doc', 'docx', 'odt', 'rtf']);
const spreadsheetFormats = new Set(['xls', 'xlsx', 'ods', 'csv']);
const presentationFormats = new Set(['ppt', 'pptx', 'odp']);
const textFormats = new Set(['txt', 'md', 'html', 'htm']);

let cachedLibreOfficeCommand: string | null | undefined;

export interface FileConvertOptions {
    filePath: string;
    targetFormat: string;
    quality?: number;
    outputPath?: string;
}

export interface FileConvertResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    originalSize: number;
    newSize: number;
    sourceFormat: string;
    targetFormat: string;
    strategy: ConversionStrategy;
    message?: string;
}

export interface FileConversionCapabilities {
    libreOfficeAvailable: boolean;
    libreOfficePath?: string;
    message: string;
}

function normalizeFormat(format: string): string {
    const normalized = format.replace('.', '').toLowerCase();
    if (normalized === 'jpg') {
        return 'jpeg';
    }

    if (normalized === 'htm') {
        return 'html';
    }

    if (normalized === 'tif') {
        return 'tiff';
    }

    return normalized;
}

function getFileFormat(filePath: string): string {
    return normalizeFormat(path.extname(filePath));
}

function getCategory(format: string): ConversionCategory {
    if (imageFormats.has(format)) {
        return 'image';
    }

    if (format === 'pdf') {
        return 'pdf';
    }

    if (documentFormats.has(format)) {
        return 'document';
    }

    if (spreadsheetFormats.has(format)) {
        return 'spreadsheet';
    }

    if (presentationFormats.has(format)) {
        return 'presentation';
    }

    if (textFormats.has(format)) {
        return 'text';
    }

    return 'unknown';
}

function ensurePath(filePath: string): void {
    if (!filePath) {
        throw new Error('No file path provided. Please select files from the desktop app.');
    }
}

function mimeTypeForFormat(format: string): string {
    switch (format) {
        case 'jpeg':
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
            return 'application/octet-stream';
    }
}

async function resolveLibreOfficeCommand(): Promise<string> {
    if (cachedLibreOfficeCommand !== undefined) {
        if (!cachedLibreOfficeCommand) {
            throw new Error('LibreOffice was not found. Install LibreOffice or set LIBREOFFICE_PATH.');
        }

        return cachedLibreOfficeCommand;
    }

    const envPath = process.env.LIBREOFFICE_PATH;
    const candidates = [
        envPath,
        process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : undefined,
        process.platform === 'win32' ? 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe' : undefined,
        process.platform !== 'win32' ? '/usr/bin/soffice' : undefined,
        process.platform !== 'win32' ? '/usr/local/bin/soffice' : undefined,
        process.platform !== 'win32' ? '/snap/bin/libreoffice' : undefined,
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            await execFileAsync(candidate, ['--version'], { windowsHide: true });
            cachedLibreOfficeCommand = candidate;
            return candidate;
        } catch {
            // Try next candidate.
        }
    }

    try {
        await execFileAsync('soffice', ['--version'], { windowsHide: true });
        cachedLibreOfficeCommand = 'soffice';
        return 'soffice';
    } catch {
        cachedLibreOfficeCommand = null;
        throw new Error('LibreOffice was not found. Install LibreOffice or set LIBREOFFICE_PATH.');
    }
}

async function convertImageWithSharp(
    filePath: string,
    targetFormat: RasterFormat,
    quality: number
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
    const output = await applyFormat(sharp(filePath), targetFormat, quality).toBuffer({
        resolveWithObject: true,
    });

    return {
        buffer: output.data,
        width: output.info.width,
        height: output.info.height,
        format: targetFormat,
    };
}

function applyFormat(pipeline: sharp.Sharp, format: RasterFormat, quality: number): sharp.Sharp {
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
    }
}

async function convertImageToSvg(filePath: string): Promise<Buffer> {
    const metadata = await sharp(filePath).metadata();
    const source = await fs.readFile(filePath);
    const sourceFormat = normalizeFormat(metadata.format ?? path.extname(filePath));

    if (sourceFormat === 'svg') {
        return source;
    }

    const width = metadata.width ?? 512;
    const height = metadata.height ?? 512;
    const mimeType = mimeTypeForFormat(sourceFormat);
    const encoded = source.toString('base64');
    const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <image href="data:${mimeType};base64,${encoded}" x="0" y="0" width="${width}" height="${height}"/>\n</svg>`;
    return Buffer.from(svgText, 'utf-8');
}

async function convertImageToPdf(filePath: string): Promise<Buffer> {
    const sourceFormat = getFileFormat(filePath);
    let imageBytes: Uint8Array = await fs.readFile(filePath);

    // pdf-lib supports JPG and PNG directly, so convert other formats to PNG first.
    if (sourceFormat !== 'jpeg' && sourceFormat !== 'png') {
        imageBytes = await sharp(filePath).png().toBuffer();
    }

    const metadata = await sharp(Buffer.from(imageBytes)).metadata();
    const width = metadata.width ?? 1024;
    const height = metadata.height ?? 768;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([width, height]);
    const image = sourceFormat === 'jpeg'
        ? await pdf.embedJpg(imageBytes)
        : await pdf.embedPng(imageBytes);

    page.drawImage(image, {
        x: 0,
        y: 0,
        width,
        height,
    });

    const pdfBytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
    return Buffer.from(pdfBytes);
}

async function convertWithLibreOffice(filePath: string, targetFormat: string): Promise<{ buffer: Buffer; outputFormat: string }> {
    const command = await resolveLibreOfficeCommand();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'utilix-convert-'));
    const baseName = path.parse(filePath).name.toLowerCase();

    try {
        await execFileAsync(
            command,
            ['--headless', '--convert-to', targetFormat, '--outdir', tempDir, filePath],
            { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
        );

        const outputs = await fs.readdir(tempDir);
        const normalizedTarget = normalizeFormat(targetFormat);

        let selectedOutput = outputs.find(item => {
            const name = path.parse(item).name.toLowerCase();
            const format = normalizeFormat(path.extname(item));
            return name === baseName && format === normalizedTarget;
        });

        if (!selectedOutput) {
            selectedOutput = outputs.find(item => normalizeFormat(path.extname(item)) === normalizedTarget);
        }

        if (!selectedOutput && outputs.length > 0) {
            selectedOutput = outputs[0];
        }

        if (!selectedOutput) {
            throw new Error(`LibreOffice did not produce an output file for ${targetFormat}.`);
        }

        const outputPath = path.join(tempDir, selectedOutput);
        const buffer = await fs.readFile(outputPath);
        const outputFormat = normalizeFormat(path.extname(selectedOutput));

        return { buffer, outputFormat };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function getCapabilities(): Promise<FileConversionCapabilities> {
    try {
        const command = await resolveLibreOfficeCommand();
        return {
            libreOfficeAvailable: true,
            libreOfficePath: command,
            message: 'LibreOffice conversion engine is available.',
        };
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : 'LibreOffice conversion engine is not available.';

        return {
            libreOfficeAvailable: false,
            message,
        };
    }
}

async function convertFile(options: FileConvertOptions): Promise<FileConvertResult> {
    ensurePath(options.filePath);

    const sourceFormat = getFileFormat(options.filePath);
    const targetFormat = normalizeFormat(options.targetFormat);
    const originalStats = await fs.stat(options.filePath);
    const quality = options.quality ?? 90;

    let strategy: ConversionStrategy = 'copy';
    let outputBuffer: Buffer;
    let effectiveTarget = targetFormat;

    const sourceCategory = getCategory(sourceFormat);

    if (sourceFormat === targetFormat) {
        outputBuffer = await fs.readFile(options.filePath);
        strategy = 'copy';
    } else if (sourceCategory === 'image' && targetFormat === 'pdf') {
        outputBuffer = await convertImageToPdf(options.filePath);
        strategy = 'pdf-lib';
    } else if (sourceCategory === 'image' && targetFormat === 'svg') {
        outputBuffer = await convertImageToSvg(options.filePath);
        strategy = 'sharp';
    } else if (sourceCategory === 'image' && ['jpeg', 'png', 'webp', 'gif', 'avif'].includes(targetFormat)) {
        const converted = await convertImageWithSharp(options.filePath, targetFormat as RasterFormat, quality);
        outputBuffer = converted.buffer;
        strategy = 'sharp';
    } else {
        const converted = await convertWithLibreOffice(options.filePath, targetFormat);
        outputBuffer = converted.buffer;
        effectiveTarget = converted.outputFormat;
        strategy = 'libreoffice';
    }

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, outputBuffer);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: outputBuffer.toString('base64'),
        originalSize: originalStats.size,
        newSize: outputBuffer.length,
        sourceFormat,
        targetFormat: effectiveTarget,
        strategy,
    };
}

export function registerFileConversionHandlers(): void {
    ipcMain.handle('file:convert', async (_event, options: FileConvertOptions) => {
        return convertFile(options);
    });

    ipcMain.handle('file:conversion-capabilities', async () => {
        return getCapabilities();
    });
}
