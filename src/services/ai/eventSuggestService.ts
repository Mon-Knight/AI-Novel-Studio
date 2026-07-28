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
import { safeJsonParse } from './jsonUtils';
import { describeUnknownError } from '../../utils/errorMessage';
import type { AiGenerateOptions } from '../../types/ai';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from './aiTaskCancellation';

export interface EventSuggestion {
  title: string;
  type?: string;
  description: string;
  involvedCharacterIds?: string[];
  impact?: string;
  risk?: string;
  mustHappen?: boolean;
  rawText?: string;
}

export const eventSuggestService = {
  async suggestEvents(
    input: {
      novelId: string;
      chapterId: string;
      chapterTitle?: string;
      chapterOutline: string;
      characters: Character[];
      previousSummary?: string;
    },
    options: AiGenerateOptions = {},
  ): Promise<EventSuggestion[]> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);
    const characterNames = input.characters.map((c) => c.name);

    // 加载分卷信息和上下文
    let volumeGoal: string | undefined;
    let previousContext: string | undefined;
    try {
      const chapters = await (
        await import('../database/chapterRepository')
      ).chapterRepository.getByNovelId(input.novelId);
      const chapter = chapters.find((c) => c.id === input.chapterId);
      if (chapter?.volumeId) {
        const vol = await volumeRepository.getById(chapter.volumeId);
        volumeGoal = vol?.goal?.trim() || undefined;
      }
    } catch {
      /* non-critical */
    }
    try {
      const records = await contextRecordService.getForGeneration({
        novelId: input.novelId,
        maxCount: 10,
      });
      if (records.length > 0) previousContext = buildContextSummary(records);
    } catch {
      /* non-critical */
    }

    const request = buildEventSuggestPrompt({
      novelTitle: novel?.title || '未命名作品',
      novelGenre: novel?.genre,
      protagonist: novel?.protagonistName,
      chapterTitle: input.chapterTitle || input.chapterOutline.slice(0, 50) || '未命名章节',
      chapterOutline: input.chapterOutline,
      volumeGoal,
      previousContext: input.previousSummary || previousContext,
      existingEvents: [],
      characterNames,
    });

    const task = await aiTaskService
      .create('event_suggest', {
        novelId: input.novelId,
        chapterId: input.chapterId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `为章节推荐关键事件（出场角色：${characterNames.join('、') || '无'}）`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request, options);
      throwIfAiRequestCancelled(options.signal);
      const text = response.text || '';

      const parsed = safeJsonParse<{ events: EventSuggestion[] }>(text, { events: [] });

      if (parsed.events?.length > 0) {
        await aiTaskService.markSucceeded(task?.id || '', {
          resultText: `推荐了 ${parsed.events.length} 个候选事件`,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
        });
        return parsed.events.map((e) => ({
          ...e,
          mustHappen: e.mustHappen || false,
          involvedCharacterIds: input.characters.slice(0, 2).map((c) => c.id),
        }));
      }

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: '模型返回格式不规范，已展示原始文本',
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return [
        {
          title: 'AI 原始返回',
          description: text.slice(0, 1000),
          rawText: text,
          mustHappen: false,
        },
      ];
    } catch (err: unknown) {
      await settleAiTaskError({
        taskId: task?.id,
        error: err,
        signal: options.signal,
        fallbackMessage: describeUnknownError(err, '事件推荐失败'),
      });
      throw err;
    } finally {
      releaseCancellation();
    }
  },
};
