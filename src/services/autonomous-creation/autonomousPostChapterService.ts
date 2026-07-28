import type { AiGenerateOptions, ChapterDraft } from '../../types/ai';
import { isAiRequestCancelled, throwIfAiRequestCancelled } from '../ai/aiCancellation';
import type { AutonomousChapterRun, AutonomousStoryPlan } from '../../types/autonomousCreation';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import type {
  SaveChapterContextBundleInput,
  SaveChapterContextBundleResult,
} from '../context/chapterContextPersistenceService';
import type { AutonomousPlanPersistence } from './autonomousPersistence';

interface ChapterGateway {
  getById(chapterId: string): Promise<Chapter | null>;
}

interface ChapterSummarizer {
  summarize(
    input: {
      novelId: string;
      chapterId: string;
      adoptedDraftId: string;
      chapterTitle: string;
      chapterOutline?: string;
      adoptedContent: string;
    },
    options?: AiGenerateOptions,
  ): Promise<ChapterSummarizeResult>;
}

interface WorldSuggestionGateway {
  generate(input: {
    plan: AutonomousStoryPlan;
    chapter: Chapter;
    result: ChapterSummarizeResult;
    signal?: AbortSignal;
  }): Promise<string[]>;
}

export interface AutonomousPostChapterDependencies {
  persistence: AutonomousPlanPersistence;
  chapters: ChapterGateway;
  summarizer: ChapterSummarizer;
  worldSuggestions: WorldSuggestionGateway;
  contextPersistence: {
    save(input: SaveChapterContextBundleInput): Promise<SaveChapterContextBundleResult>;
  };
  hashContent: (content: string) => string;
  validateSummary: (
    content: string,
    result: ChapterSummarizeResult,
  ) => {
    passed: boolean;
    score: number;
    problems: Array<{
      type:
        | 'fabrication'
        | 'omission'
        | 'character_error'
        | 'setting_error'
        | 'spoiler'
        | 'speculation'
        | 'quality_conflict';
      message: string;
    }>;
    safeToContext: boolean;
  };
  now: () => string;
}

function errorMessage(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason || '章节收束失败'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function runs(plan: AutonomousStoryPlan): AutonomousChapterRun[] {
  return plan.chapterRuns ?? [];
}

function replaceRun(
  plan: AutonomousStoryPlan,
  run: AutonomousChapterRun,
  checkpoint: string,
  now: string,
): AutonomousStoryPlan {
  const current = runs(plan);
  const index = current.findIndex((item) => item.runId === run.runId);
  const next = [...current];
  if (index >= 0) next[index] = run;
  else next.push(run);
  return {
    ...plan,
    chapterRuns: next,
    progress: { ...plan.progress, lastCheckpoint: checkpoint },
    updatedAt: now,
  };
}

function latestChapterRun(
  plan: AutonomousStoryPlan,
  chapterId: string,
): AutonomousChapterRun | undefined {
  return [...runs(plan)].reverse().find((item) => item.chapterId === chapterId);
}

function completeVolumeIds(plan: AutonomousStoryPlan): string[] {
  return plan.volumes
    .filter((volume) =>
      plan.chapters
        .filter((chapter) => chapter.volumeId === volume.id)
        .every((chapter) => chapter.status === 'adopted'),
    )
    .map((volume) => volume.id);
}

function currentVolumeIndex(plan: AutonomousStoryPlan): number {
  const next = plan.chapters.find((chapter) => chapter.status !== 'adopted');
  if (!next) return plan.volumes.length;
  return Math.max(
    0,
    plan.volumes.findIndex((volume) => volume.id === next.volumeId),
  );
}

function resolveCharacterIds(
  plan: AutonomousStoryPlan,
  result: ChapterSummarizeResult,
): ChapterSummarizeResult {
  const byName = new Map(plan.characters.map((character) => [character.name.trim(), character.id]));
  return {
    ...result,
    characterChanges: result.characterChanges.map((change) => ({
      ...change,
      characterId: change.characterId || byName.get(change.characterName.trim()),
    })),
  };
}

export class AutonomousPostChapterService {
  constructor(private readonly dependencies: AutonomousPostChapterDependencies) {}

  private async findAppliedPlan(
    novelId: string,
    chapterId: string,
  ): Promise<AutonomousStoryPlan | null> {
    const plans = await this.dependencies.persistence.listPlansByNovel(novelId, 100);
    return (
      plans.find(
        (plan) =>
          plan.status === 'applied' && plan.chapters.some((chapter) => chapter.id === chapterId),
      ) ?? null
    );
  }

  private async saveRun(
    plan: AutonomousStoryPlan,
    run: AutonomousChapterRun,
    checkpoint: string,
  ): Promise<AutonomousStoryPlan> {
    return this.dependencies.persistence.savePlan(
      replaceRun(plan, run, checkpoint, this.dependencies.now()),
      plan.revision,
    );
  }

  async markAdopted(draft: ChapterDraft): Promise<AutonomousStoryPlan | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plan = await this.findAppliedPlan(draft.novelId, draft.chapterId);
      if (!plan) return null;
      const chapter = plan.chapters.find((item) => item.id === draft.chapterId);
      if (!chapter) return null;
      const existing = latestChapterRun(plan, chapter.id);
      if (
        chapter.status === 'adopted' &&
        existing?.status === 'adopted' &&
        existing.adoptedDraftId === draft.id
      ) {
        return plan;
      }
      const adoptedDraftChanged = existing?.adoptedDraftId !== draft.id;
      const now = this.dependencies.now();
      const run: AutonomousChapterRun = {
        ...(existing ?? {
          runId: `adoption:${chapter.id}`,
          operationId: `autonomous-adoption:${draft.id}`,
          chapterId: chapter.id,
          chapterNumber: chapter.chapterNumber,
          plannedCharacterBeatIds: [...chapter.characterBeatIds],
          confirmedCharacterBeatIds: [],
          createdAt: now,
        }),
        status: 'adopted',
        adoptedDraftId: draft.id,
        confirmedCharacterBeatIds: adoptedDraftChanged
          ? []
          : (existing?.confirmedCharacterBeatIds ?? []),
        analysis: adoptedDraftChanged ? undefined : existing?.analysis,
        errorMessage: undefined,
        updatedAt: now,
      };
      const chapters = plan.chapters.map((item) =>
        item.id === chapter.id ? { ...item, status: 'adopted' as const } : item,
      );
      const adoptedChapterNumbers = [
        ...new Set([...plan.progress.adoptedChapterNumbers, chapter.chapterNumber]),
      ].sort((left, right) => left - right);
      const updatedBase: AutonomousStoryPlan = {
        ...plan,
        chapters,
        progress: {
          ...plan.progress,
          adoptedChapterNumbers,
        },
      };
      const updated = replaceRun(
        updatedBase,
        run,
        `第 ${chapter.chapterNumber} 章已采用，等待章节收束确认`,
        now,
      );
      updated.progress.completedVolumeIds = completeVolumeIds(updated);
      updated.progress.currentVolumeIndex = currentVolumeIndex(updated);
      try {
        return await this.dependencies.persistence.savePlan(updated, plan.revision);
      } catch (reason) {
        if (attempt === 2) throw reason;
      }
    }
    return null;
  }

  async analyzeAdoptedChapter(
    planId: string,
    draft: ChapterDraft,
    signal?: AbortSignal,
  ): Promise<AutonomousStoryPlan> {
    throwIfAiRequestCancelled(signal);
    let plan = await this.dependencies.persistence.getPlan(planId);
    throwIfAiRequestCancelled(signal);
    if (!plan || plan.status !== 'applied') throw new Error('自主创作计划不存在或尚未应用。');
    const plannedChapter = plan.chapters.find((item) => item.id === draft.chapterId);
    const chapter = await this.dependencies.chapters.getById(draft.chapterId);
    throwIfAiRequestCancelled(signal);
    if (!plannedChapter || !chapter || chapter.novelId !== draft.novelId || !draft.isAdopted) {
      throw new Error('章节采用身份与自主创作计划不一致。');
    }
    let run = latestChapterRun(plan, chapter.id);
    if (!run || run.adoptedDraftId !== draft.id) {
      const marked = await this.markAdopted(draft);
      if (!marked) throw new Error('章节不属于已应用的自主创作计划。');
      plan = marked;
      run = latestChapterRun(plan, chapter.id);
    }
    if (!run) throw new Error('章节采用状态不存在。');
    if (
      run.analysis?.adoptedDraftId === draft.id &&
      (run.analysis.status === 'pending_confirmation' || run.analysis.status === 'confirmed')
    ) {
      return plan;
    }

    run = {
      ...run,
      analysis: {
        status: 'running',
        adoptedDraftId: draft.id,
        worldSuggestionIds: [],
        updatedAt: this.dependencies.now(),
      },
      updatedAt: this.dependencies.now(),
    };
    throwIfAiRequestCancelled(signal);
    plan = await this.saveRun(plan, run, `正在分析第 ${chapter.chapterNumber} 章的实际变化`);

    try {
      const analyzed = resolveCharacterIds(
        plan,
        await this.dependencies.summarizer.summarize(
          {
            novelId: draft.novelId,
            chapterId: chapter.id,
            adoptedDraftId: draft.id,
            chapterTitle: chapter.title,
            chapterOutline: chapter.outline,
            adoptedContent: draft.content,
          },
          { signal },
        ),
      );
      throwIfAiRequestCancelled(signal);
      run = {
        ...run,
        analysis: {
          status: 'pending_confirmation',
          adoptedDraftId: draft.id,
          result: analyzed,
          worldSuggestionIds: [],
          updatedAt: this.dependencies.now(),
        },
        updatedAt: this.dependencies.now(),
      };
      plan = await this.saveRun(plan, run, `第 ${chapter.chapterNumber} 章分析待确认`);
      throwIfAiRequestCancelled(signal);

      let suggestionIds: string[] = [];
      let suggestionError: string | undefined;
      try {
        suggestionIds = await this.dependencies.worldSuggestions.generate({
          plan,
          chapter,
          result: analyzed,
          signal,
        });
      } catch (reason) {
        if (signal?.aborted || isAiRequestCancelled(reason)) throw reason;
        suggestionError = errorMessage(reason);
      }
      throwIfAiRequestCancelled(signal);
      const latest = await this.dependencies.persistence.getPlan(plan.planId);
      if (!latest) throw new Error('章节分析保存后无法重新读取。');
      const latestRun = latestChapterRun(latest, chapter.id);
      if (!latestRun?.analysis || latestRun.analysis.adoptedDraftId !== draft.id) return latest;
      const withSuggestions: AutonomousChapterRun = {
        ...latestRun,
        analysis: {
          ...latestRun.analysis,
          worldSuggestionIds: suggestionIds,
          errorMessage: suggestionError,
          updatedAt: this.dependencies.now(),
        },
        updatedAt: this.dependencies.now(),
      };
      return this.saveRun(
        latest,
        withSuggestions,
        suggestionError
          ? `第 ${chapter.chapterNumber} 章分析待确认，世界扩展候选生成失败`
          : `第 ${chapter.chapterNumber} 章分析和世界扩展候选待确认`,
      );
    } catch (reason) {
      const cancelled = signal?.aborted || isAiRequestCancelled(reason);
      const latest = await this.dependencies.persistence.getPlan(plan.planId).catch(() => null);
      if (latest) {
        const latestRun = latestChapterRun(latest, chapter.id) ?? run;
        const failed: AutonomousChapterRun = {
          ...latestRun,
          analysis: {
            status: cancelled ? 'cancelled' : 'failed',
            adoptedDraftId: draft.id,
            worldSuggestionIds: latestRun.analysis?.worldSuggestionIds ?? [],
            errorMessage: cancelled ? undefined : errorMessage(reason),
            updatedAt: this.dependencies.now(),
          },
          updatedAt: this.dependencies.now(),
        };
        await this.saveRun(
          latest,
          failed,
          cancelled
            ? `第 ${chapter.chapterNumber} 章分析已停止`
            : `第 ${chapter.chapterNumber} 章分析失败`,
        ).catch(() => undefined);
      }
      throw reason;
    }
  }

  async confirmAnalysis(input: {
    planId: string;
    chapter: Chapter;
    draft: ChapterDraft;
    result?: ChapterSummarizeResult;
  }): Promise<AutonomousStoryPlan> {
    const plan = await this.dependencies.persistence.getPlan(input.planId);
    if (!plan || plan.status !== 'applied') throw new Error('自主创作计划不存在或尚未应用。');
    const run = latestChapterRun(plan, input.chapter.id);
    const candidate = input.result ?? run?.analysis?.result;
    if (!run || run.adoptedDraftId !== input.draft.id || !candidate) {
      throw new Error('没有可确认的章节分析候选。');
    }
    if (
      !input.draft.isAdopted ||
      input.draft.chapterId !== input.chapter.id ||
      input.chapter.novelId !== plan.novelId
    ) {
      throw new Error('当前采用稿与章节分析候选不一致。');
    }
    if (run.analysis?.status === 'confirmed') return plan;

    const validation = this.dependencies.validateSummary(input.draft.content, candidate);
    const contentHash = this.dependencies.hashContent(input.draft.content);
    const identityPrefix = `${plan.planId}:${input.chapter.id}`;
    const saved = await this.dependencies.contextPersistence.save({
      novelId: plan.novelId,
      chapterId: input.chapter.id,
      adoptedDraftId: input.draft.id,
      summary: {
        id: `${identityPrefix}:summary`,
        novelId: plan.novelId,
        chapterId: input.chapter.id,
        volumeId: input.chapter.volumeId,
        adoptedDraftId: input.draft.id,
        summary: candidate.summary,
        keyEvents: candidate.keyEvents,
        characterChanges: candidate.characterChanges,
        relationshipChanges: candidate.relationshipChanges,
        newForeshadows: candidate.newForeshadows,
        resolvedForeshadows: candidate.resolvedForeshadows,
        nextChapterHints: candidate.nextChapterHints,
        coreEvents: candidate.coreEvents,
        protagonistStateChange: candidate.protagonistStateChange,
        importantCharacterChanges: candidate.importantCharacterChanges,
        settingChanges: candidate.settingChanges,
        newLocations: candidate.newLocations,
        newItemsOrAbilities: candidate.newItemsOrAbilities,
        foreshadowing: candidate.foreshadowing,
        unresolvedQuestions: candidate.unresolvedQuestions,
        factsMustRemember: candidate.factsMustRemember,
        nextChapterHook: candidate.nextChapterHook,
        validationStatus: validation.passed ? 'passed' : 'failed',
        validationResult: validation,
        enabled: validation.safeToContext,
        contentHash,
        draftVersion: input.draft.versionNo,
      },
      contextRecords: candidate.contextRecords.map((record, index) => ({
        ...record,
        id: `${identityPrefix}:context:${index}`,
        novelId: plan.novelId,
        chapterId: input.chapter.id,
        volumeId: input.chapter.volumeId,
        isActive: validation.safeToContext,
        contentHash,
        draftVersion: input.draft.versionNo,
      })),
      characterStates: candidate.characterChanges.flatMap((change) =>
        change.characterId
          ? [
              {
                id: `${identityPrefix}:state:${change.characterId}`,
                novelId: plan.novelId,
                characterId: change.characterId,
                chapterId: input.chapter.id,
                stateSummary: change.stateSummary,
                relationshipChanges: change.relationshipChanges,
                goalChanges: change.goalChanges,
                location: change.location,
                healthState: change.healthState,
                knowledgeState: change.knowledgeState,
              },
            ]
          : [],
      ),
    });

    const changedCharacterIds = new Set(
      candidate.characterChanges.map((change) => change.characterId).filter(Boolean),
    );
    const confirmedBeatIds = run.plannedCharacterBeatIds.filter((beatId) =>
      plan.characters.some((character) =>
        character.beats.some((beat) => beat.id === beatId && changedCharacterIds.has(character.id)),
      ),
    );
    const confirmed: AutonomousChapterRun = {
      ...run,
      confirmedCharacterBeatIds: confirmedBeatIds,
      analysis: {
        status: 'confirmed',
        adoptedDraftId: input.draft.id,
        worldSuggestionIds: run.analysis?.worldSuggestionIds ?? [],
        summaryId: saved.summary.id,
        updatedAt: this.dependencies.now(),
      },
      updatedAt: this.dependencies.now(),
    };
    return this.saveRun(
      plan,
      confirmed,
      `第 ${input.chapter.chapterNumber} 章上下文已确认，人物弧与世界候选已推进`,
    );
  }
}
