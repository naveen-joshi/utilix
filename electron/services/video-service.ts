import { ipcMain, app, WebContents } from 'electron';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createScopedTempDir } from './temp-file-manager';

export const videoFormats = new Set([
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ts', 'mts', 'mxf',
]);

export const videoOutputTargets = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'gif'] as const;

export interface VideoProgressData {
    percent: number | undefined;
    timemark: string;
    currentKbps: number | undefined;
}

export interface VideoConvertOptions {
    filePath: string;
    targetFormat: string;
    quality?: number; // 0–100, higher = better quality
    jobId?: string;
}

export interface VideoConvertResult {
    success: boolean;
    outputPath: string;
    buffer: string; // always empty – file lives at outputPath, not in memory
    originalSize: number;
    newSize: number;
    sourceFormat: string;
    targetFormat: string;
    strategy: 'ffmpeg';
}

const activeVideoCommands = new Map<string, Ffmpeg.FfmpegCommand>();
const cancelledVideoJobs = new Set<string>();

function resolveFfmpegPath(): string {
    const raw = ffmpegStatic as string | null;
    if (!raw) {
        throw new Error('ffmpeg binary not found. The ffmpeg-static package may not be installed correctly.');
    }

    if (app.isPackaged) {
        // In an asar-packaged Electron app the binary lives in app.asar.unpacked
        return raw.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
    }

    return raw;
}

function qualityToCrf(quality: number, codec: 'h264' | 'vp9'): number {
    if (codec === 'h264') {
        // CRF range: 0 (lossless) – 51 (worst). 18–28 is perceptually acceptable.
        return Math.round(((100 - quality) / 100) * 51);
    }
    // VP9: CRF range 0–63
    return Math.round(((100 - quality) / 100) * 63);
}

function runFfmpeg(
    inputPath: string,
    outputPath: string,
    targetFormat: string,
    quality: number,
    onProgress?: (data: VideoProgressData) => void,
    jobId?: string
): Promise<void> {
    const ffmpegPath = resolveFfmpegPath();

    return new Promise<void>((resolve, reject) => {
        let cmd = Ffmpeg(inputPath).setFfmpegPath(ffmpegPath);

        if (jobId) {
            activeVideoCommands.set(jobId, cmd);
            cancelledVideoJobs.delete(jobId);
        }

        if (targetFormat === 'mp3') {
            // Extract audio as MP3
            const bitrate = Math.round(32 + (quality / 100) * 288); // 32–320 kbps
            cmd = cmd.noVideo().audioCodec('libmp3lame').audioBitrate(bitrate);
        } else if (targetFormat === 'gif') {
            // Animated GIF – scale to 480px wide, 10 fps
            cmd = cmd.noAudio().outputOptions([
                '-vf', 'scale=480:-1:flags=lanczos,fps=10',
                '-loop', '0',
            ]);
        } else if (targetFormat === 'webm') {
            const crf = qualityToCrf(quality, 'vp9');
            cmd = cmd
                .videoCodec('libvpx-vp9')
                .audioCodec('libopus')
                .outputOptions([`-crf ${crf}`, '-b:v 0', '-deadline realtime']);
        } else {
            // H.264/AAC for mp4, mkv, mov, avi
            const crf = qualityToCrf(quality, 'h264');
            cmd = cmd
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([`-crf ${crf}`, '-preset medium', '-movflags +faststart']);
        }

        cmd.output(outputPath)
            .on('progress', (progress) => {
                onProgress?.({
                    percent: progress.percent,
                    timemark: progress.timemark,
                    currentKbps: progress.currentKbps,
                });
            })
            .on('end', () => {
                if (jobId) {
                    activeVideoCommands.delete(jobId);
                    cancelledVideoJobs.delete(jobId);
                }
                resolve();
            })
            .on('error', (err: Error) => {
                if (jobId) {
                    activeVideoCommands.delete(jobId);
                }

                if (jobId && cancelledVideoJobs.has(jobId)) {
                    cancelledVideoJobs.delete(jobId);
                    reject(new Error('Conversion cancelled by user.'));
                    return;
                }

                reject(new Error(`FFmpeg error: ${err.message}`));
            })
            .run();
    });
}

export function cancelVideoConversion(jobId: string): boolean {
    const command = activeVideoCommands.get(jobId);
    if (!command) {
        return false;
    }

    cancelledVideoJobs.add(jobId);
    command.kill('SIGKILL');
    activeVideoCommands.delete(jobId);
    return true;
}

export async function convertVideoFile(
    options: VideoConvertOptions,
    onProgress?: (data: VideoProgressData) => void
): Promise<VideoConvertResult> {
    const { filePath, targetFormat, quality = 80 } = options;

    const sourceFormat = path.extname(filePath).replace('.', '').toLowerCase() || 'video';
    const originalStats = await fs.stat(filePath);

    const ext = targetFormat;
    const tempDir = await createScopedTempDir('video');
    const outputPath = path.join(tempDir, `output.${ext}`);

    await runFfmpeg(filePath, outputPath, targetFormat, quality, onProgress, options.jobId);

    const newStats = await fs.stat(outputPath);

    return {
        success: true,
        outputPath,
        buffer: '', // large video files are never transferred as base64 over IPC
        originalSize: originalStats.size,
        newSize: newStats.size,
        sourceFormat,
        targetFormat,
        strategy: 'ffmpeg',
    };
}

export function registerVideoHandlers(): void {
    ipcMain.handle('video:convert', async (event, options: VideoConvertOptions) => {
        const sender: WebContents = event.sender;
        return convertVideoFile(options, (data) => {
            if (!sender.isDestroyed()) {
                sender.send('video:progress', data);
            }
        });
    });
}
