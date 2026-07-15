import { readFile, writeFile } from "node:fs/promises";

import {
  PANGLE_PLAYABLE_SDK_URL,
  TIKTOK_PLAYABLE_SDK_URL,
} from "./bytedance-channel.js";

export const CHANNEL_PLATFORMS = [
  "Preview",
  "AppLovin",
  "Google",
  "Facebook",
  "Liftoff",
  "IronSource",
  "Unity",
  "Moloco",
  "Pangle",
  "TikTok",
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
  | "google-exit-api"
  | "bytedance-playable-sdk";
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

const MRAID_LIFECYCLE_WARNING =
  "已注入 MRAID ready/viewable、尺寸、音量和下载桥；正式投放前仍需通过目标渠道最新 Validator。";

const BYTEDANCE_SAMPLE_WARNING =
  "当前接入依据用户提供的渠道样例：同步加载远程 Playable SDK，并将游戏 CTA 委托给 SDK 提供的 xsd_playable.download/install。公开资料不足以确认该 SDK URL 为长期稳定官方入口，正式投放前必须通过对应广告后台预览与上传验证。";

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
      "当前实现会生成 ZIP（index.html + res.js）、引用 Exit API，并优先调用 ExitApi.exit()；正式投放前仍需通过 Google Ads 验证。",
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
      "当前实现会生成 ZIP（index.html + res.js）并注入 FbPlayableAd.onCTAClick；正式投放前仍需通过 Meta Validator。",
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
      "当前实现采用 Liftoff Interactive Ad Integration 的 MRAID 路线，并生成根目录仅含 index.html 的 ZIP。",
      "当前 CTA 调用为 mraid.open(storeUrl)，而官方示例使用无参数 mraid.open()；正式投放前需在目标预览环境确认。",
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
    warnings: [
      MRAID_LIFECYCLE_WARNING,
      "当前实现生成单 HTML，并依赖 IronSource 宿主提供 mraid 全局对象。",
    ],
  },
  Unity: {
    platform: "Unity",
    displayName: "Unity Ads",
    deliveryFormat: "single-html",
    bridge: "mraid",
    startupPolicy: "mraid-viewable",
    analyticsAdapter: "none",
    requiredGlobals: ["mraid"],
    externalScripts: ["mraid.js (host-provided)"],
    requiresExternalApi: true,
    warnings: [
      MRAID_LIFECYCLE_WARNING,
      "当前实现生成单 HTML，并依赖 Unity Ads 宿主注入 mraid；不会把本地模拟器或伪造 mraid.js 打进正式产物。",
    ],
  },
  Moloco: {
    platform: "Moloco",
    displayName: "Moloco",
    deliveryFormat: "single-html",
    bridge: "facebook-cta",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: ["FbPlayableAd"],
    externalScripts: [],
    requiresExternalApi: true,
    warnings: [
      "Moloco 2026-06-11 官方规范已确认：产物应为小于 5 MB 的单 HTML，CTA 使用无参数 FbPlayableAd.onCTAClick()。",
      "正式产物不得包含 XMLHttpRequest、外部网络资源、mraid.js 或 JavaScript redirects；仍需通过 Moloco Ads Manager Preview。",
      "历史成品中的第三方 beacon 不会作为默认实现复制。",
    ],
  },
  Pangle: {
    platform: "Pangle",
    displayName: "Pangle",
    deliveryFormat: "single-html",
    bridge: "bytedance-playable-sdk",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: ["xsd_playable"],
    externalScripts: [PANGLE_PLAYABLE_SDK_URL],
    requiresExternalApi: true,
    warnings: [
      BYTEDANCE_SAMPLE_WARNING,
      "当前 Pangle SDK URL 来自用户提供的 Pangle 样例。SDK 未提供 CTA 时，产物只输出警告，不执行浏览器商店跳转回退。",
    ],
  },
  TikTok: {
    platform: "TikTok",
    displayName: "TikTok",
    deliveryFormat: "single-html",
    bridge: "bytedance-playable-sdk",
    startupPolicy: "window-load",
    analyticsAdapter: "none",
    requiredGlobals: ["xsd_playable"],
    externalScripts: [TIKTOK_PLAYABLE_SDK_URL],
    requiresExternalApi: true,
    warnings: [
      BYTEDANCE_SAMPLE_WARNING,
      "当前 TikTok SDK URL 来自用户提供的 TikTok 样例。SDK 未提供 CTA 时，产物只输出警告，不执行浏览器商店跳转回退。",
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
  if (profile.bridge === "mraid" && config.androidStoreUrl === null && config.iosStoreUrl === null) {
    warnings.push("未配置 Android 或 iOS 商店地址；MRAID 下载桥无法完成商店跳转。");
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
