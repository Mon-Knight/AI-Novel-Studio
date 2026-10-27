import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterWorkflowStageView } from '../../types/chapterWorkflowStage';
import type {
  ChapterWorkflowStageReadResult,
  ChapterWorkflowStageReadScope,
} from '../../services/conversation/chapterWorkflowStageReader';
import { buildChapterStagePlanMapping } from './chapterWorkflowStageTreeMapping';
import type { ChapterCandidateEvidence } from './chapterWorkflowStageTreeMapping';
import {
  useChapterWorkflowStageTree,
  type UseChapterWorkflowStageTreeOptions,
} from './useChapterWorkflowStageTree';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('../../services/conversation/chapterWorkflowStageReader', () => ({
  readChapterWorkflowStages: mocks.read,
}));

const HASH = 'a'.repeat(64);
const SCOPE: ChapterWorkflowStageReadScope = {
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  conversationId: 'conversation-1',
  workflowId: 'turn-1',
};

function stage(stageId: string, overrides: Partial<ChapterWorkflowStageView> = {}) {
  return {
    stageId,
    workflowId: 'turn-1',
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    runId: 'run-1',
    stageKey: stageId,
    stageKind: 'scene_plan',
    planVersion: 2,
    modelSnapshotHash: HASH,
    contextHash: HASH,
    baseHash: HASH,
    inputHash: HASH,
    planHash: HASH,
    status: 'succeeded',
    attempt: 1,
    revision: 1,
    resultHash: HASH,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:01.000Z',
    ...overrides,
  } satisfies ChapterWorkflowStageView;
}

function readResult(
  scope: ChapterWorkflowStageReadScope,
  stages: ChapterWorkflowStageView[],
  overrides: Partial<ChapterWorkflowStageReadResult> = {},
): ChapterWorkflowStageReadResult {
  return {
    authority: 'sqlite',
    scope,
    stages,
    limit: 200,
    truncated: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const INITIAL_PROPS: UseChapterWorkflowStageTreeOptions = { enabled: true, scope: SCOPE };

beforeEach(() => {
  mocks.read.mockReset();
});

describe('useChapterWorkflowStageTree', () => {
  it('stays disabled for legacy callers without issuing any read', () => {
    const { result } = renderHook(() =>
      useChapterWorkflowStageTree({ enabled: false, scope: SCOPE }),
    );

    expect(mocks.read).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      stages: [],
      read: null,
      loading: false,
      error: '',
      reason: 'disabled',
    });
  });

  it('reads once for an explicit enabled scope and exposes validated stages', async () => {
    mocks.read.mockResolvedValue(readResult(SCOPE, [stage('plan')]));
    const { result } = renderHook(() => useChapterWorkflowStageTree(INITIAL_PROPS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith(SCOPE);
    expect(result.current.stages.map((row) => row.stageId)).toEqual(['plan']);
    expect(result.current.read?.authority).toBe('sqlite');
    expect(result.current.reason).toBe('ready');
  });

  it('reports browser mode as none rather than pretending to read SQLite', async () => {
    mocks.read.mockResolvedValue({
      authority: 'none',
      reason: 'browser',
      scope: SCOPE,
      stages: [],
      limit: 200,
      truncated: false,
    });
    const { result } = renderHook(() => useChapterWorkflowStageTree(INITIAL_PROPS));

    await waitFor(() => expect(result.current.reason).toBe('browser'));
    expect(result.current.stages).toEqual([]);
    expect(result.current.read?.authority).toBe('none');
  });

  it('never promotes browser card evidence into a SQLite candidate', async () => {
    mocks.read.mockResolvedValue({
      authority: 'none',
      reason: 'browser',
      scope: SCOPE,
      stages: [],
      limit: 200,
      truncated: false,
    });
    const candidateEvidence: ChapterCandidateEvidence = {
      cardId: 'card-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      artifactType: 'chapter_text',
      processingStatus: 'valid',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
    };
    const { result } = renderHook(() =>
      useChapterWorkflowStageTree({ ...INITIAL_PROPS, candidateEvidence: [candidateEvidence] }),
    );

    await waitFor(() => expect(result.current.reason).toBe('browser'));
    expect(result.current.stages).toEqual([]);
    expect(result.current.read?.authority).toBe('none');
  });

  it('hides old facts and ignores a late response after the scope changes', async () => {
    const first = deferred<ChapterWorkflowStageReadResult>();
    const second = deferred<ChapterWorkflowStageReadResult>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const scopeA = SCOPE;
    const scopeB: ChapterWorkflowStageReadScope = {
      novelId: 'novel-1',
      chapterId: 'chapter-2',
      conversationId: 'conversation-2',
      workflowId: 'turn-2',
    };
    const { result, rerender } = renderHook(
      (props: UseChapterWorkflowStageTreeOptions) => useChapterWorkflowStageTree(props),
      { initialProps: { enabled: true, scope: scopeA } },
    );

    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    rerender({ enabled: true, scope: scopeB });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(result.current.stages).toEqual([]);

    await act(async () => {
      second.resolve(readResult(scopeB, [stage('stage-b', { chapterId: 'chapter-2' })]));
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.stages.map((row) => row.stageId)).toEqual(['stage-b']),
    );

    await act(async () => {
      first.resolve(readResult(scopeA, [stage('stage-a')]));
      await first.promise;
    });
    await act(async () => undefined);
    expect(result.current.stages.map((row) => row.stageId)).toEqual(['stage-b']);
  });

  it('re-reads on an explicit refreshToken but not without one', async () => {
    mocks.read
      .mockResolvedValueOnce(readResult(SCOPE, [stage('stage-a')]))
      .mockResolvedValueOnce(readResult(SCOPE, [stage('stage-b')]));
    const { result, rerender } = renderHook(
      (props: UseChapterWorkflowStageTreeOptions) => useChapterWorkflowStageTree(props),
      { initialProps: INITIAL_PROPS },
    );

    await waitFor(() =>
      expect(result.current.stages.map((row) => row.stageId)).toEqual(['stage-a']),
    );
    rerender({ ...INITIAL_PROPS, refreshToken: 'refresh-2' });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.stages.map((row) => row.stageId)).toEqual(['stage-b']),
    );
  });

  it('clears the tree when disabled and never issues a replacement read', async () => {
    mocks.read.mockResolvedValue(readResult(SCOPE, [stage('stage-a')]));
    const { result, rerender } = renderHook(
      (props: UseChapterWorkflowStageTreeOptions) => useChapterWorkflowStageTree(props),
      { initialProps: INITIAL_PROPS },
    );

    await waitFor(() => expect(result.current.stages).toHaveLength(1));
    rerender({ enabled: false, scope: SCOPE });
    expect(result.current.stages).toEqual([]);
    expect(result.current.reason).toBe('disabled');
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('surfaces read errors without keeping a fabricated or stale tree', async () => {
    mocks.read.mockRejectedValue(new Error('桌面阶段记录读取失败'));
    const { result } = renderHook(() => useChapterWorkflowStageTree(INITIAL_PROPS));

    await waitFor(() => expect(result.current.reason).toBe('error'));
    expect(result.current.error).toContain('桌面阶段记录读取失败');
    expect(result.current.stages).toEqual([]);
    expect(result.current.read).toBeNull();
  });

  it('remaps rows from the same read when the explicit plan changes, without another IPC read', async () => {
    mocks.read.mockResolvedValue(
      readResult(SCOPE, [
        stage('write', { stageKind: 'beat_write', sceneId: 'scene-a', beatId: 'beat-a1' }),
      ]),
    );
    const planOne = buildChapterStagePlanMapping([
      { id: 'scene-a', sceneNo: 1, beats: [{ id: 'beat-a1', order: 1 }] },
    ]);
    const planTwo = buildChapterStagePlanMapping([
      { id: 'scene-a', sceneNo: 3, beats: [{ id: 'beat-a1', order: 4 }] },
    ]);
    const { result, rerender } = renderHook(
      (props: UseChapterWorkflowStageTreeOptions) => useChapterWorkflowStageTree(props),
      { initialProps: { enabled: true, scope: SCOPE, plan: planOne } },
    );

    await waitFor(() => expect(result.current.stages[0]?.sceneNo).toBe(1));
    rerender({ enabled: true, scope: SCOPE, plan: planTwo });
    await waitFor(() => expect(result.current.stages[0]?.sceneNo).toBe(3));
    expect(result.current.stages[0]?.beatOrder).toBe(4);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('does not add background polling', async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValue(readResult(SCOPE, [stage('stage-a')]));
    const { result } = renderHook(() => useChapterWorkflowStageTree(INITIAL_PROPS));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.stages).toHaveLength(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
