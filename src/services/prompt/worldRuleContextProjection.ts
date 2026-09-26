import type { RuleSystem, WorldSetting } from '../../types/setting';
import type { GenerationRuleCoverage } from '../../types/generationContext';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { formatWorldRuleMetadata } from '../worldRules/worldRuleFormatting';

function extractText(summary: string | undefined | null): string | undefined {
  return summary?.trim() || undefined;
}

function parseTimestamp(value?: string): number {
  if (!value) return NaN;
  const normalized = value.replace(/\.(\d{3})\d+/, '.$1');
  return Date.parse(normalized);
}

type WorldSettingSelectionCandidate = Pick<WorldSetting, 'content' | 'isActive'> &
  Partial<Pick<WorldSetting, 'id' | 'createdAt' | 'updatedAt'>>;

function worldSettingRecency(setting: WorldSettingSelectionCandidate): [number, number] {
  const updatedAt = parseTimestamp(setting.updatedAt);
  const createdAt = parseTimestamp(setting.createdAt);
  return [
    Number.isFinite(updatedAt) ? updatedAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY,
  ];
}

export function selectPrimaryWorldSettingForWriter<T extends WorldSettingSelectionCandidate>(
  worldSettings: readonly T[],
): T | undefined {
  return worldSettings
    .filter((setting) => setting.isActive && extractText(setting.content))
    .reduce<T | undefined>((selected, candidate) => {
      if (!selected) return candidate;
      const [candidateUpdatedAt, candidateCreatedAt] = worldSettingRecency(candidate);
      const [selectedUpdatedAt, selectedCreatedAt] = worldSettingRecency(selected);
      if (candidateUpdatedAt !== selectedUpdatedAt) {
        return candidateUpdatedAt > selectedUpdatedAt ? candidate : selected;
      }
      if (candidateCreatedAt !== selectedCreatedAt) {
        return candidateCreatedAt > selectedCreatedAt ? candidate : selected;
      }
      return candidate.id && selected.id && candidate.id.localeCompare(selected.id) > 0
        ? candidate
        : selected;
    }, undefined);
}

export function resolveWorldBackgroundForWriter(
  worldSettings: readonly WorldSettingSelectionCandidate[],
  legacyWorldBackground?: string | null,
): string | undefined {
  const activeWorld = selectPrimaryWorldSettingForWriter(worldSettings);
  return extractText(activeWorld?.content) || extractText(legacyWorldBackground);
}

function ruleForbiddenItems(value?: string): string[] {
  const normalized = value?.trim();
  if (!normalized) return [];
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
        .filter((item): item is string => Boolean(item));
    }
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
  } catch {
    // Legacy records may store a plain-text rule instead of JSON.
  }
  return [normalized];
}

export function formatRuleSystemForWriter(
  rule: Pick<RuleSystem, 'title' | 'content' | 'forbiddenRules' | 'structuredJson'>,
): string {
  const title = rule.title.trim();
  const content = rule.content.trim();
  const sections = [`【${title || '未命名规则'}】${content}`];
  const forbidden = ruleForbiddenItems(rule.forbiddenRules);
  if (forbidden.length > 0) {
    sections.push(`禁止规则：\n${forbidden.map((item) => `- ${item}`).join('\n')}`);
  }
  const structured = formatWorldRuleMetadata(rule.structuredJson);
  if (structured) sections.push(structured);
  return sections.join('\n');
}

/** No recency sampling: until rule scope is authoritative, every active rule is relevant. */
export async function buildRuleSystemsProjectionForWriter(
  novelId: string,
  rules: readonly RuleSystem[],
): Promise<{ ruleSystems?: string; ruleSystemCoverage: GenerationRuleCoverage }> {
  const activeRules = rules.filter((rule) => rule.isActive);
  if (activeRules.some((rule) => rule.novelId !== novelId || !rule.id.trim())) {
    throw Object.assign(new Error('context_incomplete：规则来源不属于当前作品或缺少身份。'), {
      code: 'GENERATION_CONTEXT_INCOMPLETE',
    });
  }
  activeRules.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const sourceIds = activeRules.map((rule) => rule.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw Object.assign(new Error('context_incomplete：规则来源身份重复。'), {
      code: 'GENERATION_CONTEXT_INCOMPLETE',
    });
  }
  const ruleSystems = activeRules.map(formatRuleSystemForWriter).join('\n\n');
  return {
    ruleSystems: ruleSystems || undefined,
    ruleSystemCoverage: {
      schemaVersion: 'generation_rule_coverage_v1',
      novelId,
      status: 'complete',
      requiredCount: sourceIds.length,
      includedCount: sourceIds.length,
      sourceIds,
      projectionHash: await computeContentSha256(ruleSystems),
    },
  };
}

export async function buildWorldSettingsProjectionForWriter(
  novelId: string,
  worldSettings: readonly WorldSetting[],
  legacyWorldBackground?: string,
): Promise<{
  worldBackground?: string;
  chapterSettings?: string;
  worldSettingCoverage: GenerationRuleCoverage;
}> {
  const active = worldSettings
    .filter((setting) => setting.isActive)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const sourceIds = active.map((setting) => setting.id);
  if (
    active.some((setting) => setting.novelId !== novelId || !setting.id.trim()) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    throw Object.assign(new Error('context_incomplete：世界设定来源作用域或身份不一致。'), {
      code: 'GENERATION_CONTEXT_INCOMPLETE',
    });
  }
  const primary = selectPrimaryWorldSettingForWriter(active);
  const format = (setting: WorldSetting) =>
    [setting.content.trim(), formatWorldRuleMetadata(setting.structuredJson)]
      .filter(Boolean)
      .join('\n');
  const worldBackground = primary ? format(primary) : extractText(legacyWorldBackground);
  const chapterSettings =
    active
      .filter((setting) => setting.id !== primary?.id)
      .map((setting) => '【' + setting.title + '】' + format(setting))
      .join('\n\n') || undefined;
  return {
    worldBackground,
    chapterSettings,
    worldSettingCoverage: {
      schemaVersion: 'generation_rule_coverage_v1',
      novelId,
      status: 'complete',
      requiredCount: active.length,
      includedCount: active.length,
      sourceIds,
      projectionHash: await computeContentSha256(
        JSON.stringify({ worldBackground, chapterSettings }),
      ),
    },
  };
}
