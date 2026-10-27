import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: false,
  list: vi.fn(),
}));

vi.mock('../database/db', () => ({
  isTauri: () => mocks.desktop,
  dbCall: mocks.list,
}));

import {
  CHAPTER_WORKFLOW_STAGE_READ_LIMIT,
  ChapterWorkflowStageReadError,
  readChapterWorkflowStages,
} from './chapterWorkflowStageReader';

const HASH = 'a'.repeat(64);
const SCOPE = { novelId: 'novel-1', chapterId: 'chapter-1' } as const;

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stageId: 'stage-1',
    workflowId: 'workflow-1',
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    runId: 'run-1',
    stageKey: 'beat_write:scene-1:beat-1',
    stageKind: 'beat_write',
    sceneId: 'scene-1',
    beatId: 'beat-1',
    planVersion: 2,
    modelSnapshotHash: HASH,
    contextHash: HASH,
    baseHash: HASH,
    inputHash: HASH,
    planHash: HASH,
    status: 'succeeded',
    attempt: 1,
    revision: 2,
    resultHash: HASH,
    resultDocumentId: null,
    resultJson: null,
    verifiedArtifactId: null,
    errorCode: null,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.desktop = true;
  mocks.list.mockReset();
});

describe('readChapterWorkflowStages', () => {
  it('reads the bounded desktop projection and normalizes nullable optional fields', async () => {
    mocks.list.mockResolvedValue([
      record({
        resultDocumentId: 'doc-1',
        resultJson: null,
        verifiedArtifactId: null,
        errorCode: null,
        sceneId: ' scene-1 ',
      }),
    ]);

    const result = await readChapterWorkflowStages({
      ...SCOPE,
      conversationId: 'conversation-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
    });

    expect(mocks.list).toHaveBeenCalledWith('list_chapter_workflow_stages', {
      input: {
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        conversationId: 'conversation-1',
        workflowId: 'workflow-1',
        runId: 'run-1',
        limit: CHAPTER_WORKFLOW_STAGE_READ_LIMIT,
      },
    });
    expect(result).toMatchObject({ authority: 'sqlite', truncated: false, limit: 200 });
    expect(result.stages[0]).toMatchObject({
      stageId: 'stage-1',
      stageKind: 'beat_write',
      status: 'succeeded',
      attempt: 1,
      revision: 2,
      sceneId: 'scene-1',
      resultDocumentId: 'doc-1',
    });
    expect('resultJson' in result.stages[0]).toBe(false);
    expect('verifiedArtifactId' in result.stages[0]).toBe(false);
    expect('errorCode' in result.stages[0]).toBe(false);
    expect(result.notice).toBeUndefined();
  });

  it('returns explicit none in browser mode without invoking Tauri or faking SQLite', async () => {
    mocks.desktop = false;

    const result = await readChapterWorkflowStages(SCOPE);

    expect(mocks.list).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      authority: 'none',
      reason: 'browser',
      stages: [],
      limit: 200,
      truncated: false,
    });
    expect(result.notice).toBeUndefined();
  });

  it('requires novelId and chapterId before any native read', async () => {
    await expect(
      readChapterWorkflowStages({ novelId: '  ', chapterId: 'chapter-1' }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      readChapterWorkflowStages({ novelId: 'novel-1', chapterId: '' }),
    ).rejects.toBeInstanceOf(ChapterWorkflowStageReadError);
    await expect(readChapterWorkflowStages({ ...SCOPE, limit: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('clamps requests to the hard limit and labels reaching it as bounded, not full history', async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: CHAPTER_WORKFLOW_STAGE_READ_LIMIT }, (_, index) =>
        record({ stageId: `stage-${index}` }),
      ),
    );

    const result = await readChapterWorkflowStages({ ...SCOPE, limit: 999 });

    expect(mocks.list.mock.calls[0][1]).toEqual({
      input: { ...SCOPE, limit: CHAPTER_WORKFLOW_STAGE_READ_LIMIT },
    });
    expect(result.limit).toBe(CHAPTER_WORKFLOW_STAGE_READ_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.notice).toContain('已加载 200 条');
    expect(result.notice).toContain('可能不是全部历史');
    expect(result.notice).not.toContain('最近');
  });

  it('does not mark a shorter page as truncated', async () => {
    mocks.list.mockResolvedValue([record({ stageId: 'one' })]);
    const result = await readChapterWorkflowStages(SCOPE);
    expect(result.truncated).toBe(false);
    expect(result.notice).toBeUndefined();
  });

  it('rejects rows outside the requested scope and filter identity', async () => {
    mocks.list.mockResolvedValue([record({ chapterId: 'chapter-2' })]);
    await expect(readChapterWorkflowStages(SCOPE)).rejects.toMatchObject({
      code: 'scope_mismatch',
    });

    mocks.list.mockResolvedValue([record({ conversationId: 'conversation-2' })]);
    await expect(
      readChapterWorkflowStages({ ...SCOPE, conversationId: 'conversation-1' }),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });

    mocks.list.mockResolvedValue([record({ workflowId: 'workflow-2' })]);
    await expect(
      readChapterWorkflowStages({ ...SCOPE, workflowId: 'workflow-1' }),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });

    mocks.list.mockResolvedValue([record({ runId: 'run-2' })]);
    await expect(readChapterWorkflowStages({ ...SCOPE, runId: 'run-1' })).rejects.toMatchObject({
      code: 'scope_mismatch',
    });
  });

  const malformedRows: Array<[string, Record<string, unknown>]> = [
    ['unknown kind', { stageKind: 'beat_write_v2' }],
    ['unknown status', { status: 'done' }],
    ['zero attempt', { attempt: 0 }],
    ['fractional revision', { revision: 1.5 }],
    ['uppercase hash', { contextHash: 'A'.repeat(64) }],
    ['short hash', { planHash: 'abc' }],
    ['missing success result hash', { resultHash: null }],
    ['zero plan version', { planVersion: 0 }],
  ];

  it.each(malformedRows)('rejects malformed native rows: %s', async (_label, overrides) => {
    mocks.list.mockResolvedValue([record(overrides)]);
    await expect(readChapterWorkflowStages(SCOPE)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects a non-array or over-limit native response', async () => {
    mocks.list.mockResolvedValue({ stages: [] });
    await expect(readChapterWorkflowStages(SCOPE)).rejects.toMatchObject({
      code: 'invalid_response',
    });

    mocks.list.mockResolvedValue(
      Array.from({ length: CHAPTER_WORKFLOW_STAGE_READ_LIMIT + 1 }, (_, index) =>
        record({ stageId: `stage-${index}` }),
      ),
    );
    await expect(
      readChapterWorkflowStages({ ...SCOPE, limit: CHAPTER_WORKFLOW_STAGE_READ_LIMIT }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
