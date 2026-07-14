import { createResourceOptimizationWebMvpIndexHtml } from "./resource-analysis-optimization-ui.js";
import {
  createFallbackWebVersionInfo,
  type WebVersionInfo,
} from "./web-version-info.js";

const CLARIFIED_NOTE = "图片为 WebP 80 临时转码实测；音频只估算源码率高于 48 kbps 的文件。上述大小针对解压后的 web-mobile 目录，不等同于最终 Brotli Payload 或单 HTML 降幅；最终体积必须通过真实 Playable 打包确认。";

const NOTE_VARIANTS = [
  "图片为 WebP 80 临时转码实测；音频为 48 kbps 参数估算。这里只提供诊断，不会自动修改打包配置或资源文件。",
  "图片为 WebP 80 临时转码实测；音频为 48 kbps 参数估算。这里只提供诊断，不会自动修改打包配置或资源文件。这里的百分比针对解压后的 Web Mobile，不等同于最终 Brotli Payload 或单 HTML 降幅。",
] as const;

export function createClarifiedResourceAnalysisWebMvpIndexHtml(
  versionInfo: WebVersionInfo = createFallbackWebVersionInfo(),
): string {
  let html = createResourceOptimizationWebMvpIndexHtml(versionInfo)
    .replace("预计优化后构建大小", "预计 Web Mobile 优化后")
    .replace("预计优化后 Web Mobile", "预计 Web Mobile 优化后")
    .replace("预计总构建减少", "Web Mobile 原始体积预计减少");

  for (const note of NOTE_VARIANTS) {
    html = html.replace(note, CLARIFIED_NOTE);
  }
  return html;
}
