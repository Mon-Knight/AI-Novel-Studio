import { useCallback, useEffect, useRef, useState } from 'react';
import { memoryPersistenceService } from '../../services/memory/memoryPersistenceService';
import type { MemorySnapshotBundle, MemorySnapshotVerification } from '../../types/memory';
import { describeUnknownError } from '../../utils/errorMessage';

export function useChapterContinuityMemory(novelId?: string, chapterId?: string) {
  const available = memoryPersistenceService.isAvailable();
  const [bundle, setBundle] = useState<MemorySnapshotBundle | null>(null);
  const [verification, setVerification] = useState<MemorySnapshotVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const targetRef = useRef({ novelId, chapterId });
  const operationRef = useRef<string>();
  targetRef.current = { novelId, chapterId };

  const accept = useCallback((next: MemorySnapshotBundle) => {
    const target = targetRef.current;
    if (next.snapshot.novelId === target.novelId
      && next.snapshot.targetChapterId === target.chapterId) {
      setBundle(next);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!available || !chapterId) {
      setBundle(null);
      setVerification(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const snapshots = await memoryPersistenceService.listByChapter(chapterId, 1);
      if (targetRef.current.chapterId !== chapterId) return;
      if (snapshots.length === 0) {
        setBundle(null);
        setVerification(null);
      } else {
        accept(await memoryPersistenceService.get(snapshots[0].snapshotId));
        setVerification(null);
      }
    } catch (reason) {
      if (targetRef.current.chapterId === chapterId) {
        setError(describeUnknownError(reason, '无法读取章节记忆快照'));
      }
    } finally {
      if (targetRef.current.chapterId === chapterId) setLoading(false);
    }
  }, [accept, available, chapterId]);

  useEffect(() => {
    setBundle(null);
    setVerification(null);
    setError('');
    operationRef.current = undefined;
    void reload();
  }, [reload]);

  const create = useCallback(async () => {
    if (!novelId || !chapterId) return;
    operationRef.current ??= memoryPersistenceService.newOperationId();
    setCreating(true);
    setError('');
    try {
      const next = await memoryPersistenceService.create({
        operationId: operationRef.current,
        novelId,
        targetChapterId: chapterId,
        lookbackChapters: 20,
        budgetBytes: 65_536,
      });
      accept(next);
      setVerification(await memoryPersistenceService.verify(next.snapshot.snapshotId));
      operationRef.current = undefined;
    } catch (reason) {
      setError(describeUnknownError(reason, '记忆快照创建失败'));
    } finally {
      setCreating(false);
    }
  }, [accept, chapterId, novelId]);

  const verify = useCallback(async () => {
    if (!bundle) return;
    setVerifying(true);
    setError('');
    try {
      const result = await memoryPersistenceService.verify(bundle.snapshot.snapshotId);
      if (targetRef.current.chapterId === bundle.snapshot.targetChapterId) {
        setVerification(result);
      }
    } catch (reason) {
      setError(describeUnknownError(reason, '记忆来源复验失败'));
    } finally {
      setVerifying(false);
    }
  }, [bundle]);

  return {
    available,
    bundle,
    verification,
    loading,
    creating,
    verifying,
    error,
    reload,
    create,
    verify,
  };
}

