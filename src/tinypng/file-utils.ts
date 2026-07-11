import path from "node:path";

export function toPortablePath(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

export {
    isNodeError,
    isRecord,
    readJsonUnknown,
    resolvePortableRelativePath,
    toErrorMessage,
    writeBufferAtomically,
    writeJsonAtomically,
} from "../tinypng-build/file-utils.js";
