import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { optimizeBuildAudio } from './optimize-build-audio.js';

function ffmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg 退出码 ${code}`)));
    });
}

const root = await mkdtemp(path.join(tmpdir(), 'audio-optimize-'));
const build = path.join(root, 'web-mobile');
const source = path.join(build, 'sound.mp3');
await mkdir(build);
await ffmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=0.8', '-codec:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', source]);
const beforeBytes = (await readFile(source)).byteLength;
const preview = await optimizeBuildAudio({ buildDirectory: build, targetBitrateKbps: 48, ffmpegPath: 'not-used-in-preview', confirm: false, reportFile: path.join(root, 'preview.json') });
const previewSummary = preview.summary as { wouldOptimizeCount: number };
assert.equal(previewSummary.wouldOptimizeCount, 1);
assert.equal((await readFile(source)).byteLength, beforeBytes);
const report = await optimizeBuildAudio({ buildDirectory: build, targetBitrateKbps: 48, ffmpegPath: 'ffmpeg', confirm: true, reportFile: path.join(root, 'report.json') });
const summary = report.summary as { optimizedCount: number; savedBytes: number };
assert.equal(summary.optimizedCount, 1);
assert.ok(summary.savedBytes > 0);
const afterBytes = (await readFile(source)).byteLength;
assert.ok(afterBytes < beforeBytes);
const metadata = await parseFile(source, { duration: true });
assert.equal(metadata.format.numberOfChannels, 2);
assert.ok((metadata.format.bitrate ?? Infinity) <= 49000);
console.log('音频优化自测通过');
