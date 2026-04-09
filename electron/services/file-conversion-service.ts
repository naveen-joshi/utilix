import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { cancelVideoConversion, convertVideoFile, videoFormats } from './video-service';
import { createScopedTempDir, isManagedTempPath, removeManagedTempPath } from './temp-file-manager';

type ConversionStrategy = 'sharp' | 'pdf-lib' | 'libreoffice' | 'copy' | 'local' | 'ffmpeg';
type ConversionCategory = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'video' | 'unknown';
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
    jobId?: string;
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

export interface FilePreviewResult {
    success: boolean;
    category: ConversionCategory;
    sourceFormat: string;
    thumbnailBase64?: string;
    excerpt?: string;
    pageCount?: number;
    message?: string;
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

    if (videoFormats.has(format)) {
        return 'video';
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

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function htmlToPlainText(value: string): string {
    const withoutScript = value.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    const withoutStyle = withoutScript.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const withLineBreaks = withoutStyle
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
    const stripped = withLineBreaks.replace(/<[^>]+>/g, ' ');
    const decoded = decodeHtmlEntities(stripped);

    return decoded
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function getLocalSupportedTargets(category: ConversionCategory, sourceFormat: string): Set<string> {
    const targets = new Set<string>([sourceFormat]);

    if (category === 'image') {
        for (const format of ['png', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'pdf']) {
            targets.add(format);
        }
        return targets;
    }

    if (category === 'pdf') {
        for (const format of ['pdf', 'txt', 'png', 'jpeg']) {
            targets.add(format);
        }
        return targets;
    }

    if (category === 'text') {
        for (const format of ['txt', 'html', 'pdf']) {
            targets.add(format);
        }
        return targets;
    }

    if (category === 'video') {
        for (const format of ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'gif']) {
            targets.add(format);
        }
        return targets;
    }

    return targets;
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

async function extractPdfText(filePath: string): Promise<string> {
    const parser = new PDFParse({ data: await fs.readFile(filePath) });

    try {
        const result = await parser.getText();
        return result.text ?? '';
    } finally {
        await parser.destroy();
    }
}

async function extractPdfTextFromBuffer(pdfBuffer: Uint8Array): Promise<string> {
    const parser = new PDFParse({ data: pdfBuffer });

    try {
        const result = await parser.getText();
        return result.text ?? '';
    } finally {
        await parser.destroy();
    }
}

async function renderPdfFirstPageFromBuffer(
    pdfBuffer: Uint8Array,
    target: 'png' | 'jpeg',
    quality: number
): Promise<{ imageBuffer: Buffer; pageCount: number }> {
    const parser = new PDFParse({ data: pdfBuffer });

    try {
        const info = await parser.getInfo();
        const screenshots = await parser.getScreenshot({
            first: 1,
            imageDataUrl: false,
            imageBuffer: true,
        });

        const page = screenshots.pages[0];
        if (!page?.data) {
            throw new Error('Unable to render a page preview from the PDF.');
        }

        const png = Buffer.from(page.data);
        if (target === 'png') {
            return {
                imageBuffer: png,
                pageCount: info.total ?? 1,
            };
        }

        const jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
        return {
            imageBuffer: jpeg,
            pageCount: info.total ?? 1,
        };
    } finally {
        await parser.destroy();
    }
}

async function convertPdfToText(filePath: string): Promise<Buffer> {
    const text = await extractPdfText(filePath);
    return Buffer.from(text, 'utf-8');
}

async function convertPdfToRaster(filePath: string, target: 'png' | 'jpeg', quality: number): Promise<Buffer> {
    const pdfBuffer = await fs.readFile(filePath);
    const rendered = await renderPdfFirstPageFromBuffer(pdfBuffer, target, quality);
    return rendered.imageBuffer;
}

function truncateExcerpt(text: string, maxLength = 420): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength)}...`;
}

async function generateFilePreview(filePath: string, categoryHint?: string): Promise<FilePreviewResult> {
    ensurePath(filePath);

    const sourceFormat = getFileFormat(filePath);
    const hintedCategory = (categoryHint ?? '').toLowerCase() as ConversionCategory;
    const category = ['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text', 'video'].includes(hintedCategory)
        ? hintedCategory
        : getCategory(sourceFormat);

    if (category === 'image') {
        const thumbnailBuffer = await sharp(filePath)
            .rotate()
            .resize({ width: 560, height: 360, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();

        return {
            success: true,
            category,
            sourceFormat,
            thumbnailBase64: thumbnailBuffer.toString('base64'),
            message: 'Image preview generated.',
        };
    }

    if (category === 'pdf') {
        const pdfBuffer = await fs.readFile(filePath);
        const rendered = await renderPdfFirstPageFromBuffer(pdfBuffer, 'png', 85);
        const excerpt = truncateExcerpt(await extractPdfTextFromBuffer(pdfBuffer));

        return {
            success: true,
            category,
            sourceFormat,
            thumbnailBase64: rendered.imageBuffer.toString('base64'),
            excerpt,
            pageCount: rendered.pageCount,
            message: 'PDF first-page preview generated.',
        };
    }

    if (category === 'text') {
        const excerpt = truncateExcerpt(await readTextContent(filePath, sourceFormat));
        return {
            success: true,
            category,
            sourceFormat,
            excerpt,
            message: excerpt
                ? 'Text excerpt extracted.'
                : 'Text file has no readable preview content.',
        };
    }

    if (category === 'document' || category === 'spreadsheet' || category === 'presentation') {
        try {
            const converted = await convertWithLibreOffice(filePath, 'pdf');
            const rendered = await renderPdfFirstPageFromBuffer(converted.buffer, 'png', 85);
            const excerpt = truncateExcerpt(await extractPdfTextFromBuffer(converted.buffer));

            return {
                success: true,
                category,
                sourceFormat,
                thumbnailBase64: rendered.imageBuffer.toString('base64'),
                excerpt,
                pageCount: rendered.pageCount,
                message: 'Office document first page preview generated.',
            };
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Could not generate office preview.';

            return {
                success: false,
                category,
                sourceFormat,
                message,
            };
        }
    }

    if (category === 'video') {
        return {
            success: true,
            category,
            sourceFormat,
            message: 'Video preview thumbnail is not generated yet. Conversion is still supported.',
        };
    }

    return {
        success: false,
        category: 'unknown',
        sourceFormat,
        message: 'Preview is unavailable for this file type.',
    };
}

async function readTextContent(filePath: string, sourceFormat: string): Promise<string> {
    const text = await fs.readFile(filePath, 'utf-8');

    if (sourceFormat === 'html') {
        return htmlToPlainText(text);
    }

    return text;
}

async function convertTextToHtml(filePath: string, sourceFormat: string): Promise<Buffer> {
    if (sourceFormat === 'html') {
        return fs.readFile(filePath);
    }

    const text = await readTextContent(filePath, sourceFormat);
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>Converted Document</title>\n</head>\n<body>\n<pre>${escapeHtml(text)}</pre>\n</body>\n</html>`;
    return Buffer.from(html, 'utf-8');
}

function wrapTextToLines(text: string, maxLineLength: number): string[] {
    const lines: string[] = [];
    const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            lines.push('');
            continue;
        }

        const words = paragraph.split(/\s+/);
        let currentLine = '';

        for (const word of words) {
            const candidate = currentLine ? `${currentLine} ${word}` : word;
            if (candidate.length <= maxLineLength) {
                currentLine = candidate;
                continue;
            }

            if (currentLine) {
                lines.push(currentLine);
            }

            if (word.length <= maxLineLength) {
                currentLine = word;
                continue;
            }

            for (let start = 0; start < word.length; start += maxLineLength) {
                const chunk = word.slice(start, start + maxLineLength);
                if (chunk.length === maxLineLength) {
                    lines.push(chunk);
                } else {
                    currentLine = chunk;
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }
    }

    return lines;
}

async function convertTextToPdf(filePath: string, sourceFormat: string): Promise<Buffer> {
    const text = await readTextContent(filePath, sourceFormat);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const fontSize = 11;
    const lineHeight = 15;
    const maxLineLength = 100;
    const lines = wrapTextToLines(text, maxLineLength);

    let page = pdf.addPage([pageWidth, pageHeight]);
    let cursorY = pageHeight - margin;

    for (const line of lines) {
        if (cursorY < margin + lineHeight) {
            page = pdf.addPage([pageWidth, pageHeight]);
            cursorY = pageHeight - margin;
        }

        page.drawText(line, {
            x: margin,
            y: cursorY,
            size: fontSize,
            font,
            maxWidth: pageWidth - margin * 2,
            lineHeight,
        });

        cursorY -= lineHeight;
    }

    const pdfBytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
    return Buffer.from(pdfBytes);
}

async function convertWithLibreOffice(filePath: string, targetFormat: string): Promise<{ buffer: Buffer; outputFormat: string }> {
    const command = await resolveLibreOfficeCommand();
    const tempDir = await createScopedTempDir('convert');
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
        await removeManagedTempPath(tempDir);
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
    const localSupportedTargets = getLocalSupportedTargets(sourceCategory, sourceFormat);

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
    } else if (sourceCategory === 'pdf' && targetFormat === 'txt') {
        outputBuffer = await convertPdfToText(options.filePath);
        strategy = 'local';
    } else if (sourceCategory === 'pdf' && (targetFormat === 'png' || targetFormat === 'jpeg')) {
        outputBuffer = await convertPdfToRaster(options.filePath, targetFormat, quality);
        strategy = 'local';
    } else if (sourceCategory === 'text' && targetFormat === 'txt') {
        const text = await readTextContent(options.filePath, sourceFormat);
        outputBuffer = Buffer.from(text, 'utf-8');
        strategy = 'local';
    } else if (sourceCategory === 'text' && targetFormat === 'html') {
        outputBuffer = await convertTextToHtml(options.filePath, sourceFormat);
        strategy = 'local';
    } else if (sourceCategory === 'text' && targetFormat === 'pdf') {
        outputBuffer = await convertTextToPdf(options.filePath, sourceFormat);
        strategy = 'local';
    } else if (sourceCategory === 'video') {
        const videoResult = await convertVideoFile({
            filePath: options.filePath,
            targetFormat,
            quality,
            jobId: options.jobId,
        });
        return {
            success: videoResult.success,
            outputPath: videoResult.outputPath,
            buffer: videoResult.buffer,
            originalSize: videoResult.originalSize,
            newSize: videoResult.newSize,
            sourceFormat: videoResult.sourceFormat,
            targetFormat: videoResult.targetFormat,
            strategy: videoResult.strategy,
        };
    } else {
        try {
            const converted = await convertWithLibreOffice(options.filePath, targetFormat);
            outputBuffer = converted.buffer;
            effectiveTarget = converted.outputFormat;
            strategy = 'libreoffice';
        } catch (error) {
            const localTargets = [...localSupportedTargets].sort().join(', ').toUpperCase();
            const message = error instanceof Error ? error.message : 'Unsupported conversion.';

            if (message.includes('LibreOffice was not found')) {
                throw new Error(
                    `Conversion ${sourceFormat.toUpperCase()} -> ${targetFormat.toUpperCase()} requires LibreOffice. Local formats available: ${localTargets || sourceFormat.toUpperCase()}.`
                );
            }

            throw error;
        }
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

    ipcMain.handle('file:cancel-conversion', async (_event, jobId: string) => {
        const cancelled = cancelVideoConversion(jobId);
        return { cancelled };
    });

    ipcMain.handle('file:conversion-capabilities', async () => {
        return getCapabilities();
    });

    ipcMain.handle('file:preview', async (_event, filePath: string, category?: string) => {
        return generateFilePreview(filePath, category);
    });

    ipcMain.handle('file:copy-to', async (_event, sourcePath: string, destPath: string) => {
        // Security: only allow copying files from the app-managed temp workspace.
        const normalizedSource = path.normalize(sourcePath);
        if (!isManagedTempPath(normalizedSource)) {
            throw new Error('Source must be a temporary file managed by this application.');
        }

        await fs.copyFile(normalizedSource, destPath);

        // Best-effort cleanup of the temp directory after successful copy
        try {
            await removeManagedTempPath(path.dirname(normalizedSource));
        } catch {
            // Ignore cleanup errors
        }
    });
}
