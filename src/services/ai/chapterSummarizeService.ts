/**
 * AI Novel Studio - AI chapter context summarization.
 */
import type { ChapterSummarizeResult, SummarizeAdoptedChapterInput } from '../../types/chapterSummary';
import type { ContextRecordType } from '../../types/context';
import { createAiClient, aiSettingsService } from './aiClient';
import { aiTaskService } from './aiTaskService';
import { buildChapterSummarizePrompt } from './promptBuilder';
import { safeJsonParse } from './jsonUtils';
import { novelRepository } from '../database/novelRepository';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiWorkflowService, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';

function normalizeImportance(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 3;
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5;
}

function normalizeContextType(value: unknown): ContextRecordType {
  const allowed: ContextRecordType[] = ['chapter_summary', 'volume_summary', 'character_state', 'foreshadow', 'rule', 'relationship', 'plot_progress', 'other'];
  return allowed.includes(value as ContextRecordType) ? value as ContextRecordType : 'other';
}

function normalizeResult(result: Partial<ChapterSummarizeResult>, fallbackText: string): ChapterSummarizeResult {
  return {
    summary: result.summary?.trim() || fallbackText.slice(0, 800) || '模型返回了空总结。',
    keyEvents: Array.isArray(result.keyEvents) ? result.keyEvents.map(String).filter(Boolean) : [],
    characterChanges: Array.isArray(result.characterChanges) ? result.characterChanges.map((item: any) => ({
      characterName: String(item.characterName || item.name || '未命名角色'),
      characterId: typeof item.characterId === 'string' ? item.characterId : undefined,
      stateSummary: String(item.stateSummary || item.summary || ''),
      relationshipChanges: item.relationshipChanges ? String(item.relationshipChanges) : undefined,
      goalChanges: item.goalChanges ? String(item.goalChanges) : undefined,
      location: item.location ? String(item.location) : undefined,
      healthState: item.healthState ? String(item.healthState) : undefined,
      knowledgeState: item.knowledgeState ? String(item.knowledgeState) : undefined,
    })).filter((item) => item.stateSummary) : [],
    relationshipChanges: Array.isArray(result.relationshipChanges) ? result.relationshipChanges.map((item: any) => ({
      fromCharacterName: String(item.fromCharacterName || item.from || ''),
      toCharacterName: String(item.toCharacterName || item.to || ''),
      change: String(item.change || ''),
    })).filter((item) => item.fromCharacterName || item.toCharacterName || item.change) : [],
    newForeshadows: Array.isArray(result.newForeshadows) ? result.newForeshadows.map(String).filter(Boolean) : [],
    resolvedForeshadows: Array.isArray(result.resolvedForeshadows) ? result.resolvedForeshadows.map(String).filter(Boolean) : [],
    nextChapterHints: result.nextChapterHints?.trim() || '',
    contextRecords: Array.isArray(result.contextRecords) ? result.contextRecords.map((item: any) => ({
      contextType: normalizeContextType(item.contextType),
      title: String(item.title || '上下文记录'),
      content: String(item.content || ''),
      importance: normalizeImportance(item.importance),
    })).filter((item) => item.content) : [],
  };
}

export const chapterSummarizeService = {
  async submitBackground(input: SummarizeAdoptedChapterInput & { sourceDraftVersion: number }): Promise<WorkflowCreated> {
    const novel = await novelRepository.getById(input.novelId).catch(() => null);
    const request = buildChapterSummarizePrompt({
      novelTitle: novel?.title,
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      adoptedContent: input.adoptedContent,
      chapterCharacters: input.chapterCharacters,
      chapterEvents: input.chapterEvents,
    });
    const baseContentHash = await computeContentSha256(input.adoptedContent);
    return aiWorkflowService.createBackground({
      workflowName: `${input.chapterTitle} · 章节摘要`,
      taskType: 'chapter_summary',
      novelId: input.novelId,
      chapterId: input.chapterId,
      draftId: input.adoptedDraftId,
      scopeType: 'draft',
      targetHintJson: {
        chapterId: input.chapterId, draftId: input.adoptedDraftId, staleAgainstLatest: true,
      },
      inputPayloadJson: { chapterTitle: input.chapterTitle, chapterOutline: input.chapterOutline },
      inputBody: input.adoptedContent,
      sourceManifestJson: [{
        type: 'chapter_draft', id: input.adoptedDraftId,
        version: input.sourceDraftVersion, hash: baseContentHash,
      }],
      sourceDraftVersion: input.sourceDraftVersion,
      baseContentHash,
      steps: [{
        stepKey: 'chapter_summary', taskType: 'chapter_summary', agentRole: '摘要',
        artifactType: 'chapter_summary', messages: request.messages, reviewOutput: true,
      }],
    });
  },

  async summarize(input: SummarizeAdoptedChapterInput): Promise<ChapterSummarizeResult> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId).catch(() => null);
    const request = buildChapterSummarizePrompt({
      novelTitle: novel?.title,
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      adoptedContent: input.adoptedContent,
      chapterCharacters: input.chapterCharacters,
      chapterEvents: input.chapterEvents,
    });

    const task = await aiTaskService.create('context_summarize', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `总结章节「${input.chapterTitle}」`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<Partial<ChapterSummarizeResult>>(response.text, {});
      const result = normalizeResult(parsed, response.text);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: result.summary,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '章节总结失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },
};
