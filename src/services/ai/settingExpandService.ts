/**
 * AI Novel Studio - AI setting expansion service.
 */
import { aiSettingsService } from './aiClient';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { executeAiTask } from './aiExecutionPipeline';
import { extractJsonObject } from './jsonUtils';
import type { AiContextSourceInput, AiContextSourceType } from '../../types/aiCompilation';
import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { placementRuntimeService } from '../placements/placementRuntimeService';
import type { PlacementBundle } from '../../types/placement';

function compareStableText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareCreatedIdentity(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number {
  return compareStableText(left.createdAt, right.createdAt) || compareStableText(left.id, right.id);
}

export interface SettingSuggestion {
  name: string;
  category?: string;
  description: string;
  usageInChapter?: string;
  risk?: string;
  rawText?: string;
  placement?: PlacementBundle;
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
    throwIfAiRequestCancelled(input.signal);
    const settings = aiSettingsService.getSettings();
    const [novel, worldSettings, ruleSystems, chapter] = await Promise.all([
      novelRepository.getById(input.novelId),
      settingRepository.getWorldSettings(input.novelId).catch(() => []),
      settingRepository.getRuleSystems(input.novelId).catch(() => []),
      input.chapterId ? chapterRepository.getById(input.chapterId) : Promise.resolve(null),
    ]);
    throwIfAiRequestCancelled(input.signal);
    if (!novel) throw new Error('目标作品不存在，无法编译设定候选上下文。');
    if (input.chapterId && (!chapter || chapter.novelId !== input.novelId)) {
      throw new Error('目标章节不存在或不属于当前作品。');
    }

    const orderedWorldSettings = [...worldSettings].sort(compareCreatedIdentity);
    const activeWorld =
      orderedWorldSettings.find((item) => item.isActive) || orderedWorldSettings[0];
    const activeRules = ruleSystems.filter((item) => item.isActive).sort(compareCreatedIdentity);
    const sources: AiContextSourceInput[] = [
      {
        sourceType: 'novel',
        sourceId: novel.id,
        sourceVersion: novel.updatedAt,
        origin: 'sqlite',
        label: '作品基础',
        content: [
          `作品：《${novel.title}》`,
          novel.genre ? `题材：${novel.genre}` : '',
          novel.description ? `简介：${novel.description}` : '',
          novel.worldBackground ? `世界背景：${novel.worldBackground}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        order: 10,
        priority: 100,
        required: true,
        maxTokens: 2_000,
      },
    ];
    if (activeWorld) {
      sources.push({
        sourceType: 'world_setting',
        sourceId: activeWorld.id,
        sourceVersion: activeWorld.updatedAt,
        origin: 'sqlite',
        label: `世界设定：${activeWorld.title}`,
        content: activeWorld.content,
        order: 20,
        priority: 90,
        maxTokens: 2_000,
      });
    }
    activeRules.forEach((rule, index) => {
      sources.push({
        sourceType: 'rule_system',
        sourceId: rule.id,
        sourceVersion: rule.updatedAt,
        origin: 'sqlite',
        label: `规则体系：${rule.title}`,
        content: [
          rule.category ? `分类：${rule.category}` : '',
          rule.content,
          rule.forbiddenRules ? `禁止规则：${rule.forbiddenRules}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        order: 30 + index,
        priority: 80,
        maxTokens: 1_500,
      });
    });
    if (chapter) {
      sources.push({
        sourceType: 'chapter',
        sourceId: chapter.id,
        sourceVersion: chapter.updatedAt,
        origin: 'sqlite',
        label: `当前章节：${chapter.title}`,
        content:
          [
            chapter.outline ? `章节大纲：${chapter.outline}` : '',
            chapter.goal ? `章节目标：${chapter.goal}` : '',
          ]
            .filter(Boolean)
            .join('\n') || `章节：${chapter.title}`,
        order: 50,
        priority: 95,
        maxTokens: 2_000,
      });
    } else if (input.chapterTitle || input.chapterOutline) {
      sources.push({
        sourceType: 'request_context',
        sourceId: 'setting_expand_request',
        sourceVersion: '1',
        origin: 'request',
        label: '本次章节请求',
        content: [
          input.chapterTitle ? `当前章节：${input.chapterTitle}` : '',
          input.chapterOutline ? `章节大纲：${input.chapterOutline}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        order: 50,
        priority: 95,
        maxTokens: 2_000,
      });
    }
    const missingSourceTypes: AiContextSourceType[] = [
      ...(!activeWorld ? ['world_setting' as const] : []),
      ...(activeRules.length === 0 ? ['rule_system' as const] : []),
      ...(!chapter && !input.chapterTitle && !input.chapterOutline ? ['chapter' as const] : []),
    ];
    const execution = await executeAiTask({
      taskType: 'setting_expand',
      scopeType: input.chapterId ? 'chapter' : 'novel',
      novelId: input.novelId,
      chapterId: input.chapterId,
      settings,
      compilation: {
        sources,
        missingSourceTypes,
        taskInput: {
          chapterId: input.chapterId,
          hasRequestChapterTitle: Boolean(input.chapterTitle),
          hasRequestChapterOutline: Boolean(input.chapterOutline),
        },
      },
      parseStructuredPayload: parseSettingCandidatePayload,
      signal: input.signal,
    });
    throwIfAiRequestCancelled(input.signal);
    const parsed = execution.structuredPayloadJson as SettingCandidatePayload | undefined;
    const suggestions = Array.isArray(parsed?.settings)
      ? parsed.settings
          .map((item, candidateIndex) => ({ item, candidateIndex }))
          .filter(({ item }) => item.name && item.description)
      : [];
    if (suggestions.length > 0) {
      const artifact = execution.artifactBundle?.artifact;
      if (!artifact) return suggestions.map(({ item }) => item);
      const prepared: SettingSuggestion[] = [];
      for (const { item, candidateIndex } of suggestions) {
        throwIfAiRequestCancelled(input.signal);
        const placement = await placementRuntimeService.prepare({
          artifactId: artifact.artifactId,
          candidateIndex,
          expectedArtifactHash: artifact.contentHash,
        });
        throwIfAiRequestCancelled(input.signal);
        prepared.push({
          ...item,
          ...(placement.candidateJson as unknown as SettingSuggestion),
          placement,
        });
      }
      return prepared;
    }
    return [
      {
        name: 'AI 原始返回',
        category: 'other',
        description: execution.text.slice(0, 1000),
        rawText: execution.text,
      },
    ];
  },
};
