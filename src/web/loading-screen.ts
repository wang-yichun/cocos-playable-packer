import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export const MAX_LOADING_LOGO_BYTES = 40 * 1024;
export const LOADING_SCREEN_MARKER = "data-cpp-loading-screen";

export type LoadingLogoMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface LoadingScreenConfig {
  enabled?: boolean;
  logoDataUrl?: string | null;
}

export interface NormalizedLoadingScreenConfig {
  enabled: boolean;
  logoDataUrl: string | null;
  logoBytes: number;
  logoMimeType: LoadingLogoMimeType | null;
}

export interface LoadingScreenArtifactResult {
  injected: boolean;
  outputBytes: number;
  outputSha256: string;
  addedBytes: number;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesMimeSignature(bytes: Buffer, mimeType: LoadingLogoMimeType): boolean {
  if (mimeType === "image/png") {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function normalizeLogoDataUrl(value: unknown): {
  dataUrl: string;
  bytes: number;
  mimeType: LoadingLogoMimeType;
} {
  if (typeof value !== "string") {
    throw new Error("启用加载界面时必须上传 Logo。");
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (match === null) {
    throw new Error("加载 Logo 只支持 PNG、JPEG 或 WebP Base64 Data URL。");
  }
  const mimeType = match[1] as LoadingLogoMimeType;
  const payload = match[2] ?? "";
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0) {
    throw new Error("加载 Logo 不能为空。");
  }
  if (bytes.length > MAX_LOADING_LOGO_BYTES) {
    throw new Error(`加载 Logo 不能超过 ${MAX_LOADING_LOGO_BYTES} B。`);
  }
  if (bytes.toString("base64") !== payload) {
    throw new Error("加载 Logo Base64 数据无效。");
  }
  if (!matchesMimeSignature(bytes, mimeType)) {
    throw new Error("加载 Logo 的文件内容与 MIME 类型不匹配。");
  }
  return {
    dataUrl: value,
    bytes: bytes.length,
    mimeType,
  };
}

export function normalizeLoadingScreenConfig(
  value: unknown,
): NormalizedLoadingScreenConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    throw new Error("loadingScreen 必须是对象。");
  }
  const enabledValue = value.enabled;
  if (enabledValue !== undefined && typeof enabledValue !== "boolean") {
    throw new Error("loadingScreen.enabled 必须是布尔值。");
  }
  const enabled = enabledValue === true;
  if (!enabled) {
    return {
      enabled: false,
      logoDataUrl: null,
      logoBytes: 0,
      logoMimeType: null,
    };
  }
  const logo = normalizeLogoDataUrl(value.logoDataUrl);
  return {
    enabled: true,
    logoDataUrl: logo.dataUrl,
    logoBytes: logo.bytes,
    logoMimeType: logo.mimeType,
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function insertIntoHead(html: string, content: string): string {
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${content}\n</head>`);
  }
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype !== null && doctype.index !== undefined) {
    const end = doctype.index + doctype[0].length;
    return `${html.slice(0, end)}\n${content}${html.slice(end)}`;
  }
  return `${content}\n${html}`;
}

function insertIntoBody(html: string, content: string): string {
  if (/<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b[^>]*>/i, (openingTag) => `${openingTag}\n${content}`);
  }
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype !== null && doctype.index !== undefined) {
    const end = doctype.index + doctype[0].length;
    return `${html.slice(0, end)}\n${content}${html.slice(end)}`;
  }
  return `${content}\n${html}`;
}

function createLoadingScreenStyle(): string {
  return `<style ${LOADING_SCREEN_MARKER}="style">
#cpp-loading-screen{position:fixed;inset:0;z-index:2147483646;background:#171717;opacity:1;overflow:hidden;transition:opacity .2s ease;pointer-events:auto;}
#cpp-loading-screen.cpp-loading-screen--hidden{opacity:0;pointer-events:none;}
#cpp-loading-screen .cpp-loading-logo{position:absolute;left:50%;top:50%;width:min(45vw,480px);max-width:72vw;max-height:44vh;object-fit:contain;transform:translate(-50%,-58%);user-select:none;-webkit-user-drag:none;}
#cpp-loading-screen .cpp-loading-progress{position:absolute;left:27.5%;top:80%;width:45%;height:3px;border-radius:999px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 3px rgba(0,0,0,.55);overflow:visible;}
#cpp-loading-screen .cpp-loading-progress-fill{display:block;position:relative;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3dc5de,#5ff8ff);box-shadow:0 0 8px rgba(95,248,255,.7);transition:width .35s ease-in-out;overflow:hidden;}
#cpp-loading-screen .cpp-loading-progress-fill::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.2) 0 5px,rgba(255,255,255,0) 5px 10px);animation:cpp-loading-stripes .8s linear infinite;}
#cpp-loading-screen .cpp-loading-progress-fill::after{content:"";position:absolute;right:-3px;top:50%;width:7px;height:7px;border-radius:50%;background:#baffff;box-shadow:0 0 8px #5ff8ff;transform:translateY(-50%);}
@keyframes cpp-loading-stripes{from{background-position:0 0}to{background-position:14px 0}}
@media (orientation:landscape){#cpp-loading-screen .cpp-loading-logo{width:min(26vw,420px);max-height:48vh;}}
@media (prefers-reduced-motion:reduce){#cpp-loading-screen,#cpp-loading-screen .cpp-loading-progress-fill{transition:none}#cpp-loading-screen .cpp-loading-progress-fill::before{animation:none}}
</style>`;
}

function createLoadingScreenMarkup(logoDataUrl: string): string {
  const logo = escapeHtmlAttribute(logoDataUrl);
  return `<div id="cpp-loading-screen" ${LOADING_SCREEN_MARKER}="root" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
  <img class="cpp-loading-logo" src="${logo}" alt="" draggable="false">
  <div class="cpp-loading-progress"><span id="cpp-loading-progress-fill" class="cpp-loading-progress-fill"></span></div>
</div>
<script ${LOADING_SCREEN_MARKER}="runtime">
(function(){
  var root=document.getElementById('cpp-loading-screen');
  var fill=document.getElementById('cpp-loading-progress-fill');
  if(!root||!fill){return;}
  var done=false;
  var progress=8;
  var startedAt=typeof performance!=='undefined'?performance.now():Date.now();
  var firstRenderAt=0;
  var renderSignals=0;
  var canvasCandidateAt=0;
  var restorers=[];
  function now(){return typeof performance!=='undefined'?performance.now():Date.now();}
  function setProgress(value){
    if(done&&value<100){return;}
    var next=Math.max(progress,Math.min(100,Number(value)||0));
    progress=next;
    fill.style.width=next.toFixed(2)+'%';
    root.setAttribute('aria-valuenow',String(Math.round(next)));
  }
  function restoreHooks(){
    for(var index=0;index<restorers.length;index+=1){try{restorers[index]();}catch(_error){}}
    restorers.length=0;
  }
  function remove(){
    root.classList.add('cpp-loading-screen--hidden');
    window.setTimeout(function(){if(root.parentNode){root.parentNode.removeChild(root);}},220);
  }
  function complete(){
    if(done){return;}
    done=true;
    window.clearInterval(timer);
    restoreHooks();
    setProgress(100);
    window.setTimeout(function(){
      window.requestAnimationFrame(function(){window.requestAnimationFrame(remove);});
    },80);
  }
  function markRender(){
    if(done){return;}
    renderSignals+=1;
    if(firstRenderAt===0){firstRenderAt=now();}
    setProgress(94);
  }
  function hookMethod(prototype,name){
    if(!prototype||typeof prototype[name]!=='function'){return;}
    var original=prototype[name];
    var wrapped=function(){markRender();return original.apply(this,arguments);};
    try{
      prototype[name]=wrapped;
      if(prototype[name]===wrapped){restorers.push(function(){prototype[name]=original;});}
    }catch(_error){}
  }
  hookMethod(window.WebGLRenderingContext&&WebGLRenderingContext.prototype,'drawArrays');
  hookMethod(window.WebGLRenderingContext&&WebGLRenderingContext.prototype,'drawElements');
  hookMethod(window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype,'drawArrays');
  hookMethod(window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype,'drawElements');
  hookMethod(window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype,'drawImage');
  hookMethod(window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype,'fillRect');
  function canvasReady(){
    var canvases=document.getElementsByTagName('canvas');
    for(var index=0;index<canvases.length;index+=1){
      var canvas=canvases[index];
      var rect=canvas.getBoundingClientRect();
      var style=window.getComputedStyle(canvas);
      var visible=rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||'1')>0;
      var configured=canvas.width>0&&canvas.height>0&&(canvas.width!==300||canvas.height!==150);
      if(visible&&configured){return true;}
    }
    return false;
  }
  function watchRender(){
    if(done){return;}
    var current=now();
    if(renderSignals>=3&&firstRenderAt>0&&current-firstRenderAt>=180&&current-startedAt>=500){
      complete();
      return;
    }
    if(current-startedAt>=6000&&canvasReady()){
      if(canvasCandidateAt===0){canvasCandidateAt=current;}
      if(current-canvasCandidateAt>=650){complete();return;}
    }else if(!canvasReady()){
      canvasCandidateAt=0;
    }
    window.requestAnimationFrame(watchRender);
  }
  window.__CPP_LOADING_SCREEN__={setProgress:setProgress,complete:complete};
  setProgress(progress);
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){setProgress(18);},{once:true});
  }else{
    setProgress(18);
  }
  var timer=window.setInterval(function(){
    if(done){return;}
    setProgress(Math.min(90,progress+Math.max(.45,(90-progress)*.04)));
  },160);
  window.requestAnimationFrame(watchRender);
})();
</script>`;
}

export function injectLoadingScreen(
  html: string,
  config: NormalizedLoadingScreenConfig,
): string {
  if (!config.enabled) {
    return html;
  }
  if (config.logoDataUrl === null) {
    throw new Error("启用加载界面时缺少 Logo 数据。");
  }
  if (html.includes(`${LOADING_SCREEN_MARKER}=`)) {
    throw new Error("HTML 已包含 Cocos Playable Packer 加载界面。");
  }
  const withStyle = insertIntoHead(html, createLoadingScreenStyle());
  return insertIntoBody(withStyle, createLoadingScreenMarkup(config.logoDataUrl));
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function applyLoadingScreenToArtifact(
  outputFile: string,
  reportFile: string,
  config: NormalizedLoadingScreenConfig,
): Promise<LoadingScreenArtifactResult> {
  const originalHtml = await readFile(outputFile, "utf8");
  if (!config.enabled) {
    return {
      injected: false,
      outputBytes: Buffer.byteLength(originalHtml),
      outputSha256: sha256(originalHtml),
      addedBytes: 0,
    };
  }

  const parsed: unknown = JSON.parse(await readFile(reportFile, "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`构建报告根节点必须是对象：${reportFile}`);
  }
  const html = injectLoadingScreen(originalHtml, config);
  const outputBytes = Buffer.byteLength(html);
  const outputSha256 = sha256(html);
  const output = isJsonObject(parsed.output) ? parsed.output : {};
  const report: JsonObject = {
    ...parsed,
    output: {
      ...output,
      bytes: outputBytes,
      sha256: outputSha256,
    },
    loadingScreen: {
      enabled: true,
      style: "centered-logo-blue-progress",
      logoMimeType: config.logoMimeType,
      logoOriginalBytes: config.logoBytes,
      logoEmbeddedBytes: Buffer.byteLength(config.logoDataUrl ?? ""),
      htmlAddedBytes: outputBytes - Buffer.byteLength(originalHtml),
      backgroundColor: "#171717",
      progressGradient: ["#3dc5de", "#5ff8ff"],
    },
  };
  await writeFile(outputFile, html, "utf8");
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    injected: true,
    outputBytes,
    outputSha256,
    addedBytes: outputBytes - Buffer.byteLength(originalHtml),
  };
}
