/**
 * AI Novel Studio - 上下文记录服务（Tauri SQLite + localStorage 回退）
 * v1.7.13: 增加章节上下文分类、过期支持、Tauri 持久化
 */
import { lsGet, lsSet, generateId, nowISO, dbCall } from '../database/db';
import type { ContextRecord, CreateContextRecordInput } from '../../types/context';

const KEY = 'ai_novel_studio_context_records';
function getAll(): ContextRecord[] { return lsGet<ContextRecord[]>(KEY) ?? []; }
function saveAll(items: ContextRecord[]): void { lsSet(KEY, items); }

export const contextRecordService = {
  async getByNovelId(novelId: string): Promise<ContextRecord[]> {
    try {
      const dtos = await dbCall<any[]>('get_context_records', { novelId });
      if (Array.isArray(dtos)) return dtos.map(fromTauriDto);
    } catch { /* fallback */ }
    return getAll().filter((r) => r.novelId === novelId);
  },

  async getActiveByNovelId(novelId: string): Promise<ContextRecord[]> {
    try {
      const all = await this.getByNovelId(novelId);
      return all.filter((r) => r.isActive && !r.isExpired);
    } catch { /* fallback */ }
    return getAll().filter((r) => r.novelId === novelId && r.isActive);
  },

  async getById(id: string): Promise<ContextRecord | null> {
    return getAll().find((r) => r.id === id) ?? null;
  },

  async getForGeneration(input: { novelId: string; chapterId?: string; maxCount?: number; excludeExpired?: boolean }): Promise<ContextRecord[]> {
    const active = await this.getActiveByNovelId(input.novelId);
      const filtered = input.excludeExpired !== false
      ? active.filter((r) => !r.isExpired)
      : active;
    const sorted = filtered.sort((a, b) => b.importance - a.importance);
    return sorted.slice(0, input.maxCount || 15);
  },

  async create(input: CreateContextRecordInput): Promise<ContextRecord> {
    const now = nowISO();
    const r: ContextRecord = {
      ...input, id: generateId(),
      importance: (input.importance || 3) as ContextRecord['importance'],
      isActive: input.isActive ?? true, isExpired: false,
      createdAt: now, updatedAt: now,
    };
    try {
      await dbCall('save_context_records', { inputs: [{ ...input, id: r.id }] });
    } catch { /* fallback */ }
    const list = getAll(); list.push(r); saveAll(list);
    return r;
  },

  async createBatch(inputs: CreateContextRecordInput[]): Promise<ContextRecord[]> {
    const now = nowISO();
    const records = inputs.map((input) => ({
      ...input, id: generateId(),
      importance: (input.importance || 3) as ContextRecord['importance'],
      isActive: input.isActive ?? true, isExpired: false,
      createdAt: now, updatedAt: now,
    }));
    try {
      await dbCall('save_context_records', { inputs: records.map((r) => ({ ...r, id: r.id })) });
    } catch { /* fallback */ }
    const list = getAll(); list.push(...records); saveAll(list);
    return records;
  },

  async update(id: string, input: Partial<ContextRecord>): Promise<ContextRecord | null> {
    const list = getAll(); const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    try { await dbCall('update_context_record_active', { id, isActive }); } catch { /* fallback */ }
    const list = getAll(); const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return;
    list[idx].isActive = isActive; list[idx].updatedAt = nowISO(); saveAll(list);
  },

  async remove(id: string): Promise<void> {
    try { await dbCall('delete_context_record', { id }); } catch { /* fallback */ }
    saveAll(getAll().filter((r) => r.id !== id));
  },
};

function fromTauriDto(dto: any): ContextRecord {
  return {
    id: dto.id,
    novelId: dto.novelId || dto.novel_id,
    chapterId: dto.chapterId || dto.chapter_id,
    volumeId: dto.volumeId || dto.volume_id,
    contextType: dto.contextType || dto.context_type,
    title: dto.title,
    content: dto.content,
    importance: dto.importance || 3,
    isActive: dto.isActive !== undefined ? dto.isActive : dto.is_active !== false,
    isExpired: dto.isExpired || dto.is_expired || false,
    contentHash: dto.contentHash || dto.content_hash,
    draftVersion: dto.draftVersion || dto.draft_version,
    createdAt: dto.createdAt || dto.created_at,
    updatedAt: dto.updatedAt || dto.updated_at,
  };
}

export function buildContextSummary(records: ContextRecord[], maxLength = 1200): string {
  if (records.length === 0) return '';
  const active = records.filter((r) => !r.isExpired);
  const lines = active.map((r) => {
    const prefix = `[${r.title}]`;
    const short = r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content;
    return `${prefix}${short}`;
  });
  let result = lines.join('\n');
  if (result.length > maxLength) result = result.slice(0, maxLength) + '\n…（上下文已截断）';
  return result;
}

