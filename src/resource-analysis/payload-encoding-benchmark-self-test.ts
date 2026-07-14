import assert from "node:assert/strict";

import {
  calculatePayloadEncodingMeasurements,
  type PayloadEncodingBenchmark,
} from "./payload-encoding-benchmark.js";
import { renderPayloadEncodingSummary } from "./resource-analysis-final-report.js";

const compressed = Uint8Array.from({ length: 4096 }, (_, index) => (index * 31 + 17) & 0xff);
const measurements = calculatePayloadEncodingMeasurements(
  compressed,
  { base64: 8000, base91: 7500, html7: 7000 },
  20_000,
);

assert.equal(measurements.length, 3);
assert.deepEqual(measurements.map((item) => item.encoding), ["base64", "base91", "html7"]);
assert.equal(measurements[0]?.savingsVsBase64Bytes, 0);
assert.equal(measurements[1]?.savingsVsBase64Bytes, 500);
assert.equal(measurements[2]?.savingsVsBase64Bytes, 1000);
assert.equal(measurements[0]?.htmlPercentOfBuildBytes, 40);
assert((measurements[1]?.payloadBytes ?? 0) < (measurements[0]?.payloadBytes ?? 0));
assert((measurements[2]?.payloadBytes ?? 0) < (measurements[0]?.payloadBytes ?? 0));

const benchmark: PayloadEncodingBenchmark = {
  status: "measured",
  archiveRawBytes: 20_000,
  brotliBytes: compressed.byteLength,
  brotliCompressionPercent: 20.48,
  encodings: measurements,
  warnings: ["fixture"],
};
const html = renderPayloadEncodingSummary(benchmark);
assert.match(html, /归档原始字节/);
assert.match(html, /Brotli Q11 二进制/);
assert.match(html, /Brotli 压缩率/);
assert.match(html, /最终单 HTML（Base64）/);
assert.match(html, /最终单 HTML（Base91）/);
assert.match(html, /最终单 HTML（HTML7）/);
assert.match(html, /7\.8 KiB（40\.00%）/);

console.log("payload encoding benchmark self-test passed");
