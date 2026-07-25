/**
 * AI Novel Studio - 章节总结持久化服务。
 *
 * Tauri 桌面端只读写 SQLite；只有浏览器开发模式使用 localStorage。
 * 两条路径不会在 IPC 失败时互相回退，避免出现“界面显示已保存、重启后丢失”。
 */
import {
  dbCall,
  generateId,
  getDbMode,
  lsGet,
  nowISO,
} from '../database/db';
import type {
  ChapterSummary,
  ChapterSummaryValidation,
  CreateChapterSummaryInput,
} from '../../types/chapterSummary';
import type { ContextRecord } from '../../types/context';

export const CHAPTER_SUMMARIES_STORAGE_KEY = 'ai_novel_studio_chapter_summaries';
const CONTEXT_RECORDS_STORAGE_KEY = 'ai_novel_studio_context_records';

export type PersistableChapterSummaryInput = CreateChapterSummaryInput & { id?: string };

function getAllLocal(): ChapterSummary[] {
  return lsGet<ChapterSummary[]>(CHAPTER_SUMMARIES_STORAGE_KEY) ?? [];
}

function saveAllLocal(items: ChapterSummary[]): void {
  localStorage.setItem(CHAPTER_SUMMARIES_STORAGE_KEY, JSON.stringify(items));
}

function compareNewest(left: ChapterSummary, right: ChapterSummary): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id);
}

function latestByChapterInStableOrder(items: ChapterSummary[]): ChapterSummary[] {
  const latestByChapter = new Map<string, ChapterSummary>();
  for (const item of items) {
    const current = latestByChapter.get(item.chapterId);
    if (!current || compareNewest(item, current) < 0) {
      latestByChapter.set(item.chapterId, item);
    }
  }
  return [...latestByChapter.values()].sort((left, right) => (
    left.chapterId.localeCompare(right.chapterId) || compareNewest(left, right)
  ));
}

export function toTauriChapterSummaryInput(
  input: PersistableChapterSummaryInput,
): Record<string, unknown> {
  return {
    id: input.id,
    novelId: input.novelId,
    chapterId: input.chapterId,
    volumeId: input.volumeId ?? null,
    adoptedDraftId: input.adoptedDraftId,
    summary: input.summary,
    keyEvents: input.keyEvents ? JSON.stringify(input.keyEvents) : null,
    characterChanges: input.characterChanges ? JSON.stringify(input.characterChanges) : null,
    relationshipChanges: input.relationshipChanges ? JSON.stringify(input.relationshipChanges) : null,
    newForeshadows: input.newForeshadows ? JSON.stringify(input.newForeshadows) : null,
    resolvedForeshadows: input.resolvedForeshadows ? JSON.stringify(input.resolvedForeshadows) : null,
    nextChapterHints: input.nextChapterHints ?? null,
    coreEvents: input.coreEvents ? JSON.stringify(input.coreEvents) : null,
    protagonistStateChange: input.protagonistStateChange ?? null,
    importantCharacterChanges: input.importantCharacterChanges
      ? JSON.stringify(input.importantCharacterChanges)
      : null,
    settingChanges: input.settingChanges ? JSON.stringify(input.settingChanges) : null,
    newLocations: input.newLocations ? JSON.stringify(input.newLocations) : null,
    newItemsOrAbilities: input.newItemsOrAbilities
      ? JSON.stringify(input.newItemsOrAbilities)
      : null,
    foreshadowing: input.foreshadowing ? JSON.stringify(input.foreshadowing) : null,
    unresolvedQuestions: input.unresolvedQuestions
      ? JSON.stringify(input.unresolvedQuestions)
      : null,
    factsMustRemember: input.factsMustRemember
      ? JSON.stringify(input.factsMustRemember)
      : null,
    nextChapterHook: input.nextChapterHook ?? null,
    validationStatus: input.validationStatus ?? null,
    validationResult: input.validationResult ? JSON.stringify(input.validationResult) : null,
    enabled: input.enabled ?? true,
    contentHash: input.contentHash ?? null,
    draftVersion: input.draftVersion ?? null,
    aiTaskId: input.aiTaskId ?? null,
  };
}

function readDtoValue(dto: unknown, camelKey: string, snakeKey: string): unknown {
  if (!dto || typeof dto !== 'object') return undefined;
  const record = dto as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function safeJsonParseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonParseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validationStatus(value: unknown): ChapterSummary['validationStatus'] {
  return value === 'pending' || value === 'passed' || value === 'failed' ? value : undefined;
}

export function mapChapterSummaryFromTauriDto(dto: unknown): ChapterSummary {
  const id = readDtoValue(dto, 'id', 'id');
  const novelId = readDtoValue(dto, 'novelId', 'novel_id');
  const chapterId = readDtoValue(dto, 'chapterId', 'chapter_id');
  const adoptedDraftId = readDtoValue(dto, 'adoptedDraftId', 'adopted_draft_id');
  const summary = readDtoValue(dto, 'summary', 'summary');
  const createdAt = readDtoValue(dto, 'createdAt', 'created_at');
  const updatedAt = readDtoValue(dto, 'updatedAt', 'updated_at');
  if (![id, novelId, chapterId, adoptedDraftId, summary, createdAt, updatedAt]
    .every((value) => typeof value === 'string')) {
    throw new Error('SQLite 返回了无效的章节总结。');
  }

  const enabled = readDtoValue(dto, 'enabled', 'enabled');
  const isExpired = readDtoValue(dto, 'isExpired', 'is_expired');
  return {
    id: id as string,
    novelId: novelId as string,
    chapterId: chapterId as string,
    volumeId: optionalString(readDtoValue(dto, 'volumeId', 'volume_id')),
    adoptedDraftId: adoptedDraftId as string,
    summary: summary as string,
    keyEvents: safeJsonParseArray(readDtoValue(dto, 'keyEvents', 'key_events')) as string[],
    characterChanges: safeJsonParseObject(readDtoValue(dto, 'characterChanges', 'character_changes')),
    relationshipChanges: safeJsonParseObject(readDtoValue(dto, 'relationshipChanges', 'relationship_changes')),
    newForeshadows: safeJsonParseArray(readDtoValue(dto, 'newForeshadows', 'new_foreshadows')) as string[],
    resolvedForeshadows: safeJsonParseArray(readDtoValue(dto, 'resolvedForeshadows', 'resolved_foreshadows')) as string[],
    nextChapterHints: optionalString(readDtoValue(dto, 'nextChapterHints', 'next_chapter_hints')),
    coreEvents: safeJsonParseArray(readDtoValue(dto, 'coreEvents', 'core_events')) as string[],
    protagonistStateChange: optionalString(
      readDtoValue(dto, 'protagonistStateChange', 'protagonist_state_change'),
    ),
    importantCharacterChanges: safeJsonParseArray(
      readDtoValue(dto, 'importantCharacterChanges', 'important_character_changes'),
    ) as ChapterSummary['importantCharacterChanges'],
    settingChanges: safeJsonParseArray(readDtoValue(dto, 'settingChanges', 'setting_changes')) as string[],
    newLocations: safeJsonParseArray(readDtoValue(dto, 'newLocations', 'new_locations')) as string[],
    newItemsOrAbilities: safeJsonParseArray(
      readDtoValue(dto, 'newItemsOrAbilities', 'new_items_or_abilities'),
    ) as string[],
    foreshadowing: safeJsonParseArray(readDtoValue(dto, 'foreshadowing', 'foreshadowing')) as string[],
    unresolvedQuestions: safeJsonParseArray(
      readDtoValue(dto, 'unresolvedQuestions', 'unresolved_questions'),
    ) as string[],
    factsMustRemember: safeJsonParseArray(
      readDtoValue(dto, 'factsMustRemember', 'facts_must_remember'),
    ) as string[],
    nextChapterHook: optionalString(readDtoValue(dto, 'nextChapterHook', 'next_chapter_hook')),
    validationStatus: validationStatus(readDtoValue(dto, 'validationStatus', 'validation_status')),
    validationResult: safeJsonParseObject(
      readDtoValue(dto, 'validationResult', 'validation_result'),
    ) as unknown as ChapterSummaryValidation,
    enabled: enabled !== false && enabled !== 0,
    contentHash: optionalString(readDtoValue(dto, 'contentHash', 'content_hash')),
    draftVersion: optionalNumber(readDtoValue(dto, 'draftVersion', 'draft_version')),
    isExpired: isExpired === true || isExpired === 1,
    aiTaskId: optionalString(readDtoValue(dto, 'aiTaskId', 'ai_task_id')),
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  };
}

function restoreLocalSnapshot(key: string, raw: string | null): void {
  if (raw === null) localStorage.removeItem(key);
  else localStorage.setItem(key, raw);
}

export const chapterSummaryService = {
  async getByChapterId(chapterId: string): Promise<ChapterSummary | null> {
    if (getDbMode() === 'tauri') {
      const dto = await dbCall<unknown | null>('get_chapter_summary', { chapterId });
      return dto ? mapChapterSummaryFromTauriDto(dto) : null;
    }
    return getAllLocal()
      .filter((item) => item.chapterId === chapterId)
      .sort(compareNewest)[0] ?? null;
  },

  async getByNovelId(novelId: string): Promise<ChapterSummary[]> {
    if (getDbMode() === 'tauri') {
      const dtos = await dbCall<unknown[]>('get_chapter_summaries_by_novel', { novelId });
      if (!Array.isArray(dtos)) {
        throw new Error('SQLite 返回了无效的章节总结列表。');
      }
      const summaries = dtos.map(mapChapterSummaryFromTauriDto);
      const seen = new Set<string>();
      return summaries.filter((item) => {
        if (seen.has(item.chapterId)) return false;
        seen.add(item.chapterId);
        return true;
      });
    }
    return latestByChapterInStableOrder(
      getAllLocal().filter((item) => item.novelId === novelId),
    );
  },

  async create(input: CreateChapterSummaryInput): Promise<ChapterSummary> {
    if (getDbMode() === 'tauri') {
      const dto = await dbCall<unknown>('save_chapter_summary', {
        input: toTauriChapterSummaryInput(input),
      });
      return mapChapterSummaryFromTauriDto(dto);
    }

    const now = nowISO();
    const summary: ChapterSummary = {
      ...input,
      id: generateId(),
      enabled: input.enabled ?? true,
      isExpired: false,
      createdAt: now,
      updatedAt: now,
    };
    const list = getAllLocal();
    list.push(summary);
    saveAllLocal(list);
    return summary;
  },

  async update(
    id: string,
    input: Partial<CreateChapterSummaryInput>,
  ): Promise<ChapterSummary | null> {
    if (getDbMode() === 'tauri') {
      const existingDto = await dbCall<unknown | null>('get_chapter_summary_by_id', { id });
      if (!existingDto) return null;
      const existing = mapChapterSummaryFromTauriDto(existingDto);
      const merged: PersistableChapterSummaryInput = { ...existing, ...input, id };
      const dto = await dbCall<unknown>('save_chapter_summary', {
        input: toTauriChapterSummaryInput(merged),
      });
      return mapChapterSummaryFromTauriDto(dto);
    }

    const list = getAllLocal();
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...input, id, updatedAt: nowISO() };
    saveAllLocal(list);
    return list[index];
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('update_chapter_summary_enabled', { id, enabled });
      return;
    }
    const list = getAllLocal();
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return;
    list[index].enabled = enabled;
    list[index].updatedAt = nowISO();
    saveAllLocal(list);
  },

  async markExpired(chapterId: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('mark_chapter_summaries_expired', { chapterId });
      return;
    }

    const summarySnapshot = localStorage.getItem(CHAPTER_SUMMARIES_STORAGE_KEY);
    const contextSnapshot = localStorage.getItem(CONTEXT_RECORDS_STORAGE_KEY);
    const now = nowISO();
    const summaries = getAllLocal().map((item) => item.chapterId === chapterId
      ? { ...item, isExpired: true, updatedAt: now }
      : item);
    const contexts = (lsGet<ContextRecord[]>(CONTEXT_RECORDS_STORAGE_KEY) ?? [])
      .map((item) => item.chapterId === chapterId
        ? { ...item, isExpired: true, updatedAt: now }
        : item);
    try {
      localStorage.setItem(CHAPTER_SUMMARIES_STORAGE_KEY, JSON.stringify(summaries));
      localStorage.setItem(CONTEXT_RECORDS_STORAGE_KEY, JSON.stringify(contexts));
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try { restoreLocalSnapshot(CHAPTER_SUMMARIES_STORAGE_KEY, summarySnapshot); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      try { restoreLocalSnapshot(CONTEXT_RECORDS_STORAGE_KEY, contextSnapshot); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (rollbackErrors.length > 0) {
        const rollbackFailure = new Error('章节上下文本地保存失败，且回滚未完全成功。');
        Object.assign(rollbackFailure, { cause: error, rollbackErrors });
        throw rollbackFailure;
      }
      throw error;
    }
  },

  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('delete_chapter_summary', { id });
      return;
    }
    saveAllLocal(getAllLocal().filter((item) => item.id !== id));
  },
};
