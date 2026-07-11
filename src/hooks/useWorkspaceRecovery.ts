import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceRecoveryService } from '../services/workspace/workspaceRecoveryService';
import { createTraceId, logWorkspaceError, logWorkspaceWarning } from '../services/workspace/workspaceErrorService';
import type {
  RecoveryPromptState,
  WorkspaceRecoverySaveStatus,
  WorkspaceRecoverySnapshot,
  WorkspaceRecoveryTarget,
} from '../types/workspaceRecovery';
import { computeContentSha256 } from '../utils/contentIntegrity';

export interface WorkspaceRecoveryEditorState extends WorkspaceRecoveryTarget {
  draftId?: string;
  draftVersion?: number;
  baseContentHash?: string;
  content: string;
  dirty: boolean;
  contentAvailable: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}

interface UseWorkspaceRecoveryOptions {
  editor: WorkspaceRecoveryEditorState | null;
  debounceMs?: number;
}

interface PendingRecoveryWrite extends WorkspaceRecoveryEditorState {
  traceId: string;
}

function sameOptional(left: string | number | undefined, right: string | number | undefined): boolean {
  return left === right || (left === undefined && right === undefined);
}

function snapshotMatchesBase(
  snapshot: WorkspaceRecoverySnapshot,
  editor: Pick<WorkspaceRecoveryEditorState,
    'novelId' | 'chapterId' | 'draftId' | 'draftVersion' | 'baseContentHash'>,
): boolean {
  return snapshot.novelId === editor.novelId
    && snapshot.chapterId === editor.chapterId
    && sameOptional(snapshot.baseDraftId, editor.draftId)
    && sameOptional(snapshot.baseDraftVersion, editor.draftVersion)
    && sameOptional(snapshot.baseContentHash, editor.baseContentHash);
}

export function useWorkspaceRecovery({
  editor,
  debounceMs = 1500,
}: UseWorkspaceRecoveryOptions) {
  const [prompt, setPrompt] = useState<RecoveryPromptState>({ status: 'none' });
  const [saveStatus, setSaveStatus] = useState<WorkspaceRecoverySaveStatus>('idle');
  const editorRef = useRef(editor);
  const pendingRef = useRef<PendingRecoveryWrite | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastWrittenSignatureRef = useRef('');
  const loadEpochRef = useRef(0);
  const writeInFlightRef = useRef<Promise<void> | null>(null);
  const writeInFlightSignatureRef = useRef('');
  const mountedRef = useRef(true);
  editorRef.current = editor;
  const editorNovelId = editor?.novelId;
  const editorChapterId = editor?.chapterId;
  const editorDraftId = editor?.draftId;
  const editorDraftVersion = editor?.draftVersion;
  const editorBaseContentHash = editor?.baseContentHash;
  const editorContent = editor?.content ?? '';
  const editorDirty = editor?.dirty ?? false;
  const editorContentAvailable = editor?.contentAvailable ?? false;
  const editorSelectionStart = editor?.selectionStart;
  const editorSelectionEnd = editor?.selectionEnd;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    cancelTimer();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || !pending.dirty || !pending.contentAvailable) {
      await writeInFlightRef.current;
      return;
    }

    const signature = JSON.stringify([
      pending.novelId,
      pending.chapterId,
      pending.draftId,
      pending.draftVersion,
      pending.baseContentHash,
      pending.content,
      pending.selectionStart,
      pending.selectionEnd,
    ]);
    if (signature === lastWrittenSignatureRef.current) return;

    while (writeInFlightRef.current) {
      await writeInFlightRef.current;
      if (signature === lastWrittenSignatureRef.current) return;
    }

    const write = (async () => {
      if (mountedRef.current) setSaveStatus('saving');
      try {
        const recoveryContentHash = await computeContentSha256(pending.content);
        await workspaceRecoveryService.upsert({
          traceId: pending.traceId,
          novelId: pending.novelId,
          chapterId: pending.chapterId,
          baseDraftId: pending.draftId,
          baseDraftVersion: pending.draftVersion,
          baseContentHash: pending.baseContentHash,
          recoveryContent: pending.content,
          recoveryContentHash,
          selectionStart: pending.selectionStart,
          selectionEnd: pending.selectionEnd,
        });
        lastWrittenSignatureRef.current = signature;
        if (mountedRef.current) setSaveStatus('saved');
      } catch (error) {
        if (mountedRef.current) setSaveStatus('failed');
        logWorkspaceError('recovery_upsert_failed', error, {
          traceId: pending.traceId,
          novelId: pending.novelId,
          chapterId: pending.chapterId,
          draftId: pending.draftId,
          draftVersion: pending.draftVersion,
          contentHash: pending.baseContentHash,
        });
        // Recovery persistence is best effort and never marks the document saved.
      }
    })();
    writeInFlightRef.current = write;
    writeInFlightSignatureRef.current = signature;
    try {
      await write;
    } finally {
      if (writeInFlightRef.current === write) {
        writeInFlightRef.current = null;
        writeInFlightSignatureRef.current = '';
      }
    }
  }, [cancelTimer]);

  useEffect(() => {
    if (!editorDirty || !editorContentAvailable || !editorNovelId || !editorChapterId) {
      cancelTimer();
      pendingRef.current = null;
      if (!editorDirty && mountedRef.current) setSaveStatus('idle');
      return;
    }

    pendingRef.current = {
      novelId: editorNovelId,
      chapterId: editorChapterId,
      draftId: editorDraftId,
      draftVersion: editorDraftVersion,
      baseContentHash: editorBaseContentHash,
      content: editorContent,
      dirty: editorDirty,
      contentAvailable: editorContentAvailable,
      selectionStart: editorSelectionStart,
      selectionEnd: editorSelectionEnd,
      traceId: createTraceId('recovery-write'),
    };
    if (mountedRef.current) setSaveStatus('pending');
    cancelTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, debounceMs);
  }, [
    editorNovelId,
    editorChapterId,
    editorDraftId,
    editorDraftVersion,
    editorBaseContentHash,
    editorContent,
    editorDirty,
    editorContentAvailable,
    editorSelectionStart,
    editorSelectionEnd,
    debounceMs,
    cancelTimer,
    flush,
  ]);

  // Browser lifecycle events explicitly flush the captured target. Effect
  // cleanup itself only cancels the timer so StrictMode replay cannot bypass
  // the 1500 ms debounce contract.
  useEffect(() => {
    const handlePageHide = () => { void flush(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelTimer();
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cancelTimer, flush]);

  useEffect(() => {
    const epoch = ++loadEpochRef.current;
    if (!editorNovelId || !editorChapterId) {
      setPrompt({ status: 'none' });
      return;
    }
    const target = { novelId: editorNovelId, chapterId: editorChapterId };
    const baseIdentity = {
      novelId: editorNovelId,
      chapterId: editorChapterId,
      draftId: editorDraftId,
      draftVersion: editorDraftVersion,
      baseContentHash: editorBaseContentHash,
    };
    const traceId = createTraceId('recovery-read');
    setPrompt({ status: 'loading' });
    void workspaceRecoveryService.get(target, traceId).then(async (snapshot) => {
      if (epoch !== loadEpochRef.current) return;
      if (!snapshot) {
        setPrompt({ status: 'none' });
        return;
      }
      // baseContentHash is the verified persisted document identity. Using it
      // here avoids reloading recovery on every dirty keystroke while still
      // recognizing a snapshot that is identical to the saved正文.
      if (editorBaseContentHash && snapshot.recoveryContentHash === editorBaseContentHash) {
        await workspaceRecoveryService.delete(target, createTraceId('recovery-stale-cleanup')).catch((error) => {
          const normalized = logWorkspaceError('recovery_stale_cleanup_failed', error, {
            traceId,
            novelId: target.novelId,
            chapterId: target.chapterId,
          });
          logWorkspaceWarning('recovery_stale_cleanup_deferred', {
            traceId,
            novelId: target.novelId,
            chapterId: target.chapterId,
            code: normalized.code,
          });
        });
        if (epoch === loadEpochRef.current) setPrompt({ status: 'none' });
        return;
      }
      if (snapshotMatchesBase(snapshot, baseIdentity)) {
        setPrompt({ status: 'available', snapshot, conflict: false });
      } else {
        setPrompt({
          status: 'conflict',
          snapshot,
          conflict: true,
          errorCode: 'RECOVERY_BASE_CONFLICT',
        });
      }
    }).catch((error) => {
      if (epoch !== loadEpochRef.current) return;
      setPrompt({ status: 'none' });
      logWorkspaceError('recovery_read_failed', error, { traceId, ...target });
    });
  }, [
    editorNovelId,
    editorChapterId,
    editorDraftId,
    editorDraftVersion,
    editorBaseContentHash,
  ]);

  const clear = useCallback(async (target?: WorkspaceRecoveryTarget): Promise<void> => {
    const resolvedTarget = target ?? (editorRef.current
      ? { novelId: editorRef.current.novelId, chapterId: editorRef.current.chapterId }
      : null);
    if (!resolvedTarget?.novelId || !resolvedTarget.chapterId) return;
    cancelTimer();
    if (pendingRef.current?.novelId === resolvedTarget.novelId
      && pendingRef.current.chapterId === resolvedTarget.chapterId) {
      pendingRef.current = null;
    }
    // A leave-triggered flush may already be writing this exact snapshot.
    // Wait before deleting so a late UPSERT cannot recreate a discarded or
    // formally saved recovery row.
    await writeInFlightRef.current;
    await workspaceRecoveryService.delete(resolvedTarget, createTraceId('recovery-delete'));
    const live = editorRef.current;
    if (live?.novelId === resolvedTarget.novelId && live.chapterId === resolvedTarget.chapterId) {
      setPrompt({ status: 'none' });
      setSaveStatus('idle');
      lastWrittenSignatureRef.current = '';
    }
  }, [cancelTimer]);

  const dismissPrompt = useCallback(() => setPrompt({ status: 'none' }), []);

  return {
    prompt,
    saveStatus,
    flush,
    clear,
    dismissPrompt,
    waitForWrite: async () => { await writeInFlightRef.current; },
  };
}
