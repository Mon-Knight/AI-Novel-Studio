import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RecoveryDialog from '../../components/workspace/RecoveryDialog';
import type { WorkspaceRecoverySnapshot } from '../../types/workspaceRecovery';

const snapshot: WorkspaceRecoverySnapshot = {
  novelId: 'novel-a',
  chapterId: 'chapter-a',
  baseDraftId: 'draft-a',
  baseDraftVersion: 1,
  baseContentHash: 'base-hash',
  recoveryContent: '上次没有保存的正文',
  recoveryContentHash: 'recovery-hash',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:01:00.000Z',
};

describe('workspace recovery dialog', () => {
  it('T09 explains that matching recovery remains unsaved and requires an explicit restore', async () => {
    const onRestore = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryDialog
        state={{ status: 'available', snapshot, conflict: false }}
        currentContent="持久草稿正文"
        onRestore={onRestore}
        onDiscard={vi.fn()}
        onLater={vi.fn()}
      />,
    );

    expect(screen.getByText(/它尚未成为正式草稿/)).toBeTruthy();
    expect(screen.getByText(/恢复后仍需再次保存/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '恢复' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('T10 blocks direct restore when the snapshot base conflicts with the current draft', async () => {
    const onRestore = vi.fn();
    const onSaveAsDraft = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryDialog
        state={{
          status: 'conflict',
          snapshot,
          conflict: true,
          errorCode: 'RECOVERY_BASE_CONFLICT',
        }}
        currentContent="当前 v2 正文"
        onRestore={onRestore}
        onDiscard={vi.fn()}
        onLater={vi.fn()}
        onSaveAsDraft={onSaveAsDraft}
      />,
    );

    expect(screen.queryByRole('button', { name: '恢复' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('禁止直接覆盖当前正文');
    await user.click(screen.getByRole('button', { name: '查看差异' }));
    expect(screen.getByText('当前 v2 正文')).toBeTruthy();
    expect(screen.getByText('上次没有保存的正文')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '另存为候选草稿' }));
    expect(onSaveAsDraft).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });
});
