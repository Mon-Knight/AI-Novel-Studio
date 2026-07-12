/**
 * AI Novel Studio - AI 质量检查 (v1.7.15 接入上下文)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildQualityCheckPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { unifiedAiPipeline } from '../ai-tasks/unifiedAiPipeline';
import { normalizeProviderError } from '../ai-tasks/providerAdapter';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { getContextForChapterTask, buildContextPromptSection } from '../prompt/contextReaderService';
import type { QualityCheckResult, RunQualityCheckInput } from '../../types/qualityCheck';
import {
  parseQualityCheckResult,
  withQualityCheckStructuredRetry,
} from './qualityCheckOutput';

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

    const task = input.useUnifiedPipeline ? null : await aiTaskService.create('quality_check', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `检查章节「${input.chapterTitle}」质量，hash=${input.contentHash || 'unknown'}，字数=${input.wordCount ?? input.draftContent.length}`,
    }).catch(() => null);

    try {
      const client = withQualityCheckStructuredRetry(createAiClient(settings));
      const pipeline = input.useUnifiedPipeline ? await unifiedAiPipeline.run({
        taskType: 'quality_check',
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.draftId,
        scopeType: 'draft',
        targetHintJson: { chapterId: input.chapterId, draftId: input.draftId },
        inputSnapshot: {
          schemaVersion: 1,
          inputType: 'quality_check_input',
          payloadJson: {
            chapterTitle: input.chapterTitle,
            wordCount: input.wordCount,
          },
          body: input.draftContent,
          sourceDraftId: input.draftId,
          sourceDraftVersion: input.draftVersion,
          baseContentHash: input.contentHash,
        },
        contextSnapshot: {
          schemaVersion: 1,
          sourceManifestJson: {
            novelId: input.novelId,
            chapterId: input.chapterId,
            volumeId: input.volumeId || null,
          },
          compiledContext: request.messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'),
          budgetJson: { maxTokens: request.maxTokens || settings.maxTokens },
          compilerVersion: 'quality-context-reader-v1',
        },
        constraintSnapshot: {
          schemaVersion: 1,
          payloadJson: { artifactType: 'quality_report', readOnly: true },
          promptTemplateId: 'quality_check',
          promptTemplateVersion: '1',
          promptTemplateHash: await computeContentSha256(
            request.messages.map((message) => message.content).join('\n'),
          ),
          providerOptionsJson: {
            provider: settings.provider,
            model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
            temperature: request.temperature ?? settings.temperature,
            maxTokens: request.maxTokens ?? settings.maxTokens,
            timeoutSeconds: settings.timeoutSeconds,
          },
        },
        artifactType: 'quality_report',
        providerId: settings.provider,
        timeoutMs: (settings.timeoutSeconds ?? 120) * 1000,
        client,
        request,
        parseStructuredPayload: (text) => parseQualityCheckResult(text) ?? undefined,
      }) : null;
      const response = pipeline?.response ?? await client.generate(request);
      const text = response.text || '';

      const parsed = parseQualityCheckResult(text);
      if (!parsed) {
        throw {
          code: 'AI_PROVIDER_MALFORMED_RESPONSE',
          message: 'AI 返回结果未通过校验',
          retryable: false,
        };
      }
      if (pipeline) {
        parsed.aiTaskId = pipeline.task.taskId;
        parsed.artifactId = pipeline.artifact.artifactId;
      }

      if (task) {
        await aiTaskService.markSucceeded(task.id, {
          resultText: `评分 ${parsed.overallScore}，发现 ${parsed.items?.length || 0} 个问题`,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
        });
      }

      return parsed;
    } catch (err: unknown) {
      const normalizedError = typeof err === 'string' ? normalizeProviderError(err) : err;
      const msg = normalizedError instanceof Error
        ? normalizedError.message
        : normalizedError && typeof normalizedError === 'object' && 'message' in normalizedError
          ? String(normalizedError.message)
          : '质量检查失败';
      if (task) await aiTaskService.markFailed(task.id, msg);
      throw normalizedError;
    }
  },
};

