/**
 * AI Novel Studio - 上下文记录服务（localStorage）
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ContextRecord, CreateContextRecordInput, ContextRecordType } from '../../types/context';

const KEY = 'ai_novel_studio_context_records';
function getAll(): ContextRecord[] { return lsGet<ContextRecord[]>(KEY) ?? []; }
function saveAll(items: ContextRecord[]): void { lsSet(KEY, items); }

export const contextRecordService = {
  async getByNovelId(novelId: string): Promise<ContextRecord[]> {
    return getAll().filter((r) => r.novelId === novelId);
  },
  async getActiveByNovelId(novelId: string): Promise<ContextRecord[]> {
    return getAll().filter((r) => r.novelId === novelId && r.isActive);
  },
  async getById(id: string): Promise<ContextRecord | null> {
    return getAll().find((r) => r.id === id) ?? null;
  },
  async getForGeneration(input: { novelId: string; chapterId?: string; maxCount?: number }): Promise<ContextRecord[]> {
    const active = await this.getActiveByNovelId(input.novelId);
    const sorted = active.sort((a, b) => b.importance - a.importance);
    return sorted.slice(0, input.maxCount || 15);
  },
  async create(input: CreateContextRecordInput): Promise<ContextRecord> {
    const list = getAll(); const now = nowISO();
    const r: ContextRecord = { ...input, id: generateId(), importance: (input.importance || 3) as ContextRecord['importance'], isActive: input.isActive ?? true, createdAt: now, updatedAt: now };
    list.push(r); saveAll(list); return r;
  },
  async update(id: string, input: Partial<ContextRecord>): Promise<ContextRecord | null> {
    const list = getAll(); const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },
  async setActive(id: string, isActive: boolean): Promise<void> {
    const list = getAll(); const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return;
    list[idx].isActive = isActive; list[idx].updatedAt = nowISO(); saveAll(list);
  },
  async remove(id: string): Promise<void> { saveAll(getAll().filter((r) => r.id !== id)); },
};

export function buildContextSummary(records: ContextRecord[], maxLength = 1200): string {
  if (records.length === 0) return '';
  const lines = records.map((r) => {
    const prefix = `[${r.title}]`;
    const short = r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content;
    return `${prefix}${short}`;
  });
  let result = lines.join('\n');
  if (result.length > maxLength) result = result.slice(0, maxLength) + '\n…（上下文已截断）';
  return result;
}
