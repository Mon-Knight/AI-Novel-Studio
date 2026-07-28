/**
 * AI Novel Studio - AI 正文润色 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildChapterPolishPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import type { RunPolishInput } from '../../types/polish';
import { describeUnknownError } from '../../utils/errorMessage';
import { mergePolishedSegments, splitChapterText } from './chapterTextSegmentation';
import type { AiGenerateOptions } from '../../types/ai';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from './aiTaskCancellation';

function cleanPolishText(text: string): string {
  return text
    .replace(/^【润色版[：:][^】]*】\s*/gm, '')
    .replace(/\/\/\s*润色完成[^\n]*/g, '')
    .trim();
}

export const polishAiService = {
  async runPolish(input: RunPolishInput, options: AiGenerateOptions = {}): Promise<string> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);

    const segments = splitChapterText(input.draftContent);
    if (segments.length === 0) throw new Error('润色正文为空。');

    const task = await aiTaskService
      .create('chapter_polish', {
        novelId: input.novelId,
        chapterId: input.chapterId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `润色章节「${input.chapterTitle}」，模式：${input.options.mode}`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const outputs: string[] = [];
      let tokenInput = 0;
      let tokenOutput = 0;
      let tokenTotal = 0;
      for (const segment of segments) {
        throwIfAiRequestCancelled(options.signal);
        const request = buildChapterPolishPrompt({
          novelTitle: novel?.title || '未命名作品',
          chapterTitle: input.chapterTitle,
          chapterOutline: input.chapterOutline,
          draftContent: segment.text,
          polishMode: input.options.mode,
          customInstruction: input.options.customInstruction,
          styleProfile: input.styleProfile,
          segment:
            segments.length > 1
              ? {
                  index: segment.index,
                  total: segment.total,
                  previousContext: segment.previousContext,
                  nextContext: segment.nextContext,
                }
              : undefined,
        });
        const response = await client.generate(request, options);
        throwIfAiRequestCancelled(options.signal);
        outputs.push(cleanPolishText(response.text || '') || response.text || '');
        tokenInput += response.tokenInput ?? 0;
        tokenOutput += response.tokenOutput ?? 0;
        tokenTotal +=
          response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0);
      }
      const polished = mergePolishedSegments(input.draftContent, segments, outputs);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `润色完成（${input.options.mode}，${segments.length} 段）`,
        tokenInput,
        tokenOutput,
        tokenTotal,
      });

      return polished;
    } catch (err: unknown) {
      await settleAiTaskError({
        taskId: task?.id,
        error: err,
        signal: options.signal,
        fallbackMessage: describeUnknownError(err, '润色失败'),
      });
      throw err;
    } finally {
      releaseCancellation();
    }
  },
};
