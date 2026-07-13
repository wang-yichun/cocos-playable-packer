import assert from "node:assert/strict";

import { calculatePayloadEncodingMeasurements } from "./payload-encoding-benchmark.js";

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

console.log("payload encoding benchmark self-test passed");
