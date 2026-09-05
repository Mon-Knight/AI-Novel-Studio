import type { ConversationArtifactCard } from '../../types/conversation';

export interface ArtifactCandidateOption {
  id: string;
  title: string;
  summary: string;
  raw: unknown;
}

export interface ArtifactCandidateOptions {
  items: ArtifactCandidateOption[];
  unparsed: boolean;
}

type ArtifactType = ConversationArtifactCard['artifactType'] | string;

const SKIP_ARTIFACT_TYPES = new Set<string>(['chapter_text']);

const STRUCTURED_CANDIDATE_TYPES = new Set<string>([
  'character_candidates',
  'event_candidates',
  'setting_candidates',
  'outline',
  'chapter_summary',
]);

const UNWRAP_KEYS = [
  'characters',
  'candidates',
  'events',
  'suggestions',
  'settings',
  'summary',
  'content',
  'title',
  'outline',
  'sections',
  'chapters',
  'volumes',
] as const;

const LIST_SPECS: Record<string, { keys: string[]; identityKeys: string[] }> = {
  character_candidates: { keys: ['characters', 'candidates'], identityKeys: ['name'] },
  event_candidates: { keys: ['events', 'suggestions', 'candidates'], identityKeys: ['title'] },
  setting_candidates: { keys: ['settings', 'candidates'], identityKeys: ['name'] },
  outline: {
    keys: ['outline', 'sections', 'chapters', 'volumes', 'candidates'],
    identityKeys: ['title', 'name'],
  },
};

const SUMMARY_FIELD_KEYS: Array<[string, string]> = [
  ['summary', '章节摘要'],
  ['content', '摘要正文'],
  ['text', '摘要'],
  ['keyEvents', '关键事件'],
  ['coreEvents', '核心事件'],
  ['characterChanges', '人物变化'],
  ['importantCharacterChanges', '重要人物变化'],
  ['protagonistStateChange', '主角状态变化'],
  ['relationshipChanges', '关系变化'],
  ['settingChanges', '设定变化'],
  ['newLocations', '新地点'],
  ['newItemsOrAbilities', '新物品或能力'],
  ['newForeshadows', '新伏笔'],
  ['foreshadowing', '伏笔'],
  ['resolvedForeshadows', '已回收伏笔'],
  ['unresolvedQuestions', '未决问题'],
  ['factsMustRemember', '必须记住的事实'],
  ['nextChapterHints', '下章提示'],
  ['nextChapterHook', '下章钩子'],
];

const SUMMARY_LOOKUP: Record<string, string[]> = {
  character_candidates: ['summary', 'identity', 'roleType', 'goal', 'personality', 'description'],
  event_candidates: ['summary', 'description', 'impact', 'risk'],
  setting_candidates: ['summary', 'description', 'content', 'category', 'usageInChapter'],
  outline: ['summary', 'description', 'outline', 'content', 'goal', 'text'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasCandidateFields(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!isRecord(value)) return false;
  return UNWRAP_KEYS.some((key) => hasOwn(value, key));
}

function unwrapCandidateValue(value: unknown): unknown {
  if (Array.isArray(value) || !isRecord(value)) return value;
  if (hasCandidateFields(value)) return value;
  const nested = value.data;
  if (hasCandidateFields(nested) && !(isRecord(nested) && hasOwn(nested, 'text'))) {
    return nested;
  }
  return value;
}

function parseLooseJson(raw: string): { value: unknown; unparsed: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined, unparsed: true };
  try {
    return { value: JSON.parse(trimmed) as unknown, unparsed: false };
  } catch {
    const brace = trimmed.indexOf('{');
    const bracket = trimmed.indexOf('[');
    const start = [brace, bracket]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    if (start === undefined) return { value: undefined, unparsed: true };
    try {
      return { value: JSON.parse(trimmed.slice(start)) as unknown, unparsed: false };
    } catch {
      return { value: undefined, unparsed: true };
    }
  }
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(fieldText).filter(Boolean).join('\n');
  }
  if (isRecord(value)) {
    return (
      fieldText(value.summary) ||
      fieldText(value.description) ||
      fieldText(value.content) ||
      fieldText(value.text) ||
      fieldText(value.title) ||
      fieldText(value.name)
    );
  }
  return '';
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = fieldText(record[key]);
    if (text) return text;
  }
  return '';
}

function ownerList(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return [value, value.data];
}

function pickArray(value: unknown, key: string): unknown[] | undefined {
  for (const owner of ownerList(value)) {
    if (!isRecord(owner)) continue;
    const items = owner[key];
    if (Array.isArray(items)) return items;
  }
  return undefined;
}

function candidateItems(value: unknown, keys: string[], identityKeys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  for (const owner of ownerList(value)) {
    if (!isRecord(owner)) continue;
    for (const key of keys) {
      const items = owner[key];
      if (Array.isArray(items)) return items;
    }
  }
  if (isRecord(value) && identityKeys.some((key) => hasOwn(value, key))) {
    return [value];
  }
  return [];
}

function extractOutlineRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const volumes = pickArray(value, 'volumes');
  if (volumes) {
    const rows: unknown[] = [];
    for (const volume of volumes) {
      rows.push(volume);
      if (isRecord(volume) && Array.isArray(volume.chapters)) {
        rows.push(...volume.chapters);
      }
    }
    return rows;
  }
  const rows = candidateItems(
    value,
    ['sections', 'chapters', 'candidates', 'outline'],
    ['title', 'name'],
  );
  if (rows.length > 0) return rows;
  if (
    isRecord(value) &&
    firstText(value, ['content', 'outline', 'text', 'summary', 'title', 'name'])
  ) {
    return [value];
  }
  return [];
}

function uniqueId(base: string, used: Set<string>): string {
  const normalized = base.trim() || 'candidate';
  let id = normalized;
  let suffix = 2;
  while (used.has(id)) {
    id = `${normalized}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function itemSummary(record: Record<string, unknown>, artifactType: string, title: string): string {
  const keys = SUMMARY_LOOKUP[artifactType] ?? [
    'summary',
    'description',
    'content',
    'outline',
    'text',
    'notes',
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const text = fieldText(record[key]);
    if (text && text !== title && !parts.includes(text)) parts.push(text);
    if (parts.length >= 2) break;
  }
  return parts.join(' · ');
}

function mapRow(
  row: unknown,
  index: number,
  artifactType: string,
  identityKeys: string[],
  usedIds: Set<string>,
): ArtifactCandidateOption {
  if (typeof row === 'string') {
    const title = row.trim() || `候选 ${index + 1}`;
    return { id: uniqueId(`candidate-${index}`, usedIds), title, summary: '', raw: row };
  }
  if (!isRecord(row)) {
    return {
      id: uniqueId(`candidate-${index}`, usedIds),
      title: `候选 ${index + 1}`,
      summary: '',
      raw: row,
    };
  }
  const title =
    firstText(row, identityKeys) || firstText(row, ['title', 'name']) || `候选 ${index + 1}`;
  const id = uniqueId(firstText(row, ['id', 'candidateId']) || `candidate-${index}`, usedIds);
  return {
    id,
    title,
    summary: itemSummary(row, artifactType, title),
    raw: row,
  };
}

function mapRows(
  rows: unknown[],
  artifactType: string,
  identityKeys: string[],
): ArtifactCandidateOption[] {
  const usedIds = new Set<string>();
  return rows.map((row, index) => mapRow(row, index, artifactType, identityKeys, usedIds));
}

function extractChapterSummaryItems(value: unknown): ArtifactCandidateOption[] {
  if (typeof value === 'string') {
    const summary = value.trim();
    return summary ? [{ id: 'summary', title: '章节摘要', summary, raw: value }] : [];
  }
  if (Array.isArray(value)) {
    return value
      .map((row, index) => {
        const summary = typeof row === 'string' ? row.trim() : fieldText(row);
        if (!summary) return null;
        return {
          id: `summary-${index}`,
          title: `段落 ${index + 1}`,
          summary,
          raw: row,
        } satisfies ArtifactCandidateOption;
      })
      .filter((item): item is ArtifactCandidateOption => item !== null);
  }
  if (!isRecord(value)) return [];
  const items: ArtifactCandidateOption[] = [];
  for (const [key, title] of SUMMARY_FIELD_KEYS) {
    if (!hasOwn(value, key)) continue;
    const summary = fieldText(value[key]);
    if (!summary) continue;
    items.push({ id: key, title, summary, raw: value[key] });
  }
  if (items.length > 0) return items;
  const fallback = firstText(value, ['summary', 'content', 'text', 'outline']);
  return fallback ? [{ id: 'summary', title: '章节摘要', summary: fallback, raw: value }] : [];
}

export function isStructuredCandidateArtifactType(artifactType: ArtifactType): boolean {
  return STRUCTURED_CANDIDATE_TYPES.has(artifactType);
}

export function extractArtifactCandidateOptions(
  artifactType: ArtifactType,
  content: string | undefined | null,
): ArtifactCandidateOptions {
  if (SKIP_ARTIFACT_TYPES.has(artifactType)) {
    return { items: [], unparsed: false };
  }
  if (!isStructuredCandidateArtifactType(artifactType)) {
    return { items: [], unparsed: false };
  }
  const parsed = parseLooseJson(content ?? '');
  if (parsed.unparsed) return { items: [], unparsed: true };
  const value = unwrapCandidateValue(parsed.value);
  if (artifactType === 'chapter_summary') {
    return { items: extractChapterSummaryItems(value), unparsed: false };
  }
  const spec = LIST_SPECS[artifactType];
  if (!spec) return { items: [], unparsed: false };
  const rows =
    artifactType === 'outline'
      ? extractOutlineRows(value)
      : candidateItems(value, spec.keys, spec.identityKeys);
  return { items: mapRows(rows, artifactType, spec.identityKeys), unparsed: false };
}
