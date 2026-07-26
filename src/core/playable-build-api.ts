import {
  createBuildPlayableArguments,
  normalizeBuildPlayableRequest,
  reportPathForOutput,
} from "../service/build-playable-request.js";
import { buildPlayable } from "../service/build-playable-service.js";
import {
  PlayableBuildServiceError,
  type BuildPlayableRequest as InternalBuildPlayableRequest,
  type BuildPlayableResult as InternalBuildPlayableResult,
  type NormalizedBuildPlayableRequest as InternalNormalizedBuildPlayableRequest,
  type PlayableAudioOptions,
  type PlayableBrotliFallbackMode,
  type PlayableBuildLogStream,
  type PlayableBuildServiceErrorCode,
  type PlayableBuildServiceEvent,
  type PlayableBuildStage,
  type PlayableImageOptions,
  type PlayablePayloadEncoding,
  type TinyPngScope,
} from "../service/build-playable-types.js";
import {
  createPlayableBuildServiceOptions,
  resolvePlayableRuntimeContext,
  type PlayableRuntimeBuildOptions,
  type PlayableRuntimeContext,
  type PlayableRuntimeHost,
  type ResolvedPlayableRuntimeContext,
} from "./playable-runtime.js";

export const PLAYABLE_CORE_API_VERSION = 1 as const;

export type PlayableBuildRequest = InternalBuildPlayableRequest;
export type NormalizedPlayableBuildRequest = InternalNormalizedBuildPlayableRequest;
export type PlayableBuildOptions = PlayableRuntimeBuildOptions;
export type PlayableBuildResult = InternalBuildPlayableResult;
export type PlayableBuildEvent = PlayableBuildServiceEvent;
export type PlayableCoreErrorCode = PlayableBuildServiceErrorCode;

export type {
  PlayableAudioOptions,
  PlayableBrotliFallbackMode,
  PlayableBuildLogStream,
  PlayableBuildStage,
  PlayableImageOptions,
  PlayablePayloadEncoding,
  PlayableRuntimeContext,
  PlayableRuntimeHost,
  ResolvedPlayableRuntimeContext,
  TinyPngScope,
};

export { PlayableBuildServiceError as PlayableCoreError };

export const normalizePlayableBuildRequest = normalizeBuildPlayableRequest;
export const createPlayableBuildArguments = createBuildPlayableArguments;
export const getPlayableBuildReportPath = reportPathForOutput;
export { createPlayableBuildServiceOptions, resolvePlayableRuntimeContext };

export async function runPlayableBuild(
  request: PlayableBuildRequest,
  options: PlayableBuildOptions = {},
): Promise<PlayableBuildResult> {
  return buildPlayable(request, createPlayableBuildServiceOptions(options));
}

export interface PlayableCoreApi {
  readonly version: typeof PLAYABLE_CORE_API_VERSION;
  readonly build: typeof runPlayableBuild;
  readonly normalizeRequest: typeof normalizePlayableBuildRequest;
  readonly createArguments: typeof createPlayableBuildArguments;
  readonly reportPathForOutput: typeof getPlayableBuildReportPath;
  readonly resolveRuntime: typeof resolvePlayableRuntimeContext;
  readonly createServiceOptions: typeof createPlayableBuildServiceOptions;
}

export const playableCoreApi: PlayableCoreApi = Object.freeze({
  version: PLAYABLE_CORE_API_VERSION,
  build: runPlayableBuild,
  normalizeRequest: normalizePlayableBuildRequest,
  createArguments: createPlayableBuildArguments,
  reportPathForOutput: getPlayableBuildReportPath,
  resolveRuntime: resolvePlayableRuntimeContext,
  createServiceOptions: createPlayableBuildServiceOptions,
});
