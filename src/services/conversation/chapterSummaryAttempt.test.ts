import { describe, expect, it } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { TaskConversationBundle, TaskRun } from '../../types/conversation';
import { isCurrentChapterSummaryAttempt } from './chapterSummaryAttempt';

const chapter = { id: 'chapter', novelId: 'novel', adoptedDraftId: 'draft' } as Chapter;
function fixture() {
  const run: TaskRun = {
    runId: 'summary-run',
    conversationId: 'summary-task',
    turnId: 'summary-turn',
    chapterId: chapter.id,
    status: 'failed',
    workerId: 'worker',
    modelSnapshot: {
      modelId: 'frozen-summary-model',
      providerId: 'configured',
      runtimeMode: 'api',
      capturedAt: '2026-10-16',
      capabilities: [],
      options: {},
    },
    createdAt: '2026-10-16T01:00:00Z',
    updatedAt: '2026-10-16T01:01:00Z',
  };
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: run.conversationId,
      novelId: chapter.novelId,
      title: '总结任务',
      status: 'failed',
      createdAt: '2026-10-16',
      updatedAt: '2026-10-16',
    },
    turns: [
      {
        turnId: run.turnId,
        conversationId: run.conversationId,
        sequence: 1,
        role: 'user',
        content: '模型决定的总结请求',
        createdAt: run.createdAt,
      },
    ],
    runs: [run],
    artifacts: [],
    toolEvents: [
      {
        eventId: 'host-contract',
        runId: run.runId,
        toolName: 'dsh.execution_contract',
        sequence: 1,
        status: 'succeeded',
        createdAt: run.createdAt,
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
      },
    ],
  };
  return { bundle, run };
}

describe('chapter summary attempt host identity', () => {
  it.each(['queued', 'running', 'failed', 'cancelled'] as const)(
    'recognizes %s manual summary before any candidate tool was called',
    (status) => {
      const { bundle, run } = fixture();
      run.status = status;
      expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(true);
    },
  );
  it.each(['novelId', 'chapterId', 'adoptedDraftId', 'version', 'contentHash'])(
    'rejects mismatched or invalid frozen source %s',
    (field) => {
      const { bundle, run } = fixture();
      (bundle.toolEvents[0].argumentsSummary.summarySource as Record<string, unknown>)[field] =
        'wrong';
      expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(false);
    },
  );
  it.each(['source', 'taskKind', 'status', 'duplicate', 'run', 'chapter', 'novel', 'turn'])(
    'fails closed on invalid host/run identity %s even if a summary tool exists',
    (field) => {
      const { bundle, run } = fixture();
      if (field === 'source') bundle.toolEvents[0].argumentsSummary.source = 'provider';
      if (field === 'taskKind') bundle.toolEvents[0].argumentsSummary.taskKind = 'chapter_write';
      if (field === 'status') bundle.toolEvents[0].status = 'failed';
      if (field === 'duplicate') bundle.toolEvents.push({ ...bundle.toolEvents[0] });
      if (field === 'run') run.conversationId = 'foreign-task';
      if (field === 'chapter') run.chapterId = 'foreign-chapter';
      if (field === 'novel') bundle.conversation.novelId = 'foreign-novel';
      if (field === 'turn') bundle.turns[0].role = 'assistant';
      bundle.toolEvents.push({
        ...bundle.toolEvents[0],
        eventId: 'candidate',
        toolName: 'summarize_chapter',
        argumentsSummary: {},
      });
      expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(false);
    },
  );
  it('supports earlier host records only with independent current adoption chronology', () => {
    const { bundle, run } = fixture();
    delete bundle.toolEvents[0].argumentsSummary.summarySource;
    expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(false);
    bundle.authorizations = [
      {
        authorizationId: 'adoption',
        artifactId: 'prose',
        novelId: chapter.novelId,
        chapterId: chapter.id,
        decisionId: 'decision',
        status: 'consumed',
        consumedByDraftId: chapter.adoptedDraftId,
        consumedAt: '2026-10-16T00:00:00Z',
        issuedAt: '2026-10-15',
      },
    ];
    expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(true);
    bundle.authorizations[0].consumedAt = '2026-10-16T02:00:00Z';
    expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(false);
  });
  it('does not classify an arbitrary similarly named tool as a summary attempt', () => {
    const { bundle, run } = fixture();
    bundle.toolEvents[0].toolName = 'unknown_chapter_summary_reader';
    expect(isCurrentChapterSummaryAttempt(bundle, run, chapter, [bundle])).toBe(false);
  });
});
