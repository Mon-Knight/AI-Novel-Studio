import type { WorldRuleDocument, WorldRuleKind, WorldParameterKey } from '../../types/worldRules';

export const WORLD_RULE_KIND_LABELS: Record<WorldRuleKind, string> = {
  world_fact: '世界事实',
  causal_rule: '因果规则',
  social_norm: '社会规范',
  character_belief: '角色信念',
  author_constraint: '作者约束',
  narrative_preference: '叙事偏好',
};
export const WORLD_PARAMETER_DIRECTORY: ReadonlyArray<{
  key: WorldParameterKey;
  label: string;
  hint: string;
}> = [
  {
    key: 'time_history',
    label: '时代与历史',
    hint: '故事年代、历史转折、历法；章号不等于故事日期',
  },
  { key: 'space_environment', label: '空间与环境', hint: '地理、气候、交通距离、生态与生存条件' },
  {
    key: 'institutions_power',
    label: '制度与权力',
    hint: '法律、组织、阶层、执行者；违法不等于物理不可能',
  },
  { key: 'economy_resources', label: '经济与资源', hint: '生产、货币、稀缺资源、分配与行动成本' },
  {
    key: 'technology_infrastructure',
    label: '技术与基础设施',
    hint: '通信、医疗、能源、交通；可用能力及上限',
  },
  {
    key: 'culture_daily_life',
    label: '文化与日常',
    hint: '价值观、习俗、教育、家庭与普通人的生活',
  },
  {
    key: 'information_knowledge',
    label: '信息与认知',
    hint: '谁知道什么、如何得知；传闻与真实情况分别记录',
  },
  {
    key: 'conflict_boundaries',
    label: '冲突与边界',
    hint: '长期矛盾、风险、不可随意突破的创作承诺',
  },
];

export type ParsedWorldRule =
  | { status: 'valid'; document: WorldRuleDocument }
  | { status: 'absent' | 'legacy' | 'unsupported' | 'invalid'; raw?: string; reason: string };
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && Array.from(v).length <= 20_000;
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128 && v.every(text);
const member = (v: unknown, values: readonly string[]) =>
  typeof v === 'string' && values.includes(v);
const textFields = (v: unknown, fields: string[]) =>
  object(v) && fields.every((key) => text(v[key]));

export function isWorldRuleDocument(value: unknown): value is WorldRuleDocument {
  if (!object(value) || value.schemaVersion !== 1 || value.contract !== 'world_rules_v1')
    return false;
  const id = value.identity;
  const scope = value.scope;
  const knowledge = value.epistemic;
  const origin = value.provenance;
  return (
    object(id) &&
    text(id.id) &&
    Boolean(id.id.trim()) &&
    Number.isSafeInteger(id.revision) &&
    (id.revision as number) >= 1 &&
    (id.supersedesRevision === undefined ||
      (Number.isSafeInteger(id.supersedesRevision) &&
        (id.supersedesRevision as number) >= 1 &&
        (id.supersedesRevision as number) < (id.revision as number))) &&
    member(value.kind, Object.keys(WORLD_RULE_KIND_LABELS)) &&
    member(value.authority, ['draft', 'candidate', 'confirmed', 'superseded']) &&
    member(value.strength, ['hard', 'soft', 'descriptive']) &&
    text(value.statement) &&
    list(value.conditions) &&
    object(scope) &&
    text(scope.summary) &&
    ['chapterIds', 'places', 'groups', 'characters'].every((key) => list(scope[key])) &&
    textFields(value.chronology, ['effectiveFrom', 'effectiveUntil', 'revealAt']) &&
    object(knowledge) &&
    member(knowledge.status, ['established', 'uncertain', 'disputed', 'belief']) &&
    list(knowledge.knownBy) &&
    text(knowledge.learnedAt) &&
    text(knowledge.evidence) &&
    textFields(value.boundaries, ['limitations', 'cost', 'ceiling']) &&
    Array.isArray(value.exceptions) &&
    value.exceptions.length <= 128 &&
    value.exceptions.every(
      (item) =>
        object(item) &&
        textFields(item, ['condition', 'effect', 'reason']) &&
        member(item.approval, ['proposed', 'author_approved']),
    ) &&
    object(origin) &&
    member(origin.origin, ['user', 'ai_candidate', 'adopted_text', 'legacy']) &&
    list(origin.sourceRefs) &&
    list(value.dependencies) &&
    object(value.worldParameters) &&
    Object.values(value.worldParameters).every(text)
  );
}

/** Unknown/legacy JSON is retained verbatim, never silently upgraded or erased. */
export function parseWorldRuleDocument(raw?: string | null): ParsedWorldRule {
  if (!raw?.trim()) return { status: 'absent', reason: '尚未补充结构化说明；原正文保留。' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'invalid', raw, reason: '既有结构化数据不是有效JSON，保持原样。' };
  }
  if (!object(value) || value.contract !== 'world_rules_v1')
    return { status: 'legacy', raw, reason: '旧格式结构化数据保留，不自动解释为已确认规则。' };
  if (value.schemaVersion !== 1)
    return { status: 'unsupported', raw, reason: '当前版本不支持此规则Schema，保持原样。' };
  return isWorldRuleDocument(value)
    ? { status: 'valid', document: value }
    : { status: 'invalid', raw, reason: '规则字段不符合Schema，保持原样，不降级为可信规则。' };
}

export function createWorldRuleDocument(
  id: string,
  statement = '',
  kind: WorldRuleKind = 'world_fact',
): WorldRuleDocument {
  return {
    schemaVersion: 1,
    contract: 'world_rules_v1',
    identity: { id, revision: 1 },
    kind,
    authority: 'draft',
    strength: 'descriptive',
    statement,
    conditions: [],
    scope: { summary: '', chapterIds: [], places: [], groups: [], characters: [] },
    chronology: { effectiveFrom: '', effectiveUntil: '', revealAt: '' },
    epistemic: { status: 'uncertain', knownBy: [], learnedAt: '', evidence: '' },
    boundaries: { limitations: '', cost: '', ceiling: '' },
    exceptions: [],
    provenance: { origin: 'user', sourceRefs: [] },
    dependencies: [],
    worldParameters: {},
  };
}

export function serializeWorldRuleDocument(document: WorldRuleDocument): string {
  if (!isWorldRuleDocument(document))
    throw new Error('WORLD_RULE_SCHEMA_INVALID: 规则结构不完整或字段超限');
  const clean = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);
  return JSON.stringify({
    ...document,
    conditions: clean(document.conditions),
    dependencies: clean(document.dependencies),
    scope: {
      ...document.scope,
      chapterIds: clean(document.scope.chapterIds),
      places: clean(document.scope.places),
      groups: clean(document.scope.groups),
      characters: clean(document.scope.characters),
    },
    epistemic: { ...document.epistemic, knownBy: clean(document.epistemic.knownBy) },
    provenance: { ...document.provenance, sourceRefs: clean(document.provenance.sourceRefs) },
  });
}

/** Proposal only: caller must obtain preview-bound author authorization before persistence. */
export function proposeConfirmedWorldRule(
  document: WorldRuleDocument,
  previous?: WorldRuleDocument,
): WorldRuleDocument {
  return {
    ...document,
    identity: previous
      ? {
          ...previous.identity,
          revision: previous.identity.revision + 1,
          supersedesRevision: previous.identity.revision,
        }
      : document.identity,
    authority: 'confirmed',
  };
}
