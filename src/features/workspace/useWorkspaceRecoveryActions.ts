import { useCallback, useState, type MutableRefObject } from 'react';
import type { EditorAreaHandle } from '../../components/workspace/EditorArea';
import { createTraceId, logWorkspaceError } from '../../services/workspace/workspaceErrorService';
import type { LeaveDecision, WorkspaceLeaveRequest } from '../../types/workspaceLeave';
import type { RecoveryPromptState, WorkspaceRecoveryTarget } from '../../types/workspaceRecovery';
import { showError, showInfo } from '../../utils/nativeDialog';
import { persistRecoveryCandidate } from './recoveryCandidate';

type RequestWorkspaceLeave = (request: WorkspaceLeaveRequest) => Promise<LeaveDecision>;

interface UseWorkspaceRecoveryActionsInput {
  prompt: RecoveryPromptState;
  editorRef: MutableRefObject<EditorAreaHandle | null>;
  requestWorkspaceLeave: RequestWorkspaceLeave;
  clearRecovery(target: WorkspaceRecoveryTarget): Promise<void>;
  dismissPrompt(): void;
}

export function useWorkspaceRecoveryActions({
  prompt,
  editorRef,
  requestWorkspaceLeave,
  clearRecovery,
  dismissPrompt,
}: UseWorkspaceRecoveryActionsInput) {
  const [busy, setBusy] = useState(false);

  const restore = useCallback(async () => {
    if (prompt.status !== 'available') return;
    const snapshot = prompt.snapshot;
    try {
      const decision = await requestWorkspaceLeave({
        reason: 'draft_restore',
        targetNovelId: snapshot.novelId,
        targetChapterId: snapshot.chapterId,
        continueAction: () => {
          const restored = editorRef.current?.restoreRecovery(
            snapshot.recoveryContent,
            snapshot.selectionStart,
            snapshot.selectionEnd,
          );
          if (!restored) {
            throw {
              code: 'RECOVERY_BASE_CONFLICT',
              message: '当前正文状态不允许恢复。',
              retryable: false,
            };
          }
          dismissPrompt();
        },
      });
      if (decision === 'save_failed') {
        await showError({ title: '恢复失败', message: '当前工作区无法安全切换到恢复内容。' });
      }
    } catch (error) {
      const normalized = logWorkspaceError('recovery_restore_failed', error, {
        traceId: createTraceId('recovery-restore'),
        novelId: snapshot.novelId,
        chapterId: snapshot.chapterId,
      });
      await showError({ title: '恢复失败', message: normalized.message });
    }
  }, [dismissPrompt, editorRef, prompt, requestWorkspaceLeave]);

  const discard = useCallback(async () => {
    if (prompt.status !== 'available' && prompt.status !== 'conflict') return;
    const snapshot = prompt.snapshot;
    setBusy(true);
    try {
      await clearRecovery({ novelId: snapshot.novelId, chapterId: snapshot.chapterId });
    } catch (error) {
      const normalized = logWorkspaceError('recovery_manual_delete_failed', error, {
        traceId: createTraceId('recovery-delete'),
        novelId: snapshot.novelId,
        chapterId: snapshot.chapterId,
      });
      await showError({ title: '无法删除恢复内容', message: normalized.message });
    } finally {
      setBusy(false);
    }
  }, [clearRecovery, prompt]);

  const saveAsDraft = useCallback(async () => {
    if (prompt.status !== 'conflict') return;
    const snapshot = prompt.snapshot;
    setBusy(true);
    try {
      const { draft, reused } = await persistRecoveryCandidate(snapshot);
      try {
        await clearRecovery({ novelId: snapshot.novelId, chapterId: snapshot.chapterId });
      } catch (cleanupError) {
        logWorkspaceError('recovery_candidate_post_commit_cleanup_failed', cleanupError, {
          traceId: createTraceId('recovery-candidate-cleanup'),
          novelId: snapshot.novelId,
          chapterId: snapshot.chapterId,
          draftId: draft.id,
        });
        dismissPrompt();
        await showInfo({
          title: '候选草稿已保存',
          message: `恢复内容${reused ? '已对应' : '已保存为'}草稿 v${draft.versionNo}，但恢复快照暂未清理；再次操作只会重试清理，不会重复另存。`,
        });
        return;
      }
      await showInfo({
        title: reused ? '候选草稿已存在' : '已另存为候选草稿',
        message: `恢复内容${reused ? '已对应' : '已保存为'}草稿 v${draft.versionNo}，当前正文未被覆盖。`,
      });
    } catch (error) {
      const normalized = logWorkspaceError('recovery_save_as_draft_failed', error, {
        traceId: createTraceId('recovery-candidate'),
        novelId: snapshot.novelId,
        chapterId: snapshot.chapterId,
      });
      await showError({ title: '另存失败', message: normalized.message });
    } finally {
      setBusy(false);
    }
  }, [clearRecovery, dismissPrompt, prompt]);

  return { busy, restore, discard, saveAsDraft };
}
