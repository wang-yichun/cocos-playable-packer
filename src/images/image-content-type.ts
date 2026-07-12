const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageMimeType(buffer: Uint8Array): string | null {
  if (buffer.byteLength >= PNG_SIGNATURE.byteLength && Buffer.from(buffer.subarray(0, PNG_SIGNATURE.byteLength)).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.byteLength >= 12
    && Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(buffer.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
