/**
 * AI Novel Studio - AI 正文润色 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildChapterPolishPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import type { RunPolishInput } from '../../types/polish';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiWorkflowService, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';

export const polishAiService = {
  async submitBackground(input: RunPolishInput & { sourceDraftVersion: number }): Promise<WorkflowCreated> {
    const novel = await novelRepository.getById(input.novelId);
    const request = buildChapterPolishPrompt({
      novelTitle: novel?.title || '未命名作品',
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      draftContent: input.draftContent,
      polishMode: input.options.mode,
      customInstruction: input.options.customInstruction,
    });
    const baseContentHash = await computeContentSha256(input.draftContent);
    return aiWorkflowService.createBackground({
      workflowName: `${input.chapterTitle} · 正文润色`,
      taskType: 'chapter_polish',
      novelId: input.novelId,
      chapterId: input.chapterId,
      draftId: input.sourceDraftId,
      scopeType: 'draft',
      targetHintJson: {
        chapterId: input.chapterId, draftId: input.sourceDraftId, staleAgainstLatest: true,
      },
      inputPayloadJson: { mode: input.options.mode, customInstruction: input.options.customInstruction },
      inputBody: input.draftContent,
      sourceManifestJson: [{
        type: 'chapter_draft', id: input.sourceDraftId,
        version: input.sourceDraftVersion, hash: baseContentHash,
      }],
      sourceDraftVersion: input.sourceDraftVersion,
      baseContentHash,
      steps: [{
        stepKey: 'polish', taskType: 'chapter_polish', agentRole: '润色',
        artifactType: 'chapter_text', messages: request.messages, reviewOutput: true,
      }],
    });
  },

  async runPolish(input: RunPolishInput): Promise<string> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);

    const request = buildChapterPolishPrompt({
      novelTitle: novel?.title || '未命名作品',
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      draftContent: input.draftContent,
      polishMode: input.options.mode,
      customInstruction: input.options.customInstruction,
    });

    const task = await aiTaskService.create('chapter_polish', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `润色章节「${input.chapterTitle}」，模式：${input.options.mode}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const text = response.text || '';

      // 去除 markdown 标记
      const cleaned = text
        .replace(/^【润色版[：:][^】]*】\s*/gm, '')
        .replace(/\/\/\s*润色完成[^\n]*/g, '')
        .trim();

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `润色完成（${input.options.mode}）`,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return cleaned || text; // 如果清理后为空，返回原始文本
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : '润色失败';
      if (task) await aiTaskService.markFailed(task.id, msg);
      throw err;
    }
  },
};

