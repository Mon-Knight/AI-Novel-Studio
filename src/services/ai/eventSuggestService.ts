/**
 * AI Novel Studio - AI 事件建议 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildEventSuggestPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { contextRecordService, buildContextSummary } from '../context/contextRecordService';
import type { Character } from '../../types/character';

export interface EventSuggestion {
  title: string;
  type?: string;
  description: string;
  involvedCharacterIds?: string[];
  impact?: string;
  risk?: string;
  mustHappen?: boolean;
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    let json = text.trim();
    const m = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) json = m[1].trim();
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const eventSuggestService = {
  async suggestEvents(input: {
    novelId: string;
    chapterId: string;
    chapterOutline: string;
    characters: Character[];
    previousSummary?: string;
  }): Promise<EventSuggestion[]> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);
    const characterNames = input.characters.map((c) => c.name);

    // 加载分卷信息和上下文
    let volumeGoal: string | undefined;
    let previousContext: string | undefined;
    try {
      const chapters = await (await import('../database/chapterRepository')).chapterRepository.getByNovelId(input.novelId);
      const chapter = chapters.find((c) => c.id === input.chapterId);
      if (chapter?.volumeId) {
        const vol = await volumeRepository.getById(chapter.volumeId);
        volumeGoal = vol?.goal?.trim() || undefined;
      }
    } catch { /* non-critical */ }
    try {
      const records = await contextRecordService.getForGeneration({ novelId: input.novelId, maxCount: 10 });
      if (records.length > 0) previousContext = buildContextSummary(records);
    } catch { /* non-critical */ }

    const request = buildEventSuggestPrompt({
      novelTitle: novel?.title || '未命名作品',
      novelGenre: novel?.genre,
      protagonist: novel?.protagonistName,
      chapterTitle: input.chapterOutline.slice(0, 50) || '未命名章节',
      chapterOutline: input.chapterOutline,
      volumeGoal,
      previousContext: input.previousSummary || previousContext,
      existingEvents: [],
      characterNames,
    });

    const task = await aiTaskService.create('event_suggest', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `为章节推荐关键事件（出场角色：${characterNames.join('、') || '无'}）`,
    }).catch(() => null);

    try {
      const client = createAiClient();
      const response = await client.generate(request);
      const text = response.text || '';

      const parsed = safeJsonParse<{ events: EventSuggestion[] }>(text, { events: [] });

      if (parsed.events?.length > 0) {
        await aiTaskService.markSucceeded(task?.id || '', {
          resultText: `推荐了 ${parsed.events.length} 个候选事件`,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
        });
        return parsed.events.map((e) => ({
          ...e,
          mustHappen: e.mustHappen || false,
          involvedCharacterIds: input.characters.slice(0, 2).map((c) => c.id),
        }));
      }

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: '模型返回格式不规范',
      });
      return [];
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : '事件推荐失败';
      if (task) await aiTaskService.markFailed(task.id, msg);
      throw err;
    }
  },
};

