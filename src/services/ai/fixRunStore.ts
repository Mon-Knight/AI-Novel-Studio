/**
 * AI Novel Studio - 质量修稿记录持久化（localStorage）
 * v1.7.16: 补充 fixRun 持久化，重启后不丢失
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { QualityFixRun } from '../ai/qualityFixService';

const KEY = 'ai_novel_studio_fix_runs';

function getAll(): QualityFixRun[] { return lsGet<QualityFixRun[]>(KEY) ?? []; }
function saveAll(items: QualityFixRun[]): void { lsSet(KEY, items); }

export const fixRunStore = {
  getByChapterId(chapterId: string): QualityFixRun[] {
    return getAll().filter((r) => r.chapterId === chapterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  getLatest(chapterId: string): QualityFixRun | null {
    return this.getByChapterId(chapterId)[0] ?? null;
  },

  getById(id: string): QualityFixRun | null {
    return getAll().find((r) => r.id === id) ?? null;
  },

  save(fixRun: QualityFixRun): QualityFixRun {
    const list = getAll();
    const idx = list.findIndex((r) => r.id === fixRun.id);
    const r = { ...fixRun, updatedAt: nowISO() };
    if (idx >= 0) {
      list[idx] = r;
    } else {
      r.id = r.id || generateId();
      r.createdAt = r.createdAt || nowISO();
      list.push(r);
    }
    saveAll(list);
    return r;
  },

  updateStatus(id: string, status: QualityFixRun['status']): QualityFixRun | null {
    const list = getAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx].status = status;
    list[idx].updatedAt = nowISO();
    saveAll(list);
    return list[idx];
  },
};
