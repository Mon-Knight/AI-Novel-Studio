/**
 * AI Novel Studio - AI 质量检查 (v1.7.15 接入上下文)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildQualityCheckPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import {
  getContextForChapterTask,
  buildContextPromptSection,
} from '../prompt/contextReaderService';
import type { QualityCheckResult, RunQualityCheckInput } from '../../types/qualityCheck';
import type { AiGenerateOptions } from '../../types/ai';
import { safeJsonParse } from './jsonUtils';
import { isAiRequestCancelled, throwIfAiRequestCancelled } from './aiCancellation';
import { splitChapterText } from './chapterTextSegmentation';
import { bindAiTaskCancellation } from './aiTaskCancellation';

export const qualityCheckAiService = {
  async runCheck(
    input: RunQualityCheckInput,
    aiOptions: AiGenerateOptions = {},
  ): Promise<QualityCheckResult & { aiTaskId: string }> {
    throwIfAiRequestCancelled(aiOptions.signal);
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);

    let specialAbility: string | undefined;
    let forbiddenBehaviors: string | undefined;
    try {
      const protag = await protagonistRepository.getByNovelId(input.novelId);
      if (protag) {
        specialAbility = protag.specialAbility?.trim();
        forbiddenBehaviors = protag.forbiddenBehaviors?.trim();
      }
    } catch {
      /* non-critical */
    }

    // v1.7.15 读取章节上下文用于质量检查
    let contextSummary: string | undefined;
    try {
      const ctxResult = await getContextForChapterTask({
        novelId: input.novelId,
        chapterId: input.chapterId,
        volumeId: input.volumeId as string | undefined,
        taskType: 'quality_check',
      });
      if (ctxResult.chapterSummaries.length > 0 || ctxResult.volumeContexts.length > 0) {
        contextSummary = buildContextPromptSection(ctxResult);
      }
    } catch {
      /* 上下文加载失败不影响检查 */
    }

    const segments = splitChapterText(input.draftContent);
    if (segments.length === 0) throw new Error('质量检查正文为空。');

    const task = await aiTaskService.create('quality_check', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `检查章节「${input.chapterTitle}」质量，hash=${input.contentHash || 'unknown'}，字数=${input.wordCount ?? input.draftContent.length}`,
    });
    const releaseCancellation = bindAiTaskCancellation(task.id, aiOptions);

    try {
      const client = createAiClient(settings);
      const results: Array<QualityCheckResult & { length: number }> = [];
      let tokenInput = 0;
      let tokenOutput = 0;
      let tokenTotal = 0;
      for (const segment of segments) {
        throwIfAiRequestCancelled(aiOptions.signal);
        const request = buildQualityCheckPrompt({
          novelTitle: novel?.title || '未命名作品',
          chapterTitle: input.chapterTitle,
          chapterOutline: input.chapterOutline,
          chapterGoal: input.chapterGoal,
          draftContent: segment.text,
          contentHash: input.contentHash,
          wordCount: input.wordCount,
          specialAbility,
          forbiddenBehaviors,
          contextSummary,
          segment:
            segments.length > 1
              ? {
                  index: segment.index,
                  total: segment.total,
                  startOffset: segment.startOffset,
                  paragraphStart: segment.paragraphStart,
                  previousContext: segment.previousContext,
                  nextContext: segment.nextContext,
                }
              : undefined,
        });
        const response = await client.generate(request, aiOptions);
        throwIfAiRequestCancelled(aiOptions.signal);
        const text = response.text || '';
        const parsed = safeJsonParse<QualityCheckResult>(text, {
          overallScore: 0,
          summary: `第 ${segment.index + 1} 段返回格式不规范：${text.slice(0, 300)}`,
          items: [],
        });
        results.push({
          ...parsed,
          length: segment.text.length,
          items: (parsed.items ?? []).map((item) => ({
            ...item,
            startOffset:
              item.startOffset === undefined ? undefined : segment.startOffset + item.startOffset,
            endOffset:
              item.endOffset === undefined ? undefined : segment.startOffset + item.endOffset,
            paragraphIndex:
              item.paragraphIndex === undefined
                ? undefined
                : segment.paragraphStart + item.paragraphIndex,
          })),
        });
        tokenInput += response.tokenInput ?? 0;
        tokenOutput += response.tokenOutput ?? 0;
        tokenTotal +=
          response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0);
      }
      const totalLength = results.reduce((sum, result) => sum + result.length, 0);
      const parsed: QualityCheckResult = {
        overallScore: Math.round(
          results.reduce((sum, result) => sum + result.overallScore * result.length, 0) /
            Math.max(1, totalLength),
        ),
        summary:
          results.length === 1
            ? results[0].summary
            : results.map((result, index) => `第 ${index + 1} 段：${result.summary}`).join('\n'),
        items: results.flatMap((result) => result.items ?? []),
      };

      await aiTaskService.markSucceeded(task.id, {
        resultText: `评分 ${parsed.overallScore}，发现 ${parsed.items?.length || 0} 个问题`,
        tokenInput,
        tokenOutput,
        tokenTotal,
      });

      return { ...parsed, aiTaskId: task.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '质量检查失败';
      if (isAiRequestCancelled(err) || aiOptions.signal?.aborted) {
        await aiTaskService.markCancelled(task.id);
      } else {
        await aiTaskService.markFailed(task.id, msg);
      }
      throw err;
    } finally {
      releaseCancellation();
    }
  },
};
