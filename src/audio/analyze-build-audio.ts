import { readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFile } from 'music-metadata';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

export interface AudioFileReport {
    path: string;
    extension: string;
    bytes: number;
    percentageOfPackage: number;
    durationSeconds: number | null;
    bitrateKbps: number | null;
    sampleRateHz: number | null;
    channels: number | null;
    codec: string | null;
    optimizationHints: string[];
    parseError: string | null;
}

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

async function walk(directory: string, output: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolutePath, output);
        else if (entry.isFile()) output.push(absolutePath);
    }
}

function buildHints(extension: string, bytes: number, duration: number | null, bitrate: number | null, channels: number | null): string[] {
    const hints: string[] = [];
    if (extension === '.wav') hints.push('WAV 通常可转为 OGG、MP3 或 AAC；先试玩确认浏览器兼容性和音质。');
    if (bitrate !== null && bitrate >= 160) hints.push('码率较高，可试听 96–128 kbps 的有损编码版本。');
    if (channels !== null && channels >= 2 && duration !== null && duration <= 15) hints.push('短音效为立体声；若没有方向或空间信息，可测试转为单声道。');
    if (bytes >= 512 * 1024) hints.push('单文件较大，建议优先做转码对比。');
    if (hints.length === 0) hints.push('未发现明显的规则型优化信号；仍可结合听感和用途复核。');
    return hints;
}

export async function analyzeAudioDirectory(inputDirectory: string, outputFile: string): Promise<void> {
    const root = path.resolve(inputDirectory);
    const absoluteOutput = path.resolve(outputFile);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error(`输入路径不是目录：${root}`);

    const allFiles: string[] = [];
    await walk(root, allFiles);
    const inputFiles = allFiles.filter(file => path.resolve(file) !== absoluteOutput);
    const sizes = await Promise.all(inputFiles.map(async file => (await stat(file)).size));
    const packageBytes = sizes.reduce((sum, size) => sum + size, 0);
    const audioFiles = inputFiles.filter(file => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()));

    const files: AudioFileReport[] = [];
    for (const absolutePath of audioFiles) {
        const extension = path.extname(absolutePath).toLowerCase();
        const bytes = (await stat(absolutePath)).size;
        try {
            const metadata = await parseFile(absolutePath, { duration: true, skipCovers: true });
            const duration = metadata.format.duration ?? null;
            const bitrate = metadata.format.bitrate ?? null;
            const channels = metadata.format.numberOfChannels ?? null;
            files.push({
                path: path.relative(root, absolutePath).replace(/\\/g, '/'), extension: extension.slice(1), bytes,
                percentageOfPackage: packageBytes ? round(bytes / packageBytes * 100, 4) : 0,
                durationSeconds: duration === null ? null : round(duration, 3),
                bitrateKbps: bitrate === null ? null : round(bitrate / 1000, 2),
                sampleRateHz: metadata.format.sampleRate ?? null, channels,
                codec: metadata.format.codec ?? metadata.format.container ?? null,
                optimizationHints: buildHints(extension, bytes, duration, bitrate === null ? null : bitrate / 1000, channels), parseError: null,
            });
        } catch (error) {
            files.push({
                path: path.relative(root, absolutePath).replace(/\\/g, '/'), extension: extension.slice(1), bytes,
                percentageOfPackage: packageBytes ? round(bytes / packageBytes * 100, 4) : 0,
                durationSeconds: null, bitrateKbps: null, sampleRateHz: null, channels: null, codec: null,
                optimizationHints: ['元数据解析失败；请确认文件是否完整或扩展名是否正确。'],
                parseError: error instanceof Error ? error.message : String(error),
            });
        }
    }
    files.sort((a, b) => b.bytes - a.bytes);
    const audioBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const formats = [...new Set(files.map(file => file.extension))].sort().map(extension => {
        const matching = files.filter(file => file.extension === extension);
        const bytes = matching.reduce((sum, file) => sum + file.bytes, 0);
        return { extension, fileCount: matching.length, bytes, percentageOfPackage: packageBytes ? round(bytes / packageBytes * 100, 4) : 0 };
    });
    const report = {
        version: 1, generatedAt: new Date().toISOString(), root, packageBytes,
        audio: { fileCount: files.length, bytes: audioBytes, percentageOfPackage: packageBytes ? round(audioBytes / packageBytes * 100, 4) : 0 },
        formats, files,
        notes: ['本命令只读取文件并生成报告，不修改或转码音频。', '优化建议是候选方向；最终编码参数应通过浏览器试玩和听感验证。'],
    };
    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, JSON.stringify(report, null, 2), 'utf8');
    console.log(`音频分析完成：${files.length} 个文件，${audioBytes} 字节，占总包 ${report.audio.percentageOfPackage}%`);
    console.log(`报告：${absoluteOutput}`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter(value => value !== '--');
    if (args.length < 1 || args.length > 2) throw new Error('用法：npm run audio:analyze -- "<构建目录>" ["<报告路径>"]');
    await analyzeAudioDirectory(args[0]!, args[1] ?? './audio-analysis-report.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main().catch(error => { console.error('音频分析失败：', error); process.exitCode = 1; });
