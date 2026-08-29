import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type {
  ReviewAuthorization,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';
import { resolveRetryRunChapterTarget } from './workbenchRetryTarget';

const chapters: Chapter[] = [
  {
    id: 'chapter-001',
    novelId: 'novel-001',
    title: '第一章：雾中来客',
    chapterNumber: 1,
    orderIndex: 0,
    sortOrder: 0,
    status: 'draft_generated',
    wordCount: 0,
    currentWords: 0,
    targetWords: 2500,
    drafts: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'chapter-002',
    novelId: 'novel-001',
    title: '第二章：旧钟证言',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
    status: 'draft_generated',
    wordCount: 0,
    currentWords: 0,
    targetWords: 2500,
    drafts: [],
    createdAt: '2026-08-20T00:00:01.000Z',
    updatedAt: '2026-08-20T00:00:01.000Z',
  },
];

function fixture(goal: string, runPatch: Partial<TaskRun> = {}): TaskConversationBundle {
  const run: TaskRun = {
    runId: 'run-source',
    conversationId: 'conversation-001',
    turnId: 'turn-source',
    status: 'failed',
    modelSnapshot: {
      providerId: 'mock',
      modelId: 'Mock',
      runtimeMode: 'mock',
      capabilities: [],
      options: {},
      capturedAt: '2026-08-20T00:00:00.000Z',
    },
    workerId: 'worker-001',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:01.000Z',
    ...runPatch,
  };
  return {
    conversation: {
      conversationId: 'conversation-001',
      novelId: 'novel-001',
      title: '冻结目标测试',
      status: 'failed',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:01.000Z',
    },
    turns: [
      {
        turnId: run.turnId,
        conversationId: 'conversation-001',
        sequence: 0,
        role: 'user',
        content: goal,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ],
    runs: [run],
    toolEvents: [],
    artifacts: [],
  };
}

const dependencies = { listChapters: async () => chapters };

const consumedAuthorization: ReviewAuthorization = {
  authorizationId: 'review-summary-001',
  artifactId: 'artifact-chapter-001',
  chapterId: 'chapter-001',
  novelId: 'novel-001',
  decisionId: 'decision-chapter-001',
  status: 'consumed',
  issuedAt: '2026-08-20T00:00:00.000Z',
  consumedAt: '2026-08-20T00:00:01.000Z',
  consumedByDraftId: 'draft-adopted-001',
};

const adoptedDraft: ChapterDraft = {
  id: 'draft-adopted-001',
  novelId: 'novel-001',
  chapterId: 'chapter-001',
  content: '正式采用正文',
  source: 'ai_generated',
  versionNo: 1,
  wordCount: 6,
  isAdopted: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:01.000Z',
};

function summaryDependencies(input: {
  authorization?: ReviewAuthorization | null;
  draft?: ChapterDraft | null;
  chapterAdoptedDraftId?: string;
}) {
  return {
    listChapters: async () =>
      chapters.map((chapter) =>
        chapter.id === 'chapter-001'
          ? {
              ...chapter,
              adoptedDraftId:
                input.chapterAdoptedDraftId === undefined
                  ? 'draft-adopted-001'
                  : input.chapterAdoptedDraftId,
            }
          : chapter,
      ),
    getReviewAuthorization: async (_authorizationId: string) =>
      input.authorization === undefined ? consumedAuthorization : input.authorization,
    getDraftById: async (_chapterId: string, _draftId: string) =>
      input.draft === undefined ? adoptedDraft : input.draft,
  };
}

test('retry target prefers the source run frozen chapter and never needs current UI state', async () => {
  const bundle = fixture('继续写', { chapterId: 'chapter-001' });
  const target = await resolveRetryRunChapterTarget(
    { bundle, sourceRun: bundle.runs[0], sourceGoal: '继续写' },
    dependencies,
  );
  assert.equal(target.chapterId, 'chapter-001');
  assert.equal(target.source, 'run.chapterId');
});

test('failed automatic chapter summary retry recovers its exact adopted chapter from the deterministic authorization turn', async () => {
  const bundle = fixture('总结本章', {
    turnId: `summary-generation-${consumedAuthorization.authorizationId}`,
  });
  let requestedAuthorizationId = '';
  let requestedDraftScope: [string, string] | undefined;
  const scopedDependencies = summaryDependencies({});
  scopedDependencies.getReviewAuthorization = async (authorizationId) => {
    requestedAuthorizationId = authorizationId;
    return consumedAuthorization;
  };
  scopedDependencies.getDraftById = async (chapterId, draftId) => {
    requestedDraftScope = [chapterId, draftId];
    return adoptedDraft;
  };
  const target = await resolveRetryRunChapterTarget(
    { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
    scopedDependencies,
  );
  assert.equal(requestedAuthorizationId, 'review-summary-001');
  assert.deepEqual(requestedDraftScope, ['chapter-001', 'draft-adopted-001']);
  assert.equal(target.chapterId, 'chapter-001');
  assert.equal(target.source, 'authorization.chapterId');
  assert.deepEqual(target.evidence, [
    'authorization:review-summary-001:consumedDraft:draft-adopted-001',
  ]);
});

test('chapter summary authorization evidence is merged with source-run evidence and rejects conflicts', async () => {
  const bundle = fixture('总结本章', {
    turnId: `summary-generation-${consumedAuthorization.authorizationId}`,
    chapterId: 'chapter-002',
  });
  await assert.rejects(
    resolveRetryRunChapterTarget(
      { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
      summaryDependencies({}),
    ),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'WORKBENCH_RETRY_TARGET_CONFLICT',
  );
});

test('chapter summary retry rejects authorization, chapter adoption, or adopted-draft drift', async (t) => {
  const bundle = fixture('总结本章', {
    turnId: `summary-generation-${consumedAuthorization.authorizationId}`,
  });

  await t.test('authorization belongs to another novel', async () => {
    await assert.rejects(
      resolveRetryRunChapterTarget(
        { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
        summaryDependencies({
          authorization: { ...consumedAuthorization, novelId: 'novel-other' },
        }),
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WORKBENCH_RETRY_TARGET_CONFLICT',
    );
  });

  await t.test('authorization is not consumed', async () => {
    await assert.rejects(
      resolveRetryRunChapterTarget(
        { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
        summaryDependencies({
          authorization: {
            ...consumedAuthorization,
            status: 'issued',
            consumedByDraftId: undefined,
          },
        }),
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WORKBENCH_RETRY_TARGET_INVALID',
    );
  });

  await t.test('chapter now adopts a different draft', async () => {
    await assert.rejects(
      resolveRetryRunChapterTarget(
        { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
        summaryDependencies({ chapterAdoptedDraftId: 'draft-newer' }),
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WORKBENCH_RETRY_TARGET_CONFLICT',
    );
  });

  await t.test('authorization draft is not an adopted draft for the same scope', async () => {
    await assert.rejects(
      resolveRetryRunChapterTarget(
        { bundle, sourceRun: bundle.runs[0], sourceGoal: '总结本章' },
        summaryDependencies({ draft: { ...adoptedDraft, isAdopted: false } }),
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WORKBENCH_RETRY_TARGET_INVALID',
    );
  });
});

test('ordinary retry does not consult chapter-summary authorization or draft evidence', async () => {
  const bundle = fixture('继续写', { chapterId: 'chapter-001' });
  const target = await resolveRetryRunChapterTarget(
    { bundle, sourceRun: bundle.runs[0], sourceGoal: '继续写' },
    {
      ...dependencies,
      getReviewAuthorization: async () => {
        throw new Error('ordinary retry must not read review authorization');
      },
      getDraftById: async () => {
        throw new Error('ordinary retry must not read adopted draft');
      },
    },
  );
  assert.equal(target.chapterId, 'chapter-001');
  assert.equal(target.source, 'run.chapterId');
});

test('legacy retry recovers one auditable target from source-run tool arguments', async () => {
  const bundle = fixture('检查本章伏笔');
  bundle.toolEvents.push({
    eventId: 'event-outline',
    runId: 'run-source',
    sequence: 0,
    toolName: 'chapter.read_outline',
    argumentsSummary: { novelId: 'novel-001', chapterId: 'chapter-002' },
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
  });
  const target = await resolveRetryRunChapterTarget(
    { bundle, sourceRun: bundle.runs[0], sourceGoal: '检查本章伏笔' },
    dependencies,
  );
  assert.equal(target.chapterId, 'chapter-002');
  assert.equal(target.source, 'tool.argumentsSummary.chapterId');
});

test('legacy retry may resolve an explicit chapter number from the persisted original goal', async () => {
  const bundle = fixture('先审计第二章人物线');
  const target = await resolveRetryRunChapterTarget(
    { bundle, sourceRun: bundle.runs[0], sourceGoal: '先审计第二章人物线' },
    dependencies,
  );
  assert.equal(target.chapterId, 'chapter-002');
  assert.equal(target.source, 'turn.goal.chapterNumber');
});

test('retry rejects missing or conflicting chapter evidence instead of choosing a UI chapter', async () => {
  const missing = fixture('继续写');
  await assert.rejects(
    resolveRetryRunChapterTarget(
      { bundle: missing, sourceRun: missing.runs[0], sourceGoal: '继续写' },
      dependencies,
    ),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'WORKBENCH_RETRY_TARGET_MISSING',
  );

  const conflict = fixture('检查本章', { chapterId: 'chapter-001' });
  conflict.toolEvents.push({
    eventId: 'event-conflict',
    runId: 'run-source',
    sequence: 0,
    toolName: 'chapter.read_outline',
    argumentsSummary: { chapterId: 'chapter-002' },
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
  });
  await assert.rejects(
    resolveRetryRunChapterTarget(
      { bundle: conflict, sourceRun: conflict.runs[0], sourceGoal: '检查本章' },
      dependencies,
    ),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'WORKBENCH_RETRY_TARGET_CONFLICT',
  );
});
