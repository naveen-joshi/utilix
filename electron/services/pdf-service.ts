import { ipcMain } from 'electron';
import { PDFDocument, degrees } from 'pdf-lib';
import * as fs from 'fs/promises';
import { callPdfBackend } from './pdf-backend-bridge';

export interface PdfCompressOptions {
    filePath: string;
    outputPath?: string;
    password?: string;
}

export interface PdfMergeOptions {
    filePaths: string[];
    outputPath?: string;
    password?: string;
    passwordsByFilePath?: Record<string, string>;
}

export interface PdfExtractRangeOptions {
    filePath: string;
    startPage: number;
    endPage: number;
    pageNumbers?: number[];
    outputPath?: string;
    password?: string;
}

export interface PdfRotatePagesOptions {
    filePath: string;
    rotation: 90 | 180 | 270;
    startPage?: number;
    endPage?: number;
    pageNumbers?: number[];
    outputPath?: string;
    password?: string;
}

export interface PdfDeletePagesOptions {
    filePath: string;
    pageNumbers: number[];
    outputPath?: string;
    password?: string;
}

export interface PdfUpdateMetadataOptions {
    filePath: string;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    outputPath?: string;
    password?: string;
}

export interface PdfEncryptOptions {
    filePath: string;
    userPassword: string;
    ownerPassword?: string;
    existingPassword?: string;
    outputPath?: string;
}

export interface PdfDecryptOptions {
    filePath: string;
    password: string;
    outputPath?: string;
}

export interface PdfWatermarkTextOptions {
    filePath: string;
    text: string;
    opacity?: number;
    rotation?: number;
    fontSize?: number;
    startPage?: number;
    endPage?: number;
    pageNumbers?: number[];
    password?: string;
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

interface BackendPdfOperationResult {
    success: boolean;
    output_path?: string;
    output_base64: string;
    page_count: number;
    new_size: number;
}

function ensureFilePath(filePath: string): void {
    if (!filePath) {
        throw new Error('No file path provided. Please select files from the desktop app.');
    }
}

function normalizePassword(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function normalizePasswordMap(values: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!values) {
        return undefined;
    }

    const normalized = Object.entries(values)
        .map(([filePath, password]) => [filePath, normalizePassword(password)] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[1]));

    if (normalized.length === 0) {
        return undefined;
    }

    return Object.fromEntries(normalized);
}

function shouldUseBackendForPassword(password: string | undefined): boolean {
    return Boolean(normalizePassword(password));
}

function toPdfOperationResultFromBackend(result: BackendPdfOperationResult): PdfOperationResult {
    return {
        success: result.success,
        outputPath: result.output_path,
        buffer: result.output_base64,
        pageCount: result.page_count,
        newSize: result.new_size,
    };
}

function toBackendErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Unknown backend error.';
}

async function callPdfBackendSafe<TPayload extends object, TResult>(
    endpoint: string,
    payload: TPayload
): Promise<TResult> {
    try {
        return await callPdfBackend<TPayload, TResult>(endpoint, payload);
    } catch (error) {
        throw new Error(`Advanced PDF backend error: ${toBackendErrorMessage(error)}`);
    }
}

function toPasswordErrorMessage(error: unknown): string | null {
    if (!(error instanceof Error)) {
        return null;
    }

    const message = error.message.toLowerCase();
    if (message.includes('encrypted') || message.includes('password') || message.includes('decrypt')) {
        return 'This PDF is password protected. Provide a valid password and try again.';
    }

    return null;
}

async function loadPdf(fileBuffer: Uint8Array, password?: string): Promise<PDFDocument> {
    const providedPassword = normalizePassword(password);

    try {
        return await PDFDocument.load(fileBuffer, {
            ignoreEncryption: false,
        });
    } catch (error) {
        const passwordMessage = toPasswordErrorMessage(error);
        if (passwordMessage) {
            if (providedPassword) {
                throw new Error('This PDF is encrypted, but password-based decryption is not yet supported in the local engine.');
            }

            throw new Error(passwordMessage);
        }

        throw error;
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

async function getMetadata(filePath: string, password?: string): Promise<PdfMetadata> {
    ensureFilePath(filePath);

    const normalized = normalizePassword(password);
    if (normalized) {
        const metadata = await callPdfBackendSafe<{
            file_path: string;
            password: string;
        }, {
            page_count: number;
            title?: string;
            author?: string;
            size: number;
        }>('/pdf/metadata', {
            file_path: filePath,
            password: normalized,
        });

        return {
            pageCount: metadata.page_count,
            title: metadata.title,
            author: metadata.author,
            size: metadata.size,
        };
    }

    const fileBuffer = await fs.readFile(filePath);
    const pdfDoc = await loadPdf(fileBuffer, password);
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

    const pdfDoc = await loadPdf(originalBuffer, options.password);

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

    const normalizedPassword = normalizePassword(options.password);
    const normalizedPasswordMap = normalizePasswordMap(options.passwordsByFilePath);
    if (normalizedPassword || normalizedPasswordMap) {
        const backendResult = await callPdfBackendSafe<{
            file_paths: string[];
            output_path?: string;
            password?: string;
            passwords_by_file_path?: Record<string, string>;
        }, BackendPdfOperationResult>('/pdf/merge', {
            file_paths: options.filePaths,
            output_path: options.outputPath,
            password: normalizedPassword,
            passwords_by_file_path: normalizedPasswordMap,
        });

        return toPdfOperationResultFromBackend(backendResult);
    }

    const mergedPdf = await PDFDocument.create();

    for (const filePath of options.filePaths) {
        ensureFilePath(filePath);
        const pdfBytes = await fs.readFile(filePath);
        const filePassword = options.passwordsByFilePath?.[filePath] ?? options.password;
        const sourcePdf = await loadPdf(pdfBytes, filePassword);
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
    }

    return toPdfOperationResult(mergedPdf, options.outputPath);
}

async function extractPdfRange(options: PdfExtractRangeOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    if (shouldUseBackendForPassword(options.password)) {
        const backendResult = await callPdfBackendSafe<{
            file_path: string;
            start_page?: number;
            end_page?: number;
            page_numbers?: number[];
            output_path?: string;
            password?: string;
        }, BackendPdfOperationResult>('/pdf/extract-range', {
            file_path: options.filePath,
            start_page: options.startPage,
            end_page: options.endPage,
            page_numbers: options.pageNumbers,
            output_path: options.outputPath,
            password: normalizePassword(options.password),
        });

        return toPdfOperationResultFromBackend(backendResult);
    }

    const pdfBytes = await fs.readFile(options.filePath);
    const sourcePdf = await loadPdf(pdfBytes, options.password);
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

    if (shouldUseBackendForPassword(options.password)) {
        const backendResult = await callPdfBackendSafe<{
            file_path: string;
            rotation: 90 | 180 | 270;
            start_page?: number;
            end_page?: number;
            page_numbers?: number[];
            output_path?: string;
            password?: string;
        }, BackendPdfOperationResult>('/pdf/rotate-pages', {
            file_path: options.filePath,
            rotation: options.rotation,
            start_page: options.startPage,
            end_page: options.endPage,
            page_numbers: options.pageNumbers,
            output_path: options.outputPath,
            password: normalizePassword(options.password),
        });

        return toPdfOperationResultFromBackend(backendResult);
    }

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await loadPdf(pdfBytes, options.password);
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

    if (shouldUseBackendForPassword(options.password)) {
        const backendResult = await callPdfBackendSafe<{
            file_path: string;
            page_numbers: number[];
            output_path?: string;
            password?: string;
        }, BackendPdfOperationResult>('/pdf/delete-pages', {
            file_path: options.filePath,
            page_numbers: options.pageNumbers,
            output_path: options.outputPath,
            password: normalizePassword(options.password),
        });

        return toPdfOperationResultFromBackend(backendResult);
    }

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await loadPdf(pdfBytes, options.password);
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

    if (shouldUseBackendForPassword(options.password)) {
        const backendResult = await callPdfBackendSafe<{
            file_path: string;
            title?: string;
            author?: string;
            subject?: string;
            keywords?: string;
            output_path?: string;
            password?: string;
        }, BackendPdfOperationResult>('/pdf/update-metadata', {
            file_path: options.filePath,
            title: options.title,
            author: options.author,
            subject: options.subject,
            keywords: options.keywords,
            output_path: options.outputPath,
            password: normalizePassword(options.password),
        });

        return toPdfOperationResultFromBackend(backendResult);
    }

    const pdfBytes = await fs.readFile(options.filePath);
    const pdfDoc = await loadPdf(pdfBytes, options.password);

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

async function encryptPdf(options: PdfEncryptOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const userPassword = normalizePassword(options.userPassword);
    if (!userPassword) {
        throw new Error('User password is required to encrypt a PDF.');
    }

    const backendResult = await callPdfBackendSafe<{
        file_path: string;
        user_password: string;
        owner_password?: string;
        existing_password?: string;
        output_path?: string;
    }, BackendPdfOperationResult>('/pdf/encrypt', {
        file_path: options.filePath,
        user_password: userPassword,
        owner_password: normalizePassword(options.ownerPassword),
        existing_password: normalizePassword(options.existingPassword),
        output_path: options.outputPath,
    });

    return toPdfOperationResultFromBackend(backendResult);
}

async function decryptPdf(options: PdfDecryptOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const password = normalizePassword(options.password);
    if (!password) {
        throw new Error('Password is required to decrypt a PDF.');
    }

    const backendResult = await callPdfBackendSafe<{
        file_path: string;
        password: string;
        output_path?: string;
    }, BackendPdfOperationResult>('/pdf/decrypt', {
        file_path: options.filePath,
        password,
        output_path: options.outputPath,
    });

    return toPdfOperationResultFromBackend(backendResult);
}

async function watermarkPdfText(options: PdfWatermarkTextOptions): Promise<PdfOperationResult> {
    ensureFilePath(options.filePath);

    const watermarkText = options.text?.trim();
    if (!watermarkText) {
        throw new Error('Watermark text is required.');
    }

    const backendResult = await callPdfBackendSafe<{
        file_path: string;
        text: string;
        opacity?: number;
        rotation?: number;
        font_size?: number;
        start_page?: number;
        end_page?: number;
        page_numbers?: number[];
        password?: string;
        output_path?: string;
    }, BackendPdfOperationResult>('/pdf/watermark-text', {
        file_path: options.filePath,
        text: watermarkText,
        opacity: options.opacity,
        rotation: options.rotation,
        font_size: options.fontSize,
        start_page: options.startPage,
        end_page: options.endPage,
        page_numbers: options.pageNumbers,
        password: normalizePassword(options.password),
        output_path: options.outputPath,
    });

    return toPdfOperationResultFromBackend(backendResult);
}

async function generatePdfPreview(
    filePath: string,
    _pageNumber: number,
    password?: string
): Promise<{ pageCount: number; size: number }> {
    ensureFilePath(filePath);

    const normalized = normalizePassword(password);
    if (normalized) {
        const preview = await callPdfBackendSafe<{
            file_path: string;
            page_number: number;
            password: string;
        }, {
            page_count: number;
            size: number;
        }>('/pdf/preview', {
            file_path: filePath,
            page_number: _pageNumber,
            password: normalized,
        });

        return {
            pageCount: preview.page_count,
            size: preview.size,
        };
    }

    const fileBuffer = await fs.readFile(filePath);
    const pdfDoc = await loadPdf(fileBuffer, password);
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

    ipcMain.handle('pdf:encrypt', async (_event, options: PdfEncryptOptions) => {
        return encryptPdf(options);
    });

    ipcMain.handle('pdf:decrypt', async (_event, options: PdfDecryptOptions) => {
        return decryptPdf(options);
    });

    ipcMain.handle('pdf:watermark-text', async (_event, options: PdfWatermarkTextOptions) => {
        return watermarkPdfText(options);
    });

    ipcMain.handle('pdf:get-metadata', async (_event, filePath: string, password?: string) => {
        return getMetadata(filePath, password);
    });

    ipcMain.handle('pdf:generate-preview', async (_event, filePath: string, pageNumber: number, password?: string) => {
        return generatePdfPreview(filePath, pageNumber, password);
    });
}
