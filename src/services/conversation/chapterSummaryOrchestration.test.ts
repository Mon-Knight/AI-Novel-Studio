import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
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
