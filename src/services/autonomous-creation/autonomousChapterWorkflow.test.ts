import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterDraft } from '../../types/ai';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import type { MultiAgentReviewParams, MultiAgentReviewResult } from '../../types/multiAgent';
import type { AutonomousPlanPersistence } from './autonomousPersistence';
import { AutonomousChapterWorkflowService } from './autonomousChapterWorkflow';
import { AutonomousPostChapterService } from './autonomousPostChapterService';
import { reconcileAutonomousAdoptions } from './autonomousAdoptionReconciler';
import { normalizeChapterSummarizeResult } from '../ai/chapterSummarizeNormalizer';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function storyPlan(): AutonomousStoryPlan {
  return {
    schemaVersion: 1,
    planId: 'plan-1',
    operationId: 'operation-1',
    requestHash: 'a'.repeat(64),
    novelId: 'novel-1',
    status: 'applied',
    stage: 'applied',
    revision: 1,
    brief: {
      premise: '失去记忆的城市调查员寻找真相。',
      genre: '悬疑',
      targetChapterCount: 2,
      targetWordsPerChapter: 2_400,
      readerPromise: '线索与人物成长',
      endingPreference: '公开真相',
      constraints: [],
    },
    storyBible: {
      title: '回声边界',
      logline: '调查员追踪被改写的记忆。',
      themes: ['身份'],
      protagonistPromise: '承担真相',
      centralQuestion: '真实是否值得代价',
      endingVision: '公开真相',
      narrativeRules: ['线索可回溯'],
    },
    arcs: [
      {
        id: 'arc-1',
        index: 0,
        title: '追查',
        chapterStart: 1,
        chapterEnd: 2,
        goal: '找到证据',
        turningPoint: '盟友隐瞒',
        climax: '公开对抗',
        outcome: '付出代价',
      },
    ],
    volumes: [
      {
        id: 'volume-1',
        index: 0,
        title: '第一卷',
        chapterStart: 1,
        chapterEnd: 2,
        summary: '追查失忆事件',
        goal: '找到证据',
        mainConflict: '调查与封锁',
        arcIds: ['arc-1'],
      },
    ],
    characters: [
      {
        id: 'character-1',
        name: '林岚',
        role: 'protagonist',
        identity: '调查员',
        personality: '谨慎',
        coreNeed: '确认真实',
        flaw: '不信任他人',
        initialState: '被动求证',
        desiredEndState: '主动承担',
        behaviorLimits: [],
        forbiddenBehaviors: [],
        beats: [
          {
            id: 'beat-1',
            characterId: 'character-1',
            chapterNumber: 1,
            stage: '怀疑',
            change: '开始相信盟友',
          },
        ],
      },
    ],
    worldElements: [],
    conflicts: [],
    pacingPhases: [],
    pacingCurve: [],
    chapters: [1, 2].map((chapterNumber) => ({
      id: `chapter-${chapterNumber}`,
      chapterNumber,
      volumeId: 'volume-1',
      arcId: 'arc-1',
      title: `第 ${chapterNumber} 章`,
      outline: `推进第 ${chapterNumber} 条线索`,
      goal: '推进调查',
      targetWordCount: 2_400,
      pacingMode: 'build' as const,
      tension: 50,
      endingHook: '发现新证据',
      conflictThreadIds: [],
      characterIds: ['character-1'],
      characterBeatIds: chapterNumber === 1 ? ['beat-1'] : [],
      worldElementIds: [],
      status: 'materialized' as const,
    })),
    agentRuns: [],
    chapterRuns: [],
    progress: {
      completedVolumeIds: [],
      currentVolumeIndex: 0,
      adoptedChapterNumbers: [],
      lastCheckpoint: '计划已应用',
    },
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
    completedAt: '2026-07-28T00:00:00Z',
    appliedAt: '2026-07-28T00:00:00Z',
  };
}

function draft(id = 'draft-generated', chapterId = 'chapter-1'): ChapterDraft {
  return {
    id,
    novelId: 'novel-1',
    chapterId,
    content: '林岚在旧车站找到一段被删除的监控，并决定相信盟友。',
    source: 'ai_generated',
    versionNo: id === 'draft-generated' ? 1 : 2,
    wordCount: 24,
    isAdopted: false,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
}

class MemoryPersistence implements AutonomousPlanPersistence {
  plan = storyPlan();
  saves = 0;

  async savePlan(
    plan: AutonomousStoryPlan,
    expectedRevision: number,
  ): Promise<AutonomousStoryPlan> {
    if (this.plan.revision !== expectedRevision) throw new Error('revision conflict');
    this.plan = clone({ ...plan, revision: expectedRevision + 1 });
    this.saves += 1;
    return clone(this.plan);
  }

  async getPlan(planId: string) {
    return planId === this.plan.planId ? clone(this.plan) : null;
  }

  async getPlanByOperation(operationId: string) {
    return operationId === this.plan.operationId ? clone(this.plan) : null;
  }

  async listPlansByNovel(novelId: string) {
    return novelId === this.plan.novelId ? [clone(this.plan)] : [];
  }

  async applyPlan(): Promise<never> {
    throw new Error('not used');
  }
}

function reviewResult(params: MultiAgentReviewParams): MultiAgentReviewResult {
  const reviewed = draft(
    params.chapterId === 'chapter-1' ? 'draft-reviewed' : `draft-reviewed-${params.chapterId}`,
    params.chapterId,
  );
  return {
    success: true,
    accepted: true,
    finalAction: 'accept',
    finalDraft: reviewed,
    totalTokensUsed: 120,
    durationMs: 50,
    session: {
      session: {
        sessionId: 'review-session-1',
        operationId: params.operationId ?? '',
        novelId: params.novelId,
        chapterId: params.chapterId,
        sourceDraftId: params.draftId,
        sourceDraftVersion: 1,
        sourceContentHash: 'b'.repeat(64),
        expertTypes: params.experts,
        maxRounds: 3,
        acceptanceThreshold: 0.7,
        minimumAverageScore: 75,
        minimumSuccessfulExperts: 4,
        status: 'completed',
        currentRound: 1,
        accepted: true,
        finalAction: 'accept',
        finalDraftId: reviewed.id,
        totalTokensInput: 80,
        totalTokensOutput: 40,
        totalTokensUsed: 120,
        durationMs: 50,
        createdAt: '2026-07-28T00:00:00Z',
        updatedAt: '2026-07-28T00:00:01Z',
        completedAt: '2026-07-28T00:00:01Z',
      },
      rounds: [
        {
          roundNumber: 1,
          inputDraftId: params.draftId,
          inputDraftVersion: 1,
          inputContentHash: 'b'.repeat(64),
          expertOpinions: [],
          consensus: {
            agreed: true,
            acceptanceRate: 1,
            averageScore: 88,
            successfulExperts: 6,
            failedExperts: 0,
            requiredSuccessfulExperts: 4,
            majorConcerns: [],
            mergedSuggestions: [],
            action: 'accept',
          },
          tokensInput: 80,
          tokensOutput: 40,
          tokensUsed: 120,
          durationMs: 50,
          startedAt: '2026-07-28T00:00:00Z',
          completedAt: '2026-07-28T00:00:01Z',
        },
      ],
    },
  };
}

test('下一章工作流生成并经六专家评审候选，但不会自动采用且可重放', async () => {
  const persistence = new MemoryPersistence();
  let generationCalls = 0;
  let reviewCalls = 0;
  let reviewedParams: MultiAgentReviewParams | undefined;
  let sequence = 0;
  const service = new AutonomousChapterWorkflowService({
    persistence,
    generation: {
      async runChapterDraftJob() {
        generationCalls += 1;
        return { job: { id: 'job-1', status: 'completed' }, draft: draft() };
      },
    },
    review: {
      async review(params) {
        reviewCalls += 1;
        reviewedParams = params;
        return reviewResult(params);
      },
    },
    drafts: {
      async getById(chapterId, draftId) {
        return draft(draftId, chapterId);
      },
    },
    generateId: () => `id-${++sequence}`,
    now: () => `2026-07-28T00:00:0${sequence}Z`,
  });

  const first = await service.generateNextCandidate('plan-1');
  const replay = await service.generateNextCandidate('plan-1');

  assert.equal(generationCalls, 1);
  assert.equal(reviewCalls, 1);
  assert.deepEqual(reviewedParams?.experts, [
    'outline',
    'character',
    'setting',
    'logic',
    'polish',
    'quality',
  ]);
  assert.equal(first.run.status, 'candidate_ready');
  assert.equal(first.run.candidateDraftId, 'draft-reviewed');
  assert.equal(first.plan.chapters[0].status, 'materialized');
  assert.deepEqual(first.plan.progress.adoptedChapterNumbers, []);
  assert.equal(replay.run.runId, first.run.runId);
});

test('评审阶段恢复时复用源草稿和 operation，不重复生成正文', async () => {
  const persistence = new MemoryPersistence();
  persistence.plan.chapterRuns = [
    {
      runId: 'run-existing',
      operationId: 'chapter-operation-existing',
      chapterId: 'chapter-1',
      chapterNumber: 1,
      status: 'reviewing',
      generationJobId: 'job-existing',
      sourceDraftId: 'draft-generated',
      plannedCharacterBeatIds: ['beat-1'],
      confirmedCharacterBeatIds: [],
      createdAt: '2026-07-28T00:00:00Z',
      updatedAt: '2026-07-28T00:00:00Z',
    },
  ];
  let generationCalls = 0;
  let operationId = '';
  const service = new AutonomousChapterWorkflowService({
    persistence,
    generation: {
      async runChapterDraftJob() {
        generationCalls += 1;
        return { job: { id: 'unexpected', status: 'completed' }, draft: draft() };
      },
    },
    review: {
      async review(params) {
        operationId = params.operationId ?? '';
        return reviewResult(params);
      },
    },
    drafts: {
      async getById(chapterId, draftId) {
        return draft(draftId, chapterId);
      },
    },
    generateId: () => 'unused',
    now: () => '2026-07-28T00:00:01Z',
  });

  const result = await service.generateNextCandidate('plan-1');
  assert.equal(generationCalls, 0);
  assert.equal(operationId, 'chapter-operation-existing:review');
  assert.equal(result.run.status, 'candidate_ready');
});

test('正文已检查点但评审失败后继续时不重复生成正文', async () => {
  const persistence = new MemoryPersistence();
  let generationCalls = 0;
  let reviewCalls = 0;
  const reviewOperationIds: string[] = [];
  let sequence = 0;
  const service = new AutonomousChapterWorkflowService({
    persistence,
    generation: {
      async runChapterDraftJob(input) {
        generationCalls += 1;
        const generated = draft('draft-checkpointed', input.chapterId);
        await input.onDraftSaved?.(generated, 'job-checkpointed');
        return { job: { id: 'job-checkpointed', status: 'completed' }, draft: generated };
      },
    },
    review: {
      async review(params) {
        reviewCalls += 1;
        reviewOperationIds.push(params.operationId ?? '');
        if (reviewCalls === 1) throw new Error('评审服务暂时中断');
        return reviewResult(params);
      },
    },
    drafts: {
      async getById(chapterId, draftId) {
        return draft(draftId, chapterId);
      },
    },
    generateId: () => `checkpoint-${++sequence}`,
    now: () => `2026-07-28T00:01:${String(sequence).padStart(2, '0')}Z`,
  });

  await assert.rejects(service.generateNextCandidate('plan-1'), /评审服务暂时中断/);

  const failedRun = persistence.plan.chapterRuns?.[0];
  assert.ok(failedRun);
  assert.equal(failedRun.status, 'failed');
  assert.equal(failedRun.sourceDraftId, 'draft-checkpointed');
  assert.equal(failedRun.generationJobId, 'job-checkpointed');
  const checkpointedRunId = failedRun.runId;
  const checkpointedOperationId = failedRun.operationId;

  const resumed = await service.generateNextCandidate('plan-1');

  assert.equal(generationCalls, 1);
  assert.equal(reviewCalls, 2);
  assert.deepEqual(reviewOperationIds, [
    `${checkpointedOperationId}:review`,
    `${checkpointedOperationId}:review`,
  ]);
  assert.equal(resumed.run.runId, checkpointedRunId);
  assert.equal(resumed.run.sourceDraftId, 'draft-checkpointed');
  assert.equal(resumed.run.status, 'candidate_ready');
});

test('全书候选队列逐章检查点并把前章候选作为临时连续性上下文', async () => {
  const persistence = new MemoryPersistence();
  const storedDrafts = new Map<string, ChapterDraft>();
  const generationInputs: Array<{
    chapterId: string;
    predecessorDraftId?: string;
    predecessorContent?: string;
  }> = [];
  let sequence = 0;
  const service = new AutonomousChapterWorkflowService({
    persistence,
    generation: {
      async runChapterDraftJob(input) {
        generationInputs.push({
          chapterId: input.chapterId,
          predecessorDraftId: input.provisionalPreviousChapter?.draftId,
          predecessorContent: input.provisionalPreviousChapter?.content,
        });
        const generated = draft(`generated-${input.chapterId}`, input.chapterId);
        storedDrafts.set(generated.id, generated);
        await input.onDraftSaved?.(generated, `job-${input.chapterId}`);
        return { job: { id: `job-${input.chapterId}`, status: 'completed' }, draft: generated };
      },
    },
    review: {
      async review(params) {
        const result = reviewResult(params);
        storedDrafts.set(result.finalDraft.id, result.finalDraft);
        return result;
      },
    },
    drafts: {
      async getById(chapterId, draftId) {
        const value = storedDrafts.get(draftId);
        return value?.chapterId === chapterId ? value : null;
      },
    },
    generateId: () => `queue-${++sequence}`,
    now: () => `2026-07-28T00:00:${String(sequence).padStart(2, '0')}Z`,
  });

  const result = await service.generateAllCandidates('plan-1');
  assert.equal(result.generatedChapterCount, 2);
  assert.equal(result.candidateChapterCount, 2);
  assert.equal(generationInputs.length, 2);
  assert.equal(generationInputs[0].predecessorDraftId, undefined);
  assert.equal(generationInputs[1].predecessorDraftId, 'draft-reviewed');
  assert.ok(generationInputs[1].predecessorContent?.includes('旧车站'));
  assert.equal(result.plan.chapterRuns?.length, 2);
  assert.ok(result.plan.chapterRuns?.every((run) => run.status === 'candidate_ready'));
  assert.equal(result.plan.chapterRuns?.[1].predecessorDraftId, 'draft-reviewed');
  assert.deepEqual(result.plan.progress.adoptedChapterNumbers, []);

  const replay = await service.generateAllCandidates('plan-1');
  assert.equal(replay.generatedChapterCount, 0);
  assert.equal(generationInputs.length, 2);
});

test('全书候选队列暂停后继续时仅生成尚未完成的章节', async () => {
  const persistence = new MemoryPersistence();
  const storedDrafts = new Map<string, ChapterDraft>();
  const generationCalls: string[] = [];
  const completedChapters: number[] = [];
  const controller = new AbortController();
  let sequence = 0;
  const service = new AutonomousChapterWorkflowService({
    persistence,
    generation: {
      async runChapterDraftJob(input) {
        generationCalls.push(input.chapterId);
        const generated = draft(`generated-${input.chapterId}`, input.chapterId);
        storedDrafts.set(generated.id, generated);
        await input.onDraftSaved?.(generated, `job-${input.chapterId}`);
        return { job: { id: `job-${input.chapterId}`, status: 'completed' }, draft: generated };
      },
    },
    review: {
      async review(params) {
        const result = reviewResult(params);
        storedDrafts.set(result.finalDraft.id, result.finalDraft);
        return result;
      },
    },
    drafts: {
      async getById(chapterId, draftId) {
        const value = storedDrafts.get(draftId);
        return value?.chapterId === chapterId ? value : null;
      },
    },
    generateId: () => `pause-${++sequence}`,
    now: () => `2026-07-28T00:02:${String(sequence).padStart(2, '0')}Z`,
  });

  await assert.rejects(
    service.generateAllCandidates('plan-1', {
      signal: controller.signal,
      onChapterComplete(result) {
        completedChapters.push(result.chapter.chapterNumber);
        controller.abort();
      },
    }),
    (error) => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.deepEqual(completedChapters, [1]);
  assert.deepEqual(generationCalls, ['chapter-1']);
  assert.equal(persistence.plan.chapterRuns?.[0].status, 'candidate_ready');
  assert.equal(
    persistence.plan.chapterRuns?.some((run) => run.chapterId === 'chapter-2'),
    false,
  );

  const resumed = await service.generateAllCandidates('plan-1');

  assert.equal(resumed.generatedChapterCount, 1);
  assert.equal(resumed.candidateChapterCount, 2);
  assert.deepEqual(generationCalls, ['chapter-1', 'chapter-2']);
  assert.deepEqual(
    resumed.plan.chapterRuns?.map((run) => [run.chapterId, run.status]),
    [
      ['chapter-1', 'candidate_ready'],
      ['chapter-2', 'candidate_ready'],
    ],
  );
});

function summaryResult(): ChapterSummarizeResult {
  return {
    summary: '林岚确认监控被人为删除，并决定相信盟友。',
    keyEvents: ['找到监控'],
    coreEvents: ['确认记忆篡改'],
    protagonistStateChange: '从怀疑转为有限信任',
    importantCharacterChanges: [{ name: '林岚', change: '开始相信盟友' }],
    characterChanges: [{ characterName: '林岚', stateSummary: '开始相信盟友' }],
    relationshipChanges: [],
    settingChanges: ['旧车站监控由记忆局控制'],
    newLocations: ['旧车站地下档案室'],
    newItemsOrAbilities: [],
    newForeshadows: [],
    resolvedForeshadows: [],
    foreshadowing: [],
    unresolvedQuestions: ['谁删除了监控'],
    factsMustRemember: ['监控在午夜被删除'],
    nextChapterHints: '追查删除权限',
    nextChapterHook: '权限属于失踪者',
    contextRecords: [
      {
        contextType: 'plot_progress',
        title: '监控线索',
        content: '林岚找到被删除的监控。',
        importance: 4,
      },
    ],
  };
}

test('采用后推进人物弧并生成待确认分析，确认前不写正式上下文', async () => {
  const persistence = new MemoryPersistence();
  const chapter: Chapter = {
    id: 'chapter-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: '第一章',
    outline: '找到监控',
    goal: '确认篡改',
    chapterNumber: 1,
    orderIndex: 0,
    sortOrder: 0,
    status: 'adopted',
    adoptedDraftId: 'draft-reviewed',
    wordCount: 24,
    currentWords: 24,
    targetWords: 2_400,
    drafts: [],
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
  const adopted = {
    ...draft('draft-reviewed'),
    content: `${'正'.repeat(12_050)}AUTONOMOUS_SUMMARY_TAIL`,
    isAdopted: true,
  };
  let contextSaves = 0;
  let summarizedContent = '';
  const service = new AutonomousPostChapterService({
    persistence,
    chapters: {
      async getById() {
        return chapter;
      },
    },
    summarizer: {
      async summarize(input) {
        summarizedContent = input.adoptedContent;
        return summaryResult();
      },
    },
    worldSuggestions: {
      async generate() {
        return ['world-candidate-1', 'rule-candidate-1'];
      },
    },
    contextPersistence: {
      async save(input) {
        contextSaves += 1;
        const timestamp = '2026-07-28T00:00:02Z';
        return {
          summary: {
            ...input.summary,
            id: input.summary.id ?? 'summary-1',
            enabled: input.summary.enabled ?? true,
            isExpired: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          contextRecords: input.contextRecords.map((item) => ({
            ...item,
            id: item.id ?? 'context-1',
            importance: (item.importance ?? 3) as 1 | 2 | 3 | 4 | 5,
            isActive: item.isActive ?? true,
            isExpired: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
          characterStates: input.characterStates.map((item) => ({
            ...item,
            id: item.id ?? 'state-1',
            createdAt: timestamp,
          })),
          chapterStatus: 'summarized',
        };
      },
    },
    hashContent: () => 'content-hash',
    validateSummary: () => ({ passed: true, score: 95, problems: [], safeToContext: true }),
    now: () => '2026-07-28T00:00:02Z',
  });

  const marked = await service.markAdopted(adopted);
  assert.ok(marked);
  assert.equal(marked.chapters[0].status, 'adopted');
  assert.deepEqual(marked.progress.adoptedChapterNumbers, [1]);
  assert.equal(contextSaves, 0);

  const analyzed = await service.analyzeAdoptedChapter('plan-1', adopted);
  assert.ok(summarizedContent.endsWith('AUTONOMOUS_SUMMARY_TAIL'));
  assert.equal(summarizedContent, adopted.content);
  const pendingRun = analyzed.chapterRuns?.find((item) => item.chapterId === 'chapter-1');
  assert.equal(pendingRun?.analysis?.status, 'pending_confirmation');
  assert.equal(pendingRun?.analysis?.result?.characterChanges[0].characterId, 'character-1');
  assert.deepEqual(pendingRun?.analysis?.worldSuggestionIds, [
    'world-candidate-1',
    'rule-candidate-1',
  ]);
  assert.equal(contextSaves, 0);

  const confirmed = await service.confirmAnalysis({ planId: 'plan-1', chapter, draft: adopted });
  const confirmedRun = confirmed.chapterRuns?.find((item) => item.chapterId === 'chapter-1');
  assert.equal(contextSaves, 1);
  assert.equal(confirmedRun?.analysis?.status, 'confirmed');
  assert.equal(confirmedRun?.analysis?.result, undefined);
  assert.deepEqual(confirmedRun?.confirmedCharacterBeatIds, ['beat-1']);
});

test('章节总结解析保留世界、人物、节奏衔接等扩展字段', () => {
  const normalized = normalizeChapterSummarizeResult(summaryResult(), 'fallback');
  assert.deepEqual(normalized.newLocations, ['旧车站地下档案室']);
  assert.deepEqual(normalized.factsMustRemember, ['监控在午夜被删除']);
  assert.equal(normalized.protagonistStateChange, '从怀疑转为有限信任');
  assert.equal(normalized.nextChapterHook, '权限属于失踪者');
});

test('重新采用不同草稿会作废旧分析与已确认人物节点', async () => {
  const persistence = new MemoryPersistence();
  persistence.plan.chapters[0].status = 'adopted';
  persistence.plan.progress.adoptedChapterNumbers = [1];
  persistence.plan.chapterRuns = [
    {
      runId: 'run-1',
      operationId: 'operation-1',
      chapterId: 'chapter-1',
      chapterNumber: 1,
      status: 'adopted',
      adoptedDraftId: 'draft-old',
      plannedCharacterBeatIds: ['beat-1'],
      confirmedCharacterBeatIds: ['beat-1'],
      analysis: {
        status: 'confirmed',
        adoptedDraftId: 'draft-old',
        worldSuggestionIds: ['world-old'],
        summaryId: 'summary-old',
        updatedAt: '2026-07-28T00:00:01Z',
      },
      createdAt: '2026-07-28T00:00:00Z',
      updatedAt: '2026-07-28T00:00:01Z',
    },
  ];
  const service = new AutonomousPostChapterService({
    persistence,
    chapters: {
      async getById() {
        return null;
      },
    },
    summarizer: {
      async summarize() {
        return summaryResult();
      },
    },
    worldSuggestions: {
      async generate() {
        return [];
      },
    },
    contextPersistence: {
      async save() {
        throw new Error('not used');
      },
    },
    hashContent: () => 'content-hash',
    validateSummary: () => ({ passed: true, score: 95, problems: [], safeToContext: true }),
    now: () => '2026-07-28T00:00:02Z',
  });

  const updated = await service.markAdopted({ ...draft('draft-new'), isAdopted: true });
  const run = updated?.chapterRuns?.[0];

  assert.equal(run?.adoptedDraftId, 'draft-new');
  assert.equal(run?.analysis, undefined);
  assert.deepEqual(run?.confirmedCharacterBeatIds, []);
  assert.deepEqual(updated?.progress.adoptedChapterNumbers, [1]);
});

test('页面恢复会对账权威采用稿，并仅为变化章节安排分析', async () => {
  const initial = storyPlan();
  initial.chapterRuns = [
    {
      runId: 'run-1',
      operationId: 'operation-1',
      chapterId: 'chapter-1',
      chapterNumber: 1,
      status: 'candidate_ready',
      candidateDraftId: 'draft-reviewed',
      plannedCharacterBeatIds: ['beat-1'],
      confirmedCharacterBeatIds: [],
      createdAt: '2026-07-28T00:00:00Z',
      updatedAt: '2026-07-28T00:00:01Z',
    },
  ];
  const adopted = { ...draft('draft-reviewed'), isAdopted: true };
  let markCalls = 0;

  const result = await reconcileAutonomousAdoptions(initial, {
    async getAdoptedDraft(chapterId) {
      return chapterId === 'chapter-1' ? adopted : null;
    },
    async markAdopted() {
      markCalls += 1;
      return {
        ...initial,
        chapters: initial.chapters.map((chapter) =>
          chapter.chapterNumber === 1 ? { ...chapter, status: 'adopted' as const } : chapter,
        ),
        chapterRuns: initial.chapterRuns?.map((run) => ({
          ...run,
          status: 'adopted' as const,
          adoptedDraftId: adopted.id,
        })),
        progress: {
          ...initial.progress,
          adoptedChapterNumbers: [1],
        },
      };
    },
  });

  assert.equal(markCalls, 1);
  assert.deepEqual(result.plan.progress.adoptedChapterNumbers, [1]);
  assert.deepEqual(
    result.draftsRequiringAnalysis.map((item) => item.id),
    ['draft-reviewed'],
  );

  const replay = await reconcileAutonomousAdoptions(result.plan, {
    async getAdoptedDraft(chapterId) {
      return chapterId === 'chapter-1' ? adopted : null;
    },
    async markAdopted() {
      markCalls += 1;
      return result.plan;
    },
  });
  assert.equal(markCalls, 1);
  assert.deepEqual(replay.draftsRequiringAnalysis, []);
});
