import {
  createResourceAnalysisHtmlReport,
  type CompleteResourceAnalysisReport,
} from "./resource-analysis-report.js";

function replaceOnce(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`资源体检 HTML 缺少插入点：${search}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

export function createClarifiedResourceAnalysisHtmlReport(
  report: CompleteResourceAnalysisReport,
): string {
  let html = createResourceAnalysisHtmlReport(report);
  html = html
    .replace("当前构建大小", "当前 Web Mobile 原始大小")
    .replace("预计优化后", "预计 Web Mobile 优化后")
    .replace("预计总构建减少", "Web Mobile 原始体积预计减少");
  html = replaceOnce(
    html,
    "<h2>构建资源体积构成</h2>",
    `<div class="notice">这里的大小和百分比针对解压后的 <code>web-mobile</code> 目录。图片、音频变小后，最终 Brotli Payload 与单 HTML 通常也会下降，但降幅不会与原始目录百分比完全相同，必须通过真实 Playable 打包报告确认。</div>
<h2>构建资源体积构成</h2>`,
  );
  return html;
}
