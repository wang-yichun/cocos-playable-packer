export interface CreatorProjectInfo {
  name: string;
  path: string;
  tmpDir: string;
  uuid: string;
}

export interface CreatorRuntimeInfo {
  nodeVersion: string;
  nodeExecutable: string;
  platform: NodeJS.Platform;
  architecture: string;
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
