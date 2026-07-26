import type {
  PlayableBuildEvent,
  PlayableBuildRequest,
  PlayableBuildResult,
} from "../core/index.js";

export const CREATOR_WORKER_PROTOCOL_VERSION = 1 as const;

export interface CreatorWorkerRequest {
  protocolVersion: typeof CREATOR_WORKER_PROTOCOL_VERSION;
  taskId: string;
  packageRoot: string;
  tempRoot?: string;
  nodeExecutable: string;
  environment?: NodeJS.ProcessEnv;
  build: PlayableBuildRequest;
}

export type CreatorWorkerMessage =
  | {
      type: "ready";
      taskId: string;
      pid: number;
    }
  | {
      type: "event";
      taskId: string;
      event: PlayableBuildEvent;
    }
  | {
      type: "result";
      taskId: string;
      result: PlayableBuildResult;
    }
  | {
      type: "error";
      taskId: string;
      error: {
        code: string;
        message: string;
        stack: string | null;
      };
    };

export function serializeCreatorWorkerMessage(message: CreatorWorkerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseCreatorWorkerRequest(value: unknown): CreatorWorkerRequest {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Creator Worker 请求必须是对象。");
  }
  const request = value as Partial<CreatorWorkerRequest>;
  if (request.protocolVersion !== CREATOR_WORKER_PROTOCOL_VERSION) {
    throw new TypeError(`不支持的 Creator Worker 协议版本：${String(request.protocolVersion)}`);
  }
  for (const key of ["taskId", "packageRoot", "nodeExecutable"] as const) {
    if (typeof request[key] !== "string" || request[key]!.trim().length === 0) {
      throw new TypeError(`Creator Worker 请求字段 ${key} 不能为空。`);
    }
  }
  if (typeof request.build !== "object" || request.build === null) {
    throw new TypeError("Creator Worker 请求缺少 build 配置。");
  }
  return request as CreatorWorkerRequest;
}
