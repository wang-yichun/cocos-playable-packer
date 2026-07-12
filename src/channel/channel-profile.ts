import { readFile, writeFile } from "node:fs/promises";

export const CHANNEL_PLATFORMS = [
  "Preview",
  "AppLovin",
  "Google",
  "Facebook",
  "Liftoff",
  "IronSource",
  "Unity",
  "Moloco",
] as const;

export type ChannelPlatform = typeof CHANNEL_PLATFORMS[number];
export type ChannelDeliveryFormat =
  | "single-html"
  | "zip-single-html"
  | "zip-html-res-js";
export type ChannelBridge =
  | "preview"
  | "mraid"
  | "facebook-cta"
  | "google-exit-api";
export type ChannelStartupPolicy = "window-load" | "mraid-viewable";
export type ChannelAnalyticsAdapter = "none" | "applovin" | "custom-beacon";
export type ChannelIntegrationStatus =
  | "profile-only"
  | "download-bridge-injected"
  | "mraid-lifecycle-injected"
  | "channel-delivery-ready";

export interface ChannelProfile {
  platform: ChannelPlatform;
  displayName: string;
  deliveryFormat: ChannelDeliveryFormat;
  bridge: ChannelBridge;
  startupPolicy: ChannelStartupPolicy;
  analyticsAdapter: ChannelAnalyticsAdapter;
  requiredGlobals: readonly string[];
  externalScripts: readonly string[];
  requiresExternalApi: boolean;
  warnings: readonly string[];
}

export interface ChannelBuildConfig {
  platform: ChannelPlatform;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
}

export interface ChannelReport {
  platform: ChannelPlatform;
  displayName: string;
  deliveryFormat: ChannelDeliveryFormat;
  bridge: ChannelBridge;
  startupPolicy: ChannelStartupPolicy;
  analyticsAdapter: ChannelAnalyticsAdapter;
  requiredGlobals: readonly string[];
  externalScripts: readonly string[];
  requiresExternalApi: boolean;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
  integrationStatus: ChannelIntegrationStatus;
  warnings: readonly string[];
}

export const TEST_ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.google.android.apps.maps";
export const TEST_IOS_STORE_URL =
  "https://apps.apple.com/app/google-maps/id585027354";

const DELIVERY_PENDING_WARNING =
  "已注入渠道下载桥，但尚未生成该渠道要求的专用交付容器。";
const MRAID_LIFECYCLE_WARNING =
  "已注入 MRAID ready/viewable、尺寸、音量和下载桥；尚未通过目标渠道最新官方 Validator。";

export const CHANNEL_PROFILES: Readonly<Record<ChannelPlatform, ChannelProfile>> = {
  Preview: {
    platform: "Preview",
    displayName: "本地预览",
    deliveryFormat: "single-html",
    bridge: "preview",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: [],
    externalScripts: [],
    requiresExternalApi: false,
    warnings: ["本地预览只验证浏览器运行，不代表任何广告渠道审核结果。"],
  },
  AppLovin: {
    platform: "AppLovin",
    displayName: "AppLovin",
    deliveryFormat: "single-html",
    bridge: "mraid",
    startupPolicy: "mraid-viewable",
    analyticsAdapter: "applovin",
    requiredGlobals: ["mraid"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [MRAID_LIFECYCLE_WARNING],
  },
  Google: {
    platform: "Google",
    displayName: "Google Ads",
    deliveryFormat: "zip-html-res-js",
    bridge: "google-exit-api",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: ["ExitApi"],
    externalScripts: [
      "https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js",
    ],
    requiresExternalApi: true,
    warnings: [
      DELIVERY_PENDING_WARNING,
      "历史成品交付为 ZIP（index.html + res.js）；当前阶段尚未切换输出结构。",
    ],
  },
  Facebook: {
    platform: "Facebook",
    displayName: "Facebook",
    deliveryFormat: "zip-html-res-js",
    bridge: "facebook-cta",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: ["FbPlayableAd"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [
      DELIVERY_PENDING_WARNING,
      "历史成品使用 FbPlayableAd.onCTAClick，并交付 ZIP（index.html + res.js）。",
    ],
  },
  Liftoff: {
    platform: "Liftoff",
    displayName: "Liftoff",
    deliveryFormat: "zip-single-html",
    bridge: "mraid",
    startupPolicy: "mraid-viewable",
    analyticsAdapter: "none",
    requiredGlobals: ["mraid"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [
      MRAID_LIFECYCLE_WARNING,
      "当前实现会生成 ZIP，ZIP 根目录内仅包含 index.html；正式投放前仍需通过 Liftoff Validator。",
    ],
  },
  IronSource: {
    platform: "IronSource",
    displayName: "IronSource",
    deliveryFormat: "single-html",
    bridge: "mraid",
    startupPolicy: "mraid-viewable",
    analyticsAdapter: "none",
    requiredGlobals: ["mraid"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [MRAID_LIFECYCLE_WARNING],
  },
  Unity: {
    platform: "Unity",
    displayName: "Unity Ads",
    deliveryFormat: "single-html",
    bridge: "mraid",
    startupPolicy: "mraid-viewable",
    analyticsAdapter: "none",
    requiredGlobals: ["mraid"],
    externalScripts: ["mraid.js"],
    requiresExternalApi: true,
    warnings: [
      MRAID_LIFECYCLE_WARNING,
      "历史成品包含 mraid.js 占位引用但未携带该文件，不能把本地模拟器打进正式包。",
    ],
  },
  Moloco: {
    platform: "Moloco",
    displayName: "Moloco",
    deliveryFormat: "single-html",
    bridge: "facebook-cta",
    startupPolicy: "window-load",
    analyticsAdapter: "custom-beacon",
    requiredGlobals: ["FbPlayableAd"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [
      "已注入 CTA 下载桥；历史成品使用 FbPlayableAd.onCTAClick，仍需结合 Moloco 最新官方规范复核。",
      "历史成品中的第三方 beacon 不会作为默认实现复制。",
    ],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeChannelPlatform(value: unknown): ChannelPlatform {
  if (value === undefined || value === null || value === "") {
    return "Preview";
  }
  if (typeof value !== "string" || !CHANNEL_PLATFORMS.includes(value as ChannelPlatform)) {
    throw new Error(`channelPlatform 只支持：${CHANNEL_PLATFORMS.join("、")}。`);
  }
  return value as ChannelPlatform;
}

function normalizeStoreUrl(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} 必须是字符串。`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 2_048) {
    throw new Error(`${name} 不能超过 2048 个字符。`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} 必须是完整的 http 或 https URL。`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${name} 只支持 http 或 https URL。`);
  }
  return parsed.href;
}

export function normalizeChannelBuildConfig(value: unknown): ChannelBuildConfig {
  if (value === undefined || value === null) {
    return {
      platform: "Preview",
      androidStoreUrl: null,
      iosStoreUrl: null,
    };
  }
  if (!isRecord(value)) {
    throw new Error("channel 配置必须是对象。");
  }
  return {
    platform: normalizeChannelPlatform(value.platform),
    androidStoreUrl: normalizeStoreUrl(value.androidStoreUrl, "Android 商店地址"),
    iosStoreUrl: normalizeStoreUrl(value.iosStoreUrl, "iOS 商店地址"),
  };
}

export function createChannelReport(config: ChannelBuildConfig): ChannelReport {
  const profile = CHANNEL_PROFILES[config.platform];
  const warnings = [...profile.warnings];
  if (config.platform !== "Preview" && config.androidStoreUrl === null && config.iosStoreUrl === null) {
    warnings.push("未配置 Android 或 iOS 商店地址；下载桥无法完成商店跳转。");
  }
  return {
    platform: profile.platform,
    displayName: profile.displayName,
    deliveryFormat: profile.deliveryFormat,
    bridge: profile.bridge,
    startupPolicy: profile.startupPolicy,
    analyticsAdapter: profile.analyticsAdapter,
    requiredGlobals: [...profile.requiredGlobals],
    externalScripts: [...profile.externalScripts],
    requiresExternalApi: profile.requiresExternalApi,
    androidStoreUrl: config.androidStoreUrl,
    iosStoreUrl: config.iosStoreUrl,
    integrationStatus: "profile-only",
    warnings,
  };
}

export async function appendChannelReport(
  reportFile: string,
  config: ChannelBuildConfig,
): Promise<void> {
  const source = JSON.parse(await readFile(reportFile, "utf8")) as unknown;
  if (!isRecord(source)) {
    throw new Error(`构建报告根节点必须是对象：${reportFile}`);
  }
  source.channel = createChannelReport(config);
  await writeFile(reportFile, `${JSON.stringify(source, null, 2)}\n`, "utf8");
}
