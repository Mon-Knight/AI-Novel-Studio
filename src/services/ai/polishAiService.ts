/**
 * AI Novel Studio - AI 正文润色 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildChapterPolishPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import type { RunPolishInput } from '../../types/polish';

export const polishAiService = {
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
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `润色章节「${input.chapterTitle}」，模式：${input.options.mode}`,
    }).catch(() => null);

    try {
      const client = createAiClient();
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
      });

      return cleaned || text; // 如果清理后为空，返回原始文本
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : '润色失败';
      if (task) await aiTaskService.markFailed(task.id, msg);
      throw err;
    }
  },
};

