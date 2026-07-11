import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceRecoverySnapshot } from '../../types/workspaceRecovery';
import { deferred } from '../deferred';

const recoveryServiceMocks = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../services/workspace/workspaceRecoveryService', () => ({
  workspaceRecoveryService: recoveryServiceMocks,
}));

import { useWorkspaceRecovery, type WorkspaceRecoveryEditorState } from '../../hooks/useWorkspaceRecovery';

const editor: WorkspaceRecoveryEditorState = {
  novelId: 'novel-a',
  chapterId: 'chapter-a1',
  draftId: 'draft-a1',
  draftVersion: 2,
  baseContentHash: 'base-hash',
  content: '当前编辑内容',
  dirty: true,
  contentAvailable: true,
  selectionStart: 2,
  selectionEnd: 4,
};

function strictWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

function recoverySnapshot(overrides: Partial<WorkspaceRecoverySnapshot> = {}): WorkspaceRecoverySnapshot {
  return {
    novelId: editor.novelId,
    chapterId: editor.chapterId,
    baseDraftId: editor.draftId,
    baseDraftVersion: editor.draftVersion,
    baseContentHash: editor.baseContentHash,
    recoveryContent: '异常退出前的正文',
    recoveryContentHash: 'recovery-hash',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:01:00.000Z',
    ...overrides,
  };
}

describe('workspace recovery hook', () => {
  beforeEach(() => {
    recoveryServiceMocks.get.mockReset().mockResolvedValue(null);
    recoveryServiceMocks.upsert.mockReset().mockImplementation(async (input) => ({
      ...input,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    }));
    recoveryServiceMocks.delete.mockReset().mockResolvedValue(undefined);
  });

  it('debounces dirty recovery writes and remains idempotent under StrictMode effect replay', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      () => useWorkspaceRecovery({ editor, debounceMs: 1000 }),
      { wrapper: strictWrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(recoveryServiceMocks.upsert).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await result.current.waitForWrite();
    });

    expect(recoveryServiceMocks.upsert).toHaveBeenCalledTimes(1);
    expect(recoveryServiceMocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      novelId: 'novel-a',
      chapterId: 'chapter-a1',
      baseDraftId: 'draft-a1',
      baseDraftVersion: 2,
      recoveryContent: '当前编辑内容',
      selectionStart: 2,
      selectionEnd: 4,
    }));
    expect(result.current.saveStatus).toBe('saved');
  });

  it('T09 exposes a matching snapshot as available without applying it automatically', async () => {
    recoveryServiceMocks.get.mockResolvedValue(recoverySnapshot());
    const { result } = renderHook(() => useWorkspaceRecovery({
      editor: { ...editor, dirty: false },
    }));

    await waitFor(() => expect(result.current.prompt.status).toBe('available'));
    expect(result.current.prompt).toEqual(expect.objectContaining({
      status: 'available',
      conflict: false,
    }));
    expect(recoveryServiceMocks.upsert).not.toHaveBeenCalled();
  });

  it('T10 reports a base-version conflict instead of silently replacing current content', async () => {
    recoveryServiceMocks.get.mockResolvedValue(recoverySnapshot({ baseDraftVersion: 1 }));
    const { result } = renderHook(() => useWorkspaceRecovery({
      editor: { ...editor, dirty: false },
    }));

    await waitFor(() => expect(result.current.prompt.status).toBe('conflict'));
    expect(result.current.prompt).toEqual(expect.objectContaining({
      status: 'conflict',
      conflict: true,
      errorCode: 'RECOVERY_BASE_CONFLICT',
    }));
    expect(recoveryServiceMocks.delete).not.toHaveBeenCalled();
  });

  it('T11 clears only the saved chapter recovery after a successful formal save', async () => {
    const { result } = renderHook(() => useWorkspaceRecovery({
      editor: { ...editor, dirty: false },
    }));

    await act(async () => {
      await result.current.clear({ novelId: 'novel-a', chapterId: 'chapter-a1' });
    });

    expect(recoveryServiceMocks.delete).toHaveBeenCalledTimes(1);
    expect(recoveryServiceMocks.delete).toHaveBeenCalledWith(
      { novelId: 'novel-a', chapterId: 'chapter-a1' },
      expect.stringMatching(/^recovery-delete-/),
    );
    expect(recoveryServiceMocks.delete).not.toHaveBeenCalledWith(
      { novelId: 'novel-a', chapterId: 'chapter-a2' },
      expect.anything(),
    );
  });

  it('T11 waits for an in-flight snapshot write before the formal-save cleanup', async () => {
    vi.useFakeTimers();
    const write = deferred<WorkspaceRecoverySnapshot>();
    recoveryServiceMocks.upsert.mockReturnValueOnce(write.promise);
    const { result } = renderHook(
      () => useWorkspaceRecovery({ editor, debounceMs: 1000 }),
      { wrapper: strictWrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(recoveryServiceMocks.upsert).toHaveBeenCalledTimes(1);

    let cleanup: Promise<void> | undefined;
    act(() => {
      cleanup = result.current.clear({ novelId: 'novel-a', chapterId: 'chapter-a1' });
    });
    expect(recoveryServiceMocks.delete).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve(recoverySnapshot());
      await cleanup;
    });
    expect(recoveryServiceMocks.delete).toHaveBeenCalledTimes(1);
  });
});
