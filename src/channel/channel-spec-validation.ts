import type { ChannelDeliveryFormat, ChannelPlatform } from "./channel-profile.js";

export type ChannelArtifactFormat = ChannelDeliveryFormat | "zip-other" | "unknown";
export type ChannelSpecificationStatus =
  | "not-applicable"
  | "official-confirmed"
  | "official-partial"
  | "unverified";
export type ChannelValidationSeverity = "error" | "warning";

export interface ChannelValidationIssue {
  code: string;
  severity: ChannelValidationSeverity;
  message: string;
  file?: string;
}

export interface ChannelArtifactValidationInput {
  platform: ChannelPlatform;
  deliveryFormat: ChannelArtifactFormat;
  artifactBytes: number;
  entries: readonly string[];
  textFiles: Readonly<Record<string, string>>;
}

export interface ChannelArtifactValidationReport {
  schemaVersion: 1;
  platform: ChannelPlatform;
  specificationStatus: ChannelSpecificationStatus;
  expectedFormat: ChannelDeliveryFormat | null;
  actualFormat: ChannelArtifactFormat;
  artifactBytes: number;
  maximumArtifactBytes: number | null;
  entryCount: number;
  maximumEntries: number | null;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: readonly ChannelValidationIssue[];
}

interface ChannelRuleSet {
  specificationStatus: ChannelSpecificationStatus;
  expectedFormat: ChannelDeliveryFormat | null;
  maximumArtifactBytes: number | null;
  sizeSeverity: ChannelValidationSeverity;
  maximumEntries: number | null;
}

const FIVE_MB = 5_000_000;

const CHANNEL_RULES: Readonly<Record<ChannelPlatform, ChannelRuleSet>> = {
  Preview: {
    specificationStatus: "not-applicable",
    expectedFormat: "single-html",
    maximumArtifactBytes: null,
    sizeSeverity: "warning",
    maximumEntries: null,
  },
  AppLovin: {
    specificationStatus: "official-confirmed",
    expectedFormat: "single-html",
    maximumArtifactBytes: FIVE_MB,
    sizeSeverity: "error",
    maximumEntries: 1,
  },
  Google: {
    specificationStatus: "official-confirmed",
    expectedFormat: "zip-html-res-js",
    maximumArtifactBytes: FIVE_MB,
    sizeSeverity: "error",
    maximumEntries: 512,
  },
  Facebook: {
    specificationStatus: "unverified",
    expectedFormat: "zip-html-res-js",
    maximumArtifactBytes: null,
    sizeSeverity: "warning",
    maximumEntries: null,
  },
  Liftoff: {
    specificationStatus: "official-partial",
    expectedFormat: "zip-single-html",
    maximumArtifactBytes: FIVE_MB,
    sizeSeverity: "warning",
    maximumEntries: null,
  },
  IronSource: {
    specificationStatus: "unverified",
    expectedFormat: "single-html",
    maximumArtifactBytes: null,
    sizeSeverity: "warning",
    maximumEntries: null,
  },
  Unity: {
    specificationStatus: "official-confirmed",
    expectedFormat: "single-html",
    maximumArtifactBytes: FIVE_MB,
    sizeSeverity: "error",
    maximumEntries: 1,
  },
  Moloco: {
    specificationStatus: "official-confirmed",
    expectedFormat: "single-html",
    maximumArtifactBytes: FIVE_MB,
    sizeSeverity: "error",
    maximumEntries: 1,
  },
};

const EXTERNAL_HTML_RESOURCE = /<(?:script|img|audio|video|source|link|iframe)\b[^>]*(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i;
const EXTERNAL_CSS_RESOURCE = /url\(\s*["']?\s*(?:https?:)?\/\//i;
const EXTERNAL_DYNAMIC_RESOURCE = /\b(?:fetch|importScripts)\s*\(\s*["']\s*https?:\/\//i;
const XHR_REFERENCE = /\bXMLHttpRequest\b/;
const MRAID_SCRIPT = /<script\b[^>]*src\s*=\s*["'][^"']*mraid(?:\.min)?\.js(?:[?#][^"']*)?["']/i;
const JAVASCRIPT_REDIRECT = /\b(?:window\.)?location(?:\.href)?\s*=|\blocation\.(?:assign|replace)\s*\(|\bwindow\.open\s*\(/i;

function pushIssue(
  issues: ChannelValidationIssue[],
  issue: ChannelValidationIssue,
): void {
  if (issues.some((item) => item.code === issue.code && item.file === issue.file)) {
    return;
  }
  issues.push(issue);
}

function matchingFile(
  files: Readonly<Record<string, string>>,
  pattern: RegExp,
): string | undefined {
  for (const [file, source] of Object.entries(files)) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) {
      return file;
    }
  }
  return undefined;
}

function combinedSource(files: Readonly<Record<string, string>>): string {
  return Object.entries(files)
    .map(([file, source]) => `\n/* ${file} */\n${source}`)
    .join("\n");
}

function checkNoExternalResources(
  issues: ChannelValidationIssue[],
  files: Readonly<Record<string, string>>,
  severity: ChannelValidationSeverity,
): void {
  const file = matchingFile(
    files,
    new RegExp(
      `${EXTERNAL_HTML_RESOURCE.source}|${EXTERNAL_CSS_RESOURCE.source}|${EXTERNAL_DYNAMIC_RESOURCE.source}`,
      "i",
    ),
  );
  if (file !== undefined) {
    pushIssue(issues, {
      code: "EXTERNAL_RESOURCE_REFERENCE",
      severity,
      message: "产物包含外部网络资源引用；该渠道要求资源内嵌。",
      file,
    });
  }
}

function checkNoXhr(
  issues: ChannelValidationIssue[],
  files: Readonly<Record<string, string>>,
  severity: ChannelValidationSeverity,
): void {
  const file = matchingFile(files, XHR_REFERENCE);
  if (file !== undefined) {
    pushIssue(issues, {
      code: "XMLHTTPREQUEST_PRESENT",
      severity,
      message: "产物包含 XMLHttpRequest；该渠道不允许依赖运行时网络请求。",
      file,
    });
  }
}

function checkNoMraidScript(
  issues: ChannelValidationIssue[],
  files: Readonly<Record<string, string>>,
  severity: ChannelValidationSeverity,
): void {
  const file = matchingFile(files, MRAID_SCRIPT);
  if (file !== undefined) {
    pushIssue(issues, {
      code: "MRAID_SCRIPT_BUNDLED",
      severity,
      message: "产物不应自行打包 mraid.js；MRAID 应由渠道宿主注入。",
      file,
    });
  }
}

function checkMraidBridge(
  issues: ChannelValidationIssue[],
  source: string,
): void {
  if (!/\bmraid\.open\s*\(/.test(source)) {
    pushIssue(issues, {
      code: "MRAID_OPEN_MISSING",
      severity: "error",
      message: "产物缺少 mraid.open() CTA 调用。",
    });
  }
  if (!/viewableChange/.test(source) || !/__PACK_RUNTIME_START_GATE__/.test(source)) {
    pushIssue(issues, {
      code: "MRAID_VIEWABLE_GATE_MISSING",
      severity: "error",
      message: "产物缺少 MRAID viewableChange 启动门控。",
    });
  }
}

export function validateChannelArtifact(
  input: ChannelArtifactValidationInput,
): ChannelArtifactValidationReport {
  const rules = CHANNEL_RULES[input.platform];
  const issues: ChannelValidationIssue[] = [];
  const source = combinedSource(input.textFiles);

  if (!Number.isInteger(input.artifactBytes) || input.artifactBytes <= 0) {
    pushIssue(issues, {
      code: "ARTIFACT_SIZE_INVALID",
      severity: "error",
      message: "产物大小必须是正整数。",
    });
  }

  if (rules.expectedFormat !== null && input.deliveryFormat !== rules.expectedFormat) {
    pushIssue(issues, {
      code: "DELIVERY_FORMAT_MISMATCH",
      severity: "error",
      message: `渠道要求 ${rules.expectedFormat}，当前产物为 ${input.deliveryFormat}。`,
    });
  }

  if (
    rules.maximumArtifactBytes !== null
    && input.artifactBytes > rules.maximumArtifactBytes
  ) {
    pushIssue(issues, {
      code: "ARTIFACT_SIZE_EXCEEDED",
      severity: rules.sizeSeverity,
      message: `产物 ${input.artifactBytes} B 超过渠道限制或建议值 ${rules.maximumArtifactBytes} B。`,
    });
  }

  if (rules.maximumEntries !== null && input.entries.length > rules.maximumEntries) {
    pushIssue(issues, {
      code: "ENTRY_COUNT_EXCEEDED",
      severity: "error",
      message: `产物文件数量 ${input.entries.length} 超过渠道上限 ${rules.maximumEntries}。`,
    });
  }

  if (rules.specificationStatus === "unverified") {
    pushIssue(issues, {
      code: "OFFICIAL_SPEC_UNVERIFIED",
      severity: "warning",
      message: "当前渠道缺少可公开核验的最新官方 Playable 规范，仍需账号内文档或真实后台验证。",
    });
  }

  switch (input.platform) {
    case "AppLovin":
      checkMraidBridge(issues, source);
      checkNoExternalResources(issues, input.textFiles, "error");
      checkNoXhr(issues, input.textFiles, "error");
      checkNoMraidScript(issues, input.textFiles, "error");
      pushIssue(issues, {
        code: "AUDIO_POLICY_REQUIRES_RUNTIME_TEST",
        severity: "warning",
        message: "需要实机确认首次用户交互前保持静音。",
      });
      break;

    case "Google":
      if (!input.entries.includes("index.html")) {
        pushIssue(issues, {
          code: "GOOGLE_INDEX_MISSING",
          severity: "error",
          message: "Google ZIP 根目录缺少 index.html。",
        });
      }
      if (!/ExitApi\.exit\s*\(\s*\)/.test(source)) {
        pushIssue(issues, {
          code: "GOOGLE_EXIT_API_CALL_MISSING",
          severity: "error",
          message: "Google 产物缺少 ExitApi.exit() 调用。",
        });
      }
      if (!/tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi\.js/.test(source)) {
        pushIssue(issues, {
          code: "GOOGLE_EXIT_API_SCRIPT_MISSING",
          severity: "error",
          message: "Google 产物缺少官方 exitapi.js 引用。",
        });
      }
      if (!/<meta\b[^>]*name\s*=\s*["']ad\.(?:orientation|size)["']/i.test(source)) {
        pushIssue(issues, {
          code: "GOOGLE_AD_META_MISSING",
          severity: "warning",
          message: "未发现 ad.orientation 或 ad.size 元数据，需要在真实 App Campaign 上传前确认。",
        });
      }
      pushIssue(issues, {
        code: "GOOGLE_UPLOAD_REQUIRES_VALIDATOR",
        severity: "warning",
        message: "仍需通过 Google Ads HTML5 Validator 和真实 App Campaign 上传验证。",
      });
      break;

    case "Liftoff":
      checkMraidBridge(issues, source);
      checkNoMraidScript(issues, input.textFiles, "error");
      checkNoExternalResources(issues, input.textFiles, "warning");
      if (/\bmraid\.open\s*\(\s*storeUrl\s*\)/.test(source)) {
        pushIssue(issues, {
          code: "LIFTOFF_CTA_ARGUMENT_REQUIRES_TEST",
          severity: "warning",
          message: "当前调用 mraid.open(storeUrl)；Liftoff 官方示例使用无参数 mraid.open()，需在目标预览环境确认。",
        });
      }
      pushIssue(issues, {
        code: "LIFTOFF_PRODUCT_LINE_REQUIRES_CONFIRMATION",
        severity: "warning",
        message: "需确认目标为当前 Interactive Ad Integration，而不是旧 Direct Adaptive Creative 协议。",
      });
      break;

    case "IronSource":
      checkMraidBridge(issues, source);
      checkNoMraidScript(issues, input.textFiles, "warning");
      break;

    case "Unity":
      checkMraidBridge(issues, source);
      checkNoExternalResources(issues, input.textFiles, "error");
      checkNoXhr(issues, input.textFiles, "error");
      checkNoMraidScript(issues, input.textFiles, "error");
      pushIssue(issues, {
        code: "UNITY_DEVICE_TEST_REQUIRED",
        severity: "warning",
        message: "仍需使用 Unity Ads Ad Testing App 在 Android 和 iOS 上验证。",
      });
      break;

    case "Moloco": {
      if (!/\bFbPlayableAd\.onCTAClick\s*\(\s*\)/.test(source)) {
        pushIssue(issues, {
          code: "MOLOCO_CTA_MISSING",
          severity: "error",
          message: "Moloco 产物缺少无参数 FbPlayableAd.onCTAClick()。",
        });
      }
      checkNoExternalResources(issues, input.textFiles, "error");
      checkNoXhr(issues, input.textFiles, "error");
      checkNoMraidScript(issues, input.textFiles, "error");
      const redirectFile = matchingFile(input.textFiles, JAVASCRIPT_REDIRECT);
      if (redirectFile !== undefined) {
        pushIssue(issues, {
          code: "MOLOCO_JAVASCRIPT_REDIRECT_PRESENT",
          severity: "warning",
          message: "产物包含 JavaScript 跳转回退代码；Moloco 官方规范禁止 JavaScript redirects，建议移除渠道产物中的回退路径。",
          file: redirectFile,
        });
      }
      break;
    }

    case "Facebook":
      if (!/\bFbPlayableAd\.onCTAClick\s*\(/.test(source)) {
        pushIssue(issues, {
          code: "FACEBOOK_CTA_MISSING",
          severity: "warning",
          message: "未发现 FbPlayableAd.onCTAClick()；当前 Meta 规范尚待账号内资料确认。",
        });
      }
      break;

    case "Preview":
      break;
  }

  issues.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "error" ? -1 : 1;
    }
    return left.code.localeCompare(right.code);
  });
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;

  return {
    schemaVersion: 1,
    platform: input.platform,
    specificationStatus: rules.specificationStatus,
    expectedFormat: rules.expectedFormat,
    actualFormat: input.deliveryFormat,
    artifactBytes: input.artifactBytes,
    maximumArtifactBytes: rules.maximumArtifactBytes,
    entryCount: input.entries.length,
    maximumEntries: rules.maximumEntries,
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}
