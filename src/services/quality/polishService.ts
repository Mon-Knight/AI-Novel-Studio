/**
 * AI Novel Studio - 润色记录服务
 *
 * 桌面端以 SQLite `polish_records` 为事实源（审计 GAP-15）；浏览器开发模式继续使用 LocalStorage。
 * 首次在桌面端读取时，把历史 LocalStorage 记录幂等 upsert 到 SQLite；引用已不存在的
 * 章节/草稿/任务的记录无法落库，会保留在 LocalStorage 里且不阻断其余迁移。
 */
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { PolishRecord, CreatePolishRecordInput } from '../../types/polish';

const KEY = 'ai_novel_studio_polish_records';
export const POLISH_RECORDS_SQLITE_MIGRATION_KEY = 'ai_novel_studio_polish_records_sqlite_v1';

function localGetAll(): PolishRecord[] {
  return lsGet<PolishRecord[]>(KEY) ?? [];
}

function localSaveAll(v: PolishRecord[]): void {
  lsSet(KEY, v);
}

function fromDto(dto: Record<string, unknown>): PolishRecord {
  return {
    id: String(dto.id),
    novelId: String(dto.novelId),
    chapterId: String(dto.chapterId),
    sourceDraftId: String(dto.sourceDraftId),
    resultDraftId: (dto.resultDraftId as string | null) ?? undefined,
    mode: dto.mode as PolishRecord['mode'],
    instruction: (dto.instruction as string | null) ?? undefined,
    aiTaskId: (dto.aiTaskId as string | null) ?? undefined,
    status: dto.status as PolishRecord['status'],
    errorMessage: (dto.errorMessage as string | null) ?? undefined,
    createdAt: String(dto.createdAt),
    updatedAt: String(dto.updatedAt),
  };
}

async function ensureDesktopMigrated(): Promise<void> {
  if (lsGet<boolean>(POLISH_RECORDS_SQLITE_MIGRATION_KEY)) return;
  for (const record of localGetAll()) {
    try {
      const existing = await dbCall<Record<string, unknown> | null>('get_polish_record', {
        recordId: record.id,
      });
      if (existing) continue;
      await dbCall('create_polish_record', {
        input: {
          id: record.id,
          novelId: record.novelId,
          chapterId: record.chapterId,
          sourceDraftId: record.sourceDraftId,
          resultDraftId: record.resultDraftId ?? null,
          mode: record.mode,
          instruction: record.instruction ?? null,
          aiTaskId: record.aiTaskId ?? null,
          status: record.status,
          errorMessage: record.errorMessage ?? null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
      });
    } catch {
      // Orphaned rows (deleted chapter/draft/task) cannot satisfy SQLite ownership checks.
    }
  }
  lsSet(POLISH_RECORDS_SQLITE_MIGRATION_KEY, true);
}

export const polishService = {
  async getByChapterId(chapterId: string): Promise<PolishRecord[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const rows = await dbCall<Record<string, unknown>[]>('list_polish_records', { chapterId });
      return rows.map(fromDto);
    }
    return localGetAll().filter((r) => r.chapterId === chapterId);
  },
  async getById(id: string): Promise<PolishRecord | null> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const dto = await dbCall<Record<string, unknown> | null>('get_polish_record', {
        recordId: id,
      });
      return dto ? fromDto(dto) : null;
    }
    return localGetAll().find((r) => r.id === id) ?? null;
  },
  async create(input: CreatePolishRecordInput): Promise<PolishRecord> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const dto = await dbCall<Record<string, unknown>>('create_polish_record', {
        input: {
          novelId: input.novelId,
          chapterId: input.chapterId,
          sourceDraftId: input.sourceDraftId,
          mode: input.mode,
          instruction: input.instruction ?? null,
        },
      });
      return fromDto(dto);
    }
    const list = localGetAll();
    const now = nowISO();
    const r: PolishRecord = {
      ...input,
      id: generateId(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    list.push(r);
    localSaveAll(list);
    return r;
  },
  async update(id: string, patch: Partial<PolishRecord>): Promise<PolishRecord | null> {
    if (getDbMode() === 'tauri') {
      const dto = await dbCall<Record<string, unknown> | null>('update_polish_record', {
        input: {
          id,
          resultDraftId: patch.resultDraftId,
          aiTaskId: patch.aiTaskId,
          status: patch.status,
          errorMessage: patch.errorMessage,
        },
      });
      return dto ? fromDto(dto) : null;
    }
    const list = localGetAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: nowISO() };
    localSaveAll(list);
    return list[idx];
  },
  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<void>('delete_polish_record', { recordId: id });
      return;
    }
    localSaveAll(localGetAll().filter((r) => r.id !== id));
  },
};
