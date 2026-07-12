import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFile } from 'music-metadata';

export interface OptimizeAudioOptions {
    buildDirectory: string;
    targetBitrateKbps: number;
    ffmpegPath: string;
    confirm: boolean;
    reportFile: string;
}

interface OptimizedFile {
    path: string;
    action: 'optimized' | 'would-optimize' | 'skipped-bitrate' | 'skipped-metadata';
    sourceBitrateKbps: number | null;
    targetBitrateKbps: number;
    channels: number | null;
    beforeBytes: number;
    afterBytes: number | null;
    savedBytes: number | null;
    beforeSha256: string;
    afterSha256: string | null;
}

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

async function walk(directory: string, output: string[]): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolutePath, output);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) output.push(absolutePath);
    }
}

function run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => reject(new Error(`无法启动 FFmpeg（${command}）：${error.message}`)));
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg 退出码 ${code}：${stderr.trim()}`)));
    });
}

async function replaceAtomically(source: string, replacement: string): Promise<void> {
    const backup = `${source}.audio-backup-${process.pid}`;
    await rm(backup, { force: true });
    await rename(source, backup);
    try {
        await rename(replacement, source);
        await rm(backup, { force: true });
    } catch (error) {
        await rm(source, { force: true }).catch(() => undefined);
        await rename(backup, source).catch(() => undefined);
        throw error;
    }
}

export async function optimizeBuildAudio(options: OptimizeAudioOptions): Promise<Record<string, unknown>> {
    const root = path.resolve(options.buildDirectory);
    const reportFile = path.resolve(options.reportFile);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`构建目录不存在：${root}`);
    if (!Number.isInteger(options.targetBitrateKbps) || options.targetBitrateKbps < 8 || options.targetBitrateKbps > 320) throw new Error('目标码率必须是 8 到 320 之间的整数。');
    if (options.confirm) await run(options.ffmpegPath, ['-version']);

    const audioFiles: string[] = [];
    await walk(root, audioFiles);
    audioFiles.sort((left, right) => left.localeCompare(right));
    const files: OptimizedFile[] = [];
    for (const absolutePath of audioFiles) {
        const before = await readFile(absolutePath);
        const metadata = await parseFile(absolutePath, { duration: true, skipCovers: true });
        const sourceBitrateKbps = metadata.format.bitrate ? metadata.format.bitrate / 1000 : null;
        const channels = metadata.format.numberOfChannels ?? null;
        const common = {
            path: path.relative(root, absolutePath).replace(/\\/g, '/'),
            sourceBitrateKbps: sourceBitrateKbps === null ? null : round(sourceBitrateKbps, 2),
            targetBitrateKbps: options.targetBitrateKbps,
            channels,
            beforeBytes: before.byteLength,
            beforeSha256: hash(before),
        };
        if (sourceBitrateKbps === null || channels === null) {
            files.push({ ...common, action: 'skipped-metadata', afterBytes: null, savedBytes: null, afterSha256: null });
            continue;
        }
        if (sourceBitrateKbps <= options.targetBitrateKbps) {
            files.push({ ...common, action: 'skipped-bitrate', afterBytes: before.byteLength, savedBytes: 0, afterSha256: common.beforeSha256 });
            continue;
        }
        if (!options.confirm) {
            files.push({ ...common, action: 'would-optimize', afterBytes: null, savedBytes: null, afterSha256: null });
            continue;
        }
        const temporary = `${absolutePath}.audio-${process.pid}-${Date.now()}.mp3`;
        try {
            await run(options.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', absolutePath, '-map_metadata', '-1', '-vn', '-codec:a', 'libmp3lame', '-b:a', `${options.targetBitrateKbps}k`, '-ac', String(channels), temporary]);
            const outputMetadata = await parseFile(temporary, { duration: true, skipCovers: true });
            const outputBitrate = outputMetadata.format.bitrate ? outputMetadata.format.bitrate / 1000 : null;
            const outputChannels = outputMetadata.format.numberOfChannels ?? null;
            if (outputBitrate === null || outputBitrate > options.targetBitrateKbps + 1 || outputChannels !== channels) throw new Error(`转码结果校验失败：${absolutePath}`);
            const after = await readFile(temporary);
            if (after.byteLength >= before.byteLength) {
                await rm(temporary, { force: true });
                files.push({ ...common, action: 'skipped-bitrate', afterBytes: before.byteLength, savedBytes: 0, afterSha256: common.beforeSha256 });
                continue;
            }
            await replaceAtomically(absolutePath, temporary);
            files.push({ ...common, action: 'optimized', afterBytes: after.byteLength, savedBytes: before.byteLength - after.byteLength, afterSha256: hash(after) });
        } finally {
            await rm(temporary, { force: true }).catch(() => undefined);
        }
    }
    const optimized = files.filter(file => file.action === 'optimized');
    const report = {
        schemaVersion: 1,
        tool: 'optimize-build-audio',
        generatedAt: new Date().toISOString(),
        mode: options.confirm ? 'apply' : 'preview',
        buildDirectory: root,
        settings: { targetBitrateKbps: options.targetBitrateKbps, preserveChannels: true, ffmpegPath: options.ffmpegPath },
        summary: {
            scannedMp3Count: files.length,
            optimizedCount: optimized.length,
            wouldOptimizeCount: files.filter(file => file.action === 'would-optimize').length,
            skippedBitrateCount: files.filter(file => file.action === 'skipped-bitrate').length,
            skippedMetadataCount: files.filter(file => file.action === 'skipped-metadata').length,
            beforeBytes: files.reduce((sum, file) => sum + file.beforeBytes, 0),
            afterBytes: options.confirm ? files.reduce((sum, file) => sum + (file.afterBytes ?? file.beforeBytes), 0) : null,
            savedBytes: options.confirm ? optimized.reduce((sum, file) => sum + (file.savedBytes ?? 0), 0) : null,
        },
        files,
    };
    await mkdir(path.dirname(reportFile), { recursive: true });
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`音频优化${options.confirm ? '完成' : '预览完成'}：${optimized.length || report.summary.wouldOptimizeCount} 个候选，目标 ${options.targetBitrateKbps} kbps。`);
    console.log(`报告：${reportFile}`);
    return report;
}

function parseCli(argv: string[]): OptimizeAudioOptions {
    const args = argv.filter(value => value !== '--');
    const positional = args.filter(value => !value.startsWith('--'));
    const value = (name: string) => args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
    if (positional.length !== 1) throw new Error('用法：npm run audio:optimize -- "<构建目录>" --bitrate=48 (--preview|--confirm) [--report=<路径>] [--ffmpeg=ffmpeg]');
    const confirm = args.includes('--confirm');
    const preview = args.includes('--preview');
    if (confirm === preview) throw new Error('必须且只能指定 --preview 或 --confirm。');
    const bitrate = Number(value('--bitrate'));
    const defaultReport = path.resolve(`./audio-optimization-${confirm ? 'apply' : 'preview'}.json`);
    return { buildDirectory: positional[0]!, targetBitrateKbps: bitrate, ffmpegPath: value('--ffmpeg') ?? 'ffmpeg', confirm, reportFile: value('--report') ?? defaultReport };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void optimizeBuildAudio(parseCli(process.argv.slice(2))).catch(error => { console.error('音频优化失败：', error); process.exitCode = 1; });
