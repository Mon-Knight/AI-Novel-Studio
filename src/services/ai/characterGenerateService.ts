/**
 * AI Novel Studio - AI 角色生成 (v1.0.21 统一 aiClient)
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildCharacterGeneratePrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { novelRepository } from '../database/novelRepository';
import type { Character, CharacterCandidate } from '../../types/character';
import { safeJsonParse } from './jsonUtils';
import { describeUnknownError } from '../../utils/errorMessage';
import type { AiGenerateOptions } from '../../types/ai';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from './aiTaskCancellation';

export const characterGenerateService = {
  async generateCandidates(
    input: {
      novelId: string;
      chapterId: string;
      chapterTitle?: string;
      chapterOutline: string;
      existingCharacters: Character[];
    },
    options: AiGenerateOptions = {},
  ): Promise<CharacterCandidate[]> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId);
    const existingNames = input.existingCharacters.map((c) => c.name);

    // 构建 prompt
    const request = buildCharacterGeneratePrompt({
      novelTitle: novel?.title || '未命名作品',
      novelGenre: novel?.genre,
      protagonist: novel?.protagonistName,
      worldBackground: novel?.worldBackground?.slice(0, 500),
      chapterTitle: input.chapterTitle || input.chapterOutline.slice(0, 50) || '未命名章节',
      chapterOutline: input.chapterOutline,
      existingCharacterNames: existingNames,
    });

    // 创建 AI 任务记录
    const task = await aiTaskService
      .create('character_generate', {
        novelId: input.novelId,
        chapterId: input.chapterId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `为章节生成候选角色（已有角色：${existingNames.join('、') || '无'}）`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request, options);
      throwIfAiRequestCancelled(options.signal);
      const text = response.text || '';

      // 尝试 JSON 解析
      const parsed = safeJsonParse<{ characters: CharacterCandidate[] }>(text, { characters: [] });

      if (parsed.characters?.length > 0) {
        const filtered = parsed.characters.filter((c) => c.name && !existingNames.includes(c.name));
        await aiTaskService.markSucceeded(task?.id || '', {
          resultText: `生成了 ${filtered.length} 个候选角色`,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
        });
        return filtered;
      }

      // JSON 解析失败，尝试文本解析
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: '模型返回格式不规范，已尝试文本解析',
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return [
        {
          name: 'AI 原始返回',
          roleType: 'neutral',
          identity: text.slice(0, 500),
          chapterFunction: '模型未返回可解析 JSON，请根据原始文本手动整理角色。',
          rawText: text,
        } as CharacterCandidate,
      ];
    } catch (err: unknown) {
      await settleAiTaskError({
        taskId: task?.id,
        error: err,
        signal: options.signal,
        fallbackMessage: describeUnknownError(err, '角色生成失败'),
      });
      throw err;
    } finally {
      releaseCancellation();
    }
  },
};
