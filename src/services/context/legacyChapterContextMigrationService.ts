/**
 * v2.1.8 旧 localStorage 章节上下文迁移。
 *
 * SQLite 事务成功后才清理本地记录；Rust 返回的 idMap 是唯一清理凭据。
 * 本地清理失败只产生 warning，记录会保留，后续重跑由 Rust 的匹配逻辑
 * 保证不会重复插入。
 */
import { dbCall, getDbMode } from '../database/db';
import type { CharacterState } from '../../types/character';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ContextRecord } from '../../types/context';
import {
  CHAPTER_SUMMARIES_STORAGE_KEY,
  toTauriChapterSummaryInput,
} from './chapterSummaryService';
import {
  CHARACTER_STATES_STORAGE_KEY,
  toTauriCharacterStateInput,
} from './characterStateService';
import { toTauriContextRecordInput } from './chapterContextPersistenceService';

export const CONTEXT_RECORDS_STORAGE_KEY = 'ai_novel_studio_context_records';

export interface LegacyMigrationEntityCounts {
  inserted: number;
  matched: number;
  skipped: number;
}

export interface LegacyChapterContextMigrationResult {
  performed: boolean;
  chapterSummaries: LegacyMigrationEntityCounts;
  contextRecords: LegacyMigrationEntityCounts;
  characterStates: LegacyMigrationEntityCounts;
  idMap: Record<string, string>;
  warnings: string[];
  localRecordsRemoved: {
    chapterSummaries: number;
    contextRecords: number;
    characterStates: number;
  };
}

interface LegacyCollection<T> {
  key: string;
  label: string;
  items: unknown[];
  validItems: T[];
  warnings: string[];
  canClean: boolean;
}

function emptyCounts(): LegacyMigrationEntityCounts {
  return { inserted: 0, matched: 0, skipped: 0 };
}

function emptyResult(performed = false): LegacyChapterContextMigrationResult {
  return {
    performed,
    chapterSummaries: emptyCounts(),
    contextRecords: emptyCounts(),
    characterStates: emptyCounts(),
    idMap: {},
    warnings: [],
    localRecordsRemoved: {
      chapterSummaries: 0,
      contextRecords: 0,
      characterStates: 0,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasStringFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string');
}

function isLegacySummary(value: unknown): value is ChapterSummary {
  return hasStringFields(value, [
    'id', 'novelId', 'chapterId', 'adoptedDraftId', 'summary', 'createdAt', 'updatedAt',
  ]);
}

function isLegacyContext(value: unknown): value is ContextRecord {
  return hasStringFields(value, [
    'id', 'novelId', 'contextType', 'title', 'content', 'createdAt', 'updatedAt',
  ]);
}

function isLegacyCharacterState(value: unknown): value is CharacterState {
  return hasStringFields(value, [
    'id', 'novelId', 'characterId', 'stateSummary', 'createdAt',
  ]);
}

function readLegacyCollection<T>(
  key: string,
  label: string,
  guard: (value: unknown) => value is T,
): LegacyCollection<T> {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return { key, label, items: [], validItems: [], warnings: [], canClean: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      key,
      label,
      items: [],
      validItems: [],
      warnings: [`${label} 的旧本地数据不是有效 JSON，已保留原值。`],
      canClean: false,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      key,
      label,
      items: [],
      validItems: [],
      warnings: [`${label} 的旧本地数据不是数组，已保留原值。`],
      canClean: false,
    };
  }
  const warnings: string[] = [];
  const validItems: T[] = [];
  parsed.forEach((item, index) => {
    if (guard(item)) validItems.push(item);
    else warnings.push(`${label}[${index}] 字段不完整，已留在本地等待人工处理。`);
  });
  return { key, label, items: parsed, validItems, warnings, canClean: true };
}

function itemId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
}

function excludeAmbiguousIds(
  collections: Array<LegacyCollection<unknown>>,
): { allowedIds: Set<string>; warnings: string[] } {
  const idCounts = new Map<string, number>();
  for (const collection of collections) {
    for (const item of collection.items) {
      const id = itemId(item);
      if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }
  const allowedIds = new Set(
    [...idCounts.entries()].filter(([, count]) => count === 1).map(([id]) => id),
  );
  const warnings = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => `旧本地数据中 ID ${id} 重复，相关记录已保留在本地。`);
  return { allowedIds, warnings };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function serializeSummary(item: ChapterSummary): Record<string, unknown> {
  return {
    ...toTauriChapterSummaryInput({ ...item, id: item.id }),
    isExpired: item.isExpired ?? false,
    createdAt: optionalString(item.createdAt),
    updatedAt: optionalString(item.updatedAt),
  };
}

function serializeContext(item: ContextRecord): Record<string, unknown> {
  return {
    ...toTauriContextRecordInput({ ...item, id: item.id }),
    isExpired: item.isExpired ?? false,
    createdAt: optionalString(item.createdAt),
    updatedAt: optionalString(item.updatedAt),
  };
}

function serializeCharacterState(item: CharacterState): Record<string, unknown> {
  return {
    ...toTauriCharacterStateInput({ ...item, id: item.id }),
    createdAt: optionalString(item.createdAt),
  };
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readCounts(result: unknown, camelKey: string, snakeKey: string): LegacyMigrationEntityCounts {
  if (!isRecord(result)) return emptyCounts();
  const raw = result[camelKey] ?? result[snakeKey];
  if (!isRecord(raw)) return emptyCounts();
  return {
    inserted: readNumber(raw.inserted),
    matched: readNumber(raw.matched),
    skipped: readNumber(raw.skipped),
  };
}

function readMigrationResult(result: unknown): Omit<LegacyChapterContextMigrationResult, 'performed' | 'localRecordsRemoved'> {
  if (!isRecord(result)) throw new Error('SQLite 返回了无效的旧上下文迁移结果。');
  const rawIdMap = result.idMap ?? result.id_map;
  const rawWarnings = result.warnings;
  if (!isRecord(rawIdMap) || !Array.isArray(rawWarnings)) {
    throw new Error('SQLite 返回了无效的旧上下文迁移映射。');
  }
  const idMap = Object.fromEntries(
    Object.entries(rawIdMap).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string'
    )),
  );
  return {
    chapterSummaries: readCounts(result, 'chapterSummaries', 'chapter_summaries'),
    contextRecords: readCounts(result, 'contextRecords', 'context_records'),
    characterStates: readCounts(result, 'characterStates', 'character_states'),
    idMap,
    warnings: rawWarnings.filter((item): item is string => typeof item === 'string'),
  };
}

function cleanMappedRecords(
  collection: LegacyCollection<unknown>,
  mappedIds: Set<string>,
): { removed: number; warning?: string } {
  if (!collection.canClean || collection.items.length === 0) return { removed: 0 };
  const remaining = collection.items.filter((item) => {
    const id = itemId(item);
    return !id || !mappedIds.has(id);
  });
  const removed = collection.items.length - remaining.length;
  if (removed === 0) return { removed: 0 };
  try {
    localStorage.setItem(collection.key, JSON.stringify(remaining));
    return { removed };
  } catch {
    return {
      removed: 0,
      warning: `${collection.label} 已提交到 SQLite，但本地缓存清理失败；下次启动会安全重试。`,
    };
  }
}

export const legacyChapterContextMigrationService = {
  async migrate(): Promise<LegacyChapterContextMigrationResult> {
    if (getDbMode() !== 'tauri') return emptyResult(false);

    const summaries = readLegacyCollection(
      CHAPTER_SUMMARIES_STORAGE_KEY,
      '章节总结',
      isLegacySummary,
    );
    const contexts = readLegacyCollection(
      CONTEXT_RECORDS_STORAGE_KEY,
      '上下文记录',
      isLegacyContext,
    );
    const states = readLegacyCollection(
      CHARACTER_STATES_STORAGE_KEY,
      '角色状态',
      isLegacyCharacterState,
    );
    const collections: Array<LegacyCollection<unknown>> = [summaries, contexts, states];
    const { allowedIds, warnings: duplicateWarnings } = excludeAmbiguousIds(collections);
    const preflightWarnings = [
      ...summaries.warnings,
      ...contexts.warnings,
      ...states.warnings,
      ...duplicateWarnings,
    ];
    const validSummaries = summaries.validItems.filter((item) => allowedIds.has(item.id));
    const validContexts = contexts.validItems.filter((item) => allowedIds.has(item.id));
    const validStates = states.validItems.filter((item) => allowedIds.has(item.id));

    if (validSummaries.length === 0 && validContexts.length === 0 && validStates.length === 0) {
      return { ...emptyResult(false), warnings: preflightWarnings };
    }

    const rawResult = await dbCall<unknown>('migrate_legacy_chapter_context', {
      input: {
        chapterSummaries: validSummaries.map(serializeSummary),
        contextRecords: validContexts.map(serializeContext),
        characterStates: validStates.map(serializeCharacterState),
      },
    });
    const migrated = readMigrationResult(rawResult);
    const mappedIds = new Set(Object.keys(migrated.idMap));
    const cleanedSummaries = cleanMappedRecords(summaries, mappedIds);
    const cleanedContexts = cleanMappedRecords(contexts, mappedIds);
    const cleanedStates = cleanMappedRecords(states, mappedIds);
    const cleanupWarnings = [
      cleanedSummaries.warning,
      cleanedContexts.warning,
      cleanedStates.warning,
    ].filter((item): item is string => Boolean(item));

    return {
      performed: true,
      ...migrated,
      warnings: [...preflightWarnings, ...migrated.warnings, ...cleanupWarnings],
      localRecordsRemoved: {
        chapterSummaries: cleanedSummaries.removed,
        contextRecords: cleanedContexts.removed,
        characterStates: cleanedStates.removed,
      },
    };
  },
};
