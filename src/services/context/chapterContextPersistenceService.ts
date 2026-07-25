/**
 * v2.1.8 章节上下文原子保存用例。
 *
 * SQLite 路径由单个 Rust 事务提交；浏览器开发路径先构建完整的新快照，
 * 再逐键写入，并在任意写入失败时恢复全部旧值。
 */
import { dbCall, generateId, getDbMode, nowISO } from '../database/db';
import type { Chapter } from '../../types/chapter';
import type {
  Character,
  CharacterState,
  CreateCharacterStateInput,
} from '../../types/character';
import type {
  ChapterSummary,
  CreateChapterSummaryInput,
} from '../../types/chapterSummary';
import type {
  ContextRecord,
  CreateContextRecordInput,
} from '../../types/context';
import {
  CHAPTER_SUMMARIES_STORAGE_KEY,
  mapChapterSummaryFromTauriDto,
  toTauriChapterSummaryInput,
} from './chapterSummaryService';
import {
  CHARACTERS_STORAGE_KEY,
  CHARACTER_STATES_STORAGE_KEY,
  mapCharacterStateFromTauriDto,
  toTauriCharacterStateInput,
} from './characterStateService';
import { mapContextRecordFromTauriDto } from './contextRecordService';

const CONTEXT_RECORDS_STORAGE_KEY = 'ai_novel_studio_context_records';
const CHAPTERS_STORAGE_KEY = 'ai_novel_studio_chapters';

export type PersistableContextRecordInput = CreateContextRecordInput & { id?: string };

export interface SaveChapterContextBundleInput {
  novelId: string;
  chapterId: string;
  adoptedDraftId: string;
  summary: CreateChapterSummaryInput & { id?: string };
  contextRecords: PersistableContextRecordInput[];
  characterStates: Array<CreateCharacterStateInput & { id?: string }>;
}

export interface SaveChapterContextBundleResult {
  summary: ChapterSummary;
  contextRecords: ContextRecord[];
  characterStates: CharacterState[];
  chapterStatus: 'summarized';
}

function readArrayStrict<T>(key: string): T[] {
  const raw = localStorage.getItem(key);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`本地数据 ${key} 不是有效 JSON，已停止保存以避免覆盖。`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`本地数据 ${key} 不是数组，已停止保存以避免覆盖。`);
  }
  return parsed as T[];
}

function restoreSnapshot(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

function writeLocalBundle(
  values: Record<string, unknown[]>,
  snapshots: Record<string, string | null>,
): void {
  try {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const [key, value] of Object.entries(snapshots)) {
      try { restoreSnapshot(key, value); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length > 0) {
      const rollbackFailure = new Error('章节上下文本地保存失败，且补偿回滚未完全成功。');
      Object.assign(rollbackFailure, { cause: error, rollbackErrors });
      throw rollbackFailure;
    }
    throw error;
  }
}

function normalizeIdentity(input: SaveChapterContextBundleInput): void {
  if (input.summary.novelId !== input.novelId
    || input.summary.chapterId !== input.chapterId
    || input.summary.adoptedDraftId !== input.adoptedDraftId) {
    throw new Error('章节总结与原子保存目标不一致。');
  }
  if (input.contextRecords.some((item) => (
    item.novelId !== input.novelId || item.chapterId !== input.chapterId
  ))) {
    throw new Error('上下文记录与原子保存目标不一致。');
  }
  if (input.characterStates.some((item) => (
    item.novelId !== input.novelId || item.chapterId !== input.chapterId
  ))) {
    throw new Error('角色状态与原子保存目标不一致。');
  }
}

export function toTauriContextRecordInput(input: PersistableContextRecordInput): Record<string, unknown> {
  return {
    id: input.id,
    novelId: input.novelId,
    chapterId: input.chapterId ?? null,
    volumeId: input.volumeId ?? null,
    contextType: input.contextType,
    title: input.title,
    content: input.content,
    importance: input.importance ?? 3,
    isActive: input.isActive ?? true,
    contentHash: input.contentHash ?? null,
    draftVersion: input.draftVersion ?? null,
  };
}

function readResultField(result: unknown, camelKey: string, snakeKey: string): unknown {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function mapTauriBundleResult(result: unknown): SaveChapterContextBundleResult {
  const summary = readResultField(result, 'summary', 'summary');
  const contexts = readResultField(result, 'contextRecords', 'context_records');
  const states = readResultField(result, 'characterStates', 'character_states');
  const chapterStatus = readResultField(result, 'chapterStatus', 'chapter_status');
  if (!summary || !Array.isArray(contexts) || !Array.isArray(states)
    || chapterStatus !== 'summarized') {
    throw new Error('SQLite 返回了无效的章节上下文保存结果。');
  }
  return {
    summary: mapChapterSummaryFromTauriDto(summary),
    contextRecords: contexts.map(mapContextRecordFromTauriDto),
    characterStates: states.map(mapCharacterStateFromTauriDto),
    chapterStatus,
  };
}

function chapterNovelId(chapter: Chapter | Record<string, unknown>): unknown {
  return (chapter as Chapter).novelId ?? (chapter as Record<string, unknown>).novel_id;
}

function chapterAdoptedDraftId(chapter: Chapter | Record<string, unknown>): unknown {
  return (chapter as Chapter).adoptedDraftId
    ?? (chapter as Record<string, unknown>).adopted_draft_id;
}

function saveBrowserBundle(input: SaveChapterContextBundleInput): SaveChapterContextBundleResult {
  const keys = [
    CHAPTER_SUMMARIES_STORAGE_KEY,
    CONTEXT_RECORDS_STORAGE_KEY,
    CHARACTER_STATES_STORAGE_KEY,
    CHARACTERS_STORAGE_KEY,
    CHAPTERS_STORAGE_KEY,
  ];
  const snapshots = Object.fromEntries(
    keys.map((key) => [key, localStorage.getItem(key)]),
  );
  const summaries = readArrayStrict<ChapterSummary>(CHAPTER_SUMMARIES_STORAGE_KEY);
  const contexts = readArrayStrict<ContextRecord>(CONTEXT_RECORDS_STORAGE_KEY);
  const states = readArrayStrict<CharacterState>(CHARACTER_STATES_STORAGE_KEY);
  const characters = readArrayStrict<Character>(CHARACTERS_STORAGE_KEY);
  const chapters = readArrayStrict<Chapter>(CHAPTERS_STORAGE_KEY);

  const chapterIndex = chapters.findIndex((item) => item.id === input.chapterId);
  const chapter = chapters[chapterIndex];
  if (!chapter || chapterNovelId(chapter) !== input.novelId) {
    throw new Error('章节不存在或不属于当前作品。');
  }
  const currentAdoptedDraftId = chapterAdoptedDraftId(chapter);
  if (typeof currentAdoptedDraftId === 'string'
    && currentAdoptedDraftId !== input.adoptedDraftId) {
    throw new Error('章节当前采用稿与总结目标不一致。');
  }

  const now = nowISO();
  const requestedSummaryId = input.summary.id;
  const summaryIndex = requestedSummaryId
    ? summaries.findIndex((item) => item.id === requestedSummaryId)
    : summaries
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.novelId === input.novelId && item.chapterId === input.chapterId)
      .sort((left, right) => (
        right.item.updatedAt.localeCompare(left.item.updatedAt)
        || right.item.createdAt.localeCompare(left.item.createdAt)
        || right.item.id.localeCompare(left.item.id)
      ))[0]?.index ?? -1;
  const existingSummary = summaryIndex >= 0 ? summaries[summaryIndex] : undefined;
  if (existingSummary && (existingSummary.novelId !== input.novelId
    || existingSummary.chapterId !== input.chapterId)) {
    throw new Error('章节总结 ID 已属于其他章节。');
  }
  const savedSummary: ChapterSummary = {
    ...input.summary,
    id: existingSummary?.id ?? requestedSummaryId ?? generateId(),
    enabled: input.summary.enabled ?? true,
    isExpired: false,
    createdAt: existingSummary?.createdAt ?? now,
    updatedAt: now,
  };
  if (summaryIndex >= 0) summaries[summaryIndex] = savedSummary;
  else summaries.push(savedSummary);

  const savedContexts = input.contextRecords.map((item): ContextRecord => {
    const id = item.id ?? generateId();
    const existingIndex = contexts.findIndex((record) => record.id === id);
    const existing = existingIndex >= 0 ? contexts[existingIndex] : undefined;
    if (existing && (existing.novelId !== input.novelId
      || existing.chapterId !== input.chapterId)) {
      throw new Error('上下文记录 ID 已属于其他章节。');
    }
    const saved: ContextRecord = {
      ...item,
      id,
      importance: (item.importance ?? 3) as ContextRecord['importance'],
      isActive: item.isActive ?? true,
      isExpired: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) contexts[existingIndex] = saved;
    else contexts.push(saved);
    return saved;
  });

  const savedStates = input.characterStates.map((item): CharacterState => {
    const characterIndex = characters.findIndex((character) => (
      character.id === item.characterId && character.novelId === input.novelId
    ));
    if (characterIndex === -1) {
      throw new Error('角色状态所属角色不存在或不属于当前作品。');
    }
    const id = item.id ?? generateId();
    const existingIndex = states.findIndex((state) => state.id === id);
    const existing = existingIndex >= 0 ? states[existingIndex] : undefined;
    if (existing && (existing.novelId !== input.novelId
      || existing.characterId !== item.characterId
      || existing.chapterId !== input.chapterId)) {
      throw new Error('角色状态 ID 已属于其他目标。');
    }
    const saved: CharacterState = {
      ...item,
      id,
      createdAt: existing?.createdAt ?? now,
    };
    if (existingIndex >= 0) states[existingIndex] = saved;
    else states.push(saved);
    characters[characterIndex] = {
      ...characters[characterIndex],
      currentState: item.stateSummary,
      updatedAt: now,
    };
    return saved;
  });

  chapters[chapterIndex] = {
    ...chapter,
    status: 'summarized',
    updatedAt: now,
  };
  writeLocalBundle({
    [CHAPTER_SUMMARIES_STORAGE_KEY]: summaries,
    [CONTEXT_RECORDS_STORAGE_KEY]: contexts,
    [CHARACTER_STATES_STORAGE_KEY]: states,
    [CHARACTERS_STORAGE_KEY]: characters,
    [CHAPTERS_STORAGE_KEY]: chapters,
  }, snapshots);
  return {
    summary: savedSummary,
    contextRecords: savedContexts,
    characterStates: savedStates,
    chapterStatus: 'summarized',
  };
}

export const chapterContextPersistenceService = {
  async save(input: SaveChapterContextBundleInput): Promise<SaveChapterContextBundleResult> {
    normalizeIdentity(input);
    if (getDbMode() === 'tauri') {
      const preparedContexts = input.contextRecords.map((item) => ({
        ...item,
        id: item.id ?? generateId(),
      }));
      const preparedStates = input.characterStates.map((item) => ({
        ...item,
        id: item.id ?? generateId(),
      }));
      const result = await dbCall<unknown>('save_chapter_context_bundle', {
        input: {
          novelId: input.novelId,
          chapterId: input.chapterId,
          adoptedDraftId: input.adoptedDraftId,
          summary: toTauriChapterSummaryInput(input.summary),
          contextRecords: preparedContexts.map(toTauriContextRecordInput),
          characterStates: preparedStates.map(toTauriCharacterStateInput),
        },
      });
      return mapTauriBundleResult(result);
    }
    return saveBrowserBundle(input);
  },
};
