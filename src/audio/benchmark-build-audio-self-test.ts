import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { benchmarkBuildAudio } from './benchmark-build-audio.js';

function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg 退出码 ${code}`)));
    });
}

const root = await mkdtemp(path.join(tmpdir(), 'audio-benchmark-'));
const input = path.join(root, 'input');
const output = path.join(root, 'output');
await mkdir(input);
await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5', '-codec:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', path.join(input, 'tone.mp3')]);
await benchmarkBuildAudio({ inputDirectory: input, outputDirectory: output, minimumBitrateKbps: 160, targetBitratesKbps: [96, 48], ffmpegPath: 'ffmpeg' });
const report = JSON.parse(await readFile(path.join(output, 'audio-benchmark-report.json'), 'utf8')) as { sourceCount: number; variantCount: number; profileSummary: Array<{ label: string; brotliSavingsBytes: number }>; sources: Array<{ variants: Array<{ bitrateKbps: number; channels: number }> }> };
assert.equal(report.sourceCount, 1);
assert.equal(report.variantCount, 4);
assert.deepEqual(report.sources[0]!.variants.map(item => item.channels), [2, 1, 2, 1]);
assert.ok(report.sources[0]!.variants.some(item => item.bitrateKbps <= 50));
assert.equal(report.profileSummary.length, 4);
assert.ok(report.profileSummary.every(item => item.brotliSavingsBytes > 0));
await statHtml();

async function statHtml(): Promise<void> {
    const html = await readFile(path.join(output, 'audio-benchmark.html'), 'utf8');
    assert.match(html, /audio controls/);
}

console.log('音频转码基准自测通过');
