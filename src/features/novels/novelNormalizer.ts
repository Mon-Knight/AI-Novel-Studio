import type {
  DualProtagonistRelation,
  Novel,
  NovelStatus,
  ProtagonistMode,
  ProtagonistProfile,
} from '../../types/novel';
import { generateId, nowISO } from '../../services/database/db';
import { isPlainObject, safeJsonParse, toSafeNumber, toSafeString } from '../../utils/dataGuard';
import { toValidDate } from '../../utils/date';

export interface NovelNormalizeReport {
  items: Novel[];
  repairedCount: number;
  skippedCount: number;
}

const VALID_STATUS: NovelStatus[] = [
  'draft',
  'planning',
  'writing',
  'paused',
  'completed',
  'archived',
];

const VALID_RELATION_TYPES: DualProtagonistRelation['type'][] = [
  'partner',
  'romance',
  'rival',
  'bound',
  'mentor_student',
  'family',
  'enemy_to_ally',
  'parallel',
  'custom',
];

const VALID_NARRATIVE_WEIGHTS: DualProtagonistRelation['narrativeWeight'][] = [
  'balanced',
  'primary_main',
  'secondary_main',
];

function normalizeDate(value: unknown): string | null {
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

function resolveTitle(raw: Record<string, unknown>, mark: () => void): string {
  if (typeof raw.title === 'string' && raw.title.trim()) return raw.title.trim();
  if (typeof raw.name === 'string' && raw.name.trim()) {
    mark();
    return raw.name.trim();
  }
  if (typeof raw.novelName === 'string' && raw.novelName.trim()) {
    mark();
    return raw.novelName.trim();
  }
  mark();
  return '未命名作品';
}

function resolveGenre(raw: Record<string, unknown>, mark: () => void): string {
  if (typeof raw.genre === 'string') return raw.genre;
  if (typeof raw.category === 'string') {
    mark();
    return raw.category;
  }
  return '';
}

function readJsonField<T>(
  raw: Record<string, unknown>,
  camelName: string,
  snakeName: string,
  fallback: T,
): T {
  const camelValue = raw[camelName];
  if (typeof camelValue === 'string') return safeJsonParse<T>(camelValue, fallback);
  if (camelValue !== undefined) return camelValue as T;

  const snakeValue = raw[snakeName];
  if (typeof snakeValue === 'string') return safeJsonParse<T>(snakeValue, fallback);
  if (snakeValue !== undefined) return snakeValue as T;

  return fallback;
}

export function getDefaultDualProtagonistRelation(): DualProtagonistRelation {
  return {
    type: 'partner',
    description: '',
    conflict: '',
    cooperation: '',
    emotionalProgression: '',
    narrativeWeight: 'balanced',
  };
}

export function getDefaultProtagonistProfile(
  label: ProtagonistProfile['label'] = 'primary',
): ProtagonistProfile {
  return {
    id: generateId(),
    label,
    name: '',
    gender: '',
    identity: '',
    personality: '',
    goal: '',
    motivation: '',
    ability: '',
    limitation: '',
    background: '',
    arc: '',
    notes: '',
    specialAbility: '',
    abilityLimits: '',
    forbiddenBehaviors: '',
  };
}

export function normalizeProtagonistProfile(
  raw: unknown,
  fallbackLabel: ProtagonistProfile['label'] = 'primary',
): ProtagonistProfile {
  const source = isPlainObject(raw) ? raw : {};
  const ability = toSafeString(source.ability ?? source.specialAbility, '');
  const limitation = toSafeString(source.limitation ?? source.abilityLimits, '');

  return {
    id: typeof source.id === 'string' && source.id ? source.id : generateId(),
    label: source.label === 'secondary' ? 'secondary' : fallbackLabel,
    name: toSafeString(source.name, ''),
    gender: toSafeString(source.gender, ''),
    identity: toSafeString(source.identity, ''),
    personality: toSafeString(source.personality, ''),
    goal: toSafeString(source.goal, ''),
    motivation: toSafeString(source.motivation, ''),
    ability,
    limitation,
    background: toSafeString(source.background, ''),
    arc: toSafeString(source.arc, ''),
    notes: toSafeString(source.notes ?? source.currentState, ''),
    specialAbility: ability,
    abilityLimits: limitation,
    forbiddenBehaviors: toSafeString(source.forbiddenBehaviors, ''),
  };
}

export function normalizeDualProtagonistRelation(raw: unknown): DualProtagonistRelation {
  if (!isPlainObject(raw)) return getDefaultDualProtagonistRelation();

  const type = VALID_RELATION_TYPES.includes(raw.type as DualProtagonistRelation['type'])
    ? (raw.type as DualProtagonistRelation['type'])
    : 'partner';
  const narrativeWeight = VALID_NARRATIVE_WEIGHTS.includes(
    raw.narrativeWeight as DualProtagonistRelation['narrativeWeight'],
  )
    ? (raw.narrativeWeight as DualProtagonistRelation['narrativeWeight'])
    : 'balanced';

  return {
    type,
    description: toSafeString(raw.description, ''),
    conflict: toSafeString(raw.conflict, ''),
    cooperation: toSafeString(raw.cooperation, ''),
    emotionalProgression: toSafeString(raw.emotionalProgression, ''),
    narrativeWeight,
  };
}

function normalizeProtagonists(
  raw: Record<string, unknown>,
  mode: ProtagonistMode,
): ProtagonistProfile[] {
  const rawProtagonists = readJsonField<unknown[]>(raw, 'protagonists', 'protagonists_json', []);
  const list = Array.isArray(rawProtagonists)
    ? rawProtagonists
        .filter((item) => isPlainObject(item))
        .map((item, index) =>
          normalizeProtagonistProfile(item, index === 1 ? 'secondary' : 'primary'),
        )
    : [];

  const mainCharacter = toSafeString(
    raw.mainCharacter ?? raw.main_character ?? raw.protagonistName,
    '',
  );
  const protagonistAbility = toSafeString(raw.protagonistAbility ?? raw.protagonist_ability, '');

  if (list.length === 0) {
    const primary = getDefaultProtagonistProfile('primary');
    primary.name = mainCharacter;
    primary.ability = protagonistAbility;
    primary.specialAbility = protagonistAbility;
    list.push(primary);
  } else if (mainCharacter && !list[0].name) {
    list[0].name = mainCharacter;
  }

  if (protagonistAbility && !list[0].ability && !list[0].specialAbility) {
    list[0].ability = protagonistAbility;
    list[0].specialAbility = protagonistAbility;
  }

  list[0] = { ...list[0], label: 'primary' };
  if (mode === 'dual') {
    if (!list[1]) list[1] = getDefaultProtagonistProfile('secondary');
    list[1] = { ...list[1], label: 'secondary' };
    return list.slice(0, 2);
  }

  return [list[0]];
}

function normalizeNovelInternal(raw: unknown): { novel: Novel | null; repaired: boolean } {
  if (!isPlainObject(raw)) return { novel: null, repaired: false };
  let repaired = false;
  const mark = () => {
    repaired = true;
  };

  const now = nowISO();
  const id = typeof raw.id === 'string' && raw.id ? raw.id : (mark(), generateId());
  const title = resolveTitle(raw, mark);
  const genre = resolveGenre(raw, mark);

  const description = toSafeString(raw.description, '');
  const outline = toSafeString(raw.outline, '');
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : undefined;
  const coverPath = toSafeString(raw.coverPath ?? raw.cover_path, '') || undefined;
  const coverUrl = typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined;
  const status = VALID_STATUS.includes(raw.status as NovelStatus)
    ? (raw.status as NovelStatus)
    : (mark(), 'draft');

  const totalWordCountSource =
    raw.totalWordCount ?? raw.total_word_count ?? raw.totalWords ?? raw.wordCount;
  const totalWordCount = toSafeNumber(totalWordCountSource, 0);
  if (
    raw.totalWordCount == null &&
    raw.total_word_count == null &&
    (raw.totalWords != null || raw.wordCount != null)
  )
    mark();

  const targetWordCountSource = raw.targetWordCount ?? raw.target_word_count ?? raw.targetWords;
  const targetWordCount = toSafeNumber(targetWordCountSource, 0);
  if (raw.targetWordCount == null && raw.target_word_count == null && raw.targetWords != null)
    mark();

  const chapterCountSource = raw.chapterCount ?? raw.chapterTotal ?? raw.chapterNum;
  const chapterCount = toSafeNumber(chapterCountSource, 0);
  if (raw.chapterCount == null && chapterCountSource != null) mark();

  const volumeCountSource = raw.volumeCount ?? raw.volumeTotal ?? raw.volumeNum;
  const volumeCount = toSafeNumber(volumeCountSource, 0);
  if (raw.volumeCount == null && volumeCountSource != null) mark();

  const createdAtRaw = normalizeDate(raw.createdAt ?? raw.created_at);
  const updatedAtRaw = normalizeDate(raw.updatedAt ?? raw.updated_at);
  const legacyUpdated = normalizeDate(raw.lastUpdatedAt) ?? normalizeDate(raw.lastEditedAt);
  const createdAt = createdAtRaw ?? (mark(), now);
  const updatedAt = updatedAtRaw ?? legacyUpdated ?? createdAt ?? (mark(), now);
  if (!createdAtRaw) mark();
  if (!updatedAtRaw) mark();
  if (!updatedAtRaw && legacyUpdated) mark();

  const lastOpenedAt = normalizeDate(raw.lastOpenedAt ?? raw.last_opened_at) ?? undefined;
  const deletedAt = normalizeDate(raw.deletedAt ?? raw.deleted_at) ?? undefined;

  const currentVolumeId =
    toSafeString(raw.currentVolumeId ?? raw.current_volume_id, '') || undefined;
  const currentChapterId =
    toSafeString(raw.currentChapterId ?? raw.current_chapter_id, '') || undefined;

  const volumes = Array.isArray(raw.volumes) ? raw.volumes : raw.volumes ? (mark(), []) : [];

  const rawMode = raw.protagonistMode ?? raw.protagonist_mode;
  const protagonistMode: ProtagonistMode = rawMode === 'dual' ? 'dual' : 'single';
  const protagonists = normalizeProtagonists(raw, protagonistMode);
  const dualRelationRaw = readJsonField<unknown>(
    raw,
    'dualProtagonistRelation',
    'dual_protagonist_relation_json',
    {},
  );
  const dualProtagonistRelation = normalizeDualProtagonistRelation(dualRelationRaw);

  const mainCharacter = toSafeString(
    raw.mainCharacter ?? raw.main_character ?? protagonists[0]?.name,
    '',
  );
  const protagonistAbility = toSafeString(
    raw.protagonistAbility ??
      raw.protagonist_ability ??
      protagonists[0]?.ability ??
      protagonists[0]?.specialAbility,
    '',
  );

  const normalized: Novel = {
    id,
    title,
    subtitle,
    description,
    outline,
    genre,
    protagonistName: protagonists[0]?.name ?? '',
    protagonistMode,
    protagonists,
    dualProtagonistRelation,
    mainCharacter,
    protagonistAbility,
    coverPath,
    coverUrl,
    status,
    currentVolumeId,
    currentChapterId,
    totalWordCount,
    totalWords: totalWordCount,
    targetWordCount,
    targetWords: targetWordCount,
    chapterCount,
    volumeCount,
    lastOpenedAt,
    createdAt,
    updatedAt,
    deletedAt,
    volumes,
  };

  return { novel: normalized, repaired };
}

export function normalizeNovel(raw: unknown): Novel | null {
  return normalizeNovelInternal(raw).novel;
}

export function normalizeNovels(raw: unknown): Novel[] {
  return normalizeNovelsWithReport(raw).items;
}

export function normalizeNovelsWithReport(raw: unknown): NovelNormalizeReport {
  const list = Array.isArray(raw) ? raw : [];
  let repairedCount = 0;
  let skippedCount = 0;
  const items: Novel[] = [];
  for (const item of list) {
    const { novel, repaired } = normalizeNovelInternal(item);
    if (!novel) {
      skippedCount += 1;
      continue;
    }
    if (repaired) repairedCount += 1;
    items.push(novel);
  }
  return { items, repairedCount, skippedCount };
}
