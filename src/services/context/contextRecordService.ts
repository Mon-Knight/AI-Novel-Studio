/**
 * AI Novel Studio - 上下文记录服务。
 *
 * 桌面端以 SQLite 为唯一事实源；浏览器开发模式才使用 localStorage。
 * Tauri IPC 失败必须向上传播，禁止静默写入另一套存储。
 */
import {
  lsGet,
  generateId,
  nowISO,
  dbCall,
  getDbMode,
} from '../database/db';
import type { ContextRecord, CreateContextRecordInput } from '../../types/context';

const KEY = 'ai_novel_studio_context_records';

function getAllLocal(): ContextRecord[] {
  return lsGet<ContextRecord[]>(KEY) ?? [];
}

function saveAllLocal(items: ContextRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function createLocalRecord(input: CreateContextRecordInput, now = nowISO()): ContextRecord {
  return {
    ...input,
    id: generateId(),
    importance: (input.importance || 3) as ContextRecord['importance'],
    isActive: input.isActive ?? true,
    isExpired: false,
    createdAt: now,
    updatedAt: now,
  };
}

export const contextRecordService = {
  async getByNovelId(novelId: string): Promise<ContextRecord[]> {
    if (getDbMode() === 'tauri') {
      const dtos = await dbCall<unknown[]>('get_context_records', { novelId });
      if (!Array.isArray(dtos)) {
        throw new Error('SQLite 返回了无效的上下文记录列表。');
      }
      return dtos.map(mapContextRecordFromTauriDto);
    }
    return getAllLocal().filter((record) => record.novelId === novelId);
  },

  async getActiveByNovelId(novelId: string): Promise<ContextRecord[]> {
    const all = await this.getByNovelId(novelId);
    return all.filter((record) => record.isActive && !record.isExpired);
  },

  async getById(id: string): Promise<ContextRecord | null> {
    if (getDbMode() === 'tauri') {
      const dto = await dbCall<unknown | null>('get_context_record', { id });
      return dto ? mapContextRecordFromTauriDto(dto) : null;
    }
    return getAllLocal().find((record) => record.id === id) ?? null;
  },

  async getForGeneration(input: {
    novelId: string;
    chapterId?: string;
    maxCount?: number;
    excludeExpired?: boolean;
  }): Promise<ContextRecord[]> {
    const active = await this.getActiveByNovelId(input.novelId);
    const filtered = input.excludeExpired !== false
      ? active.filter((record) => !record.isExpired)
      : active;
    return [...filtered]
      .sort((left, right) => right.importance - left.importance)
      .slice(0, input.maxCount || 15);
  },

  async create(input: CreateContextRecordInput): Promise<ContextRecord> {
    if (getDbMode() === 'tauri') {
      const requested = createLocalRecord(input);
      const dtos = await dbCall<unknown[]>('save_context_records', { inputs: [requested] });
      if (!Array.isArray(dtos) || !dtos[0]) {
        throw new Error('SQLite 未返回已保存的上下文记录。');
      }
      return mapContextRecordFromTauriDto(dtos[0]);
    }

    const record = createLocalRecord(input);
    const list = getAllLocal();
    list.push(record);
    saveAllLocal(list);
    return record;
  },

  async createBatch(inputs: CreateContextRecordInput[]): Promise<ContextRecord[]> {
    if (inputs.length === 0) return [];
    const now = nowISO();
    const records = inputs.map((input) => createLocalRecord(input, now));

    if (getDbMode() === 'tauri') {
      const dtos = await dbCall<unknown[]>('save_context_records', { inputs: records });
      if (!Array.isArray(dtos) || dtos.length !== records.length) {
        throw new Error('SQLite 返回的上下文记录数量与请求不一致。');
      }
      return dtos.map(mapContextRecordFromTauriDto);
    }

    const list = getAllLocal();
    list.push(...records);
    saveAllLocal(list);
    return records;
  },

  async update(id: string, input: Partial<ContextRecord>): Promise<ContextRecord | null> {
    if (getDbMode() === 'tauri') {
      const existing = await this.getById(id);
      if (!existing) return null;
      const dto = await dbCall<unknown>('update_context_record', {
        id,
        input: {
          novelId: existing.novelId,
          chapterId: input.chapterId ?? existing.chapterId ?? null,
          volumeId: input.volumeId ?? existing.volumeId ?? null,
          contextType: input.contextType ?? existing.contextType,
          title: input.title ?? existing.title,
          content: input.content ?? existing.content,
          importance: input.importance ?? existing.importance,
          isActive: input.isActive ?? existing.isActive,
          isExpired: input.isExpired ?? existing.isExpired ?? false,
          contentHash: input.contentHash ?? existing.contentHash ?? null,
          draftVersion: input.draftVersion ?? existing.draftVersion ?? null,
        },
      });
      return mapContextRecordFromTauriDto(dto);
    }

    const list = getAllLocal();
    const index = list.findIndex((record) => record.id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...input, id, updatedAt: nowISO() };
    saveAllLocal(list);
    return list[index];
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('update_context_record_active', { id, isActive });
      return;
    }

    const list = getAllLocal();
    const index = list.findIndex((record) => record.id === id);
    if (index === -1) return;
    list[index].isActive = isActive;
    list[index].updatedAt = nowISO();
    saveAllLocal(list);
  },

  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('delete_context_record', { id });
      return;
    }
    saveAllLocal(getAllLocal().filter((record) => record.id !== id));
  },
};

function readDtoValue(dto: unknown, camelKey: string, snakeKey: string): unknown {
  if (!dto || typeof dto !== 'object') return undefined;
  const record = dto as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function mapContextRecordFromTauriDto(dto: unknown): ContextRecord {
  const id = readDtoValue(dto, 'id', 'id');
  const novelId = readDtoValue(dto, 'novelId', 'novel_id');
  const contextType = readDtoValue(dto, 'contextType', 'context_type');
  const title = readDtoValue(dto, 'title', 'title');
  const content = readDtoValue(dto, 'content', 'content');
  const createdAt = readDtoValue(dto, 'createdAt', 'created_at');
  const updatedAt = readDtoValue(dto, 'updatedAt', 'updated_at');
  if (![id, novelId, contextType, title, content, createdAt, updatedAt].every((value) => typeof value === 'string')) {
    throw new Error('SQLite 返回了无效的上下文记录。');
  }

  const importance = Number(readDtoValue(dto, 'importance', 'importance'));
  return {
    id: id as string,
    novelId: novelId as string,
    chapterId: optionalString(readDtoValue(dto, 'chapterId', 'chapter_id')),
    volumeId: optionalString(readDtoValue(dto, 'volumeId', 'volume_id')),
    contextType: contextType as ContextRecord['contextType'],
    title: title as string,
    content: content as string,
    importance: (Number.isInteger(importance) && importance >= 1 && importance <= 5
      ? importance
      : 3) as ContextRecord['importance'],
    isActive: readDtoValue(dto, 'isActive', 'is_active') !== false,
    isExpired: readDtoValue(dto, 'isExpired', 'is_expired') === true,
    contentHash: optionalString(readDtoValue(dto, 'contentHash', 'content_hash')),
    draftVersion: optionalNumber(readDtoValue(dto, 'draftVersion', 'draft_version')),
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  };
}

export function buildContextSummary(records: ContextRecord[], maxLength = 1200): string {
  if (records.length === 0) return '';
  const lines = records.filter((record) => !record.isExpired).map((record) => {
    const prefix = `[${record.title}]`;
    const short = record.content.length > 200
      ? `${record.content.slice(0, 200)}…`
      : record.content;
    return `${prefix}${short}`;
  });
  let result = lines.join('\n');
  if (result.length > maxLength) result = `${result.slice(0, maxLength)}\n…（上下文已截断）`;
  return result;
}
