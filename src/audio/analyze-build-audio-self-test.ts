import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { analyzeAudioDirectory, inspectMp3Layout } from './analyze-build-audio.js';

function makeWav(): Buffer {
    const dataBytes = 8000;
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
    return buffer;
}

function makeTaggedMp3(): Buffer {
    const buffer = Buffer.alloc(10 + 20 + 100 + 128, 0x55);
    buffer.write('ID3', 0);
    buffer.fill(0, 3, 10);
    buffer[3] = 4;
    buffer[9] = 20;
    buffer.write('TAG', buffer.length - 128);
    return buffer;
}

const layout = inspectMp3Layout(makeTaggedMp3());
assert.equal(layout.id3v2Bytes, 30);
assert.equal(layout.id3v1Bytes, 128);
assert.equal(layout.totalId3Bytes, 158);
assert.equal(layout.audioPayloadBytes, 100);
assert.ok(layout.estimatedSingleFileBrotliSavingsBytes > 0);

const root = await mkdtemp(path.join(tmpdir(), 'audio-analysis-'));
await mkdir(path.join(root, 'assets'));
await writeFile(path.join(root, 'assets', 'effect.wav'), makeWav());
await writeFile(path.join(root, 'main.js'), 'x'.repeat(1000));
const output = path.join(root, 'report.json');
await analyzeAudioDirectory(root, output);
const report = JSON.parse(await readFile(output, 'utf8')) as any;
assert.equal(report.audio.fileCount, 1);
assert.equal(report.formats[0].extension, 'wav');
assert.equal(report.files[0].durationSeconds, 1);
assert.equal(report.files[0].sampleRateHz, 8000);
assert.equal(report.files[0].channels, 1);
assert.match(report.files[0].optimizationHints[0], /WAV/);
console.log('音频分析自测通过');
