/**
 * AI Novel Studio - AI 质量检查 (v1.7.15 接入上下文)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildQualityCheckPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { getContextForChapterTask, buildContextPromptSection } from '../prompt/contextReaderService';
import type { QualityCheckResult, RunQualityCheckInput } from '../../types/qualityCheck';
import type { AiGenerateOptions } from '../../types/ai';
import { safeJsonParse } from './jsonUtils';
import { isAiRequestCancelled, throwIfAiRequestCancelled } from './aiCancellation';

export const qualityCheckAiService = {
  async runCheck(input: RunQualityCheckInput, aiOptions: AiGenerateOptions = {}): Promise<QualityCheckResult> {
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
    } catch { /* non-critical */ }

    // v1.7.15 读取章节上下文用于质量检查
    let contextSummary: string | undefined;
    try {
      const ctxResult = await getContextForChapterTask({
        novelId: input.novelId, chapterId: input.chapterId,
        volumeId: input.volumeId as string | undefined,
        taskType: 'quality_check',
      });
      if (ctxResult.chapterSummaries.length > 0 || ctxResult.volumeContexts.length > 0) {
        contextSummary = buildContextPromptSection(ctxResult);
      }
    } catch { /* 上下文加载失败不影响检查 */ }

    const request = buildQualityCheckPrompt({
      novelTitle: novel?.title || '未命名作品',
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      chapterGoal: input.chapterGoal,
      draftContent: input.draftContent,
      contentHash: input.contentHash,
      wordCount: input.wordCount,
      specialAbility,
      forbiddenBehaviors,
      contextSummary,
    });

    const task = await aiTaskService.create('quality_check', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `检查章节「${input.chapterTitle}」质量，hash=${input.contentHash || 'unknown'}，字数=${input.wordCount ?? input.draftContent.length}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request, aiOptions);
      throwIfAiRequestCancelled(aiOptions.signal);
      const text = response.text || '';

      const parsed = safeJsonParse<QualityCheckResult>(text, {
        overallScore: 0,
        summary: '模型返回格式不规范，无法解析检查结果。原始返回：' + text.slice(0, 500),
        items: [],
      });

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `评分 ${parsed.overallScore}，发现 ${parsed.items?.length || 0} 个问题`,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return parsed;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '质量检查失败';
      if (task) {
        if (isAiRequestCancelled(err) || aiOptions.signal?.aborted) {
          await aiTaskService.markCancelled(task.id);
        } else {
          await aiTaskService.markFailed(task.id, msg);
        }
      }
      throw err;
    }
  },
};

