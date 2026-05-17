/**
 * AI Novel Studio - AI 质量检查 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildQualityCheckPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import type { QualityCheckResult, RunQualityCheckInput } from '../../types/qualityCheck';
import { safeJsonParse } from './jsonUtils';

export const qualityCheckAiService = {
  async runCheck(input: RunQualityCheckInput): Promise<QualityCheckResult> {
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

    const request = buildQualityCheckPrompt({
      novelTitle: novel?.title || '未命名作品',
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      chapterGoal: input.chapterGoal,
      draftContent: input.draftContent,
      specialAbility,
      forbiddenBehaviors,
    });

    const task = await aiTaskService.create('quality_check', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `检查章节「${input.chapterTitle}」质量`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
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
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : '质量检查失败';
      if (task) await aiTaskService.markFailed(task.id, msg);
      throw err;
    }
  },
};

