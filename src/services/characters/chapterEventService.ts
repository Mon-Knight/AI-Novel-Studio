/**
 * AI Novel Studio - 章节事件服务
 * 桌面端以 SQLite 为权威；浏览器开发模式才使用 localStorage。
 */
import { dbCall, lsGet, lsSet, isTauri, generateId, nowISO } from '../database/db';
import type {
  ChapterEvent,
  ChapterEventSource,
  ChapterEventStatus,
  CreateChapterEventInput,
} from '../../types/chapterEvent';

const KEY = 'ai_novel_studio_chapter_events';

interface ChapterEventDto {
  id?: unknown;
  novelId?: unknown;
  novel_id?: unknown;
  chapterId?: unknown;
  chapter_id?: unknown;
  title?: unknown;
  description?: unknown;
  involvedCharacterIds?: unknown;
  involved_character_ids?: unknown;
  impact?: unknown;
  risk?: unknown;
  status?: unknown;
  source?: unknown;
  aiTaskId?: unknown;
  ai_task_id?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
}

function getAll(): ChapterEvent[] {
  return lsGet<ChapterEvent[]>(KEY) ?? [];
}
function saveAll(items: ChapterEvent[]): void {
  lsSet(KEY, items);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function requiredString(field: string, ...values: unknown[]): string {
  const value = firstString(...values);
  if (value === undefined) throw new Error(`章节事件数据缺少 ${field}`);
  return value;
}

function parseCharacterIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

function isStatus(value: unknown): value is ChapterEventStatus {
  return (
    value === 'candidate' ||
    value === 'selected' ||
    value === 'required' ||
    value === 'forbidden' ||
    value === 'adopted' ||
    value === 'discarded'
  );
}

function isSource(value: unknown): value is ChapterEventSource {
  return value === 'manual' || value === 'ai_suggested';
}

function mapEvent(dto: ChapterEventDto): ChapterEvent {
  const status = dto.status;
  const source = dto.source;
  return {
    id: requiredString('id', dto.id),
    novelId: requiredString('novelId', dto.novelId, dto.novel_id),
    chapterId: requiredString('chapterId', dto.chapterId, dto.chapter_id),
    title: requiredString('title', dto.title),
    description: firstString(dto.description) ?? '',
    involvedCharacterIds: parseCharacterIds(dto.involvedCharacterIds ?? dto.involved_character_ids),
    impact: firstString(dto.impact),
    risk: firstString(dto.risk),
    status: isStatus(status) ? status : 'candidate',
    source: isSource(source) ? source : 'manual',
    aiTaskId: firstString(dto.aiTaskId, dto.ai_task_id),
    createdAt: requiredString('createdAt', dto.createdAt, dto.created_at),
    updatedAt: requiredString('updatedAt', dto.updatedAt, dto.updated_at),
  };
}

export const chapterEventService = {
  async getByChapterId(chapterId: string): Promise<ChapterEvent[]> {
    if (!chapterId) return [];
    if (isTauri()) {
      const list = await dbCall<ChapterEventDto[]>('list_chapter_events', { chapterId });
      return (list ?? []).map(mapEvent);
    }
    return getAll().filter((event) => event.chapterId === chapterId);
  },
  async create(input: CreateChapterEventInput): Promise<ChapterEvent> {
    if (isTauri()) {
      const dto = await dbCall<ChapterEventDto>('create_chapter_event', {
        input: {
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title,
          description: input.description,
          involvedCharacterIds: input.involvedCharacterIds,
          impact: input.impact,
          risk: input.risk,
          status: input.status,
          source: input.source,
        },
      });
      return mapEvent(dto);
    }
    const list = getAll();
    const now = nowISO();
    const ev: ChapterEvent = {
      ...input,
      id: generateId(),
      status: input.status || 'candidate',
      source: input.source || 'manual',
      createdAt: now,
      updatedAt: now,
    };
    list.push(ev);
    saveAll(list);
    return ev;
  },
  async update(id: string, input: Partial<ChapterEvent>): Promise<ChapterEvent | null> {
    if (isTauri()) {
      try {
        const dto = await dbCall<ChapterEventDto>('update_chapter_event', {
          id,
          input: {
            title: input.title,
            description: input.description,
            involvedCharacterIds: input.involvedCharacterIds,
            impact: input.impact,
            risk: input.risk,
            status: input.status,
          },
        });
        return mapEvent(dto);
      } catch {
        return null;
      }
    }
    const list = getAll();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    saveAll(list);
    return list[idx];
  },
  async setStatus(id: string, status: ChapterEventStatus): Promise<void> {
    if (isTauri()) {
      await dbCall('set_chapter_event_status', { id, status });
      return;
    }
    const list = getAll();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return;
    list[idx].status = status;
    list[idx].updatedAt = nowISO();
    saveAll(list);
  },
  async remove(id: string): Promise<void> {
    if (isTauri()) {
      await dbCall('delete_chapter_event', { id });
      return;
    }
    saveAll(getAll().filter((e) => e.id !== id));
  },
};
