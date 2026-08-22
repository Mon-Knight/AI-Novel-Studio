import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceRecoveryService } from '../../services/workspace/workspaceRecoveryService';

describe('browser recovery repository fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('upserts one latest snapshot per novel and chapter', async () => {
    const base = {
      traceId: 'trace-1',
      novelId: 'novel-a',
      chapterId: 'chapter-a1',
      baseDraftId: 'draft-a1',
      baseDraftVersion: 1,
      baseContentHash: 'base-hash',
      recoveryContent: '第一份恢复内容',
      recoveryContentHash: 'hash-1',
    };
    const first = await workspaceRecoveryService.upsert(base);
    const second = await workspaceRecoveryService.upsert({
      ...base,
      traceId: 'trace-2',
      recoveryContent: '最新恢复内容',
      recoveryContentHash: 'hash-2',
    });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.recoveryContent).toBe('最新恢复内容');
    await expect(workspaceRecoveryService.get(base, 'trace-read')).resolves.toEqual(
      expect.objectContaining({ recoveryContent: '最新恢复内容', recoveryContentHash: 'hash-2' }),
    );
  });

  it('deletes the exact target without touching sibling chapter or novel snapshots', async () => {
    const snapshots = [
      ['novel-a', 'chapter-a1'],
      ['novel-a', 'chapter-a2'],
      ['novel-b', 'chapter-b1'],
    ] as const;
    for (const [novelId, chapterId] of snapshots) {
      await workspaceRecoveryService.upsert({
        traceId: `write-${chapterId}`,
        novelId,
        chapterId,
        recoveryContent: chapterId,
        recoveryContentHash: `hash-${chapterId}`,
      });
    }

    await workspaceRecoveryService.delete(
      { novelId: 'novel-a', chapterId: 'chapter-a1' },
      'trace-delete',
    );

    await expect(
      workspaceRecoveryService.get({ novelId: 'novel-a', chapterId: 'chapter-a1' }, 'read-a1'),
    ).resolves.toBeNull();
    await expect(
      workspaceRecoveryService.get({ novelId: 'novel-a', chapterId: 'chapter-a2' }, 'read-a2'),
    ).resolves.toEqual(expect.objectContaining({ recoveryContent: 'chapter-a2' }));
    await expect(
      workspaceRecoveryService.get({ novelId: 'novel-b', chapterId: 'chapter-b1' }, 'read-b1'),
    ).resolves.toEqual(expect.objectContaining({ recoveryContent: 'chapter-b1' }));
  });

  it('fails closed when browser storage rejects a recovery write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    await expect(
      workspaceRecoveryService.upsert({
        traceId: 'trace-write-failure',
        novelId: 'novel-a',
        chapterId: 'chapter-a1',
        recoveryContent: 'must persist',
        recoveryContentHash: 'hash-write-failure',
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_CONTENT_INVALID', retryable: true });
  });

  it('fails closed when browser storage rejects recovery deletion', async () => {
    const target = { novelId: 'novel-a', chapterId: 'chapter-a1' };
    await workspaceRecoveryService.upsert({
      ...target,
      traceId: 'trace-delete-seed',
      recoveryContent: 'keep until deletion is confirmed',
      recoveryContentHash: 'hash-delete-failure',
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('storage unavailable', 'InvalidStateError');
    });

    await expect(
      workspaceRecoveryService.delete(target, 'trace-delete-failure'),
    ).rejects.toMatchObject({ code: 'RECOVERY_CONTENT_INVALID', retryable: true });
    await expect(
      workspaceRecoveryService.get(target, 'trace-read-after-delete-failure'),
    ).resolves.toEqual(expect.objectContaining({ recoveryContentHash: 'hash-delete-failure' }));
  });
});
