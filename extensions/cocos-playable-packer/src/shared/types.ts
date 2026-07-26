export interface CreatorProjectInfo {
  name: string;
  path: string;
  tmpDir: string;
  uuid: string;
}

export interface CreatorRuntimeInfo {
  hostNodeVersion: string;
  hostExecutable: string;
  platform: NodeJS.Platform;
  architecture: string;
  externalNodeAvailable: boolean;
  externalNodeSupported: boolean;
  externalNodeVersion: string | null;
  externalNodeExecutable: string | null;
  externalNodeError: string | null;
}

export interface CreatorExtensionPaths {
  extensionRoot: string;
  realExtensionRoot: string;
  packerRoot: string | null;
  webMobileDirectory: string;
  defaultOutputDirectory: string;
}

export interface CreatorEnvironmentChecks {
  projectDirectoryExists: boolean;
  assetsDirectoryExists: boolean;
  projectPackageExists: boolean;
  webMobileDirectoryExists: boolean;
  packerRootDetected: boolean;
  coreSourceExists: boolean;
}

export interface CreatorEnvironmentInfo {
  checkedAt: string;
  extensionVersion: string;
  project: CreatorProjectInfo;
  runtime: CreatorRuntimeInfo;
  paths: CreatorExtensionPaths;
  checks: CreatorEnvironmentChecks;
  logs: readonly string[];
}

export type CreatorBuildTaskStatus =
  | "idle"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CreatorImageMode = "none" | "squoosh" | "tinypng" | "webp";
export type CreatorPayloadEncoding = "base64" | "base91" | "html7";

export interface CreatorBuildConfiguration {
  inputDirectory: string;
  outputFile: string;
  imageMode: CreatorImageMode;
  audioEnabled: boolean;
  audioBitrateKbps: number;
  payloadEncoding: CreatorPayloadEncoding;
}

export interface CreatorBuildTask {
  id: string;
  status: CreatorBuildTaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  inputDirectory: string;
  outputFile: string;
  reportFile: string | null;
  stage: string | null;
  progress: number | null;
  error: string | null;
  logs: readonly string[];
}

export interface CreatorStartBuildResponse {
  task: CreatorBuildTask;
}

export interface CreatorCancelBuildResponse {
  task: CreatorBuildTask;
}
