export type PlayablePayloadEncoding = "base64" | "base91" | "html7";
export type PlayableBrotliFallbackMode = "raw-js" | "gzip-packed-js";
export type PlayableBuildLogStream = "stdout" | "stderr";
export type PlayableBuildStage =
  | "validating"
  | "running"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TinyPngScope =
  | { type: "all" }
  | { type: "limit"; limit: number };

export type PlayableImageOptions =
  | { mode: "none" }
  | {
      mode: "tinypng";
      scope: TinyPngScope;
      minBytes?: number;
    }
  | {
      mode: "squoosh";
      pngQuality?: number;
      jpegQuality?: number;
      colours?: number;
      effort?: number;
      dither?: number;
      oxipngLevel?: number;
    }
  | {
      mode: "webp";
      pngQuality?: number;
      jpegQuality?: number;
    };

export interface PlayableAudioOptions {
  bitrateKbps: number;
  ffmpegPath?: string;
}

export interface BuildPlayableRequest {
  inputDirectory: string;
  outputFile: string;
  image: PlayableImageOptions;
  audio?: PlayableAudioOptions | null;
  payloadEncoding?: PlayablePayloadEncoding;
  brotliFallback?: PlayableBrotliFallbackMode;
  projectName?: string | null;
  keepWorkspace?: boolean;
}

export interface NormalizedBuildPlayableRequest {
  inputDirectory: string;
  outputFile: string;
  image: PlayableImageOptions;
  audio: PlayableAudioOptions | null;
  payloadEncoding: PlayablePayloadEncoding;
  brotliFallback: PlayableBrotliFallbackMode;
  projectName: string | null;
  keepWorkspace: boolean;
}

export type PlayableBuildServiceEvent =
  | {
      type: "state";
      stage: PlayableBuildStage;
      timestamp: string;
      elapsedMs: number;
      message: string;
    }
  | {
      type: "log";
      stream: PlayableBuildLogStream;
      timestamp: string;
      elapsedMs: number;
      line: string;
    };

export interface BuildPlayableServiceOptions {
  projectRoot?: string;
  scriptPath?: string;
  nodeExecutable?: string;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onEvent?: (event: PlayableBuildServiceEvent) => void;
  maxCapturedLogLines?: number;
}

export interface BuildPlayableResult {
  status: "succeeded";
  outputFile: string;
  reportFile: string;
  outputBytes: number;
  outputSha256: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  report: Record<string, unknown>;
}

export type PlayableBuildServiceErrorCode =
  | "INVALID_REQUEST"
  | "INPUT_NOT_FOUND"
  | "PIPELINE_SCRIPT_NOT_FOUND"
  | "PIPELINE_START_FAILED"
  | "PIPELINE_FAILED"
  | "ABORTED"
  | "OUTPUT_MISSING"
  | "REPORT_INVALID";

export class PlayableBuildServiceError extends Error {
  readonly code: PlayableBuildServiceErrorCode;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly capturedLogs: readonly string[];

  constructor(
    code: PlayableBuildServiceErrorCode,
    message: string,
    options: {
      cause?: unknown;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      capturedLogs?: readonly string[];
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PlayableBuildServiceError";
    this.code = code;
    this.exitCode = options.exitCode ?? null;
    this.signal = options.signal ?? null;
    this.capturedLogs = [...(options.capturedLogs ?? [])];
  }
}
