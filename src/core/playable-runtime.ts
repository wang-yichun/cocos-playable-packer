import path from "node:path";

import type {
  BuildPlayableServiceOptions,
  PlayableBuildServiceEvent,
} from "../service/build-playable-types.js";

export type PlayableRuntimeHost = "cli" | "web" | "creator" | "unknown";

export interface PlayableRuntimeContext {
  /** Root directory containing the packaged Playable pipeline implementation. */
  packageRoot: string;
  /** Host embedding the Core API. */
  host?: PlayableRuntimeHost;
  /** Optional host-owned temporary directory, resolved relative to packageRoot. */
  tempRoot?: string;
  /** Node.js executable used to launch the pipeline worker. */
  nodeExecutable?: string;
  /** Environment additions inherited by the pipeline worker. */
  environment?: NodeJS.ProcessEnv;
  /** Host cancellation signal. */
  signal?: AbortSignal;
  /** Host-level event listener. Per-build listeners are composed with this listener. */
  onEvent?: (event: PlayableBuildServiceEvent) => void;
}

export interface ResolvedPlayableRuntimeContext {
  packageRoot: string;
  host: PlayableRuntimeHost;
  tempRoot: string | null;
  nodeExecutable: string;
  environment: NodeJS.ProcessEnv;
  signal: AbortSignal | undefined;
  onEvent: ((event: PlayableBuildServiceEvent) => void) | undefined;
}

export type PlayableRuntimeBuildOptions = BuildPlayableServiceOptions & {
  runtime?: PlayableRuntimeContext;
};

function requireNonEmptyString(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} 不能为空。`);
  }
  return normalized;
}

function parseRuntimeHost(value: PlayableRuntimeHost | undefined): PlayableRuntimeHost {
  if (value === undefined) return "cli";
  if (value === "cli" || value === "web" || value === "creator" || value === "unknown") {
    return value;
  }
  throw new TypeError(`无效 Core Runtime host：${String(value)}`);
}

function composeEventListeners(
  runtimeListener: PlayableRuntimeContext["onEvent"],
  buildListener: BuildPlayableServiceOptions["onEvent"],
): ResolvedPlayableRuntimeContext["onEvent"] {
  if (runtimeListener === undefined) return buildListener;
  if (buildListener === undefined || buildListener === runtimeListener) return runtimeListener;
  return (event) => {
    runtimeListener(event);
    buildListener(event);
  };
}

export function resolvePlayableRuntimeContext(
  runtime: PlayableRuntimeContext | undefined,
  serviceOptions: BuildPlayableServiceOptions = {},
): ResolvedPlayableRuntimeContext {
  const packageRootSource = runtime?.packageRoot ?? serviceOptions.projectRoot ?? process.cwd();
  const packageRoot = path.resolve(requireNonEmptyString(packageRootSource, "packageRoot"));
  const host = parseRuntimeHost(runtime?.host);
  const tempRoot = runtime?.tempRoot === undefined
    ? null
    : path.resolve(packageRoot, requireNonEmptyString(runtime.tempRoot, "tempRoot"));
  const nodeExecutable = requireNonEmptyString(
    runtime?.nodeExecutable ?? serviceOptions.nodeExecutable ?? process.execPath,
    "nodeExecutable",
  );
  const environment: NodeJS.ProcessEnv = {
    ...runtime?.environment,
    ...serviceOptions.environment,
    PLAYABLE_PACKER_RUNTIME_HOST: host,
    PLAYABLE_PACKER_PACKAGE_ROOT: packageRoot,
  };
  if (tempRoot !== null) {
    environment.PLAYABLE_PACKER_TEMP_ROOT = tempRoot;
  } else {
    delete environment.PLAYABLE_PACKER_TEMP_ROOT;
  }

  return {
    packageRoot,
    host,
    tempRoot,
    nodeExecutable,
    environment,
    signal: serviceOptions.signal ?? runtime?.signal,
    onEvent: composeEventListeners(runtime?.onEvent, serviceOptions.onEvent),
  };
}

export function createPlayableBuildServiceOptions(
  options: PlayableRuntimeBuildOptions = {},
): BuildPlayableServiceOptions {
  const { runtime, ...serviceOptions } = options;
  const resolved = resolvePlayableRuntimeContext(runtime, serviceOptions);
  return {
    ...serviceOptions,
    projectRoot: resolved.packageRoot,
    nodeExecutable: resolved.nodeExecutable,
    environment: resolved.environment,
    signal: resolved.signal,
    onEvent: resolved.onEvent,
  };
}
