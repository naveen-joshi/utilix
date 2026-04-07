import { ipcMain } from 'electron';
import { PDFDocument, degrees } from 'pdf-lib';
import * as fs from 'fs/promises';

export interface PdfCompressOptions {
    filePath: string;
    outputPath?: string;
}

export interface PdfMergeOptions {
    filePaths: string[];
    outputPath?: string;
}

export interface PdfExtractRangeOptions {
    filePath: string;
    startPage: number;
    endPage: number;
    pageNumbers?: number[];
    outputPath?: string;
}

export interface PdfRotatePagesOptions {
    filePath: string;
    rotation: 90 | 180 | 270;
    startPage?: number;
    endPage?: number;
    pageNumbers?: number[];
    outputPath?: string;
}

export interface PdfDeletePagesOptions {
    filePath: string;
    pageNumbers: number[];
    outputPath?: string;
}

export interface PdfUpdateMetadataOptions {
    filePath: string;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    outputPath?: string;
}

export interface PdfMetadata {
    pageCount: number;
    title: string | undefined;
    author: string | undefined;
    size: number;
}

export interface PdfCompressResult {
    success: boolean;
    outputPath?: string;
    buffer?: string; // base64
    originalSize: number;
    newSize: number;
    pageCount: number;
}

export interface PdfOperationResult {
    success: boolean;
    outputPath?: string;
    buffer?: string;
    pageCount: number;
    newSize: number;
}

function ensureFilePath(filePath: string): void {
    if (!filePath) {
        throw new Error('No file path provided. Please select files from the desktop app.');
    }
}

function resolvePageRange(pageCount: number, startPage?: number, endPage?: number): number[] {
    const start = Math.max(1, startPage ?? 1);
    const end = Math.min(pageCount, endPage ?? pageCount);

    if (start > end) {
        throw new Error(`Invalid page range: ${start}-${end}`);
    }

    const indices: number[] = [];
    for (let page = start; page <= end; page++) {
        indices.push(page - 1);
    }

    return indices;
}

function resolvePageNumbers(pageCount: number, pageNumbers?: number[]): number[] {
    if (!pageNumbers || pageNumbers.length === 0) {
        return [];
    }

    return [...new Set(pageNumbers)]
        .filter(page => Number.isInteger(page) && page >= 1 && page <= pageCount)
        .sort((a, b) => a - b)
        .map(page => page - 1);
}

async function toPdfOperationResult(pdfDoc: PDFDocument, outputPath?: string): Promise<PdfOperationResult> {
    const outputBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
    });

    const outputBuffer = Buffer.from(outputBytes);

    if (outputPath) {
        await fs.writeFile(outputPath, outputBuffer);
    }

    return {
        success: true,
        outputPath,
        buffer: outputBuffer.toString('base64'),
        pageCount: pdfDoc.getPageCount(),
        newSize: outputBuffer.length,
    };
}

async function getMetadata(filePath: string): Promise<PdfMetadata> {
    ensureFilePath(filePath);

    const fileBuffer = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
    const stats = await fs.stat(filePath);

    return {
        pageCount: pdfDoc.getPageCount(),
        title: pdfDoc.getTitle(),
        author: pdfDoc.getAuthor(),
        size: stats.size,
    };
}

async function compressPdf(options: PdfCompressOptions): Promise<PdfCompressResult> {
    ensureFilePath(options.filePath);

    const originalBuffer = await fs.readFile(options.filePath);
    const originalSize = originalBuffer.length;

    const pdfDoc = await PDFDocument.load(originalBuffer);

    // Strip metadata to reduce size
    pdfDoc.setProducer('Utilix');
    pdfDoc.setCreator('Utilix');

    // Save with object streams enabled for better compression
    const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
    });

    const compressedBuffer = Buffer.from(compressedBytes);

    if (options.outputPath) {
        await fs.writeFile(options.outputPath, compressedBuffer);
    }

    return {
        success: true,
        outputPath: options.outputPath,
        buffer: compressedBuffer.toString('base64'),
        originalSize,
        newSize: compressedBuffer.length,
        pageCount: pdfDoc.getPageCount(),
    };
}

async function mergePdfs(options: PdfMergeOptions): Promise<PdfOperationResult> {
    if (!options.filePaths || options.filePaths.length < 2) {
        throw new Error('Please provide at least two PDF files to merge.');
    }

    const mergedPdf = await PDFDocument.create();

    for (const filePath of options.filePaths) {
        ensureFilePath(filePath);
        const pdfBytes = await fs.readFile(filePath);
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
    }

    return toPdfOperationResult(mergedPdf, options.outputPath);
}

async function extractPdfRange(options: PdfExtractRangeOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const pdfBytes = await fs.readFile(options.filePath);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const sourcePageCount = sourcePdf.getPageCount();
    const explicitIndices = resolvePageNumbers(sourcePageCount, options.pageNumbers);
    const indices = explicitIndices.length > 0
        ? explicitIndices
        : resolvePageRange(sourcePageCount, options.startPage, options.endPage);

    const extractedPdf = await PDFDocument.create();
    const pages = await extractedPdf.copyPages(sourcePdf, indices);
    pages.forEach(page => extractedPdf.addPage(page));

    return toPdfOperationResult(extractedPdf, options.outputPath);
}

async function rotatePdfPages(options: PdfRotatePagesOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();
    const explicitIndices = resolvePageNumbers(pageCount, options.pageNumbers);
    const pageIndices = explicitIndices.length > 0
        ? explicitIndices
        : resolvePageRange(pageCount, options.startPage, options.endPage);

    pageIndices.forEach(index => {
        const page = pdfDoc.getPage(index);
        page.setRotation(degrees(options.rotation));
    });

    return toPdfOperationResult(pdfDoc, options.outputPath);
}

async function deletePdfPages(options: PdfDeletePagesOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();

    const validPages = [...new Set(options.pageNumbers)]
        .filter(page => Number.isInteger(page) && page >= 1 && page <= pageCount)
        .sort((a, b) => b - a);

    if (validPages.length === 0) {
        throw new Error('No valid pages selected for deletion.');
    }

    if (validPages.length >= pageCount) {
        throw new Error('Cannot delete all pages. A PDF must contain at least one page.');
    }

    validPages.forEach(page => {
        pdfDoc.removePage(page - 1);
    });

    return toPdfOperationResult(pdfDoc, options.outputPath);
}

async function updatePdfMetadata(options: PdfUpdateMetadataOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    if (options.title !== undefined) {
        pdfDoc.setTitle(options.title);
    }

    if (options.author !== undefined) {
        pdfDoc.setAuthor(options.author);
    }

    if (options.subject !== undefined) {
        pdfDoc.setSubject(options.subject);
    }

    if (options.keywords !== undefined) {
        const keywords = options.keywords
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0);
        pdfDoc.setKeywords(keywords);
    }

    pdfDoc.setProducer('Utilix');
    pdfDoc.setCreator('Utilix');

    return toPdfOperationResult(pdfDoc, options.outputPath);
}

async function generatePdfPreview(
    filePath: string,
    _pageNumber: number
): Promise<{ pageCount: number; size: number }> {
    ensureFilePath(filePath);

    const fileBuffer = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
    const stats = await fs.stat(filePath);

    return {
        pageCount: pdfDoc.getPageCount(),
        size: stats.size,
    };
}

export function registerPdfHandlers(): void {
    ipcMain.handle('pdf:compress', async (_event, options: PdfCompressOptions) => {
        return compressPdf(options);
    });

    ipcMain.handle('pdf:merge', async (_event, options: PdfMergeOptions) => {
        return mergePdfs(options);
    });

    ipcMain.handle('pdf:extract-range', async (_event, options: PdfExtractRangeOptions) => {
        return extractPdfRange(options);
    });

    ipcMain.handle('pdf:rotate-pages', async (_event, options: PdfRotatePagesOptions) => {
        return rotatePdfPages(options);
    });

    ipcMain.handle('pdf:delete-pages', async (_event, options: PdfDeletePagesOptions) => {
        return deletePdfPages(options);
    });

    ipcMain.handle('pdf:update-metadata', async (_event, options: PdfUpdateMetadataOptions) => {
        return updatePdfMetadata(options);
    });

    ipcMain.handle('pdf:get-metadata', async (_event, filePath: string) => {
        return getMetadata(filePath);
    });

    ipcMain.handle('pdf:generate-preview', async (_event, filePath: string, pageNumber: number) => {
        return generatePdfPreview(filePath, pageNumber);
    });
}
