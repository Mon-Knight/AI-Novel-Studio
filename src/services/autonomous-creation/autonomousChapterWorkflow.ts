import type { ChapterDraft } from '../../types/ai';
import type { ProvisionalPreviousChapterContext } from '../../types/generationContext';
import type {
  AutonomousChapterPlan,
  AutonomousChapterRun,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import type { MultiAgentReviewParams, MultiAgentReviewResult } from '../../types/multiAgent';
import type { AutonomousPlanPersistence } from './autonomousPersistence';
import { hashTextContent } from '../../utils/contentHash';

interface GenerationJobResult {
  job: {
    id: string;
    status: string;
    errorMessage?: string;
  };
  draft?: ChapterDraft;
}

interface ChapterGenerationGateway {
  runChapterDraftJob(input: {
    novelId: string;
    volumeId?: string;
    chapterId: string;
    title?: string;
    provisionalPreviousChapter?: ProvisionalPreviousChapterContext;
    signal?: AbortSignal;
    onDraftSaved?: (draft: ChapterDraft, jobId: string) => void | Promise<void>;
  }): Promise<GenerationJobResult>;
}

interface MultiAgentReviewGateway {
  review(input: MultiAgentReviewParams): Promise<MultiAgentReviewResult>;
}

interface ChapterDraftGateway {
  getById(chapterId: string, draftId: string): Promise<ChapterDraft | null>;
}

export interface AutonomousChapterWorkflowDependencies {
  persistence: AutonomousPlanPersistence;
  generation: ChapterGenerationGateway;
  review: MultiAgentReviewGateway;
  drafts: ChapterDraftGateway;
  generateId: () => string;
  now: () => string;
}

export interface AutonomousChapterWorkflowResult {
  plan: AutonomousStoryPlan;
  chapter: AutonomousChapterPlan;
  run: AutonomousChapterRun;
}

export interface AutonomousBookCandidateResult {
  plan: AutonomousStoryPlan;
  generatedChapterCount: number;
  candidateChapterCount: number;
}

type CandidateSelection = 'next_unadopted' | 'next_missing_candidate';

const REVIEW_EXPERTS = ['outline', 'character', 'setting', 'logic', 'polish', 'quality'] as const;

function errorMessage(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason || '章节候选生成失败'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function isCancelled(reason: unknown, signal?: AbortSignal): boolean {
  return (
    Boolean(signal?.aborted) ||
    (reason instanceof DOMException && reason.name === 'AbortError') ||
    (reason instanceof Error && /cancel|abort/i.test(reason.message))
  );
}

function chapterRuns(plan: AutonomousStoryPlan): AutonomousChapterRun[] {
  return plan.chapterRuns ?? [];
}

function replaceRun(
  plan: AutonomousStoryPlan,
  run: AutonomousChapterRun,
  checkpoint: string,
  now: string,
): AutonomousStoryPlan {
  const runs = chapterRuns(plan);
  const index = runs.findIndex((item) => item.runId === run.runId);
  const nextRuns = [...runs];
  if (index >= 0) nextRuns[index] = run;
  else nextRuns.push(run);
  return {
    ...plan,
    chapterRuns: nextRuns,
    progress: { ...plan.progress, lastCheckpoint: checkpoint },
    updatedAt: now,
  };
}

function latestRun(plan: AutonomousStoryPlan, chapterId: string): AutonomousChapterRun | undefined {
  return [...chapterRuns(plan)].reverse().find((run) => run.chapterId === chapterId);
}

function hasUsableCandidate(plan: AutonomousStoryPlan, chapter: AutonomousChapterPlan): boolean {
  if (chapter.status === 'adopted') return true;
  const run = latestRun(plan, chapter.id);
  return run?.status === 'candidate_ready' || run?.status === 'adopted';
}

function nextChapter(
  plan: AutonomousStoryPlan,
  selection: CandidateSelection,
): AutonomousChapterPlan | undefined {
  if (selection === 'next_missing_candidate') {
    return plan.chapters.find((chapter) => !hasUsableCandidate(plan, chapter));
  }
  return plan.chapters.find((chapter) => chapter.status !== 'adopted');
}

function candidateChapterCount(plan: AutonomousStoryPlan): number {
  return plan.chapters.filter((chapter) => hasUsableCandidate(plan, chapter)).length;
}

function predecessorCandidate(plan: AutonomousStoryPlan, chapter: AutonomousChapterPlan) {
  const previous = [...plan.chapters]
    .filter((item) => item.chapterNumber < chapter.chapterNumber)
    .sort((left, right) => right.chapterNumber - left.chapterNumber)[0];
  if (!previous) return undefined;
  const run = latestRun(plan, previous.id);
  const draftId = run?.candidateDraftId ?? run?.adoptedDraftId;
  return draftId ? { chapter: previous, draftId } : undefined;
}

export class AutonomousChapterWorkflowService {
  private readonly bookInFlight = new Map<string, Promise<AutonomousBookCandidateResult>>();

  constructor(private readonly dependencies: AutonomousChapterWorkflowDependencies) {}

  private async saveRun(
    plan: AutonomousStoryPlan,
    run: AutonomousChapterRun,
    checkpoint: string,
    onProgress?: (plan: AutonomousStoryPlan) => void,
  ): Promise<AutonomousStoryPlan> {
    const saved = await this.dependencies.persistence.savePlan(
      replaceRun(plan, run, checkpoint, this.dependencies.now()),
      plan.revision,
    );
    onProgress?.(saved);
    return saved;
  }

  async generateNextCandidate(
    planId: string,
    options: {
      signal?: AbortSignal;
      onProgress?: (plan: AutonomousStoryPlan) => void;
      selection?: CandidateSelection;
    } = {},
  ): Promise<AutonomousChapterWorkflowResult> {
    const loadedPlan = await this.dependencies.persistence.getPlan(planId);
    if (!loadedPlan) throw new Error('自主创作计划不存在。');
    let plan: AutonomousStoryPlan = loadedPlan;
    if (plan.status !== 'applied') throw new Error('必须先确认应用全书计划。');
    const selection = options.selection ?? 'next_unadopted';
    const chapter = nextChapter(plan, selection);
    if (!chapter) {
      throw new Error(
        selection === 'next_missing_candidate' ? '全书章节均已有候选。' : '全书章节均已采用。',
      );
    }
    if (options.signal?.aborted) throw new DOMException('章节候选生成已取消', 'AbortError');

    const existing = latestRun(plan, chapter.id);
    if (existing?.status === 'candidate_ready') return { plan, chapter, run: existing };

    const now = this.dependencies.now();
    let run: AutonomousChapterRun =
      existing?.sourceDraftId && ['reviewing', 'failed', 'cancelled'].includes(existing.status)
        ? { ...existing, status: 'reviewing' as const, errorMessage: undefined }
        : {
            runId: this.dependencies.generateId(),
            operationId: `autonomous-chapter:${plan.planId}:${chapter.chapterNumber}:${this.dependencies.generateId()}`,
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber,
            status: 'generating' as const,
            plannedCharacterBeatIds: [...chapter.characterBeatIds],
            confirmedCharacterBeatIds: [],
            createdAt: now,
            updatedAt: now,
          };

    try {
      if (run.status !== 'reviewing') {
        const predecessor = predecessorCandidate(plan, chapter);
        let provisionalPreviousChapter: ProvisionalPreviousChapterContext | undefined;
        if (predecessor) {
          const previousDraft = await this.dependencies.drafts.getById(
            predecessor.chapter.id,
            predecessor.draftId,
          );
          if (!previousDraft || previousDraft.contentState?.status === 'unavailable') {
            throw new Error(
              `第 ${predecessor.chapter.chapterNumber} 章候选正文不可用，队列已停在连续性边界。`,
            );
          }
          provisionalPreviousChapter = {
            chapterId: predecessor.chapter.id,
            draftId: previousDraft.id,
            contentHash:
              previousDraft.contentState?.status === 'ready'
                ? previousDraft.contentState.contentHash
                : hashTextContent(previousDraft.content),
            content: previousDraft.content,
          };
          run = {
            ...run,
            predecessorDraftId: provisionalPreviousChapter.draftId,
            predecessorContentHash: provisionalPreviousChapter.contentHash,
          };
        }
        plan = await this.saveRun(
          plan,
          run,
          `正在生成第 ${chapter.chapterNumber} 章候选正文`,
          options.onProgress,
        );
        const generated = await this.dependencies.generation.runChapterDraftJob({
          novelId: plan.novelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          title: chapter.title,
          provisionalPreviousChapter,
          signal: options.signal,
          onDraftSaved: async (savedDraft, generationJobId) => {
            run = {
              ...run,
              status: 'reviewing',
              generationJobId,
              sourceDraftId: savedDraft.id,
              errorMessage: undefined,
              updatedAt: this.dependencies.now(),
            };
            plan = await this.saveRun(
              plan,
              run,
              `第 ${chapter.chapterNumber} 章正文已保存，继续质量检查与专家评审`,
              options.onProgress,
            );
          },
        });
        if (options.signal?.aborted) throw new DOMException('章节候选生成已取消', 'AbortError');
        if (!generated.draft) {
          throw new Error(generated.job.errorMessage || '章节生成任务未产出完整草稿。');
        }
        if (run.sourceDraftId !== generated.draft.id || run.generationJobId !== generated.job.id) {
          run = {
            ...run,
            status: 'reviewing',
            generationJobId: generated.job.id,
            sourceDraftId: generated.draft.id,
            updatedAt: this.dependencies.now(),
          };
          plan = await this.saveRun(
            plan,
            run,
            `六类专家正在评审第 ${chapter.chapterNumber} 章`,
            options.onProgress,
          );
        }
      }

      if (!run.sourceDraftId) throw new Error('章节评审缺少源草稿。');
      const reviewed = await this.dependencies.review.review({
        novelId: plan.novelId,
        chapterId: chapter.id,
        draftId: run.sourceDraftId,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline,
        chapterGoal: chapter.goal,
        experts: [...REVIEW_EXPERTS],
        maxRounds: 3,
        minimumSuccessfulExperts: 4,
        operationId: `${run.operationId}:review`,
        signal: options.signal,
      });
      const consensus = reviewed.session.rounds[reviewed.session.rounds.length - 1]?.consensus;
      run = {
        ...run,
        status: 'candidate_ready',
        candidateDraftId: reviewed.finalDraft.id,
        reviewSessionId: reviewed.session.session.sessionId,
        reviewAccepted: reviewed.accepted,
        reviewAction: reviewed.finalAction,
        acceptanceRate: consensus?.acceptanceRate,
        averageScore: consensus?.averageScore,
        errorMessage: undefined,
        updatedAt: this.dependencies.now(),
      };
      plan = await this.saveRun(
        plan,
        run,
        `第 ${chapter.chapterNumber} 章候选已完成，等待人工采用`,
        options.onProgress,
      );
      return { plan, chapter, run };
    } catch (reason) {
      const latest = await this.dependencies.persistence.getPlan(planId).catch(() => null);
      if (latest?.status === 'applied') {
        const current = chapterRuns(latest).find((item) => item.runId === run.runId) ?? run;
        if (current.status !== 'candidate_ready' && current.status !== 'adopted') {
          const failed: AutonomousChapterRun = {
            ...current,
            status: isCancelled(reason, options.signal) ? 'cancelled' : 'failed',
            errorMessage: errorMessage(reason),
            updatedAt: this.dependencies.now(),
          };
          plan = await this.saveRun(
            latest,
            failed,
            `第 ${chapter.chapterNumber} 章候选未完成`,
            options.onProgress,
          ).catch(() => latest);
        }
      }
      throw reason;
    }
  }

  async generateAllCandidates(
    planId: string,
    options: {
      signal?: AbortSignal;
      onProgress?: (plan: AutonomousStoryPlan) => void;
      onChapterComplete?: (result: AutonomousChapterWorkflowResult) => void;
    } = {},
  ): Promise<AutonomousBookCandidateResult> {
    const active = this.bookInFlight.get(planId);
    if (active) return active;
    const promise = this.generateAllCandidatesInternal(planId, options);
    this.bookInFlight.set(planId, promise);
    try {
      return await promise;
    } finally {
      if (this.bookInFlight.get(planId) === promise) this.bookInFlight.delete(planId);
    }
  }

  private async generateAllCandidatesInternal(
    planId: string,
    options: {
      signal?: AbortSignal;
      onProgress?: (plan: AutonomousStoryPlan) => void;
      onChapterComplete?: (result: AutonomousChapterWorkflowResult) => void;
    },
  ): Promise<AutonomousBookCandidateResult> {
    let plan = await this.dependencies.persistence.getPlan(planId);
    if (!plan) throw new Error('自主创作计划不存在。');
    if (plan.status !== 'applied') throw new Error('必须先确认应用全书计划。');
    let generatedChapterCount = 0;
    while (nextChapter(plan, 'next_missing_candidate')) {
      if (options.signal?.aborted) throw new DOMException('全书候选生成已暂停', 'AbortError');
      const result = await this.generateNextCandidate(planId, {
        signal: options.signal,
        onProgress: options.onProgress,
        selection: 'next_missing_candidate',
      });
      plan = result.plan;
      generatedChapterCount += 1;
      options.onChapterComplete?.(result);
    }
    return {
      plan,
      generatedChapterCount,
      candidateChapterCount: candidateChapterCount(plan),
    };
  }
}
