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
  type BuildPlayableServiceOptions as InternalBuildPlayableOptions,
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

export const PLAYABLE_CORE_API_VERSION = 1 as const;

export type PlayableBuildRequest = InternalBuildPlayableRequest;
export type NormalizedPlayableBuildRequest = InternalNormalizedBuildPlayableRequest;
export type PlayableBuildOptions = InternalBuildPlayableOptions;
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
  TinyPngScope,
};

export { PlayableBuildServiceError as PlayableCoreError };

export const normalizePlayableBuildRequest = normalizeBuildPlayableRequest;
export const createPlayableBuildArguments = createBuildPlayableArguments;
export const getPlayableBuildReportPath = reportPathForOutput;
export const runPlayableBuild = buildPlayable;

export interface PlayableCoreApi {
  readonly version: typeof PLAYABLE_CORE_API_VERSION;
  readonly build: typeof runPlayableBuild;
  readonly normalizeRequest: typeof normalizePlayableBuildRequest;
  readonly createArguments: typeof createPlayableBuildArguments;
  readonly reportPathForOutput: typeof getPlayableBuildReportPath;
}

export const playableCoreApi: PlayableCoreApi = Object.freeze({
  version: PLAYABLE_CORE_API_VERSION,
  build: runPlayableBuild,
  normalizeRequest: normalizePlayableBuildRequest,
  createArguments: createPlayableBuildArguments,
  reportPathForOutput: getPlayableBuildReportPath,
});
