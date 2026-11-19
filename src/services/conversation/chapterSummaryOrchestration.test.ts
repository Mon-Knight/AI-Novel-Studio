import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummary, ChapterSummaryValidation } from '../../types/chapterSummary';
import type {
  ReviewAuthorization,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';
import {
  chapterSummaryOrchestrationLabel,
  chapterSummaryTurnId,
  resolveChapterSummaryOrchestration,
} from './chapterSummaryOrchestration';

const authorization: ReviewAuthorization = {
  authorizationId: 'auth-1',
  artifactId: 'chapter-artifact',
  chapterId: 'chapter-1',
  novelId: 'novel-1',
  decisionId: 'decision-1',
  status: 'consumed',
  issuedAt: '2026-08-28T00:00:00.000Z',
  consumedAt: '2026-08-28T00:10:00.000Z',
  consumedByDraftId: 'draft-1',
};

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  outline: '',
  goal: '',
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  status: 'adopted',
  adoptedDraftId: 'draft-1',
  wordCount: 1000,
  currentWords: 1000,
  targetWords: 1000,
  drafts: [],
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:10:00.000Z',
};

function bundle(): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      title: '写作任务',
      status: 'idle',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:10:00.000Z',
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: [],
    decisions: [],
    authorizations: [authorization],
  };
}

function run(status: TaskRun['status']): TaskRun {
  return {
    runId: 'summary-run-1',
    conversationId: 'conversation-1',
    turnId: chapterSummaryTurnId(authorization.authorizationId),
    chapterId: chapter.id,
    status,
    modelSnapshot: {
      providerId: 'provider',
      modelId: 'model',
      runtimeMode: 'api',
      capabilities: [],
      options: {},
      capturedAt: '2026-08-28T00:00:00.000Z',
    },
    workerId: 'worker-1',
    createdAt: '2026-08-28T00:11:00.000Z',
    updatedAt: '2026-08-28T00:11:00.000Z',
  };
}

test('consumed adoption first ensures one deterministic automatic summary turn', () => {
  const state = resolveChapterSummaryOrchestration({
    bundle: bundle(),
    chapters: [chapter],
    summaries: [],
  });

  assert.equal(state.phase, 'ensure_turn');
  assert.equal(state.turnId, 'summary-generation-auth-1');
});

test('zero-run summary turn waits for credentials and becomes startable once available', () => {
  const state = bundle();
  state.turns.push({
    turnId: chapterSummaryTurnId(authorization.authorizationId),
    conversationId: 'conversation-1',
    sequence: 2,
    role: 'user',
    content: '总结本章',
    createdAt: '2026-08-28T00:11:00.000Z',
  });

  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: state,
      chapters: [chapter],
      summaries: [],
      credentialAvailable: false,
    }).phase,
    'awaiting_credentials',
  );
  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: state,
      chapters: [chapter],
      summaries: [],
      credentialAvailable: true,
    }).phase,
    'ready_to_start',
  );
});

test('terminal run never becomes automatically startable and valid candidate awaits apply', () => {
  const state = bundle();
  const turnId = chapterSummaryTurnId(authorization.authorizationId);
  state.turns.push({
    turnId,
    conversationId: 'conversation-1',
    sequence: 2,
    role: 'user',
    content: '总结本章',
    createdAt: '2026-08-28T00:11:00.000Z',
  });
  state.runs.push(run('failed'));
  assert.equal(
    resolveChapterSummaryOrchestration({ bundle: state, chapters: [chapter], summaries: [] }).phase,
    'failed',
  );

  state.runs[0] = run('completed');
  state.artifacts.push({
    cardId: 'summary-card-1',
    conversationId: 'conversation-1',
    turnId,
    runId: 'summary-run-1',
    artifactId: 'summary-artifact-1',
    artifactType: 'chapter_summary',
    title: '章节总结候选',
    summary: '候选',
    status: 'candidate',
    createdAt: '2026-08-28T00:12:00.000Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      processingStatus: 'valid',
      validationIssues: [],
    },
  });
  assert.equal(
    resolveChapterSummaryOrchestration({ bundle: state, chapters: [chapter], summaries: [] }).phase,
    'awaiting_apply',
  );
});

test('matching formal summary advances only to a planned next chapter or story completion', () => {
  const summary: ChapterSummary = {
    id: 'summary-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    adoptedDraftId: 'draft-1',
    summary: '第一章正式总结',
    enabled: true,
    isExpired: false,
    createdAt: '2026-08-28T00:12:00.000Z',
    updatedAt: '2026-08-28T00:12:00.000Z',
  };

  const ready = resolveChapterSummaryOrchestration({
    bundle: bundle(),
    chapters: [chapter],
    summaries: [summary],
    nextTarget: { status: 'advanced', chapterId: 'chapter-2' },
  });
  assert.equal(ready.phase, 'next_ready');
  assert.equal(ready.nextChapterId, 'chapter-2');
  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: bundle(),
      chapters: [chapter],
      summaries: [summary],
      nextTarget: { status: 'complete' },
    }).phase,
    'story_complete',
  );
});

test('recovery closes the earliest planned adopted chapter summary gap first', () => {
  const state = bundle();
  const secondAuthorization: ReviewAuthorization = {
    ...authorization,
    authorizationId: 'auth-2',
    artifactId: 'chapter-artifact-2',
    chapterId: 'chapter-2',
    decisionId: 'decision-2',
    consumedAt: '2026-08-28T00:20:00.000Z',
    consumedByDraftId: 'draft-2',
  };
  state.authorizations = [authorization, secondAuthorization];
  const secondChapter: Chapter = {
    ...chapter,
    id: 'chapter-2',
    title: '第二章',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
    adoptedDraftId: 'draft-2',
  };

  const recovered = resolveChapterSummaryOrchestration({
    bundle: state,
    chapters: [chapter, secondChapter],
    summaries: [],
  });
  assert.equal(recovered.authorizationId, 'auth-1');
  assert.equal(recovered.phase, 'ensure_turn');
});

test('pre-run summary failure exposes a distinct manual recovery label', () => {
  assert.equal(
    chapterSummaryOrchestrationLabel({
      phase: 'failed',
      turnId: chapterSummaryTurnId(authorization.authorizationId),
    }),
    '章节总结启动失败，请重试',
  );
  assert.equal(
    chapterSummaryOrchestrationLabel({
      phase: 'failed',
      turnId: chapterSummaryTurnId(authorization.authorizationId),
      runId: 'summary-run-1',
    }),
    '章节总结未完成，请使用回合中的重试操作',
  );
});

test('a rejected earlier summary stays visible while another adopted chapter can generate', () => {
  const state = bundle();
  const secondChapter = {
    ...chapter,
    id: 'chapter-2',
    chapterNumber: 2,
    adoptedDraftId: 'draft-2',
  };
  state.authorizations!.push({
    ...authorization,
    authorizationId: 'auth-2',
    chapterId: 'chapter-2',
    consumedByDraftId: 'draft-2',
  });
  const turnId = chapterSummaryTurnId(authorization.authorizationId);
  state.turns.push({
    turnId,
    conversationId: 'conversation-1',
    sequence: 1,
    role: 'user',
    content: '总结本章',
    createdAt: '2026-08-28T00:11:00Z',
  });
  state.runs.push(run('completed'));
  state.artifacts.push({
    cardId: 'summary-card',
    conversationId: 'conversation-1',
    runId: 'summary-run-1',
    turnId,
    artifactId: 'summary-artifact',
    artifactType: 'chapter_summary',
    title: '总结',
    summary: '',
    status: 'rejected',
    createdAt: '2026-08-28T00:12:00Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      processingStatus: 'valid',
      validationIssues: [],
    },
    latestDecision: {
      decisionId: 'reject',
      artifactId: 'summary-artifact',
      artifactHash: 'h',
      cardId: 'summary-card',
      conversationId: 'conversation-1',
      decision: 'reject',
      idempotencyKey: 'reject',
      actor: 'user',
      targetType: 'chapter',
      targetId: 'chapter-1',
      createdAt: '2026-08-28T00:13:00Z',
    },
  });
  const result = resolveChapterSummaryOrchestration({
    bundle: state,
    chapters: [chapter, secondChapter],
    summaries: [],
  });
  assert.equal(result.chapterId, 'chapter-2');
  assert.equal(result.phase, 'ensure_turn');
  assert.deepEqual(
    result.pendingChapters?.find((item) => item.chapterId === 'chapter-1'),
    { chapterId: 'chapter-1', phase: 'rejected', cardId: 'summary-card' },
  );
  assert.equal(state.artifacts[0].latestDecision?.decision, 'reject');
});

test('a newer manual summary candidate prevents duplicate automatic generation for the same adopted draft', () => {
  const state = bundle();
  state.artifacts.push({
    cardId: 'manual-card',
    conversationId: 'conversation-1',
    runId: 'manual-run',
    turnId: 'manual-turn',
    artifactId: 'manual-summary',
    artifactType: 'chapter_summary',
    title: '重新总结',
    summary: '',
    status: 'candidate',
    createdAt: '2026-08-28T00:12:00Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      processingStatus: 'valid',
      validationIssues: [],
    },
  });
  const result = resolveChapterSummaryOrchestration({
    bundle: state,
    chapters: [chapter],
    summaries: [],
  });
  assert.equal(result.phase, 'awaiting_apply');
  assert.equal(result.turnId, 'manual-turn');
  assert.equal(result.cardId, 'manual-card');
  state.artifacts[0].artifactEvidence!.sourceDraftId = 'old-draft';
  assert.equal(
    resolveChapterSummaryOrchestration({ bundle: state, chapters: [chapter], summaries: [] }).phase,
    'ensure_turn',
  );
});

test('disabled or expired summaries remain explicit and never trigger automatic replacement', () => {
  const summary: ChapterSummary = {
    id: 'summary',
    novelId: chapter.novelId,
    chapterId: chapter.id,
    adoptedDraftId: chapter.adoptedDraftId!,
    summary: '已保存的总结',
    enabled: false,
    isExpired: false,
    createdAt: '',
    updatedAt: '',
  };
  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: bundle(),
      chapters: [chapter],
      summaries: [summary],
    }).phase,
    'disabled',
  );
  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: bundle(),
      chapters: [chapter],
      summaries: [{ ...summary, enabled: true, isExpired: true }],
    }).phase,
    'expired',
  );
});

function formalSummary(validation?: ChapterSummaryValidation): ChapterSummary {
  return {
    id: 'formal-summary',
    novelId: chapter.novelId,
    chapterId: chapter.id,
    adoptedDraftId: chapter.adoptedDraftId!,
    summary: '既有正式总结',
    enabled: true,
    isExpired: false,
    createdAt: '2026-08-28T00:12:00Z',
    updatedAt: '2026-08-28T00:12:00Z',
    ...(validation ? { validationResult: validation } : {}),
  };
}

const unsafeSummaryValidation: ChapterSummaryValidation = {
  policyVersion: 1,
  passed: false,
  score: 99,
  safeToContext: true,
  problems: [{ type: 'character_error', message: '正文没有该人物，不能进入上下文。' }],
  semanticValidation: 'not_checked',
};

test('summary policy blocks enabled unsafe or unreviewed summaries from readiness and continuation', () => {
  const cases: Array<{
    validation: ChapterSummaryValidation;
    reason: string;
    status?: ChapterSummary['validationStatus'];
  }> = [
    { validation: unsafeSummaryValidation, reason: 'SUMMARY_BLOCKING_VALIDATION_ERROR' },
    {
      validation: {
        policyVersion: 1,
        passed: true,
        score: 100,
        safeToContext: true,
        problems: [],
        reviewRequirement: 'human_required',
        authorReviewed: false,
      },
      reason: 'SUMMARY_HUMAN_REVIEW_REQUIRED',
    },
    {
      validation: {
        policyVersion: 1,
        passed: true,
        score: 100,
        safeToContext: false,
        problems: [],
      },
      reason: 'SUMMARY_CONTEXT_UNSAFE',
    },
    {
      validation: { policyVersion: 1, passed: true, score: 100, safeToContext: true, problems: [] },
      status: 'failed',
      reason: 'SUMMARY_BLOCKING_VALIDATION_ERROR',
    },
  ];
  for (const item of cases) {
    const summary = { ...formalSummary(item.validation), validationStatus: item.status };
    for (const nextTarget of [
      undefined,
      { status: 'advanced' as const, chapterId: 'chapter-2' },
      { status: 'complete' as const },
    ]) {
      const state = resolveChapterSummaryOrchestration({
        bundle: bundle(),
        chapters: [chapter],
        summaries: [summary],
        nextTarget,
      });
      assert.equal(state.phase, 'failed');
      assert.equal(state.stopReason, item.reason);
      assert.equal(state.nextChapterId, undefined);
      assert.doesNotMatch(chapterSummaryOrchestrationLabel(state), /已应用.*已就绪|故事已到达/u);
    }
    const persisted = bundle();
    persisted.turns.push({
      turnId: chapterSummaryTurnId(authorization.authorizationId),
      conversationId: 'conversation-1',
      sequence: 2,
      role: 'user',
      content: '总结本章',
      createdAt: '2026-08-28T00:11:00Z',
    });
    assert.equal(
      resolveChapterSummaryOrchestration({
        bundle: persisted,
        chapters: [chapter],
        summaries: [summary],
        credentialAvailable: true,
      }).phase,
      'failed',
      'a persisted empty followup is not permission to regenerate a blocked summary',
    );
  }
});

test('blocked formal summary keeps explicit new candidates and active repairs reviewable', () => {
  const state = bundle();
  state.artifacts.push({
    cardId: 'repair-card',
    artifactId: 'repair-artifact',
    conversationId: 'conversation-1',
    turnId: 'manual-repair-turn',
    runId: 'manual-repair-run',
    artifactType: 'chapter_summary',
    title: '作者重新请求的总结候选',
    summary: '尚未应用',
    status: 'candidate',
    createdAt: '2026-08-28T00:13:00Z',
    artifactEvidence: {
      sourceNovelId: chapter.novelId,
      sourceChapterId: chapter.id,
      sourceDraftId: chapter.adoptedDraftId,
      processingStatus: 'valid',
      validationIssues: [],
    },
  });
  const readyForReview = resolveChapterSummaryOrchestration({
    bundle: state,
    chapters: [chapter],
    summaries: [formalSummary(unsafeSummaryValidation)],
    nextTarget: { status: 'advanced', chapterId: 'chapter-2' },
  });
  assert.equal(readyForReview.phase, 'awaiting_apply');
  assert.equal(readyForReview.cardId, 'repair-card');
  assert.equal(readyForReview.nextChapterId, undefined);
  const active = bundle();
  active.turns.push({
    turnId: chapterSummaryTurnId(authorization.authorizationId),
    conversationId: 'conversation-1',
    sequence: 2,
    role: 'user',
    content: '总结本章',
    createdAt: '2026-08-28T00:11:00Z',
  });
  active.runs.push(run('running'));
  assert.equal(
    resolveChapterSummaryOrchestration({
      bundle: active,
      chapters: [chapter],
      summaries: [formalSummary(unsafeSummaryValidation)],
    }).phase,
    'generating',
  );
});

test('summary policy retains legacy manual and nonblocking context without fabricating author review', () => {
  const validations: Array<ChapterSummaryValidation | undefined> = [
    undefined,
    {
      passed: false,
      score: 80,
      safeToContext: true,
      authorReviewed: true,
      semanticValidation: 'not_checked',
      evidenceValidation: 'passed',
      problems: [{ type: 'speculation', message: '历史人工判断，未宣称语义证明。' }],
    },
    {
      policyVersion: 1,
      passed: true,
      score: 76,
      safeToContext: true,
      problems: [],
      advisories: [
        { code: 'SEMANTIC_NOT_CHECKED', path: '/summary', message: '结构通过，不是语义证明。' },
      ],
      semanticValidation: 'not_checked',
      authorReviewed: false,
    },
    {
      policyVersion: 1,
      passed: true,
      score: 100,
      safeToContext: true,
      problems: [],
      applicationProvenance: { mode: 'task_preauthorization', authorizationId: 'grant-1' },
      authorReviewed: false,
    },
  ];
  for (const validation of validations) {
    const original = validation ? JSON.stringify(validation) : undefined;
    const summary = formalSummary(validation);
    const next = resolveChapterSummaryOrchestration({
      bundle: bundle(),
      chapters: [chapter],
      summaries: [summary],
      nextTarget: { status: 'advanced', chapterId: 'chapter-2' },
    });
    assert.equal(next.phase, 'next_ready');
    assert.equal(next.nextChapterId, 'chapter-2');
    assert.equal(validation ? JSON.stringify(validation) : undefined, original);
  }
  for (const flags of [
    { enabled: false, isExpired: false },
    { enabled: true, isExpired: true },
  ]) {
    const state = resolveChapterSummaryOrchestration({
      bundle: bundle(),
      chapters: [chapter],
      summaries: [{ ...formalSummary(unsafeSummaryValidation), ...flags }],
    });
    assert.equal(state.phase, flags.isExpired ? 'expired' : 'disabled');
  }
});
