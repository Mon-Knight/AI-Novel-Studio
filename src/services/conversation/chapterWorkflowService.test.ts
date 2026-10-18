import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { TaskConversationBundle } from '../../types/conversation';
import {
  buildChapterSummaryRedoHandoff,
  loadChapterWorkflow,
  resolveChapterWorkflow,
} from './chapterWorkflowService';

const fixture = vi.hoisted(() => ({
  chapter: vi.fn(),
  summary: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  artifact: vi.fn(),
  persistent: vi.fn(),
}));
vi.mock('../database/chapterRepository', () => ({
  chapterRepository: { getById: fixture.chapter },
}));
vi.mock('../context/chapterSummaryService', () => ({
  chapterSummaryService: { getByChapterId: fixture.summary },
}));
vi.mock('./taskConversationService', () => ({
  taskConversationService: {
    listPage: fixture.list,
    get: fixture.get,
    isPersistent: fixture.persistent,
  },
}));
vi.mock('../ai-tasks/aiTaskRuntimeService', () => ({
  aiTaskRuntimeService: { getArtifact: fixture.artifact },
}));

const chapter: Chapter = {
  id: 'chapter-3',
  novelId: 'novel',
  title: '旧信',
  chapterNumber: 3,
  outline: '',
  goal: '',
  orderIndex: 2,
  sortOrder: 2,
  status: 'adopted',
  adoptedDraftId: 'draft-3',
  wordCount: 3400,
  currentWords: 3400,
  targetWords: 3400,
  drafts: [],
  createdAt: '2026-10-15',
  updatedAt: '2026-10-16',
};
function bundle(): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'source',
      novelId: 'novel',
      title: '写第三章',
      status: 'idle',
      defaultModel: {
        providerId: 'configured',
        modelId: 'model-3.8',
        runtimeMode: 'api',
        baseUrl: 'https://configured.example',
        capabilities: [],
        options: {},
        capturedAt: '2026-10-15',
      },
      createdAt: '2026-10-15',
      updatedAt: '2026-10-16',
    },
    turns: [
      {
        turnId: 'summary-generation-auth-3',
        conversationId: 'source',
        sequence: 1,
        role: 'user',
        content: '总结本章',
        createdAt: '2026-10-16',
      },
    ],
    runs: [],
    toolEvents: [],
    artifacts: [],
    decisions: [],
    authorizations: [
      {
        authorizationId: 'auth-3',
        artifactId: 'chapter-artifact',
        chapterId: chapter.id,
        novelId: chapter.novelId,
        decisionId: 'decision',
        status: 'consumed',
        issuedAt: '2026-10-15',
        consumedAt: '2026-10-15T00:00:00Z',
        consumedByDraftId: chapter.adoptedDraftId,
      },
    ],
  };
}
const request = { novelId: chapter.novelId, chapterId: chapter.id };

describe('chapter workflow source and adoption identity', () => {
  it('returns the exact adopted source task and its model, ignoring unrelated recent tasks', () => {
    const unrelated = bundle();
    unrelated.conversation = {
      ...unrelated.conversation,
      conversationId: 'other',
      novelId: 'other',
    };
    const source = resolveChapterWorkflow(request, chapter, null, [unrelated, bundle()]);
    expect(source).toMatchObject({
      phase: 'missing',
      conversationId: 'source',
      actualModel: false,
      model: { modelId: 'model-3.8' },
    });
  });
  it('does not route a new adopted draft to the previous consumed authorization', () => {
    expect(
      resolveChapterWorkflow(request, { ...chapter, adoptedDraftId: 'new-draft' }, null, [bundle()])
        .conversationId,
    ).toBeUndefined();
    expect(() =>
      resolveChapterWorkflow({ ...request, novelId: 'other' }, chapter, null, [bundle()]),
    ).toThrow('作品');
    expect(() =>
      resolveChapterWorkflow({ ...request, authorizationId: 'wrong' }, chapter, null, [bundle()]),
    ).toThrow('来源');
  });
  it('routes a rejected summary to its actual task and frozen model for a deliberate redo', () => {
    const state = bundle();
    const turnId = 'summary-generation-auth-3';
    state.runs.push({
      runId: 'summary-run',
      turnId,
      chapterId: chapter.id,
      conversationId: 'source',
      status: 'completed',
      modelSnapshot: { ...state.conversation.defaultModel!, modelId: 'frozen-model' },
      workerId: 'w',
      createdAt: '2026-10-16T01:00:00Z',
      updatedAt: '2026-10-16T01:01:00Z',
    });
    state.artifacts.push({
      cardId: 'summary-card',
      conversationId: 'source',
      runId: 'summary-run',
      turnId,
      artifactId: 'summary-artifact',
      artifactType: 'chapter_summary',
      title: '总结',
      summary: '',
      status: 'rejected',
      createdAt: '2026-10-16T01:01:00Z',
      artifactEvidence: {
        sourceNovelId: 'novel',
        sourceChapterId: chapter.id,
        sourceDraftId: chapter.adoptedDraftId,
        processingStatus: 'valid',
        validationIssues: [],
      },
    });
    state.decisions!.push({
      decisionId: 'reject',
      artifactId: 'summary-artifact',
      artifactHash: 'hash',
      cardId: 'summary-card',
      conversationId: 'source',
      decision: 'reject',
      idempotencyKey: 'reject',
      actor: 'user',
      targetType: 'chapter',
      targetId: chapter.id,
      createdAt: '2026-10-16T01:02:00Z',
    });
    const result = resolveChapterWorkflow(request, chapter, null, [state]);
    expect(result).toMatchObject({
      phase: 'rejected',
      cardId: 'summary-card',
      actualModel: true,
      model: { modelId: 'frozen-model' },
    });
    const handoff = buildChapterSummaryRedoHandoff({
      ...request,
      adoptedDraftId: chapter.adoptedDraftId,
      conversationId: result.conversationId,
      revisionNotes: '调查尚未完成',
    });
    expect(handoff.chapterWorkflow.draft).toContain('调查尚未完成');
    expect(handoff.chapterWorkflow).toMatchObject({
      adoptedDraftId: 'draft-3',
      chapterId: 'chapter-3',
    });
    expect(handoff.chapterWorkflow).not.toHaveProperty('revisionSource');
  });
  it('only marks a matching enabled formal summary applied', () => {
    const summary: ChapterSummary = {
      id: 'summary',
      novelId: 'novel',
      chapterId: chapter.id,
      adoptedDraftId: 'draft-3',
      summary: '正式事实',
      enabled: true,
      isExpired: false,
      createdAt: '',
      updatedAt: '',
    };
    expect(resolveChapterWorkflow(request, chapter, summary, [bundle()]).phase).toBe('applied');
    expect(
      resolveChapterWorkflow(request, chapter, { ...summary, adoptedDraftId: 'old' }, [bundle()])
        .phase,
    ).toBe('expired');
    expect(
      resolveChapterWorkflow(request, chapter, { ...summary, enabled: false }, [bundle()]).phase,
    ).toBe('disabled');
    expect(() =>
      resolveChapterWorkflow(request, chapter, { ...summary, novelId: 'foreign' }, [bundle()]),
    ).toThrow('作用域');
    expect(() =>
      resolveChapterWorkflow(request, chapter, { ...summary, chapterId: 'foreign' }, [bundle()]),
    ).toThrow('作用域');
  });
  it('exposes failed automatic summary without pretending a new generation is pending', () => {
    const state = bundle();
    state.runs.push({
      runId: 'failed',
      conversationId: 'source',
      turnId: 'summary-generation-auth-3',
      chapterId: chapter.id,
      status: 'failed',
      modelSnapshot: state.conversation.defaultModel!,
      workerId: 'w',
      createdAt: '2026-10-16',
      updatedAt: '2026-10-16',
    });
    expect(resolveChapterWorkflow(request, chapter, null, [state])).toMatchObject({
      phase: 'failed',
      actualModel: true,
    });
  });
  it('locates a failed manual summary in its own task while preserving the writing source', () => {
    const manual = bundle();
    manual.conversation.conversationId = 'manual-summary';
    manual.authorizations = [];
    manual.turns = [
      {
        turnId: 'manual-turn',
        conversationId: 'manual-summary',
        sequence: 1,
        role: 'user',
        content: '总结本章',
        createdAt: '2026-10-16',
      },
    ];
    manual.runs = [
      {
        runId: 'manual-run',
        conversationId: 'manual-summary',
        turnId: 'manual-turn',
        chapterId: chapter.id,
        status: 'failed',
        modelSnapshot: { ...manual.conversation.defaultModel!, modelId: 'manual-frozen' },
        workerId: 'w',
        createdAt: '2026-10-16',
        updatedAt: '2026-10-16',
      },
    ];
    manual.toolEvents = [
      {
        eventId: 'manual-tool',
        runId: 'manual-run',
        sequence: 1,
        toolName: 'summarize_chapter',
        argumentsSummary: { chapterId: chapter.id },
        status: 'failed',
        createdAt: '2026-10-16',
      },
    ];
    expect(resolveChapterWorkflow(request, chapter, null, [bundle(), manual])).toMatchObject({
      phase: 'failed',
      sourceConversationId: 'source',
      conversationId: 'manual-summary',
      actualModel: true,
      model: { modelId: 'manual-frozen' },
    });
    // An HTTP/context failure happens before summarize_chapter is ever called.
    manual.toolEvents[0] = {
      ...manual.toolEvents[0],
      toolName: 'dsh.execution_contract',
      status: 'succeeded',
      argumentsSummary: {
        source: 'ans-host',
        taskKind: 'chapter_summary',
        summarySource: {
          version: 1,
          novelId: chapter.novelId,
          chapterId: chapter.id,
          adoptedDraftId: chapter.adoptedDraftId,
          contentHash: 'a'.repeat(64),
        },
      },
    };
    expect(resolveChapterWorkflow(request, chapter, null, [bundle(), manual])).toMatchObject({
      phase: 'failed',
      sourceConversationId: 'source',
      conversationId: 'manual-summary',
      actualModel: true,
      model: { modelId: 'manual-frozen' },
    });
    expect(
      resolveChapterWorkflow(request, { ...chapter, adoptedDraftId: 'new-adoption' }, null, [
        bundle(),
        manual,
      ]),
    ).toMatchObject({ phase: 'missing', actualModel: false });
  });
  it('keeps an explicitly selected older summary in its own task when another task has a newer candidate', () => {
    const older = bundle();
    const newer = bundle();
    newer.conversation = { ...newer.conversation, conversationId: 'newer-summary' };
    newer.authorizations = [];
    for (const [index, item] of [older, newer].entries()) {
      const runId = `summary-run-${index}`;
      item.runs = [
        {
          runId,
          conversationId: item.conversation.conversationId,
          turnId: 'summary-generation-auth-3',
          chapterId: chapter.id,
          status: 'completed',
          modelSnapshot: { ...item.conversation.defaultModel!, modelId: `frozen-${index}` },
          workerId: 'worker',
          createdAt: `2026-10-16T0${index}:00:00Z`,
          updatedAt: `2026-10-16T0${index}:01:00Z`,
        },
      ];
      item.artifacts = [
        {
          cardId: `card-${index}`,
          artifactId: `artifact-${index}`,
          conversationId: item.conversation.conversationId,
          runId,
          artifactType: 'chapter_summary',
          title: '总结',
          summary: '',
          status: 'candidate',
          createdAt: `2026-10-16T0${index}:01:00Z`,
          artifactEvidence: {
            sourceNovelId: chapter.novelId,
            sourceChapterId: chapter.id,
            sourceDraftId: chapter.adoptedDraftId,
            processingStatus: 'valid_with_warnings',
            validationIssues: [],
          },
        },
      ];
    }
    expect(resolveChapterWorkflow(request, chapter, null, [older, newer])).toMatchObject({
      conversationId: 'newer-summary',
      cardId: 'card-1',
    });
    const exact = { ...request, summaryCardId: 'card-0' };
    expect(resolveChapterWorkflow(exact, chapter, null, [older, newer])).toMatchObject({
      conversationId: 'source',
      sourceConversationId: 'source',
      cardId: 'card-0',
      model: { modelId: 'frozen-0' },
    });
    older.artifacts[0].artifactEvidence!.processingStatus = 'invalid';
    expect(resolveChapterWorkflow(exact, chapter, null, [older, newer])).toMatchObject({
      phase: 'failed',
      conversationId: 'source',
      cardId: 'card-0',
    });
    for (const field of ['sourceNovelId', 'sourceChapterId', 'sourceDraftId'] as const) {
      const previous = older.artifacts[0].artifactEvidence![field];
      older.artifacts[0].artifactEvidence![field] = 'foreign';
      expect(() => resolveChapterWorkflow(exact, chapter, null, [older, newer])).toThrow(
        '所选总结候选',
      );
      older.artifacts[0].artifactEvidence![field] = previous!;
    }
    expect(() =>
      resolveChapterWorkflow({ ...request, summaryCardId: 'missing' }, chapter, null, [older]),
    ).toThrow('所选总结候选');
  });
});

describe('chapter workflow authoritative reads', () => {
  beforeEach(() => {
    fixture.chapter.mockResolvedValue(chapter);
    fixture.summary.mockResolvedValue(null);
    fixture.list.mockResolvedValue({ items: [bundle().conversation] });
    fixture.get.mockResolvedValue(bundle());
    fixture.persistent.mockReturnValue(true);
  });
  it('reads all project directory pages and hydrates only summary candidates', async () => {
    const source = bundle();
    source.artifacts = ['chapter_text', 'chapter_summary'].map((type, index) => ({
      cardId: `card-${index}`,
      artifactId: `artifact-${index}`,
      artifactType: type as 'chapter_text' | 'chapter_summary',
      conversationId: 'source',
      title: type,
      summary: '',
      status: 'candidate',
      createdAt: '2026-10-16',
    }));
    const cursor = { updatedAt: '2026-10-15', conversationId: 'older' };
    fixture.list
      .mockResolvedValueOnce({ items: [], nextCursor: cursor })
      .mockResolvedValueOnce({ items: [source.conversation] });
    fixture.get.mockResolvedValueOnce(source);
    fixture.artifact.mockResolvedValueOnce({
      artifact: {
        artifactId: 'artifact-1',
        artifactType: 'chapter_summary',
        sourceNovelId: 'novel',
        sourceChapterId: chapter.id,
        sourceDraftId: chapter.adoptedDraftId,
        processingStatus: 'valid',
      },
      issues: [],
    });
    const result = await loadChapterWorkflow(request);
    expect(result).toMatchObject({
      phase: 'awaiting_apply',
      conversationId: 'source',
      cardId: 'card-1',
    });
    expect(fixture.artifact).toHaveBeenCalledExactlyOnceWith('artifact-1');
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith('source', { hydrateArtifacts: false });
    expect(fixture.list).toHaveBeenLastCalledWith({
      novelId: 'novel',
      archive: 'all',
      limit: 100,
      cursor,
    });
  });
  it('surfaces unreadable summary evidence and permits a fresh read after failure', async () => {
    const source = bundle();
    source.artifacts = [
      {
        cardId: 'card',
        artifactId: 'summary',
        artifactType: 'chapter_summary',
        conversationId: 'source',
        title: '',
        summary: '',
        status: 'candidate',
        createdAt: '',
      },
    ];
    fixture.get.mockResolvedValue(source);
    fixture.artifact.mockRejectedValueOnce(new Error('总结读取失败'));
    await expect(loadChapterWorkflow(request)).rejects.toThrow('总结读取失败');
    fixture.get.mockResolvedValueOnce(bundle());
    await expect(loadChapterWorkflow(request)).resolves.toMatchObject({ phase: 'missing' });
    expect(fixture.chapter).toHaveBeenCalledTimes(2);
  });
  it('deduplicates simultaneous panel reads without making completed state stale', async () => {
    const first = loadChapterWorkflow(request);
    const second = loadChapterWorkflow({ ...request, authorizationId: undefined });
    expect(second).toBe(first);
    await first;
    expect(fixture.chapter).toHaveBeenCalledTimes(1);
    await loadChapterWorkflow(request);
    expect(fixture.chapter).toHaveBeenCalledTimes(2);
  });
});
