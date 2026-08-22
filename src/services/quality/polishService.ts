/**
 * AI Novel Studio - 润色记录服务（localStorage）
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { PolishRecord, CreatePolishRecordInput } from '../../types/polish';

const KEY = 'ai_novel_studio_polish_records';
function getAll(): PolishRecord[] {
  return lsGet<PolishRecord[]>(KEY) ?? [];
}
function saveAll(v: PolishRecord[]): void {
  lsSet(KEY, v);
}

export const polishService = {
  async getByChapterId(chapterId: string): Promise<PolishRecord[]> {
    return getAll().filter((r) => r.chapterId === chapterId);
  },
  async getById(id: string): Promise<PolishRecord | null> {
    return getAll().find((r) => r.id === id) ?? null;
  },
  async create(input: CreatePolishRecordInput): Promise<PolishRecord> {
    const list = getAll();
    const now = nowISO();
    const r: PolishRecord = {
      ...input,
      id: generateId(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    list.push(r);
    saveAll(list);
    return r;
  },
  async update(id: string, patch: Partial<PolishRecord>): Promise<PolishRecord | null> {
    const list = getAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: nowISO() };
    saveAll(list);
    return list[idx];
  },
  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((r) => r.id !== id));
  },
};
