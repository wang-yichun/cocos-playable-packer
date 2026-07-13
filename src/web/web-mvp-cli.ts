import { pathToFileURL } from "node:url";

import { startEnhancedResourceAnalysisWebMvpServer } from "./resource-analysis-enhanced-web-server.js";
import {
  createWebMvpAccessUrls,
  isWildcardWebMvpHost,
  normalizeWebMvpHost,
  parseWebMvpPort,
} from "./web-mvp-network.js";

async function main(): Promise<void> {
  const host = normalizeWebMvpHost(process.env.PLAYABLE_WEB_HOST);
  const server = await startEnhancedResourceAnalysisWebMvpServer({
    host,
    port: parseWebMvpPort(process.env.PLAYABLE_WEB_PORT),
    rootDirectory: process.env.PLAYABLE_WEB_ROOT,
    projectRoot: process.cwd(),
  });
  const urls = createWebMvpAccessUrls(server.host, server.port);

  console.log("Cocos Playable Packer Web MVP");
  console.log("----------------------------");
  console.log(`版本：v${server.versionInfo.appVersion} / Build ${server.versionInfo.buildShortSha}`);
  if (isWildcardWebMvpHost(server.host)) {
    console.log(`本机地址：${urls[0]}`);
    for (const url of urls.slice(1)) {
      console.log(`局域网地址：${url}`);
    }
    if (urls.length === 1) {
      console.log("局域网地址：未检测到可用 IPv4，请使用 ipconfig 检查当前网卡地址。");
    }
  } else {
    console.log(`地址：${urls[0]}`);
  }
  console.log(`监听：${server.host}:${server.port}`);
  console.log(`数据目录：${server.manager.rootDirectory}`);
  console.log("加载界面：支持内嵌 Logo 与蓝色进度条");
  console.log("资源体检：支持源资源映射、重复资源识别、WebP 实测、音频参数估算与独立 HTML 报告");
  console.log("安全提示：Web MVP 没有登录鉴权，仅应在可信局域网中运行。");
}

const entryFile = process.argv[1];
if (entryFile !== undefined && import.meta.url === pathToFileURL(entryFile).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
