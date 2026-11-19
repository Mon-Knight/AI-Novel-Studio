import { chapterSummarizeService } from '../ai/chapterSummarizeService';
import { validateSummary } from '../ai/summaryValidator';
import { chapterRepository } from '../database/chapterRepository';
import { nowISO, isTauri } from '../database/db';
import { submitProductionAiEntry } from './productionAiEntryService';
import { chapterContextPersistenceService } from '../context/chapterContextPersistenceService';
import { settingSuggestionService } from '../settingSuggestions/settingSuggestionService';
import { hashTextContent } from '../../utils/contentHash';
import { AutonomousPostChapterService } from './autonomousPostChapterService';
import { autonomousPlanPersistence } from './autonomousPersistence';
import { throwIfAiRequestCancelled } from '../ai/aiCancellation';
import type { ChapterDraft } from '../../types/ai';

const browserAnalysis = new AutonomousPostChapterService({
  persistence: autonomousPlanPersistence,
  chapters: chapterRepository,
  summarizer: chapterSummarizeService,
  contextPersistence: chapterContextPersistenceService,
  hashContent: hashTextContent,
  validateSummary,
  now: nowISO,
  worldSuggestions: {
    async generate({ plan, chapter, result, signal }) {
      throwIfAiRequestCancelled(signal);
      const ids: string[] = [];
      if ((result.newLocations?.length ?? 0) > 0) {
        const locations = await settingSuggestionService.generate(
          {
            novelId: plan.novelId,
            suggestionType: 'location',
            worldType: plan.brief.genre,
            referenceStyle: '严格遵循已采用正文和既有世界规则',
            count: Math.min(5, Math.max(1, result.newLocations?.length ?? 1)),
            userInstruction: [
              `根据已采用的第 ${chapter.chapterNumber} 章补全地点候选。`,
              `新地点：${result.newLocations?.join('；')}`,
              result.settingChanges?.length ? `设定变化：${result.settingChanges.join('；')}` : '',
              '只能生成待确认候选，不得改写既有正史。',
            ]
              .filter(Boolean)
              .join('\n'),
            includeWorldSettings: true,
            includeExistingAssets: true,
          },
          { signal },
        );
        throwIfAiRequestCancelled(signal);
        ids.push(...locations.map((item) => item.id));
      }
      const ruleSeeds = [...(result.settingChanges ?? []), ...(result.newItemsOrAbilities ?? [])];
      if (ruleSeeds.length > 0) {
        const rules = await settingSuggestionService.generate(
          {
            novelId: plan.novelId,
            suggestionType: 'rule',
            worldType: plan.brief.genre,
            referenceStyle: '严格遵循已采用正文和既有世界规则',
            count: Math.min(5, ruleSeeds.length),
            userInstruction: [
              `根据已采用的第 ${chapter.chapterNumber} 章补全规则候选。`,
              `正文新增事实：${ruleSeeds.join('；')}`,
              '只能生成待确认候选，不得改写既有正史。',
            ].join('\n'),
            includeWorldSettings: true,
            includeExistingAssets: true,
          },
          { signal },
        );
        throwIfAiRequestCancelled(signal);
        ids.push(...rules.map((item) => item.id));
      }
      return ids;
    },
  },
});

export const autonomousPostChapterService = {
  markAdopted: (draft: ChapterDraft) => browserAnalysis.markAdopted(draft),
  confirmAnalysis: (input: Parameters<AutonomousPostChapterService['confirmAnalysis']>[0]) =>
    browserAnalysis.confirmAnalysis(input),
  async analyzeAdoptedChapter(planId: string, draft: ChapterDraft, signal?: AbortSignal) {
    if (!isTauri()) return browserAnalysis.analyzeAdoptedChapter(planId, draft, signal);
    const plan = await autonomousPlanPersistence.getPlan(planId);
    if (!plan || plan.novelId !== draft.novelId)
      throw new Error('自主创作计划不存在或与采用稿不匹配。');
    const run = [...(plan.chapterRuns ?? [])]
      .reverse()
      .find((run) => run.chapterId === draft.chapterId);
    await submitProductionAiEntry({
      novelId: draft.novelId,
      chapterId: draft.chapterId,
      conversationId: run?.analysis?.runtimeConversationId ?? run?.runtimeConversationId,
      modelSnapshot: run?.runtimeModelSnapshot,
      goal: '总结当前已采用章节，生成章节收束候选；不应用上下文、不修改正式规则。',
      entry: { kind: 'autonomous_post_chapter', planId, adoptedDraftId: draft.id },
      signal,
    });
    const current = await autonomousPlanPersistence.getPlan(planId);
    if (!current) throw new Error('无法读取权威章节收束结果。');
    return current;
  },
};

interface ActivePostChapterAnalysis {
  controller: AbortController;
  promise: Promise<Awaited<ReturnType<typeof autonomousPostChapterService.analyzeAdoptedChapter>>>;
}

const activePostChapterAnalyses = new Map<string, ActivePostChapterAnalysis>();

function analysisKey(planId: string, draftId: string): string {
  return `${planId}:${draftId}`;
}

export function runAutonomousPostChapterAnalysis(
  planId: string,
  draft: ChapterDraft,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof autonomousPostChapterService.analyzeAdoptedChapter>>> {
  const key = analysisKey(planId, draft.id);
  const existing = activePostChapterAnalyses.get(key);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const promise = autonomousPostChapterService
    .analyzeAdoptedChapter(planId, draft, controller.signal)
    .finally(() => {
      signal?.removeEventListener('abort', onAbort);
      const active = activePostChapterAnalyses.get(key);
      if (active?.controller === controller) activePostChapterAnalyses.delete(key);
    });
  activePostChapterAnalyses.set(key, { controller, promise });
  return promise;
}

export async function cancelAutonomousPostChapterAnalysis(
  planId: string,
  draftId?: string,
): Promise<boolean> {
  let cancelled = false;
  for (const [key, active] of activePostChapterAnalyses) {
    if (key === analysisKey(planId, draftId ?? '') || (!draftId && key.startsWith(`${planId}:`))) {
      active.controller.abort();
      cancelled = true;
    }
  }
  if (isTauri()) {
    const plan = await autonomousPlanPersistence.getPlan(planId);
    const roots = new Set(
      plan?.chapterRuns
        ?.filter(
          (run) =>
            run.analysis?.status === 'running' &&
            (!draftId || run.analysis.adoptedDraftId === draftId),
        )
        .map((run) => run.analysis?.runtimeConversationId ?? run.runtimeConversationId)
        .filter((id): id is string => Boolean(id)),
    );
    const { taskSessionAdapter } = await import('../dsh/taskSessionAdapter');
    for (const root of roots) cancelled = (await taskSessionAdapter.cancel(root)) || cancelled;
  }
  return cancelled;
}
