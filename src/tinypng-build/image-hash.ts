import { createHash } from "node:crypto";

export function calculateImageSha256(
    buffer: Buffer,
): string {
    return createHash("sha256")
        .update(buffer)
        .digest("hex");
}
