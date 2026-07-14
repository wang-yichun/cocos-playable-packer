export type BuildArtifactExplanationConfidence = "high" | "medium" | "low";

export interface BuildArtifactExplanation {
  kind: string;
  label: string;
  explanation: string;
  confidence: BuildArtifactExplanationConfidence;
}

function normalized(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function mappedSourceExplanation(sourcePaths: readonly string[]): BuildArtifactExplanation {
  return {
    kind: "mapped-source-resource",
    label: "已关联源资源",
    explanation: `已通过 UUID 或构建路径恢复到 ${sourcePaths.length} 个工程源资源，优先从这些源资源和导入配置排查。`,
    confidence: "high",
  };
}

export function explainBuildArtifact(
  buildPath: string,
  extension: string,
  sourcePaths: readonly string[],
): BuildArtifactExplanation {
  if (sourcePaths.length > 0) return mappedSourceExplanation(sourcePaths);

  const value = normalized(buildPath);
  const ext = extension.toLowerCase();

  if (/^cocos-js\/cc(?:\.|\/|$)/.test(value)) {
    return {
      kind: "cocos-engine-runtime",
      label: "Cocos 引擎运行时",
      explanation: "这是 Cocos Creator Web 构建生成的引擎运行时代码，通常无法映射到单个 assets 源资源。体积优化应从引擎模块裁剪和构建选项入手。",
      confidence: "high",
    };
  }

  if (/^cocos-js\/bullet(?:\.|\/|$)/.test(value)) {
    return {
      kind: "bullet-physics-runtime",
      label: "Bullet 物理运行时",
      explanation: "这是 Bullet 物理引擎的生成代码或 ASM/WASM 兼容运行时，不属于单个工程资源。只有项目不需要 Bullet 功能时才可能通过物理后端选择减少。",
      confidence: "high",
    };
  }

  if (/^cocos-js\//.test(value) && [".js", ".mjs", ".cjs", ".wasm"].includes(ext)) {
    return {
      kind: "cocos-generated-runtime",
      label: "Cocos 生成运行时",
      explanation: "位于 cocos-js 目录，通常是引擎模块、物理、解码器或构建生成的运行时代码，不会对应 assets 中的单个源文件。",
      confidence: "medium",
    };
  }

  if (/^assets\/[^/]+\/index\.(?:js|mjs|cjs)$/.test(value)) {
    return {
      kind: "project-bundle-script",
      label: "项目脚本合并包",
      explanation: "这是 Cocos Bundle 的脚本入口或合并产物，通常包含多个用户脚本和模块依赖，无法一对一映射到某个 TypeScript 文件。",
      confidence: "high",
    };
  }

  if (/^src\/assets\/scripts\/libs\//.test(value) && [".js", ".mjs", ".cjs"].includes(ext)) {
    return {
      kind: "project-or-third-party-library",
      label: "用户或第三方库脚本",
      explanation: "路径位于 scripts/libs，通常是项目直接携带的第三方库或未参与常规 Bundle 合并的用户脚本。应从对应库的功能必要性和精简版本评估。",
      confidence: "medium",
    };
  }

  if (/^assets\/[^/]+\/import\/.+\.(?:json|cconb)$/.test(value)) {
    return {
      kind: "cocos-serialized-import",
      label: "Cocos 序列化导入数据",
      explanation: "这是 Cocos 构建生成的 import 数据，可能聚合场景、Prefab、材质、动画或模型元数据，因此不一定能恢复为单一源文件。不要直接编辑构建产物。",
      confidence: "high",
    };
  }

  if (/^assets\/[^/]+\/config\.json$/.test(value)) {
    return {
      kind: "bundle-config",
      label: "Bundle 配置索引",
      explanation: "这是 Cocos Bundle 的配置和 UUID 索引文件，由构建流程生成，不对应单个工程资源。体积异常时应检查 Bundle 内资源数量和序列化配置。",
      confidence: "high",
    };
  }

  if (/^assets\/[^/]+\/native\/[0-9a-f]{2}\/[0-9a-f]{8,}\.(?:png|jpe?g|webp)$/.test(value)) {
    return {
      kind: "generated-texture-or-atlas",
      label: "生成纹理或图集页",
      explanation: "该短哈希纹理没有精确 UUID 映射，经验上通常是自动图集页、合并纹理或构建生成图片。应结合同 Bundle 中未独立输出的源图片和 Auto Atlas 配置判断。",
      confidence: "medium",
    };
  }

  if (ext === ".wasm") {
    return {
      kind: "wasm-runtime",
      label: "WASM 运行模块",
      explanation: "这是 WebAssembly 运行模块，常见于物理、解码或高性能库，不对应单个 assets 资源。是否可裁剪取决于实际功能依赖。",
      confidence: "medium",
    };
  }

  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    return {
      kind: "unmapped-script-bundle",
      label: "未映射脚本产物",
      explanation: "这是构建后的脚本文件，可能包含用户代码、第三方库或生成运行时。仅凭路径无法可靠拆分到具体源脚本，需要结合 Source Map 或构建模块清单进一步确认。",
      confidence: "low",
    };
  }

  if (ext === ".json" && value.startsWith("assets/")) {
    return {
      kind: "unmapped-cocos-json",
      label: "未映射 Cocos 数据",
      explanation: "该 JSON 位于构建 assets 目录，通常属于序列化资源或 Bundle 数据；缺少直接 UUID 证据时不能安全归到单个源资源。",
      confidence: "medium",
    };
  }

  return {
    kind: "unknown-build-artifact",
    label: "未知构建产物",
    explanation: "当前只有构建路径和文件类型，证据不足，无法可靠判断具体来源。建议结合构建配置、文件头、Source Map 或运行时引用继续定位。",
    confidence: "low",
  };
}
