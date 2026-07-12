import {
    mkdir,
    readFile,
    readdir,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { detectImageMimeType } from './images/image-content-type.js';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import * as cheerio from 'cheerio';

interface PackedFile {
    m: string;
    b: string;
    s: number;
}

interface BootPlan {
    base: string;
    runtime: string[];
    modules: string[];
    plainScripts: string[];
    entry: string;
    importMap: {
        imports: Record<string, string>;
        scopes?: Record<
            string,
            Record<string, string>
        >;
    };
}

interface TransformResult {
    source: string;
    registerCount: number;
    anonymousRegisterCount: number;
    namedRegisterCount: number;
}

const VIRTUAL_ORIGIN =
    'https://playable.local/';

/**
 * Cocos Creator 的 Bundle index.js 中包含一个匿名入口模块。
 *
 * 例如：
 *
 * assets/internal/index.js
 *     -> virtual:///prerequisite-imports/internal
 *
 * assets/main/index.js
 *     -> virtual:///prerequisite-imports/main
 *
 * assets/resources/index.js
 *     -> virtual:///prerequisite-imports/resources
 *
 * 其他普通 JS 文件继续使用 playable.local 虚拟 HTTP 地址。
 */
function getAnonymousModuleId(
    relativePath: string,
): string {
    const bundleIndexMatch =
        /^assets\/([^/]+)\/index\.js$/i.exec(
            relativePath,
        );

    const bundleName =
        bundleIndexMatch?.[1];

    if (bundleName) {
        return (
            'virtual:///prerequisite-imports/'
            + bundleName
        );
    }

    return VIRTUAL_ORIGIN + relativePath;
}

const RUNTIME_FILES = [
    'src/polyfills.bundle.js',
    'src/system.bundle.js',
];

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function isExternalUrl(value: string): boolean {
    const lower = value.toLowerCase();

    return (
        lower.startsWith('http://')
        || lower.startsWith('https://')
        || lower.startsWith('//')
        || lower.startsWith('data:')
        || lower.startsWith('blob:')
    );
}

function getMimeType(filePath: string, buffer?: Uint8Array): string {
    const detectedImageType = buffer === undefined ? null : detectImageMimeType(buffer);
    if (detectedImageType !== null) {
        return detectedImageType;
    }
    const extension =
        path.extname(filePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',

        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',

        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',

        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',

        '.wasm': 'application/wasm',
        '.bin': 'application/octet-stream',
        '.cconb': 'application/octet-stream',
        '.pvr': 'application/octet-stream',
        '.pkm': 'application/octet-stream',
        '.astc': 'application/octet-stream',
    };

    return (
        mimeTypes[extension]
        ?? 'application/octet-stream'
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)
        } MB`;
}

async function walkDirectory(
    root: string,
    current: string,
    output: string[],
): Promise<void> {
    const entries = await readdir(current, {
        withFileTypes: true,
    });

    for (const entry of entries) {
        const absolutePath = path.join(
            current,
            entry.name,
        );

        if (entry.isDirectory()) {
            await walkDirectory(
                root,
                absolutePath,
                output,
            );

            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        output.push(
            normalizePath(
                path.relative(
                    root,
                    absolutePath,
                ),
            ),
        );
    }
}

function isSystemRegisterCall(
    node: any,
): boolean {
    const callee = node?.callee;

    return (
        node?.type === 'CallExpression'
        && callee?.type === 'MemberExpression'
        && callee.computed === false
        && callee.object?.type === 'Identifier'
        && callee.object.name === 'System'
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'register'
    );
}

function isStaticStringNode(
    node: any,
): boolean {
    return (
        node?.type === 'Literal'
        && typeof node.value === 'string'
    );
}

interface SourceEdit {
    start: number;
    end: number;
    text: string;
}

/**
 * 为匿名 System.register 添加模块 ID。
 *
 * Cocos 的 Bundle index.js 比较特殊：
 *
 * System.register(
 *     ['./SomeScript.ts'],
 *     function (...) {}
 * );
 *
 * 同一个文件内实际已经注册了：
 *
 * System.register(
 *     'chunks:///_virtual/SomeScript.ts',
 *     ...
 * );
 *
 * 因此在给匿名入口命名时，还需要把它的相对依赖
 * 重写到 chunks:///_virtual/ 命名空间。
 */
interface SourceEdit {
    start: number;
    end: number;
    text: string;
}

function getStaticStringValue(
    node: any,
): string | null {
    if (
        node?.type === 'Literal'
        && typeof node.value === 'string'
    ) {
        return node.value;
    }

    if (
        node?.type === 'TemplateLiteral'
        && node.expressions?.length === 0
        && node.quasis?.length === 1
    ) {
        return (
            node.quasis[0]?.value?.cooked
            ?? node.quasis[0]?.value?.raw
            ?? null
        );
    }

    return null;
}

function nameAnonymousSystemRegister(
    source: string,
    moduleId: string,
): TransformResult {
    type SourceEdit = {
        start: number;
        end: number;
        text: string;
    };

    function isSystemRegisterCall(
        node: any,
    ): boolean {
        const callee = node?.callee;

        return (
            node?.type === 'CallExpression'
            && callee?.type
            === 'MemberExpression'
            && callee.computed === false
            && callee.object?.type
            === 'Identifier'
            && callee.object.name === 'System'
            && callee.property?.type
            === 'Identifier'
            && callee.property.name === 'register'
        );
    }

    function getStaticModuleName(
        node: any,
    ): string | null {
        if (
            node?.type === 'Literal'
            && typeof node.value === 'string'
        ) {
            return node.value;
        }

        if (
            node?.type === 'TemplateLiteral'
            && node.expressions?.length === 0
            && node.quasis?.length === 1
        ) {
            return (
                node.quasis[0]?.value?.cooked
                ?? node.quasis[0]?.value?.raw
                ?? null
            );
        }

        return null;
    }

    const ast = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
    });

    const registerCalls: any[] = [];

    walk.simple(
        ast,
        {
            CallExpression(node: any): void {
                if (
                    isSystemRegisterCall(node)
                ) {
                    registerCalls.push(node);
                }
            },
        } as any,
    );

    const edits: SourceEdit[] = [];

    let registerCount = 0;
    let anonymousRegisterCount = 0;
    let namedRegisterCount = 0;

    for (const call of registerCalls) {
        registerCount += 1;

        const argumentsList: any[] =
            call.arguments ?? [];

        const firstArgument =
            argumentsList[0];

        const staticModuleName =
            getStaticModuleName(
                firstArgument,
            );

        /*
         * 情况一：第一个参数是字符串。
         *
         * System.register(
         *     "chunks:///_virtual/xxx",
         *     dependencies,
         *     declaration
         * );
         *
         * 这是已经命名的模块，保持原样。
         */
        if (staticModuleName !== null) {
            namedRegisterCount += 1;
            continue;
        }

        /*
         * 情况二：三个参数。
         *
         * System.register(
         *     moduleNameVariable,
         *     dependencies,
         *     declaration
         * );
         *
         * Cocos Creator 的 Bundle 入口会使用这种形式，
         * 模块名称被保存在 Identifier 变量中。
         *
         * 它依然是已经命名的模块，绝对不能再插入
         * 一个新的 moduleId，否则会变成四个参数。
         */
        if (argumentsList.length === 3) {
            namedRegisterCount += 1;
            continue;
        }

        /*
         * 情况三：两个参数。
         *
         * System.register(
         *     dependencies,
         *     declaration
         * );
         *
         * 这是标准匿名模块，转换为：
         *
         * System.register(
         *     "moduleId",
         *     dependencies,
         *     declaration
         * );
         */
        if (argumentsList.length === 2) {
            if (
                typeof firstArgument?.start
                !== 'number'
            ) {
                throw new Error(
                    '无法定位匿名 System.register '
                    + `的依赖参数：${moduleId}`,
                );
            }

            edits.push({
                start: firstArgument.start,
                end: firstArgument.start,
                text:
                    `${JSON.stringify(moduleId)},`,
            });

            anonymousRegisterCount += 1;
            continue;
        }

        /*
         * 情况四：一个参数。
         *
         * System.register(
         *     declaration
         * );
         *
         * 转换为：
         *
         * System.register(
         *     "moduleId",
         *     [],
         *     declaration
         * );
         */
        if (argumentsList.length === 1) {
            if (
                typeof firstArgument?.start
                !== 'number'
            ) {
                throw new Error(
                    '无法定位匿名 System.register '
                    + `的声明参数：${moduleId}`,
                );
            }

            edits.push({
                start: firstArgument.start,
                end: firstArgument.start,
                text:
                    `${JSON.stringify(moduleId)},[],`,
            });

            anonymousRegisterCount += 1;
            continue;
        }

        throw new Error(
            '无法识别 System.register 调用：'
            + `${moduleId}，参数数量为 `
            + argumentsList.length,
        );
    }

    /*
     * 一个物理 JS 文件正常情况下最多只有一个
     * 匿名入口模块。
     *
     * 文件内其他模块通常已经使用
     * chunks:///_virtual/... 命名。
     */
    if (anonymousRegisterCount > 1) {
        throw new Error(
            `${moduleId} 包含 `
            + `${anonymousRegisterCount} 个匿名 `
            + 'System.register，不能安全地使用'
            + '同一个模块 ID 命名。',
        );
    }

    /*
     * 从源码末尾向前修改，避免较早的插入操作
     * 改变后续 AST 节点的字符位置。
     */
    edits.sort(
        (a, b) => b.start - a.start,
    );

    let transformedSource = source;

    for (const edit of edits) {
        transformedSource =
            transformedSource.slice(
                0,
                edit.start,
            )
            + edit.text
            + transformedSource.slice(
                edit.end,
            );
    }

    return {
        source: transformedSource,
        registerCount,
        anonymousRegisterCount,
        namedRegisterCount,
    };
}

function resolveImportMapTarget(
    importMapPath: string,
    target: string,
): string {
    if (isExternalUrl(target)) {
        return target;
    }

    const directory =
        path.posix.dirname(importMapPath);

    const resolved = normalizePath(
        path.posix.normalize(
            path.posix.join(
                directory,
                target,
            ),
        ),
    ).replace(/^\/+/, '');

    return VIRTUAL_ORIGIN + resolved;
}

function transformImportMap(
    importMapPath: string,
    source: string,
): BootPlan['importMap'] {
    const parsed = JSON.parse(source) as {
        imports?: Record<string, string>;
        scopes?: Record<
            string,
            Record<string, string>
        >;
    };

    const imports: Record<string, string> = {};

    for (
        const [name, target]
        of Object.entries(parsed.imports ?? {})
    ) {
        imports[name] = resolveImportMapTarget(
            importMapPath,
            target,
        );
    }

    const scopes: Record<
        string,
        Record<string, string>
    > = {};

    for (
        const [scopeName, scopeImports]
        of Object.entries(parsed.scopes ?? {})
    ) {
        const resolvedScopeName =
            resolveImportMapTarget(
                importMapPath,
                scopeName,
            );

        const resolvedScope:
            Record<string, string> = {};

        for (
            const [name, target]
            of Object.entries(scopeImports)
        ) {
            resolvedScope[name] =
                resolveImportMapTarget(
                    importMapPath,
                    target,
                );
        }

        scopes[resolvedScopeName] =
            resolvedScope;
    }

    return {
        imports,
        scopes:
            Object.keys(scopes).length > 0
                ? scopes
                : undefined,
    };
}

function rewriteCssUrls(
    cssSource: string,
    cssPath: string,
    fileBuffers: Map<string, Buffer>,
): string {
    const cssDirectory =
        path.posix.dirname(cssPath);

    return cssSource.replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (
            original,
            _quote: string,
            rawUrl: string,
        ) => {
            const value = rawUrl.trim();

            if (
                value.length === 0
                || isExternalUrl(value)
                || value.startsWith('#')
            ) {
                return original;
            }

            const cleanUrl =
                value
                    .split('?')[0]
                    ?.split('#')[0];

            if (!cleanUrl) {
                return original;
            }

            const resolvedPath = normalizePath(
                path.posix.normalize(
                    path.posix.join(
                        cssDirectory,
                        cleanUrl,
                    ),
                ),
            ).replace(/^\/+/, '');

            const buffer =
                fileBuffers.get(resolvedPath);

            if (!buffer) {
                console.warn(
                    `CSS 引用未找到：`
                    + `${cssPath} -> ${value}`,
                );

                return original;
            }

            const mime =
                getMimeType(resolvedPath, buffer);

            return (
                `url("data:${mime};base64,`
                + `${buffer.toString('base64')}")`
            );
        },
    );
}

function escapeHtmlAttribute(
    value: string,
): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderAttributes(
    attributes:
        Record<string, string> | undefined,
): string {
    if (!attributes) {
        return '';
    }

    const entries = Object.entries(attributes);

    if (entries.length === 0) {
        return '';
    }

    return ' ' + entries
        .map(
            ([name, value]) =>
                `${name}="${escapeHtmlAttribute(value)
                }"`,
        )
        .join(' ');
}

function escapeJavaScriptSource(
    source: string,
): string {
    return source
        .replace(/<\/script/gi, '<\\/script')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
function createRuntimeSource(): string {
    return String.raw`
(function () {
    'use strict';

    var FILES = window.__PACK_FILES__;
    var BOOT = window.__PACK_BOOT__;
    var BASE = BOOT.base;

    var paths = Object.keys(FILES).sort(
        function (a, b) {
            return b.length - a.length;
        }
    );

    var byteCache = Object.create(null);
    var textCache = Object.create(null);
    var blobUrlCache = Object.create(null);

    /**
     * 消除路径中的：
     *
     * .
     * ..
     * 多余斜杠
     */
    function collapsePath(value) {
        var input = String(value)
            .replace(/\\/g, '/')
            .split('?')[0]
            .split('#')[0];

        var parts = input.split('/');
        var output = [];

        for (
            var index = 0;
            index < parts.length;
            index += 1
        ) {
            var part = parts[index];

            if (
                !part
                || part === '.'
            ) {
                continue;
            }

            if (part === '..') {
                if (output.length > 0) {
                    output.pop();
                }

                continue;
            }

            output.push(part);
        }

        return output.join('/');
    }

    /**
     * 将浏览器 URL 转为 VFS 内部相对路径。
     */
    function normalizeUrl(input) {
        if (
            input === null
            || input === undefined
        ) {
            return null;
        }

        var raw;

        if (
            typeof Request !== 'undefined'
            && input instanceof Request
        ) {
            raw = input.url;
        } else if (
            typeof URL !== 'undefined'
            && input instanceof URL
        ) {
            raw = input.href;
        } else {
            raw = String(input);
        }

        if (
            raw.indexOf('data:') === 0
            || raw.indexOf('blob:') === 0
            || raw.indexOf('chunks://') === 0
            || raw.indexOf('virtual:///') === 0
        ) {
            return null;
        }

        var candidates = [];

        try {
            var parsed = new URL(
                raw,
                document.baseURI
            );

            candidates.push(
                parsed.pathname.replace(
                    /^\/+/,
                    ''
                )
            );
        } catch (_error) {
            // 不是标准 URL 时继续用原字符串。
        }

        candidates.push(raw);

        for (
            var candidateIndex = 0;
            candidateIndex < candidates.length;
            candidateIndex += 1
        ) {
            var candidate =
                candidates[candidateIndex];

            try {
                candidate =
                    decodeURIComponent(
                        candidate
                    );
            } catch (_error) {
                // 保留原字符串。
            }

            candidate =
                collapsePath(candidate);

            if (FILES[candidate]) {
                return candidate;
            }

            /*
             * 有些 Cocos URL 会在路径前面附带：
             *
             * http://127.0.0.1:8080/
             * blob origin
             * 临时目录
             *
             * 因此再尝试尾部匹配。
             */
            for (
                var pathIndex = 0;
                pathIndex < paths.length;
                pathIndex += 1
            ) {
                var knownPath =
                    paths[pathIndex];

                if (
                    candidate === knownPath
                    || candidate.endsWith(
                        '/' + knownPath
                    )
                ) {
                    return knownPath;
                }
            }
        }

        return null;
    }

    function decodeBase64(base64) {
        var binary = atob(base64);

        var bytes =
            new Uint8Array(
                binary.length
            );

        for (
            var index = 0;
            index < binary.length;
            index += 1
        ) {
            bytes[index] =
                binary.charCodeAt(index);
        }

        return bytes;
    }

    function getBytes(input) {
        var key = normalizeUrl(input);

        if (!key) {
            return null;
        }

        if (byteCache[key]) {
            return byteCache[key];
        }

        var entry = FILES[key];

        if (!entry) {
            return null;
        }

        var bytes =
            decodeBase64(entry.b);

        byteCache[key] = bytes;

        return bytes;
    }

    function getText(input) {
        var key = normalizeUrl(input);

        if (!key) {
            throw new Error(
                'VFS text not found: '
                + String(input)
            );
        }

        if (
            textCache[key] !== undefined
        ) {
            return textCache[key];
        }

        var bytes = getBytes(key);

        if (!bytes) {
            throw new Error(
                'VFS text not found: '
                + String(input)
            );
        }

        var text =
            new TextDecoder('utf-8')
                .decode(bytes);

        textCache[key] = text;

        return text;
    }

    function getBlobUrl(input) {
        var key = normalizeUrl(input);

        if (!key) {
            return null;
        }

        if (blobUrlCache[key]) {
            return blobUrlCache[key];
        }

        var entry = FILES[key];
        var bytes = getBytes(key);

        if (
            !entry
            || !bytes
        ) {
            return null;
        }

        var blob = new Blob(
            [bytes],
            {
                type:
                    entry.m
                    || 'application/octet-stream',
            }
        );

        var url =
            URL.createObjectURL(blob);

        blobUrlCache[key] = url;

        return url;
    }

    function has(input) {
        return normalizeUrl(input) !== null;
    }

    window.__packVfs = {
        normalize: normalizeUrl,
        has: has,
        bytes: getBytes,
        text: getText,
        blobUrl: getBlobUrl,
    };

    /**
     * 将 CSS 中的本地资源 URL 替换为 Blob URL。
     *
     * 主要处理：
     *
     * @font-face {
     *     src: url("assets/.../font.ttf");
     * }
     */
    function rewriteCssResourceUrls(value) {
        if (typeof value !== 'string') {
            return value;
        }

        return value.replace(
            /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
            function (
                original,
                _quote,
                rawUrl
            ) {
                var resourceUrl =
                    String(rawUrl).trim();

                if (
                    !resourceUrl
                    || resourceUrl.indexOf(
                        'data:'
                    ) === 0
                    || resourceUrl.indexOf(
                        'blob:'
                    ) === 0
                    || resourceUrl.indexOf(
                        '#'
                    ) === 0
                ) {
                    return original;
                }

                var mappedUrl =
                    getBlobUrl(resourceUrl);

                if (!mappedUrl) {
                    return original;
                }

                return (
                    'url("'
                    + mappedUrl
                    + '")'
                );
            }
        );
    }

    /**
     * 拦截 fetch。
     */
    var nativeFetch =
        window.fetch
            ? window.fetch.bind(window)
            : null;

    window.fetch = function (
        input,
        init
    ) {
        var key = normalizeUrl(input);

        if (!key) {
            if (!nativeFetch) {
                return Promise.reject(
                    new Error(
                        'fetch is not supported: '
                        + String(input)
                    )
                );
            }

            return nativeFetch(
                input,
                init
            );
        }

        var entry = FILES[key];
        var bytes = getBytes(key);

        if (
            !entry
            || !bytes
        ) {
            return Promise.resolve(
                new Response(
                    null,
                    {
                        status: 404,
                        statusText:
                            'Not Found',
                    }
                )
            );
        }

        return Promise.resolve(
            new Response(
                bytes,
                {
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        'Content-Type':
                            entry.m
                            || 'application/octet-stream',

                        'Content-Length':
                            String(
                                bytes.byteLength
                            ),
                    },
                }
            )
        );
    };

    /**
     * 拦截 XMLHttpRequest。
     */
    var NativeXMLHttpRequest =
        window.XMLHttpRequest;

    function dispatchHandler(
        target,
        type,
        event
    ) {
        var handler =
            target['on' + type];

        if (
            typeof handler
            === 'function'
        ) {
            handler.call(
                target,
                event
            );
        }

        target.dispatchEvent(event);
    }

    class PackXMLHttpRequest
        extends EventTarget {
        constructor() {
            super();

            this._native = null;
            this._url = '';
            this._method = 'GET';
            this._async = true;

            this._readyState = 0;
            this._status = 0;
            this._statusText = '';

            this._response = null;
            this._responseText = '';
            this._responseXML = null;
            this._responseURL = '';
            this._responseType = '';

            this._timeout = 0;
            this._withCredentials = false;

            this.upload =
                new EventTarget();

            this.onreadystatechange = null;
            this.onloadstart = null;
            this.onprogress = null;
            this.onabort = null;
            this.onerror = null;
            this.onload = null;
            this.ontimeout = null;
            this.onloadend = null;
        }

        get readyState() {
            return this._native
                ? this._native.readyState
                : this._readyState;
        }

        get status() {
            return this._native
                ? this._native.status
                : this._status;
        }

        get statusText() {
            return this._native
                ? this._native.statusText
                : this._statusText;
        }

        get response() {
            return this._native
                ? this._native.response
                : this._response;
        }

        get responseText() {
            return this._native
                ? this._native.responseText
                : this._responseText;
        }

        get responseXML() {
            return this._native
                ? this._native.responseXML
                : this._responseXML;
        }

        get responseURL() {
            return this._native
                ? this._native.responseURL
                : this._responseURL;
        }

        get responseType() {
            return this._native
                ? this._native.responseType
                : this._responseType;
        }

        set responseType(value) {
            this._responseType = value;

            if (this._native) {
                this._native.responseType =
                    value;
            }
        }

        get timeout() {
            return this._native
                ? this._native.timeout
                : this._timeout;
        }

        set timeout(value) {
            this._timeout = value;

            if (this._native) {
                this._native.timeout =
                    value;
            }
        }

        get withCredentials() {
            return this._native
                ? this._native.withCredentials
                : this._withCredentials;
        }

        set withCredentials(value) {
            this._withCredentials =
                value;

            if (this._native) {
                this._native
                    .withCredentials =
                    value;
            }
        }

        open(
            method,
            url,
            async,
            user,
            password
        ) {
            this._method = method;
            this._url = String(url);
            this._async =
                async !== false;

            var key =
                normalizeUrl(
                    this._url
                );

            if (key) {
                this._readyState = 1;

                dispatchHandler(
                    this,
                    'readystatechange',
                    new Event(
                        'readystatechange'
                    )
                );

                return;
            }

            this._native =
                new NativeXMLHttpRequest();

            this._native.timeout =
                this._timeout;

            this._native.withCredentials =
                this._withCredentials;

            this._native.responseType =
                this._responseType;

            var eventNames = [
                'readystatechange',
                'loadstart',
                'progress',
                'abort',
                'error',
                'load',
                'timeout',
                'loadend',
            ];

            for (
                var index = 0;
                index < eventNames.length;
                index += 1
            ) {
                var eventName =
                    eventNames[index];

                this._native
                    .addEventListener(
                        eventName,
                        function (event) {
                            dispatchHandler(
                                this,
                                event.type,
                                event
                            );
                        }.bind(this)
                    );
            }

            this._native.open(
                method,
                url,
                async,
                user,
                password
            );
        }

        send(body) {
            if (this._native) {
                this._native.send(body);
                return;
            }

            var execute =
                function () {
                    var key =
                        normalizeUrl(
                            this._url
                        );

                    var entry =
                        key
                            ? FILES[key]
                            : null;

                    var bytes =
                        key
                            ? getBytes(key)
                            : null;

                    if (
                        !entry
                        || !bytes
                    ) {
                        this._status = 404;
                        this._statusText =
                            'Not Found';

                        this._readyState = 4;

                        dispatchHandler(
                            this,
                            'readystatechange',
                            new Event(
                                'readystatechange'
                            )
                        );

                        dispatchHandler(
                            this,
                            'error',
                            new Event(
                                'error'
                            )
                        );

                        dispatchHandler(
                            this,
                            'loadend',
                            new Event(
                                'loadend'
                            )
                        );

                        return;
                    }

                    dispatchHandler(
                        this,
                        'loadstart',
                        new Event(
                            'loadstart'
                        )
                    );

                    this._readyState = 2;
                    this._status = 200;
                    this._statusText = 'OK';
                    this._responseURL =
                        BASE + key;

                    dispatchHandler(
                        this,
                        'readystatechange',
                        new Event(
                            'readystatechange'
                        )
                    );

                    this._readyState = 3;

                    dispatchHandler(
                        this,
                        'readystatechange',
                        new Event(
                            'readystatechange'
                        )
                    );

                    var buffer =
                        bytes.buffer.slice(
                            bytes.byteOffset,
                            bytes.byteOffset
                                + bytes.byteLength
                        );

                    var text = null;

                    switch (
                        this._responseType
                    ) {
                        case 'arraybuffer':
                            this._response =
                                buffer;
                            break;

                        case 'blob':
                            this._response =
                                new Blob(
                                    [bytes],
                                    {
                                        type:
                                            entry.m,
                                    }
                                );
                            break;

                        case 'json':
                            text =
                                new TextDecoder(
                                    'utf-8'
                                ).decode(
                                    bytes
                                );

                            this._response =
                                JSON.parse(
                                    text
                                );
                            break;

                        case 'document':
                            text =
                                new TextDecoder(
                                    'utf-8'
                                ).decode(
                                    bytes
                                );

                            this._responseXML =
                                new DOMParser()
                                    .parseFromString(
                                        text,
                                        entry.m
                                            || 'text/xml'
                                    );

                            this._response =
                                this
                                    ._responseXML;
                            break;

                        default:
                            text =
                                new TextDecoder(
                                    'utf-8'
                                ).decode(
                                    bytes
                                );

                            this._responseText =
                                text;

                            this._response =
                                text;
                            break;
                    }

                    this._readyState = 4;

                    dispatchHandler(
                        this,
                        'readystatechange',
                        new Event(
                            'readystatechange'
                        )
                    );

                    if (
                        typeof ProgressEvent
                        !== 'undefined'
                    ) {
                        dispatchHandler(
                            this,
                            'progress',
                            new ProgressEvent(
                                'progress',
                                {
                                    lengthComputable:
                                        true,

                                    loaded:
                                        bytes
                                            .byteLength,

                                    total:
                                        bytes
                                            .byteLength,
                                }
                            )
                        );
                    }

                    dispatchHandler(
                        this,
                        'load',
                        new Event('load')
                    );

                    dispatchHandler(
                        this,
                        'loadend',
                        new Event(
                            'loadend'
                        )
                    );
                }.bind(this);

            if (this._async) {
                setTimeout(
                    execute,
                    0
                );
            } else {
                execute();
            }
        }

        abort() {
            if (this._native) {
                this._native.abort();
                return;
            }

            this._readyState = 0;

            dispatchHandler(
                this,
                'abort',
                new Event('abort')
            );

            dispatchHandler(
                this,
                'loadend',
                new Event('loadend')
            );
        }

        setRequestHeader(
            name,
            value
        ) {
            if (this._native) {
                this._native
                    .setRequestHeader(
                        name,
                        value
                    );
            }
        }

        getResponseHeader(name) {
            if (this._native) {
                return this._native
                    .getResponseHeader(
                        name
                    );
            }

            var key =
                normalizeUrl(
                    this._url
                );

            var entry =
                key
                    ? FILES[key]
                    : null;

            if (!entry) {
                return null;
            }

            var lowerName =
                String(name)
                    .toLowerCase();

            if (
                lowerName
                === 'content-type'
            ) {
                return entry.m;
            }

            if (
                lowerName
                === 'content-length'
            ) {
                return String(entry.s);
            }

            return null;
        }

        getAllResponseHeaders() {
            if (this._native) {
                return this._native
                    .getAllResponseHeaders();
            }

            var key =
                normalizeUrl(
                    this._url
                );

            var entry =
                key
                    ? FILES[key]
                    : null;

            if (!entry) {
                return '';
            }

            return (
                'content-type: '
                + entry.m
                + '\r\n'
                + 'content-length: '
                + entry.s
                + '\r\n'
            );
        }

        overrideMimeType(value) {
            if (this._native) {
                this._native
                    .overrideMimeType(
                        value
                    );
            }
        }
    }

    PackXMLHttpRequest.UNSENT = 0;
    PackXMLHttpRequest.OPENED = 1;
    PackXMLHttpRequest.HEADERS_RECEIVED = 2;
    PackXMLHttpRequest.LOADING = 3;
    PackXMLHttpRequest.DONE = 4;

    window.XMLHttpRequest =
        PackXMLHttpRequest;

    /**
     * 拦截 DOM 元素的 src 属性。
     */
    function patchUrlProperty(
        prototype,
        propertyName
    ) {
        if (!prototype) {
            return;
        }

        var descriptor =
            Object.getOwnPropertyDescriptor(
                prototype,
                propertyName
            );

        if (
            !descriptor
            || typeof descriptor.set
                !== 'function'
        ) {
            return;
        }

        Object.defineProperty(
            prototype,
            propertyName,
            {
                configurable:
                    descriptor.configurable,

                enumerable:
                    descriptor.enumerable,

                get:
                    descriptor.get,

                set:
                    function (value) {
                        var mapped =
                            getBlobUrl(value);

                        descriptor.set.call(
                            this,
                            mapped || value
                        );
                    },
            }
        );
    }

    patchUrlProperty(
        window.HTMLImageElement
            && HTMLImageElement.prototype,
        'src'
    );

    patchUrlProperty(
        window.HTMLMediaElement
            && HTMLMediaElement.prototype,
        'src'
    );

    patchUrlProperty(
        window.HTMLSourceElement
            && HTMLSourceElement.prototype,
        'src'
    );

    patchUrlProperty(
        window.HTMLScriptElement
            && HTMLScriptElement.prototype,
        'src'
    );

    /**
     * 拦截动态加入的 style 标签。
     */
    function rewriteStyleElement(
        element
    ) {
        if (
            !element
            || element.nodeType !== 1
            || String(element.tagName)
                .toUpperCase()
                !== 'STYLE'
        ) {
            return;
        }

        var cssText =
            element.textContent;

        if (
            typeof cssText === 'string'
            && cssText.indexOf(
                'url('
            ) >= 0
        ) {
            element.textContent =
                rewriteCssResourceUrls(
                    cssText
                );
        }
    }

    var nativeAppendChild =
        Node.prototype.appendChild;

    Node.prototype.appendChild =
        function (child) {
            rewriteStyleElement(child);

            return nativeAppendChild.call(
                this,
                child
            );
        };

    var nativeInsertBefore =
        Node.prototype.insertBefore;

    Node.prototype.insertBefore =
        function (
            newNode,
            referenceNode
        ) {
            rewriteStyleElement(
                newNode
            );

            return nativeInsertBefore.call(
                this,
                newNode,
                referenceNode
            );
        };

    /**
     * 拦截：
     *
     * styleSheet.insertRule(...)
     */
    if (
        window.CSSStyleSheet
        && CSSStyleSheet.prototype
            .insertRule
    ) {
        var nativeInsertRule =
            CSSStyleSheet.prototype
                .insertRule;

        CSSStyleSheet.prototype
            .insertRule =
            function (
                rule,
                index
            ) {
                var rewrittenRule =
                    rewriteCssResourceUrls(
                        String(rule)
                    );

                if (
                    index === undefined
                ) {
                    return nativeInsertRule.call(
                        this,
                        rewrittenRule
                    );
                }

                return nativeInsertRule.call(
                    this,
                    rewrittenRule,
                    index
                );
            };
    }

    /**
     * 拦截：
     *
     * style.setProperty(
     *     "src",
     *     "url(...)"
     * );
     */
    if (
        window.CSSStyleDeclaration
        && CSSStyleDeclaration
            .prototype
            .setProperty
    ) {
        var nativeSetProperty =
            CSSStyleDeclaration
                .prototype
                .setProperty;

        CSSStyleDeclaration
            .prototype
            .setProperty =
            function (
                propertyName,
                value,
                priority
            ) {
                var nextValue =
                    typeof value === 'string'
                        ? rewriteCssResourceUrls(
                            value
                        )
                        : value;

                return nativeSetProperty.call(
                    this,
                    propertyName,
                    nextValue,
                    priority
                );
            };
    }

    /**
     * 拦截 FontFace。
     */
    if (window.FontFace) {
        var NativeFontFace =
            window.FontFace;

        window.FontFace = function (
            family,
            source,
            descriptors
        ) {
            var transformedSource =
                source;

            if (
                typeof source
                === 'string'
            ) {
                transformedSource =
                    rewriteCssResourceUrls(
                        source
                    );
            }

            return new NativeFontFace(
                family,
                transformedSource,
                descriptors
            );
        };

        window.FontFace.prototype =
            NativeFontFace.prototype;
    }

    /**
     * 浏览器要求用户交互后才能启动 AudioContext。
     *
     * 首次点击或触摸时尝试恢复。
     */
    function resumeAudioContexts() {
        var context =
            window.__audioContext
            || window.audioContext;

        if (
            context
            && typeof context.resume
                === 'function'
            && context.state
                === 'suspended'
        ) {
            context.resume().catch(
                function () {}
            );
        }

        /*
         * Cocos 通常会自行监听用户输入恢复音频。
         * 这里额外尝试恢复页面上可访问到的音频元素。
         */
        var mediaElements =
            document.querySelectorAll(
                'audio,video'
            );

        for (
            var index = 0;
            index < mediaElements.length;
            index += 1
        ) {
            var media =
                mediaElements[index];

            if (
                media
                && media.paused
                && media.autoplay
                && typeof media.play
                    === 'function'
            ) {
                media.play().catch(
                    function () {}
                );
            }
        }
    }

    var unlockEvents = [
        'pointerdown',
        'touchstart',
        'mousedown',
        'keydown',
    ];

    function unlockAudioOnce() {
        resumeAudioContexts();

        for (
            var index = 0;
            index < unlockEvents.length;
            index += 1
        ) {
            window.removeEventListener(
                unlockEvents[index],
                unlockAudioOnce,
                true
            );
        }
    }

    for (
        var unlockIndex = 0;
        unlockIndex
            < unlockEvents.length;
        unlockIndex += 1
    ) {
        window.addEventListener(
            unlockEvents[unlockIndex],
            unlockAudioOnce,
            true
        );
    }

    /**
     * 本地预览用渠道桩。
     */
    if (
        !window.ALPlayableAnalytics
    ) {
        window.ALPlayableAnalytics = {
            trackEvent:
                function (name) {
                    console.log(
                        '[PlayableAnalytics]',
                        name
                    );
                },
        };
    }

    if (!window.mraid) {
        var mraidListeners =
            Object.create(null);

        window.mraid = {
            getState:
                function () {
                    return 'default';
                },

            getVersion:
                function () {
                    return 'preview';
                },

            isViewable:
                function () {
                    return true;
                },

            getScreenSize:
                function () {
                    return {
                        width:
                            window
                                .innerWidth,

                        height:
                            window
                                .innerHeight,
                    };
                },

            getMaxSize:
                function () {
                    return {
                        width:
                            window
                                .innerWidth,

                        height:
                            window
                                .innerHeight,
                    };
                },

            addEventListener:
                function (
                    name,
                    callback
                ) {
                    mraidListeners[name] =
                        callback;
                },

            removeEventListener:
                function (name) {
                    delete mraidListeners[
                        name
                    ];
                },

            open:
                function (url) {
                    window.open(
                        url,
                        '_blank'
                    );
                },
        };
    }

    if (!window.xsd_playable) {
        window.xsd_playable = {
            adapter:
                function () {},

            download:
                function () {},

            mraidOpen:
                function () {},

            gameReady:
                function () {},

            gameEnd:
                function () {},

            onInteracted:
                function () {},

            playableSDKsendEvent:
                function () {},
        };
    }

    /**
     * 在全局作用域执行 JS 文件。
     */
    function evaluateFile(filePath) {
        var source =
            getText(filePath);

        (0, eval)(
            source
            + '\n//# sourceURL='
            + BASE
            + filePath
        );
    }

    async function boot() {
        /*
         * 原始执行顺序：
         *
         * polyfills
         * system.bundle
         */
        for (
            var runtimeIndex = 0;
            runtimeIndex
                < BOOT.runtime.length;
            runtimeIndex += 1
        ) {
            evaluateFile(
                BOOT.runtime[
                    runtimeIndex
                ]
            );
        }

        if (!window.System) {
            throw new Error(
                'SystemJS 初始化失败。'
            );
        }

        /*
         * 安装 Import Map。
         */
        if (
            typeof System.addImportMap
            === 'function'
        ) {
            System.addImportMap(
                BOOT.importMap
            );
        } else {
            var importMapElement =
                document.createElement(
                    'script'
                );

            importMapElement.type =
                'systemjs-importmap';

            importMapElement
                .textContent =
                JSON.stringify(
                    BOOT.importMap
                );

            document.head.appendChild(
                importMapElement
            );
        }

        /*
         * 执行全部 System.register 文件。
         *
         * 这里只注册模块，不立即执行模块主体。
         */
        for (
            var moduleIndex = 0;
            moduleIndex
                < BOOT.modules.length;
            moduleIndex += 1
        ) {
            evaluateFile(
                BOOT.modules[
                    moduleIndex
                ]
            );
        }

        /*
         * 让 SystemJS named-register 的清理微任务
         * 先执行完毕。
         */
        await Promise.resolve();

        /*
         * 导入 Cocos 启动入口。
         */
        await System.import(
            BOOT.entry
        );
    }

    boot().catch(
        function (error) {
            console.error(
                '[Playable Packer] 启动失败：',
                error
            );

            var errorElement =
                document.createElement(
                    'pre'
                );

            errorElement.style.position =
                'fixed';

            errorElement.style.left =
                '0';

            errorElement.style.top =
                '0';

            errorElement.style.right =
                '0';

            errorElement.style.zIndex =
                '999999';

            errorElement.style.margin =
                '0';

            errorElement.style.padding =
                '12px';

            errorElement.style.background =
                '#300';

            errorElement.style.color =
                '#fff';

            errorElement.style.whiteSpace =
                'pre-wrap';

            errorElement.textContent =
                'Playable 启动失败\n\n'
                + (
                    error
                    && error.stack
                        ? error.stack
                        : String(error)
                );

            document.body.appendChild(
                errorElement
            );
        }
    );
})();
`;
}

async function main(): Promise<void> {
    const inputDirectory =
        process.argv[2] ?? './web-mobile';

    const outputFile =
        process.argv[3]
        ?? './dist/game-uncompressed.html';

    const root =
        path.resolve(inputDirectory);

    const absoluteOutputPath =
        path.resolve(outputFile);

    const filePaths: string[] = [];

    await walkDirectory(
        root,
        root,
        filePaths,
    );

    filePaths.sort();

    const fileBuffers =
        new Map<string, Buffer>();

    for (const relativePath of filePaths) {
        fileBuffers.set(
            relativePath,
            await readFile(
                path.join(
                    root,
                    relativePath,
                ),
            ),
        );
    }

    const indexBuffer =
        fileBuffers.get('index.html');

    if (!indexBuffer) {
        throw new Error(
            `没有找到 index.html：${root}`,
        );
    }

    const importMapBuffer =
        fileBuffers.get(
            'src/import-map.json',
        );

    if (!importMapBuffer) {
        throw new Error(
            '没有找到 src/import-map.json',
        );
    }

    const importMap =
        transformImportMap(
            'src/import-map.json',
            importMapBuffer.toString('utf8'),
        );

    const packedFiles:
        Record<string, PackedFile> = {};

    const moduleFiles: string[] = [];
    const plainScriptFiles: string[] = [];

    let totalRawBytes = 0;
    let anonymousModuleCount = 0;

    const prerequisiteModuleIds:
        string[] = [];

    for (const relativePath of filePaths) {
        if (
            relativePath === 'index.html'
            || relativePath === 'style.css'
        ) {
            continue;
        }

        const originalBuffer =
            fileBuffers.get(relativePath);

        if (!originalBuffer) {
            continue;
        }

        let outputBuffer =
            originalBuffer;

        const extension =
            path.extname(relativePath)
                .toLowerCase();

        if (
            extension === '.js'
            || extension === '.mjs'
        ) {
            const isRuntime =
                RUNTIME_FILES.includes(
                    relativePath,
                );

            if (!isRuntime) {
                // const moduleId =
                //     VIRTUAL_ORIGIN
                //     + relativePath;
                const moduleId =
                    getAnonymousModuleId(
                        relativePath,
                    );

                if (
                    moduleId.startsWith(
                        'virtual:///prerequisite-imports/',
                    )
                ) {
                    prerequisiteModuleIds.push(
                        moduleId,
                    );
                }

                const result =
                    nameAnonymousSystemRegister(
                        originalBuffer.toString(
                            'utf8',
                        ),
                        moduleId,
                    );

                outputBuffer = Buffer.from(
                    result.source,
                    'utf8',
                );

                if (result.registerCount > 0) {
                    moduleFiles.push(
                        relativePath,
                    );

                    anonymousModuleCount +=
                        result
                            .anonymousRegisterCount;
                } else {
                    plainScriptFiles.push(
                        relativePath,
                    );
                }
            }
        }

        packedFiles[relativePath] = {
            m: getMimeType(relativePath, outputBuffer),
            b: outputBuffer.toString(
                'base64',
            ),
            s: outputBuffer.byteLength,
        };

        totalRawBytes +=
            outputBuffer.byteLength;
    }

    const styleBuffer =
        fileBuffers.get('style.css');

    const styleSource =
        styleBuffer
            ? rewriteCssUrls(
                styleBuffer.toString('utf8'),
                'style.css',
                fileBuffers,
            )
            : '';

    const $ = cheerio.load(
        indexBuffer.toString('utf8'),
    );

    $('script').remove();
    $('link[rel="stylesheet"]').remove();

    const htmlAttributes =
        $('html').attr();

    const bodyAttributes =
        $('body').attr();

    const preservedHead =
        $('head').html() ?? '';

    const preservedBody =
        $('body').html() ?? '';

    const bootPlan: BootPlan = {
        base: VIRTUAL_ORIGIN,

        runtime: [
            ...RUNTIME_FILES,
        ],

        modules: moduleFiles,

        plainScripts:
            plainScriptFiles,

        entry:
            VIRTUAL_ORIGIN + 'index.js',

        importMap,
    };

    const filePayload =
        escapeJavaScriptSource(
            JSON.stringify(packedFiles),
        );

    const bootPayload =
        escapeJavaScriptSource(
            JSON.stringify(bootPlan),
        );

    const runtimeSource =
        escapeJavaScriptSource(
            createRuntimeSource(),
        );

    const html = [
        '<!DOCTYPE html>',
        `<html${renderAttributes(htmlAttributes)
        }>`,
        '<head>',
        preservedHead,
        '<link rel="icon" href="data:,">',

        styleSource
            ? `<style>${styleSource.replace(
                /<\/style/gi,
                '<\\/style',
            )
            }</style>`
            : '',

        '</head>',

        `<body${renderAttributes(bodyAttributes)
        }>`,

        preservedBody,

        '<script>',
        `window.__PACK_FILES__=${filePayload};`,
        `window.__PACK_BOOT__=${bootPayload};`,
        '</script>',

        '<script>',
        runtimeSource,
        '</script>',

        '</body>',
        '</html>',
    ].join('\n');

    await mkdir(
        path.dirname(
            absoluteOutputPath,
        ),
        {
            recursive: true,
        },
    );

    await writeFile(
        absoluteOutputPath,
        html,
        'utf8',
    );

    const outputBytes =
        Buffer.byteLength(html);

    console.log('');
    console.log('未压缩单 HTML 已生成');
    console.log(`输入目录：${root}`);
    console.log(
        `输出文件：${absoluteOutputPath}`,
    );
    console.log('');
    console.log(
        `打包文件数：${Object.keys(packedFiles).length
        }`,
    );
    console.log(
        `SystemJS 模块文件：${moduleFiles.length
        }`,
    );
    console.log(
        `匿名模块命名数：${anonymousModuleCount
        }`,
    );
    console.log(
        `普通脚本文件：${plainScriptFiles.length
        }`,
    );
    console.log(
        `资源原始大小：${formatBytes(totalRawBytes)
        }`,
    );
    console.log(
        `最终 HTML：${formatBytes(outputBytes)
        }`,
    );

    console.log(
        'Cocos Bundle 前置模块：',
    );

    console.table(
        prerequisiteModuleIds.map(
            moduleId => ({
                模块ID: moduleId,
            }),
        ),
    );

    console.log('');
    console.log(
        '下一步请通过 HTTP 服务测试，'
        + '暂时不要直接双击 HTML。'
    );
}

void main().catch(error => {
    console.error('打包失败：', error);
    process.exitCode = 1;
});
