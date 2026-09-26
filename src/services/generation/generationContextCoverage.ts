import type { CompiledGenerationContext } from '../../types/generationContext';
import { computeContentSha256 } from '../../utils/contentIntegrity';

/** Preserve the existing deterministic snapshot serialization, independent of object key order. */
export function stableStringifyGenerationContext(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringifyGenerationContext).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyGenerationContext(record[key])}`)
    .join(',')}}`;
}

export interface GenerationCoreAssetsMissingError extends Error {
  code: 'GENERATION_CORE_ASSETS_MISSING';
  missingAssets: Array<'chapter_outline' | 'world_setting' | 'rule_system' | 'protagonist'>;
}

export function assertRequiredCoreAssets(context: CompiledGenerationContext['baseContext']): void {
  const missingAssets: GenerationCoreAssetsMissingError['missingAssets'] = [];
  if (!context.chapterOutline?.trim()) missingAssets.push('chapter_outline');
  if (!context.worldBackground?.trim() && !context.chapterSettings?.trim()) {
    missingAssets.push('world_setting');
  }
  if (!context.ruleSystems?.trim()) missingAssets.push('rule_system');
  if (!context.protagonist?.trim() && !context.protagonistNames?.trim()) {
    missingAssets.push('protagonist');
  }
  if (missingAssets.length === 0) return;
  const labels = missingAssets.map((asset) => {
    if (asset === 'chapter_outline') return '章节大纲';
    if (asset === 'world_setting') return '世界设定';
    if (asset === 'rule_system') return '规则体系';
    return '主角设定';
  });
  const error = new Error(
    `生成所需核心资产不完整：${labels.join('、')}。请先在作品资产中补齐后再生成。`,
  ) as GenerationCoreAssetsMissingError;
  error.code = 'GENERATION_CORE_ASSETS_MISSING';
  error.missingAssets = missingAssets;
  throw error;
}

export async function assertGenerationRuleCoverage(
  novelId: string,
  context: CompiledGenerationContext['baseContext'],
): Promise<void> {
  const projections = [
    { coverage: context.ruleSystemCoverage, text: context.ruleSystems?.trim() ?? '' },
    {
      coverage: context.worldSettingCoverage,
      text: JSON.stringify({
        worldBackground: context.worldBackground,
        chapterSettings: context.chapterSettings,
      }),
    },
  ];
  for (const { coverage, text } of projections) {
    if (
      !coverage ||
      coverage.schemaVersion !== 'generation_rule_coverage_v1' ||
      coverage.status !== 'complete' ||
      coverage.novelId !== novelId ||
      !Number.isSafeInteger(coverage.requiredCount) ||
      coverage.requiredCount < 0 ||
      coverage.requiredCount !== coverage.includedCount ||
      !Array.isArray(coverage.sourceIds) ||
      coverage.sourceIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      coverage.sourceIds.length !== coverage.includedCount ||
      new Set(coverage.sourceIds).size !== coverage.sourceIds.length ||
      (coverage.requiredCount > 0 && !text) ||
      coverage.projectionHash !== (await computeContentSha256(text))
    ) {
      throw Object.assign(
        new Error('context_incomplete：无法证明本次作用域规则与世界约束已完整投影，已停止生成。'),
        { code: 'GENERATION_CONTEXT_INCOMPLETE' },
      );
    }
  }
}
