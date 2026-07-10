import {
    access,
    readFile,
    readdir,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';

type ModuleKind =
    | 'system-runtime'
    | 'system-register'
    | 'es-module'
    | 'plain-script'
    | 'parse-error';

type ParseMode =
    | 'script'
    | 'module'
    | 'failed';

interface ImportMapData {
    sourcePath: string;
    imports: Record<string, string>;
}

interface DependencyRecord {
    specifier: string;
    type:
    | 'relative'
    | 'absolute'
    | 'bare'
    | 'external';

    resolvedPath: string | null;
    exists: boolean | null;
    viaImportMap: boolean;
}

interface ModuleFeatures {
    systemRegisterCount: number;
    systemImportCount: number;
    dynamicImportCount: number;

    usesFetch: boolean;
    usesXMLHttpRequest: boolean;
    usesWorker: boolean;
    usesWebAssembly: boolean;
    usesImportScripts: boolean;

    createsScriptElement: boolean;
    createsLinkElement: boolean;
}

interface ModuleRecord {
    path: string;
    bytes: number;
    kind: ModuleKind;
    parseMode: ParseMode;

    namedModuleIds: string[];
    dependencies: DependencyRecord[];
    systemImportTargets: string[];

    features: ModuleFeatures;
    parseError?: string;
}

interface ModuleAnalysisReport {
    generatedAt: string;
    root: string;

    importMap: ImportMapData;

    totals: {
        fileCount: number;
        totalBytes: number;
        systemRuntimeCount: number;
        systemRegisterCount: number;
        esModuleCount: number;
        plainScriptCount: number;
        parseErrorCount: number;
    };

    unresolvedDependencies: Array<{
        modulePath: string;
        specifier: string;
        resolvedPath: string | null;
    }>;

    externalDependencies: Array<{
        modulePath: string;
        specifier: string;
    }>;

    modules: ModuleRecord[];
}

interface ParsedJavaScript {
    ast: any | null;
    mode: ParseMode;
    error?: string;
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function stripQueryAndHash(value: string): string {
    let result = value;

    const queryIndex = result.indexOf('?');
    if (queryIndex >= 0) {
        result = result.slice(0, queryIndex);
    }

    const hashIndex = result.indexOf('#');
    if (hashIndex >= 0) {
        result = result.slice(0, hashIndex);
    }

    return result;
}

function isExternalReference(value: string): boolean {
    const lowerValue = value.toLowerCase();

    return (
        lowerValue.startsWith('http://')
        || lowerValue.startsWith('https://')
        || lowerValue.startsWith('//')
        || lowerValue.startsWith('data:')
        || lowerValue.startsWith('blob:')
    );
}

function classifySpecifier(
    value: string,
): DependencyRecord['type'] {
    if (isExternalReference(value)) {
        return 'external';
    }

    if (
        value.startsWith('./')
        || value.startsWith('../')
    ) {
        return 'relative';
    }

    if (value.startsWith('/')) {
        return 'absolute';
    }

    return 'bare';
}

async function fileExists(
    filePath: string,
): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
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

        const extension =
            path.extname(entry.name).toLowerCase();

        if (
            extension !== '.js'
            && extension !== '.mjs'
        ) {
            continue;
        }

        output.push(
            normalizePath(
                path.relative(root, absolutePath),
            ),
        );
    }
}

function parseJavaScript(
    source: string,
): ParsedJavaScript {
    try {
        return {
            ast: parse(source, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                allowHashBang: true,
            }),
            mode: 'script',
        };
    } catch (scriptError) {
        try {
            return {
                ast: parse(source, {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    allowHashBang: true,
                }),
                mode: 'module',
            };
        } catch (moduleError) {
            const scriptMessage =
                scriptError instanceof Error
                    ? scriptError.message
                    : String(scriptError);

            const moduleMessage =
                moduleError instanceof Error
                    ? moduleError.message
                    : String(moduleError);

            return {
                ast: null,
                mode: 'failed',
                error:
                    `script: ${scriptMessage}; `
                    + `module: ${moduleMessage}`,
            };
        }
    }
}

function getStaticString(
    node: any,
): string | null {
    if (!node) {
        return null;
    }

    if (
        node.type === 'Literal'
        && typeof node.value === 'string'
    ) {
        return node.value;
    }

    if (
        node.type === 'TemplateLiteral'
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

function getStaticStringArray(
    node: any,
): string[] {
    if (
        !node
        || node.type !== 'ArrayExpression'
    ) {
        return [];
    }

    const result: string[] = [];

    for (const element of node.elements ?? []) {
        const value = getStaticString(element);

        if (value !== null) {
            result.push(value);
        }
    }

    return result;
}

function isMemberCall(
    callee: any,
    objectName: string,
    propertyName: string,
): boolean {
    return (
        callee?.type === 'MemberExpression'
        && callee.computed === false
        && callee.object?.type === 'Identifier'
        && callee.object.name === objectName
        && callee.property?.type === 'Identifier'
        && callee.property.name === propertyName
    );
}

function findImportMapTarget(
    specifier: string,
    imports: Record<string, string>,
): string | null {
    const exactTarget = imports[specifier];

    if (exactTarget !== undefined) {
        return exactTarget;
    }

    const prefixKeys = Object.keys(imports)
        .filter(key => (
            key.endsWith('/')
            && specifier.startsWith(key)
        ))
        .sort(
            (a, b) => b.length - a.length,
        );

    const matchedPrefix = prefixKeys[0];

    if (!matchedPrefix) {
        return null;
    }

    const targetPrefix =
        imports[matchedPrefix];

    if (!targetPrefix) {
        return null;
    }

    return (
        targetPrefix
        + specifier.slice(matchedPrefix.length)
    );
}

function resolveLocalTarget(
    basePath: string,
    target: string,
): string {
    const cleanTarget =
        stripQueryAndHash(target);

    if (cleanTarget.startsWith('/')) {
        return normalizePath(
            cleanTarget.replace(/^\/+/, ''),
        );
    }

    return normalizePath(
        path.posix.normalize(
            path.posix.join(
                path.posix.dirname(basePath),
                cleanTarget,
            ),
        ),
    );
}

async function resolveDependency(
    root: string,
    modulePath: string,
    specifier: string,
    importMap: ImportMapData,
): Promise<DependencyRecord> {
    const type = classifySpecifier(specifier);

    if (type === 'external') {
        return {
            specifier,
            type,
            resolvedPath: null,
            exists: null,
            viaImportMap: false,
        };
    }

    let resolvedPath: string | null = null;
    let viaImportMap = false;

    if (type === 'relative') {
        resolvedPath = resolveLocalTarget(
            modulePath,
            specifier,
        );
    } else if (type === 'absolute') {
        resolvedPath = normalizePath(
            stripQueryAndHash(specifier)
                .replace(/^\/+/, ''),
        );
    } else {
        const mappedTarget =
            findImportMapTarget(
                specifier,
                importMap.imports,
            );

        if (mappedTarget !== null) {
            viaImportMap = true;

            if (isExternalReference(mappedTarget)) {
                return {
                    specifier,
                    type: 'external',
                    resolvedPath: null,
                    exists: null,
                    viaImportMap: true,
                };
            }

            /*
             * Import Map 中的相对路径必须相对于
             * import-map.json 本身解析，而不是项目根目录。
             */
            resolvedPath = resolveLocalTarget(
                importMap.sourcePath,
                mappedTarget,
            );
        }
    }

    if (resolvedPath === null) {
        return {
            specifier,
            type,
            resolvedPath: null,
            exists: false,
            viaImportMap,
        };
    }

    return {
        specifier,
        type,
        resolvedPath,
        exists: await fileExists(
            path.resolve(root, resolvedPath),
        ),
        viaImportMap,
    };
}

async function loadImportMap(
    root: string,
): Promise<ImportMapData> {
    const sourcePath =
        'src/import-map.json';

    const absolutePath =
        path.resolve(root, sourcePath);

    const content = await readFile(
        absolutePath,
        'utf8',
    );

    const parsed = JSON.parse(content) as {
        imports?: Record<string, string>;
    };

    return {
        sourcePath,
        imports: parsed.imports ?? {},
    };
}

function isSystemRuntime(
    modulePath: string,
): boolean {
    return (
        modulePath === 'src/system.bundle.js'
        || modulePath === 'src/polyfills.bundle.js'
    );
}

async function inspectModule(
    root: string,
    modulePath: string,
    importMap: ImportMapData,
): Promise<ModuleRecord> {
    const absolutePath =
        path.resolve(root, modulePath);

    const source = await readFile(
        absolutePath,
        'utf8',
    );

    const parsed = parseJavaScript(source);

    const namedModuleIds =
        new Set<string>();

    const dependencySpecifiers =
        new Set<string>();

    const systemImportTargets =
        new Set<string>();

    let hasEsModuleSyntax = false;

    const features: ModuleFeatures = {
        systemRegisterCount: 0,
        systemImportCount: 0,
        dynamicImportCount: 0,

        usesFetch: /\bfetch\s*\(/.test(source),

        usesXMLHttpRequest:
            /\bXMLHttpRequest\b/.test(source),

        usesWorker:
            /\bnew\s+Worker\s*\(/.test(source),

        usesWebAssembly:
            /\bWebAssembly\b/.test(source),

        usesImportScripts:
            /\bimportScripts\s*\(/.test(source),

        createsScriptElement:
            /createElement\s*\(\s*["']script["']\s*\)/
                .test(source),

        createsLinkElement:
            /createElement\s*\(\s*["']link["']\s*\)/
                .test(source),
    };

    if (parsed.ast !== null) {
        walk.simple(
            parsed.ast,
            {
                CallExpression(node: any): void {
                    if (
                        isMemberCall(
                            node.callee,
                            'System',
                            'register',
                        )
                    ) {
                        features.systemRegisterCount += 1;

                        const firstArgument =
                            node.arguments?.[0];

                        const secondArgument =
                            node.arguments?.[1];

                        const namedId =
                            getStaticString(
                                firstArgument,
                            );

                        let dependencyArray: any;

                        if (
                            namedId !== null
                            && secondArgument?.type
                            === 'ArrayExpression'
                        ) {
                            namedModuleIds.add(namedId);
                            dependencyArray =
                                secondArgument;
                        } else {
                            dependencyArray =
                                firstArgument;
                        }

                        for (
                            const dependency
                            of getStaticStringArray(
                                dependencyArray,
                            )
                        ) {
                            dependencySpecifiers.add(
                                dependency,
                            );
                        }

                        return;
                    }

                    if (
                        isMemberCall(
                            node.callee,
                            'System',
                            'import',
                        )
                    ) {
                        features.systemImportCount += 1;

                        const target =
                            getStaticString(
                                node.arguments?.[0],
                            );

                        if (target !== null) {
                            systemImportTargets.add(
                                target,
                            );
                        }

                        return;
                    }

                    if (
                        node.callee?.type === 'Identifier'
                        && node.callee.name === 'fetch'
                    ) {
                        features.usesFetch = true;
                    }

                    if (
                        isMemberCall(
                            node.callee,
                            'document',
                            'createElement',
                        )
                    ) {
                        const elementType =
                            getStaticString(
                                node.arguments?.[0],
                            );

                        if (elementType === 'script') {
                            features.createsScriptElement =
                                true;
                        }

                        if (elementType === 'link') {
                            features.createsLinkElement =
                                true;
                        }
                    }
                },

                ImportDeclaration(node: any): void {
                    hasEsModuleSyntax = true;

                    const sourceValue =
                        getStaticString(node.source);

                    if (sourceValue !== null) {
                        dependencySpecifiers.add(
                            sourceValue,
                        );
                    }
                },

                ExportNamedDeclaration(node: any): void {
                    hasEsModuleSyntax = true;

                    const sourceValue =
                        getStaticString(node.source);

                    if (sourceValue !== null) {
                        dependencySpecifiers.add(
                            sourceValue,
                        );
                    }
                },

                ExportAllDeclaration(node: any): void {
                    hasEsModuleSyntax = true;

                    const sourceValue =
                        getStaticString(node.source);

                    if (sourceValue !== null) {
                        dependencySpecifiers.add(
                            sourceValue,
                        );
                    }
                },

                ImportExpression(node: any): void {
                    hasEsModuleSyntax = true;
                    features.dynamicImportCount += 1;

                    const sourceValue =
                        getStaticString(node.source);

                    if (sourceValue !== null) {
                        dependencySpecifiers.add(
                            sourceValue,
                        );
                    }
                },
            } as any,
        );
    }

    const dependencies: DependencyRecord[] = [];

    for (const specifier of dependencySpecifiers) {
        dependencies.push(
            await resolveDependency(
                root,
                modulePath,
                specifier,
                importMap,
            ),
        );
    }

    dependencies.sort(
        (a, b) =>
            a.specifier.localeCompare(b.specifier),
    );

    let kind: ModuleKind;

    if (parsed.mode === 'failed') {
        kind = 'parse-error';
    } else if (isSystemRuntime(modulePath)) {
        kind = 'system-runtime';
    } else if (
        features.systemRegisterCount > 0
    ) {
        kind = 'system-register';
    } else if (hasEsModuleSyntax) {
        kind = 'es-module';
    } else {
        kind = 'plain-script';
    }

    return {
        path: modulePath,
        bytes: Buffer.byteLength(source),
        kind,
        parseMode: parsed.mode,
        namedModuleIds: [
            ...namedModuleIds,
        ].sort(),
        dependencies,
        systemImportTargets: [
            ...systemImportTargets,
        ].sort(),
        features,
        parseError: parsed.error,
    };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(
        bytes / 1024 / 1024
    ).toFixed(2)} MB`;
}

async function main(): Promise<void> {
    const inputDirectory =
        process.argv[2] ?? './web-mobile';

    const outputFile =
        process.argv[3]
        ?? './module-report.json';

    const root =
        path.resolve(inputDirectory);

    const importMap =
        await loadImportMap(root);

    const modulePaths: string[] = [];

    await walkDirectory(
        root,
        root,
        modulePaths,
    );

    modulePaths.sort();

    const modules: ModuleRecord[] = [];

    for (const modulePath of modulePaths) {
        console.log(
            `分析模块：${modulePath}`,
        );

        modules.push(
            await inspectModule(
                root,
                modulePath,
                importMap,
            ),
        );
    }

    const unresolvedDependencies:
        ModuleAnalysisReport[
        'unresolvedDependencies'
        ] = [];

    const externalDependencies:
        ModuleAnalysisReport[
        'externalDependencies'
        ] = [];

    for (const module of modules) {
        for (const dependency of module.dependencies) {
            if (dependency.type === 'external') {
                externalDependencies.push({
                    modulePath: module.path,
                    specifier:
                        dependency.specifier,
                });

                continue;
            }

            if (dependency.exists !== true) {
                unresolvedDependencies.push({
                    modulePath: module.path,
                    specifier:
                        dependency.specifier,
                    resolvedPath:
                        dependency.resolvedPath,
                });
            }
        }
    }

    const totalBytes = modules.reduce(
        (sum, module) =>
            sum + module.bytes,
        0,
    );

    const report: ModuleAnalysisReport = {
        generatedAt:
            new Date().toISOString(),

        root,
        importMap,

        totals: {
            fileCount: modules.length,
            totalBytes,

            systemRuntimeCount:
                modules.filter(
                    item =>
                        item.kind
                        === 'system-runtime',
                ).length,

            systemRegisterCount:
                modules.filter(
                    item =>
                        item.kind
                        === 'system-register',
                ).length,

            esModuleCount:
                modules.filter(
                    item =>
                        item.kind
                        === 'es-module',
                ).length,

            plainScriptCount:
                modules.filter(
                    item =>
                        item.kind
                        === 'plain-script',
                ).length,

            parseErrorCount:
                modules.filter(
                    item =>
                        item.kind
                        === 'parse-error',
                ).length,
        },

        unresolvedDependencies,
        externalDependencies,
        modules,
    };

    await writeFile(
        path.resolve(outputFile),
        JSON.stringify(report, null, 2),
        'utf8',
    );

    console.log('');
    console.log('JavaScript 模块分析完成');
    console.log(
        `JS 文件数：${report.totals.fileCount}`,
    );
    console.log(
        `JS 总大小：${formatBytes(totalBytes)}`,
    );
    console.log('');

    console.table(
        [...modules]
            .sort(
                (a, b) => b.bytes - a.bytes,
            )
            .map(module => ({
                文件: module.path,
                类型: module.kind,
                大小: formatBytes(
                    module.bytes,
                ),
                注册数:
                    module.features
                        .systemRegisterCount,
                依赖数:
                    module.dependencies.length,
                未解析:
                    module.dependencies.filter(
                        dependency =>
                            dependency.exists
                            !== true
                            && dependency.type
                            !== 'external',
                    ).length,
            })),
    );

    if (
        unresolvedDependencies.length > 0
    ) {
        console.warn('');
        console.warn('未解析的模块依赖：');

        console.table(
            unresolvedDependencies,
        );
    }

    if (
        externalDependencies.length > 0
    ) {
        console.warn('');
        console.warn('外部模块依赖：');

        console.table(
            externalDependencies,
        );
    }

    const specialModules =
        modules.filter(module => (
            module.features.usesWorker
            || module.features.usesWebAssembly
            || module.features.usesImportScripts
            || module.features
                .createsScriptElement
            || module.features
                .dynamicImportCount > 0
        ));

    if (specialModules.length > 0) {
        console.log('');
        console.log(
            '需要特殊处理的模块：',
        );

        console.table(
            specialModules.map(module => ({
                文件: module.path,
                Worker:
                    module.features.usesWorker,
                WASM:
                    module.features
                        .usesWebAssembly,
                importScripts:
                    module.features
                        .usesImportScripts,
                动态Import:
                    module.features
                        .dynamicImportCount,
                动态脚本:
                    module.features
                        .createsScriptElement,
            })),
        );
    }

    console.log('');
    console.log(
        `报告已写入：${path.resolve(outputFile)
        }`,
    );
}

void main();