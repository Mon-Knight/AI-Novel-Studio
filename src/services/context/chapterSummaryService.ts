/**
 * AI Novel Studio - 章节总结服务（Tauri SQLite + localStorage 回退）
 * v1.7.13: 升级为章节上下文服务，支持校验、过期、卷归类
 */
import { lsGet, lsSet, generateId, nowISO, dbCall } from '../database/db';
import type { ChapterSummary, CreateChapterSummaryInput, ChapterSummaryValidation } from '../../types/chapterSummary';

const KEY = 'ai_novel_studio_chapter_summaries';
function getAll(): ChapterSummary[] { return lsGet<ChapterSummary[]>(KEY) ?? []; }
function saveAll(items: ChapterSummary[]): void { lsSet(KEY, items); }

function toTauriInput(input: CreateChapterSummaryInput): Record<string, unknown> {
  return {
    novelId: input.novelId, chapterId: input.chapterId, volumeId: input.volumeId || null,
    adoptedDraftId: input.adoptedDraftId, summary: input.summary,
    keyEvents: input.keyEvents ? JSON.stringify(input.keyEvents) : null,
    characterChanges: input.characterChanges ? JSON.stringify(input.characterChanges) : null,
    relationshipChanges: input.relationshipChanges ? JSON.stringify(input.relationshipChanges) : null,
    newForeshadows: input.newForeshadows ? JSON.stringify(input.newForeshadows) : null,
    resolvedForeshadows: input.resolvedForeshadows ? JSON.stringify(input.resolvedForeshadows) : null,
    nextChapterHints: input.nextChapterHints || null,
    coreEvents: input.coreEvents ? JSON.stringify(input.coreEvents) : null,
    protagonistStateChange: input.protagonistStateChange || null,
    importantCharacterChanges: input.importantCharacterChanges ? JSON.stringify(input.importantCharacterChanges) : null,
    settingChanges: input.settingChanges ? JSON.stringify(input.settingChanges) : null,
    newLocations: input.newLocations ? JSON.stringify(input.newLocations) : null,
    newItemsOrAbilities: input.newItemsOrAbilities ? JSON.stringify(input.newItemsOrAbilities) : null,
    foreshadowing: input.foreshadowing ? JSON.stringify(input.foreshadowing) : null,
    unresolvedQuestions: input.unresolvedQuestions ? JSON.stringify(input.unresolvedQuestions) : null,
    factsMustRemember: input.factsMustRemember ? JSON.stringify(input.factsMustRemember) : null,
    nextChapterHook: input.nextChapterHook || null,
    validationStatus: input.validationStatus || null,
    validationResult: input.validationResult ? JSON.stringify(input.validationResult) : null,
    enabled: input.enabled ?? true,
    contentHash: input.contentHash || null,
    draftVersion: input.draftVersion || null,
    aiTaskId: input.aiTaskId || null,
  };
}

function fromTauriDto(dto: any): ChapterSummary {
  return {
    id: dto.id,
    novelId: dto.novelId || dto.novel_id,
    chapterId: dto.chapterId || dto.chapter_id,
    volumeId: dto.volumeId || dto.volume_id,
    adoptedDraftId: dto.adoptedDraftId || dto.adopted_draft_id,
    summary: dto.summary || '',
    keyEvents: safeJsonParseArray(dto.keyEvents || dto.key_events),
    characterChanges: safeJsonParseObj(dto.characterChanges || dto.character_changes),
    relationshipChanges: safeJsonParseObj(dto.relationshipChanges || dto.relationship_changes),
    newForeshadows: safeJsonParseArray(dto.newForeshadows || dto.new_foreshadows),
    resolvedForeshadows: safeJsonParseArray(dto.resolvedForeshadows || dto.resolved_foreshadows),
    nextChapterHints: dto.nextChapterHints || dto.next_chapter_hints,
    coreEvents: safeJsonParseArray(dto.coreEvents),
    protagonistStateChange: dto.protagonistStateChange || dto.protagonist_state_change,
    importantCharacterChanges: safeJsonParseArray(dto.importantCharacterChanges || dto.important_character_changes) as any,
    settingChanges: safeJsonParseArray(dto.settingChanges || dto.setting_changes),
    newLocations: safeJsonParseArray(dto.newLocations || dto.new_locations),
    newItemsOrAbilities: safeJsonParseArray(dto.newItemsOrAbilities || dto.new_items_or_abilities),
    foreshadowing: safeJsonParseArray(dto.foreshadowing),
    unresolvedQuestions: safeJsonParseArray(dto.unresolvedQuestions || dto.unresolved_questions),
    factsMustRemember: safeJsonParseArray(dto.factsMustRemember || dto.facts_must_remember),
    nextChapterHook: dto.nextChapterHook || dto.next_chapter_hook,
    validationStatus: dto.validationStatus || dto.validation_status,
    validationResult: safeJsonParseObj(dto.validationResult || dto.validation_result) as ChapterSummaryValidation,
    enabled: dto.enabled !== false,
    contentHash: dto.contentHash || dto.content_hash,
    draftVersion: dto.draftVersion || dto.draft_version,
    isExpired: dto.isExpired || dto.is_expired || false,
    aiTaskId: dto.aiTaskId || dto.ai_task_id,
    createdAt: dto.createdAt || dto.created_at,
    updatedAt: dto.updatedAt || dto.updated_at,
  };
}

function safeJsonParseArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function safeJsonParseObj(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return {};
}

export const chapterSummaryService = {
  async getByChapterId(chapterId: string): Promise<ChapterSummary | null> {
    try {
      const dto = await dbCall<any>('get_chapter_summary', { chapterId });
      if (dto) return fromTauriDto(dto);
    } catch { /* fallback */ }
    return getAll().find((s) => s.chapterId === chapterId) ?? null;
  },

  async getByNovelId(novelId: string): Promise<ChapterSummary[]> {
    return getAll().filter((s) => s.novelId === novelId);
  },

  async create(input: CreateChapterSummaryInput): Promise<ChapterSummary> {
    const list = getAll(); const now = nowISO();
    const s: ChapterSummary = { ...input, id: generateId(), enabled: input.enabled ?? true, isExpired: false, createdAt: now, updatedAt: now };
    try {
      const dto = await dbCall<any>('save_chapter_summary', toTauriInput(input));
      if (dto) return fromTauriDto(dto);
    } catch { /* fallback */ }
    list.push(s); saveAll(list); return s;
  },

  async update(id: string, input: Partial<CreateChapterSummaryInput>): Promise<ChapterSummary | null> {
    try {
      const dto = await dbCall<any>('save_chapter_summary', { ...toTauriInput(input as any), id });
      if (dto) return fromTauriDto(dto);
    } catch { /* fallback */ }
    const list = getAll(); const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    try { await dbCall('update_chapter_summary_enabled', { id, enabled }); } catch { /* fallback */ }
    const list = getAll(); const idx = list.findIndex((s) => s.id === id);
    if (idx !== -1) { list[idx].enabled = enabled; list[idx].updatedAt = nowISO(); saveAll(list); }
  },

  async markExpired(chapterId: string): Promise<void> {
    try { await dbCall('mark_chapter_summaries_expired', { chapterId }); } catch { /* fallback */ }
    const list = getAll();
    let changed = false;
    for (const s of list) {
      if (s.chapterId === chapterId) { s.isExpired = true; s.updatedAt = nowISO(); changed = true; }
    }
    if (changed) saveAll(list);
  },

  async remove(id: string): Promise<void> { saveAll(getAll().filter((s) => s.id !== id)); },
};

