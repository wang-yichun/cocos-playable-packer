import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFile } from 'music-metadata';

export interface BenchmarkOptions {
    inputDirectory: string;
    outputDirectory: string;
    minimumBitrateKbps: number;
    targetBitratesKbps: number[];
    ffmpegPath: string;
}

interface VariantReport {
    label: string;
    bitrateKbps: number | null;
    channels: number | null;
    bytes: number;
    singleFileBrotliBytes: number;
    rawSavingsBytes: number;
    brotliSavingsBytes: number;
    sha256: string;
    relativePath: string;
    elapsedMs: number;
}

interface SourceReport {
    sourcePath: string;
    sourceBitrateKbps: number;
    sourceChannels: number | null;
    source: VariantReport;
    variants: VariantReport[];
}

const DEFAULT_BITRATES = [128, 96, 64, 48];

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function brotliBytes(buffer: Buffer): number {
    return brotliCompressSync(buffer, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
}

function sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

async function walk(directory: string, output: string[]): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolutePath, output);
        else if (entry.isFile()) output.push(absolutePath);
    }
}

function run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        let errorOutput = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => { errorOutput += chunk; });
        child.on('error', error => reject(new Error(`无法启动 FFmpeg（${command}）：${error.message}`)));
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg 退出码 ${code}：${errorOutput.trim()}`)));
    });
}

async function inspectVariant(absolutePath: string, outputRoot: string, label: string, sourceBytes: number, sourceBrotliBytes: number, elapsedMs: number): Promise<VariantReport> {
    const buffer = await readFile(absolutePath);
    const metadata = await parseFile(absolutePath, { duration: true, skipCovers: true });
    const compressedBytes = brotliBytes(buffer);
    return {
        label,
        bitrateKbps: metadata.format.bitrate ? round(metadata.format.bitrate / 1000, 2) : null,
        channels: metadata.format.numberOfChannels ?? null,
        bytes: buffer.byteLength,
        singleFileBrotliBytes: compressedBytes,
        rawSavingsBytes: sourceBytes - buffer.byteLength,
        brotliSavingsBytes: sourceBrotliBytes - compressedBytes,
        sha256: sha256(buffer),
        relativePath: path.relative(outputRoot, absolutePath).replace(/\\/g, '/'),
        elapsedMs: round(elapsedMs, 2),
    };
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function renderHtml(report: { sources: SourceReport[] }): string {
    const sections = report.sources.map(item => {
        const rows = [item.source, ...item.variants].map(variant => `<tr><td>${escapeHtml(variant.label)}</td><td>${variant.bitrateKbps ?? '-'}</td><td>${variant.channels ?? '-'}</td><td>${variant.bytes.toLocaleString()}</td><td>${variant.singleFileBrotliBytes.toLocaleString()}</td><td>${variant.brotliSavingsBytes.toLocaleString()}</td><td><audio controls preload="none" src="${encodeURI(variant.relativePath)}"></audio></td></tr>`).join('');
        return `<section><h2>${escapeHtml(item.sourcePath)}</h2><table><thead><tr><th>版本</th><th>码率 kbps</th><th>声道</th><th>文件字节</th><th>Brotli 字节</th><th>Brotli 节省</th><th>试听</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join('\n');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>音频转码基准</title><style>body{font-family:system-ui,sans-serif;margin:24px;background:#f6f7f9;color:#202124}section{background:white;padding:16px;margin:0 0 20px;border-radius:10px;box-shadow:0 1px 4px #0002}h2{font-size:15px;word-break:break-all}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}audio{width:280px}</style></head><body><h1>音频转码基准试听</h1><p>所有候选均为独立输出，未修改游戏构建目录。</p>${sections}</body></html>`;
}

export async function benchmarkBuildAudio(options: BenchmarkOptions): Promise<void> {
    const inputRoot = path.resolve(options.inputDirectory);
    const outputRoot = path.resolve(options.outputDirectory);
    if (!(await stat(inputRoot)).isDirectory()) throw new Error(`输入路径不是目录：${inputRoot}`);
    const relativeOutput = path.relative(inputRoot, outputRoot);
    if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) throw new Error('输出目录不能位于输入构建目录内部。');
    if (options.targetBitratesKbps.length === 0 || options.targetBitratesKbps.some(value => !Number.isInteger(value) || value <= 0)) throw new Error('目标码率必须是正整数。');
    await run(options.ffmpegPath, ['-version']);
    await mkdir(outputRoot, { recursive: true });

    const allFiles: string[] = [];
    await walk(inputRoot, allFiles);
    const sources: SourceReport[] = [];
    for (const sourcePath of allFiles.filter(file => path.extname(file).toLowerCase() === '.mp3')) {
        const metadata = await parseFile(sourcePath, { duration: true, skipCovers: true });
        const sourceBitrate = metadata.format.bitrate ? metadata.format.bitrate / 1000 : null;
        if (sourceBitrate === null || sourceBitrate < options.minimumBitrateKbps) continue;
        const sourceChannels = metadata.format.numberOfChannels ?? null;
        const sourceBuffer = await readFile(sourcePath);
        const sourceBrotliBytes = brotliBytes(sourceBuffer);
        const id = path.basename(sourcePath, '.mp3');
        const candidateDirectory = path.join(outputRoot, 'candidates', id);
        await mkdir(candidateDirectory, { recursive: true });
        const copiedSource = path.join(candidateDirectory, 'original.mp3');
        await copyFile(sourcePath, copiedSource);
        const source = await inspectVariant(copiedSource, outputRoot, '原始', sourceBuffer.byteLength, sourceBrotliBytes, 0);
        const variants: VariantReport[] = [];
        for (const targetBitrate of options.targetBitratesKbps) {
            const channelModes = sourceChannels !== null && sourceChannels >= 2 ? [{ suffix: 'stereo', channels: 2 }, { suffix: 'mono', channels: 1 }] : [{ suffix: 'mono', channels: 1 }];
            for (const mode of channelModes) {
                const outputPath = path.join(candidateDirectory, `${targetBitrate}k-${mode.suffix}.mp3`);
                const startedAt = performance.now();
                await run(options.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-map_metadata', '-1', '-vn', '-codec:a', 'libmp3lame', '-b:a', `${targetBitrate}k`, '-ac', String(mode.channels), outputPath]);
                variants.push(await inspectVariant(outputPath, outputRoot, `${targetBitrate} kbps / ${mode.suffix}`, sourceBuffer.byteLength, sourceBrotliBytes, performance.now() - startedAt));
            }
        }
        sources.push({ sourcePath: path.relative(inputRoot, sourcePath).replace(/\\/g, '/'), sourceBitrateKbps: round(sourceBitrate, 2), sourceChannels, source, variants });
    }
    const variantLabels = [...new Set(sources.flatMap(item => item.variants.map(variant => variant.label)))];
    const profileSummary = variantLabels.map(label => {
        const matchingSources = sources.filter(item => item.variants.some(variant => variant.label === label));
        const matchingVariants = matchingSources.map(item => item.variants.find(variant => variant.label === label)!);
        const sourceBytes = matchingSources.reduce((sum, item) => sum + item.source.bytes, 0);
        const sourceBrotliBytes = matchingSources.reduce((sum, item) => sum + item.source.singleFileBrotliBytes, 0);
        const candidateBytes = matchingVariants.reduce((sum, item) => sum + item.bytes, 0);
        const candidateBrotliBytes = matchingVariants.reduce((sum, item) => sum + item.singleFileBrotliBytes, 0);
        return {
            label,
            sourceCount: matchingSources.length,
            sourceBytes,
            candidateBytes,
            rawSavingsBytes: sourceBytes - candidateBytes,
            rawSavingsPercentage: sourceBytes > 0 ? round((sourceBytes - candidateBytes) / sourceBytes * 100) : 0,
            sourceSingleFileBrotliBytes: sourceBrotliBytes,
            candidateSingleFileBrotliBytes: candidateBrotliBytes,
            brotliSavingsBytes: sourceBrotliBytes - candidateBrotliBytes,
            brotliSavingsPercentage: sourceBrotliBytes > 0 ? round((sourceBrotliBytes - candidateBrotliBytes) / sourceBrotliBytes * 100) : 0,
        };
    });
    const report = {
        version: 1,
        generatedAt: new Date().toISOString(),
        inputRoot,
        outputRoot,
        settings: { minimumBitrateKbps: options.minimumBitrateKbps, targetBitratesKbps: options.targetBitratesKbps, ffmpegPath: options.ffmpegPath },
        sourceCount: sources.length,
        variantCount: sources.reduce((sum, item) => sum + item.variants.length, 0),
        profileSummary,
        sources,
        notes: ['候选文件只用于大小比较与试听，不会覆盖输入构建。', 'Brotli 数值为逐文件 Q11，用于候选排序，不等同于完整 Solid Brotli 最终收益。'],
    };
    await writeFile(path.join(outputRoot, 'audio-benchmark-report.json'), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(path.join(outputRoot, 'audio-benchmark.html'), renderHtml(report), 'utf8');
    console.log(`音频基准完成：${sources.length} 个源文件，${report.variantCount} 个候选。`);
    console.log(`报告：${path.join(outputRoot, 'audio-benchmark-report.json')}`);
    console.log(`试听页：${path.join(outputRoot, 'audio-benchmark.html')}`);
}

function parseCli(args: string[]): BenchmarkOptions {
    const filtered = args.filter(value => value !== '--');
    const positional = filtered.filter(value => !value.startsWith('--'));
    const option = (name: string) => filtered.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
    if (positional.length !== 2) throw new Error('用法：npm run audio:benchmark -- "<构建目录>" "<输出目录>" [--min-bitrate=160] [--bitrates=128,96,64,48] [--ffmpeg=ffmpeg]');
    const minimumBitrateKbps = Number(option('--min-bitrate') ?? 160);
    const targetBitratesKbps = (option('--bitrates') ?? DEFAULT_BITRATES.join(',')).split(',').map(Number);
    if (!Number.isFinite(minimumBitrateKbps) || minimumBitrateKbps <= 0) throw new Error('--min-bitrate 必须是正数。');
    return { inputDirectory: positional[0]!, outputDirectory: positional[1]!, minimumBitrateKbps, targetBitratesKbps, ffmpegPath: option('--ffmpeg') ?? 'ffmpeg' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void benchmarkBuildAudio(parseCli(process.argv.slice(2))).catch(error => { console.error('音频基准失败：', error); process.exitCode = 1; });
