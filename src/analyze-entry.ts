import {
    access,
    readFile,
    readdir,
    stat,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

interface HtmlScriptRecord {
    order: number;
    type: string;
    src: string | null;
    async: boolean;
    defer: boolean;
    inlineBytes: number;
    preview: string;
    external: boolean;
    resolvedPath: string | null;
    exists: boolean | null;
}

interface HtmlLinkRecord {
    order: number;
    rel: string;
    href: string;
    external: boolean;
    resolvedPath: string | null;
    exists: boolean | null;
}

interface ImportMapRecord {
    sourcePath: string;
    exists: boolean;
    bytes: number;
    imports: Record<string, string>;
    scopes: Record<string, Record<string, string>>;
    resolvedImports: Array<{
        name: string;
        target: string;
        external: boolean;
        resolvedPath: string | null;
        exists: boolean | null;
    }>;
    parseError?: string;
}

interface JsonInspection {
    sourcePath: string;
    exists: boolean;
    bytes: number;
    topLevelType: string;
    topLevelKeys: string[];
    pathLikeStrings: string[];
    remoteUrls: string[];
    parseError?: string;
}

interface ApplicationInspection {
    sourcePath: string;
    exists: boolean;
    bytes: number;
    pathLikeStrings: string[];
    remoteUrls: string[];
    features: {
        usesFetch: boolean;
        usesXMLHttpRequest: boolean;
        usesSystemImport: boolean;
        createsScriptElement: boolean;
        createsLinkElement: boolean;
        usesWebAssembly: boolean;
        usesWorker: boolean;
        usesDynamicImport: boolean;
    };
}

interface LocalReferenceRecord {
    source: string;
    reference: string;
    resolvedPath: string;
    exists: boolean;
}

interface EntryReport {
    generatedAt: string;
    root: string;
    title: string;
    indexBytes: number;
    rootFiles: string[];
    bodyElementIds: string[];
    scripts: HtmlScriptRecord[];
    links: HtmlLinkRecord[];
    localReferences: LocalReferenceRecord[];
    importMap: ImportMapRecord;
    settings: JsonInspection;
    application: ApplicationInspection;
}

const PATH_LIKE_EXTENSIONS = [
    '.js',
    '.mjs',
    '.json',
    '.wasm',
    '.bin',
    '.ccon',
    '.cconb',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.mp3',
    '.ogg',
    '.wav',
    '.ttf',
    '.woff',
    '.woff2',
    '.css',
];

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function normalizeReference(value: string): string {
    let result = value.trim();

    const queryIndex = result.indexOf('?');
    if (queryIndex >= 0) {
        result = result.slice(0, queryIndex);
    }

    const hashIndex = result.indexOf('#');
    if (hashIndex >= 0) {
        result = result.slice(0, hashIndex);
    }

    while (result.startsWith('./')) {
        result = result.slice(2);
    }

    try {
        result = decodeURIComponent(result);
    } catch {
        // 非法 URI 编码时保留原字符串。
    }

    return normalizePath(result);
}

function isExternalReference(value: string): boolean {
    const lowerValue = value.trim().toLowerCase();

    return (
        lowerValue.startsWith('http://')
        || lowerValue.startsWith('https://')
        || lowerValue.startsWith('//')
        || lowerValue.startsWith('data:')
        || lowerValue.startsWith('blob:')
        || lowerValue.startsWith('javascript:')
        || lowerValue.startsWith('#')
    );
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function getFileSize(filePath: string): Promise<number> {
    try {
        const fileStat = await stat(filePath);
        return fileStat.size;
    } catch {
        return 0;
    }
}

function resolveLocalReference(
    root: string,
    reference: string,
): string {
    const normalized = normalizeReference(reference);

    return path.resolve(
        root,
        normalized,
    );
}

function makeRelativePath(
    root: string,
    absolutePath: string,
): string {
    return normalizePath(
        path.relative(root, absolutePath),
    );
}

function createPreview(content: string): string {
    return content
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function isPathLikeString(value: string): boolean {
    const normalized = value.toLowerCase();

    if (
        normalized.startsWith('assets/')
        || normalized.startsWith('./assets/')
        || normalized.startsWith('src/')
        || normalized.startsWith('./src/')
        || normalized.startsWith('cocos-js/')
        || normalized.startsWith('./cocos-js/')
    ) {
        return true;
    }

    return PATH_LIKE_EXTENSIONS.some(
        extension => normalized.includes(extension),
    );
}

function extractQuotedStrings(source: string): string[] {
    const result = new Set<string>();

    /*
     * 这里只做静态分析，不尝试完整解析 JavaScript AST。
     * 目标是找出构建脚本中明显的文件路径字符串。
     */
    const expression =
        /["'`]([^"'`\r\n]{1,400})["'`]/g;

    let match: RegExpExecArray | null;

    while ((match = expression.exec(source)) !== null) {
        const value = match[1];

        if (!value) {
            continue;
        }

        if (isPathLikeString(value)) {
            result.add(value);
        }
    }

    return [...result].sort();
}

function extractRemoteUrls(source: string): string[] {
    const result = new Set<string>();

    const expression =
        /https?:\/\/[^\s"'`<>\\)]+/g;

    let match: RegExpExecArray | null;

    while ((match = expression.exec(source)) !== null) {
        const value = match[0];

        if (value) {
            result.add(value);
        }
    }

    return [...result].sort();
}

function collectStringValues(
    value: unknown,
    output: string[],
): void {
    if (typeof value === 'string') {
        output.push(value);
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectStringValues(item, output);
        }

        return;
    }

    if (
        typeof value === 'object'
        && value !== null
    ) {
        for (const childValue of Object.values(value)) {
            collectStringValues(
                childValue,
                output,
            );
        }
    }
}

function getTopLevelType(value: unknown): string {
    if (Array.isArray(value)) {
        return 'array';
    }

    if (value === null) {
        return 'null';
    }

    return typeof value;
}

function getTopLevelKeys(value: unknown): string[] {
    if (
        typeof value !== 'object'
        || value === null
        || Array.isArray(value)
    ) {
        return [];
    }

    return Object.keys(value);
}

async function inspectJsonFile(
    root: string,
    relativePath: string,
): Promise<JsonInspection> {
    const absolutePath = path.resolve(
        root,
        relativePath,
    );

    const exists = await fileExists(
        absolutePath,
    );

    if (!exists) {
        return {
            sourcePath: normalizePath(relativePath),
            exists: false,
            bytes: 0,
            topLevelType: 'missing',
            topLevelKeys: [],
            pathLikeStrings: [],
            remoteUrls: [],
        };
    }

    const content = await readFile(
        absolutePath,
        'utf8',
    );

    try {
        const value: unknown = JSON.parse(content);
        const strings: string[] = [];

        collectStringValues(
            value,
            strings,
        );

        const pathLikeStrings = [
            ...new Set(
                strings.filter(isPathLikeString),
            ),
        ].sort();

        const remoteUrls = [
            ...new Set(
                strings.filter(isExternalReference),
            ),
        ].sort();

        return {
            sourcePath: normalizePath(relativePath),
            exists: true,
            bytes: Buffer.byteLength(content),
            topLevelType: getTopLevelType(value),
            topLevelKeys: getTopLevelKeys(value),
            pathLikeStrings,
            remoteUrls,
        };
    } catch (error) {
        return {
            sourcePath: normalizePath(relativePath),
            exists: true,
            bytes: Buffer.byteLength(content),
            topLevelType: 'invalid-json',
            topLevelKeys: [],
            pathLikeStrings: [],
            remoteUrls: extractRemoteUrls(content),
            parseError:
                error instanceof Error
                    ? error.message
                    : String(error),
        };
    }
}

async function inspectImportMap(
    root: string,
    relativePath: string,
): Promise<ImportMapRecord> {
    const absolutePath = path.resolve(
        root,
        relativePath,
    );

    const exists = await fileExists(
        absolutePath,
    );

    if (!exists) {
        return {
            sourcePath: normalizePath(relativePath),
            exists: false,
            bytes: 0,
            imports: {},
            scopes: {},
            resolvedImports: [],
        };
    }

    const content = await readFile(
        absolutePath,
        'utf8',
    );

    try {
        const parsed = JSON.parse(content) as {
            imports?: Record<string, string>;
            scopes?: Record<
                string,
                Record<string, string>
            >;
        };

        const imports = parsed.imports ?? {};
        const scopes = parsed.scopes ?? {};

        const resolvedImports = [];

        for (const [name, target] of Object.entries(imports)) {
            const external =
                isExternalReference(target);

            if (external) {
                resolvedImports.push({
                    name,
                    target,
                    external: true,
                    resolvedPath: null,
                    exists: null,
                });

                continue;
            }

            const resolvedAbsolutePath =
                resolveLocalReference(
                    root,
                    target,
                );

            resolvedImports.push({
                name,
                target,
                external: false,
                resolvedPath: makeRelativePath(
                    root,
                    resolvedAbsolutePath,
                ),
                exists: await fileExists(
                    resolvedAbsolutePath,
                ),
            });
        }

        return {
            sourcePath: normalizePath(relativePath),
            exists: true,
            bytes: Buffer.byteLength(content),
            imports,
            scopes,
            resolvedImports,
        };
    } catch (error) {
        return {
            sourcePath: normalizePath(relativePath),
            exists: true,
            bytes: Buffer.byteLength(content),
            imports: {},
            scopes: {},
            resolvedImports: [],
            parseError:
                error instanceof Error
                    ? error.message
                    : String(error),
        };
    }
}

async function inspectApplication(
    root: string,
    relativePath: string,
): Promise<ApplicationInspection> {
    const absolutePath = path.resolve(
        root,
        relativePath,
    );

    const exists = await fileExists(
        absolutePath,
    );

    if (!exists) {
        return {
            sourcePath: normalizePath(relativePath),
            exists: false,
            bytes: 0,
            pathLikeStrings: [],
            remoteUrls: [],
            features: {
                usesFetch: false,
                usesXMLHttpRequest: false,
                usesSystemImport: false,
                createsScriptElement: false,
                createsLinkElement: false,
                usesWebAssembly: false,
                usesWorker: false,
                usesDynamicImport: false,
            },
        };
    }

    const content = await readFile(
        absolutePath,
        'utf8',
    );

    return {
        sourcePath: normalizePath(relativePath),
        exists: true,
        bytes: Buffer.byteLength(content),
        pathLikeStrings:
            extractQuotedStrings(content),
        remoteUrls:
            extractRemoteUrls(content),
        features: {
            usesFetch:
                /\bfetch\s*\(/.test(content),

            usesXMLHttpRequest:
                /\bXMLHttpRequest\b/.test(content),

            usesSystemImport:
                /\bSystem\.import\s*\(/.test(content),

            createsScriptElement:
                /createElement\s*\(\s*["']script["']\s*\)/
                    .test(content),

            createsLinkElement:
                /createElement\s*\(\s*["']link["']\s*\)/
                    .test(content),

            usesWebAssembly:
                /\bWebAssembly\b/.test(content),

            usesWorker:
                /\bnew\s+Worker\s*\(/.test(content),

            usesDynamicImport:
                /\bimport\s*\(/.test(content),
        },
    };
}

async function listRootFiles(
    root: string,
): Promise<string[]> {
    const entries = await readdir(
        root,
        {
            withFileTypes: true,
        },
    );

    return entries
        .map(entry => (
            entry.isDirectory()
                ? `${entry.name}/`
                : entry.name
        ))
        .sort();
}

async function main(): Promise<void> {
    const inputDirectory =
        process.argv[2] ?? './web-mobile';

    const outputFile =
        process.argv[3] ?? './entry-report.json';

    const root = path.resolve(
        inputDirectory,
    );

    const indexPath = path.join(
        root,
        'index.html',
    );

    if (!await fileExists(indexPath)) {
        console.error(
            `没有找到 index.html：${indexPath}`,
        );

        process.exitCode = 1;
        return;
    }

    const indexHtml = await readFile(
        indexPath,
        'utf8',
    );

    const $ = cheerio.load(indexHtml);

    const scripts: HtmlScriptRecord[] = [];

    const scriptElements =
        $('script').toArray();

    for (
        let index = 0;
        index < scriptElements.length;
        index += 1
    ) {
        const element = scriptElements[index];

        if (!element) {
            continue;
        }

        const node = $(element);
        const src = node.attr('src') ?? null;
        const type =
            node.attr('type') ?? 'text/javascript';

        const inlineContent =
            src === null
                ? node.text()
                : '';

        if (
            src === null
            || isExternalReference(src)
        ) {
            scripts.push({
                order: index,
                type,
                src,
                async:
                    node.attr('async') !== undefined,
                defer:
                    node.attr('defer') !== undefined,
                inlineBytes:
                    Buffer.byteLength(
                        inlineContent,
                    ),
                preview:
                    createPreview(
                        inlineContent,
                    ),
                external:
                    src !== null
                    && isExternalReference(src),
                resolvedPath: null,
                exists: null,
            });

            continue;
        }

        const resolvedAbsolutePath =
            resolveLocalReference(
                root,
                src,
            );

        scripts.push({
            order: index,
            type,
            src,
            async:
                node.attr('async') !== undefined,
            defer:
                node.attr('defer') !== undefined,
            inlineBytes: 0,
            preview: '',
            external: false,
            resolvedPath: makeRelativePath(
                root,
                resolvedAbsolutePath,
            ),
            exists: await fileExists(
                resolvedAbsolutePath,
            ),
        });
    }

    const links: HtmlLinkRecord[] = [];
    const linkElements = $('link').toArray();

    for (
        let index = 0;
        index < linkElements.length;
        index += 1
    ) {
        const element = linkElements[index];

        if (!element) {
            continue;
        }

        const node = $(element);
        const href = node.attr('href');

        if (!href) {
            continue;
        }

        const external =
            isExternalReference(href);

        if (external) {
            links.push({
                order: index,
                rel: node.attr('rel') ?? '',
                href,
                external: true,
                resolvedPath: null,
                exists: null,
            });

            continue;
        }

        const resolvedAbsolutePath =
            resolveLocalReference(
                root,
                href,
            );

        links.push({
            order: index,
            rel: node.attr('rel') ?? '',
            href,
            external: false,
            resolvedPath: makeRelativePath(
                root,
                resolvedAbsolutePath,
            ),
            exists: await fileExists(
                resolvedAbsolutePath,
            ),
        });
    }

    const localReferences:
        LocalReferenceRecord[] = [];

    for (const script of scripts) {
        if (
            script.src
            && !script.external
            && script.resolvedPath
        ) {
            localReferences.push({
                source: 'index.html:<script>',
                reference: script.src,
                resolvedPath:
                    script.resolvedPath,
                exists:
                    script.exists === true,
            });
        }
    }

    for (const link of links) {
        if (
            !link.external
            && link.resolvedPath
        ) {
            localReferences.push({
                source: 'index.html:<link>',
                reference: link.href,
                resolvedPath:
                    link.resolvedPath,
                exists:
                    link.exists === true,
            });
        }
    }

    const importMapScript = scripts.find(
        script =>
            script.type.includes('importmap')
            && script.src,
    );

    const importMapPath =
        importMapScript?.src
            ? normalizeReference(
                importMapScript.src,
            )
            : 'src/import-map.json';

    const settingsPath =
        'src/settings.json';

    const applicationPath =
        'application.js';

    const bodyElementIds = [
        ...new Set(
            $('[id]')
                .toArray()
                .map(element =>
                    $(element).attr('id'),
                )
                .filter(
                    (value): value is string =>
                        typeof value === 'string',
                ),
        ),
    ];

    const report: EntryReport = {
        generatedAt:
            new Date().toISOString(),

        root,

        title:
            $('title').first().text().trim(),

        indexBytes:
            Buffer.byteLength(indexHtml),

        rootFiles:
            await listRootFiles(root),

        bodyElementIds,

        scripts,

        links,

        localReferences,

        importMap:
            await inspectImportMap(
                root,
                importMapPath,
            ),

        settings:
            await inspectJsonFile(
                root,
                settingsPath,
            ),

        application:
            await inspectApplication(
                root,
                applicationPath,
            ),
    };

    const absoluteOutputPath =
        path.resolve(outputFile);

    await writeFile(
        absoluteOutputPath,
        JSON.stringify(report, null, 2),
        'utf8',
    );

    console.log('');
    console.log('Cocos 启动入口分析完成');
    console.log(`构建目录：${root}`);
    console.log(`页面标题：${report.title}`);
    console.log(`脚本数量：${scripts.length}`);
    console.log(`Link 数量：${links.length}`);
    console.log('');

    console.log('index.html 脚本执行顺序：');

    console.table(
        scripts.map(script => ({
            顺序: script.order,
            类型: script.type,
            来源:
                script.src
                ?? `[内联 ${script.inlineBytes} B]`,
            外部: script.external,
            存在:
                script.exists ?? '-',
        })),
    );

    console.log('');
    console.log('Import Map：');

    console.table(
        report.importMap.resolvedImports.map(
            item => ({
                模块: item.name,
                目标: item.target,
                外部: item.external,
                存在: item.exists ?? '-',
            }),
        ),
    );

    console.log('');
    console.log('application.js 特征：');
    console.table([
        report.application.features,
    ]);

    const invalidReferences =
        localReferences.filter(
            item => !item.exists,
        );

    if (invalidReferences.length > 0) {
        console.warn('');
        console.warn(
            '发现不存在的本地引用：',
        );

        console.table(
            invalidReferences,
        );
    }

    const externalUrls = [
        ...new Set([
            ...report.settings.remoteUrls,
            ...report.application.remoteUrls,
        ]),
    ];

    if (externalUrls.length > 0) {
        console.warn('');
        console.warn(
            '发现外部 URL，最终单文件需要处理：',
        );

        console.table(
            externalUrls.map(url => ({ url })),
        );
    }

    console.log('');
    console.log(
        `报告已写入：${absoluteOutputPath}`,
    );
}

void main();