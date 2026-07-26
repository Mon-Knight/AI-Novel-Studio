/**
 * AI Novel Studio - AI setting expansion service.
 */
import { aiSettingsService } from './aiClient';
import { buildSettingExpandPrompt } from './promptBuilder';
import { executeAiTask } from './aiExecutionPipeline';
import { extractJsonObject } from './jsonUtils';
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

interface SettingCandidatePayload {
  settings: SettingSuggestion[];
}

function parseSettingCandidatePayload(text: string): SettingCandidatePayload | undefined {
  const json = extractJsonObject(text);
  if (!json) return undefined;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const settings = (value as { settings?: unknown }).settings;
    return Array.isArray(settings) ? { settings: settings as SettingSuggestion[] } : undefined;
  } catch {
    return undefined;
  }
}

export const settingExpandService = {
  async suggestSettings(input: {
    novelId: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterOutline?: string;
    signal?: AbortSignal;
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

    const systemPrompt = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const execution = await executeAiTask({
      taskType: 'setting_expand',
      scopeType: input.chapterId ? 'chapter' : 'novel',
      novelId: input.novelId,
      chapterId: input.chapterId,
      expectedArtifactType: 'setting_candidates',
      request,
      settings,
      inputType: 'setting_expand_messages_v1',
      inputPayloadJson: {
        chapterId: input.chapterId,
        chapterTitle: input.chapterTitle,
      },
      sourceManifestJson: {
        sources: [
          { type: 'novel', id: novel?.id ?? input.novelId },
          ...worldSettings.map((item) => ({ type: 'world_setting', id: item.id })),
          ...activeRules.map((item) => ({ type: 'rule_system', id: item.id })),
        ],
      },
      compiledContext: systemPrompt,
      compilerVersion: 'setting_expand_prompt_v1',
      constraintPayloadJson: {
        responseSchema: 'setting_candidates_v1',
        candidateOnly: true,
      },
      promptTemplateId: 'setting/expand',
      promptTemplateVersion: '1',
      promptTemplateBody: systemPrompt,
      parseStructuredPayload: parseSettingCandidatePayload,
      signal: input.signal,
    });
    const parsed = execution.structuredPayloadJson as SettingCandidatePayload | undefined;
    const suggestions = Array.isArray(parsed?.settings)
      ? parsed.settings.filter((item) => item.name && item.description)
      : [];
    if (suggestions.length > 0) return suggestions;
    return [{
      name: 'AI 原始返回',
      category: 'other',
      description: execution.text.slice(0, 1000),
      rawText: execution.text,
    }];
  },
};
