/**
 * AI Novel Studio - AI setting expansion service.
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { buildSettingExpandPrompt } from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { safeJsonParse } from './jsonUtils';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';

export interface SettingSuggestion {
  name: string;
  category?: string;
  description: string;
  usageInChapter?: string;
  risk?: string;
  rawText?: string;
}

export const settingExpandService = {
  async suggestSettings(input: {
    novelId: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterOutline?: string;
  }): Promise<SettingSuggestion[]> {
    const settings = aiSettingsService.getSettings();
    const [novel, worldSettings, ruleSystems] = await Promise.all([
      novelRepository.getById(input.novelId),
      settingRepository.getWorldSettings(input.novelId).catch(() => []),
      settingRepository.getRuleSystems(input.novelId).catch(() => []),
    ]);

    const activeWorld = worldSettings.find((item) => item.isActive) || worldSettings[0];
    const activeRules = ruleSystems.filter((item) => item.isActive);
    const request = buildSettingExpandPrompt({
      novelTitle: novel?.title || '未命名作品',
      novelGenre: novel?.genre,
      worldBackground: activeWorld?.content?.slice(0, 1200),
      ruleSystems: activeRules.map((item) => `《${item.title}》${item.content}`).join('\n').slice(0, 2000),
      chapterTitle: input.chapterTitle || '当前章节',
      chapterOutline: input.chapterOutline,
    });

    const task = await aiTaskService.create('setting_expand', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `补充设定：${input.chapterTitle || input.chapterOutline || novel?.title || '当前作品'}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<{ settings: SettingSuggestion[] }>(response.text, { settings: [] });

      const suggestions = Array.isArray(parsed.settings) ? parsed.settings.filter((item) => item.name && item.description) : [];
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: suggestions.length > 0 ? `生成了 ${suggestions.length} 条设定建议` : '模型返回格式不规范，已展示原始文本',
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      if (suggestions.length > 0) return suggestions;
      return [{
        name: 'AI 原始返回',
        category: 'other',
        description: response.text.slice(0, 1000),
        rawText: response.text,
      }];
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '设定补充失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },
};
