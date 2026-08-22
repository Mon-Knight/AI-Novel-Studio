import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import WorkspaceLeaveDialog from '../components/workspace/WorkspaceLeaveDialog';
import type {
  LeaveDecision,
  PendingWorkspaceLeave,
  WorkspaceLeaveRequest,
} from '../types/workspaceLeave';
import { isTauriRuntime } from '../services/tauri/runtime';
import {
  createTraceId,
  logWorkspaceError,
  logWorkspaceWarning,
} from '../services/workspace/workspaceErrorService';
import { getAppErrorUserMessage, normalizeAppError } from '../types/appError';

interface UseWorkspaceLeaveGuardOptions {
  shouldGuard: boolean;
  shouldPreflight?: boolean;
  preflight?: () => Promise<boolean>;
  contentAvailable: boolean;
  save: () => Promise<boolean>;
  discard: () => Promise<void>;
  flushRecovery?: () => Promise<void>;
}

interface ActiveLeave {
  request: PendingWorkspaceLeave;
  resolve: (decision: LeaveDecision) => void;
}

/**
 * Single decision coordinator for chapter actions, router transitions and
 * native window close requests. While one decision is active, later requests
 * are explicitly ignored so they cannot save, navigate or close twice.
 */
export function useWorkspaceLeaveGuard(options: UseWorkspaceLeaveGuardOptions) {
  const optionsRef = useRef(options);
  const activeRef = useRef<ActiveLeave | null>(null);
  const preflightPendingRef = useRef(false);
  const bypassCloseGuardRef = useRef(false);
  const handledBlockedLocationRef = useRef('');
  const [activeRequest, setActiveRequest] = useState<PendingWorkspaceLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  optionsRef.current = options;

  const blocker = useBlocker(
    useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
      if (!optionsRef.current.shouldGuard && !optionsRef.current.shouldPreflight) return false;
      return (
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}` !==
        `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
      );
    }, []),
  );

  const requestWorkspaceLeave = useCallback(
    async (request: WorkspaceLeaveRequest): Promise<LeaveDecision> => {
      if (activeRef.current || preflightPendingRef.current) {
        logWorkspaceWarning('leave_request_ignored_while_deciding', {
          traceId: createTraceId('leave-ignored'),
          reason: request.reason,
          targetNovelId: request.targetNovelId,
          targetChapterId: request.targetChapterId,
        });
        return 'cancel';
      }

      const requiresPreflight =
        request.reason !== 'draft_adopt' && request.reason !== 'draft_restore';
      if (optionsRef.current.shouldPreflight && requiresPreflight) {
        preflightPendingRef.current = true;
        try {
          const approved = await optionsRef.current.preflight?.();
          if (approved !== true) return 'cancel';
        } catch (error) {
          logWorkspaceError('leave_preflight_failed', error, {
            traceId: createTraceId('leave-preflight'),
            reason: request.reason,
            targetNovelId: request.targetNovelId,
            targetChapterId: request.targetChapterId,
          });
          return 'cancel';
        } finally {
          preflightPendingRef.current = false;
        }
      }

      if (!optionsRef.current.shouldGuard) {
        await request.continueAction?.();
        return 'proceed';
      }

      // Capture the latest edit in its original target before asking the user.
      void optionsRef.current.flushRecovery?.().catch((error) => {
        logWorkspaceError('leave_recovery_flush_failed', error, {
          traceId: createTraceId('leave-flush'),
          reason: request.reason,
        });
      });

      return new Promise<LeaveDecision>((resolve) => {
        const pending: PendingWorkspaceLeave = {
          ...request,
          id: createTraceId('leave'),
        };
        activeRef.current = { request: pending, resolve };
        setErrorMessage('');
        setBusy(false);
        setActiveRequest(pending);
      });
    },
    [],
  );

  const finish = useCallback(async (decision: LeaveDecision, proceed: boolean) => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    setActiveRequest(null);
    setBusy(false);
    setErrorMessage('');
    if (proceed) {
      try {
        await active.request.continueAction?.();
      } catch (error) {
        logWorkspaceError('leave_continue_action_failed', error, {
          traceId: active.request.id,
          reason: active.request.reason,
          targetNovelId: active.request.targetNovelId,
          targetChapterId: active.request.targetChapterId,
        });
        active.resolve('save_failed');
        return;
      }
    }
    active.resolve(decision);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeRef.current || busy) return;
    setBusy(true);
    setErrorMessage('');
    try {
      if (!optionsRef.current.contentAvailable) {
        throw {
          code: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
          message: '完整正文不可用，无法安全保存。',
          retryable: true,
        };
      }
      await optionsRef.current.flushRecovery?.();
      const saved = await optionsRef.current.save();
      if (!saved) {
        throw {
          code: 'WORKSPACE_SAVE_FAILED',
          message: '正文保存失败，已保留当前编辑内容。',
          retryable: true,
        };
      }
      await finish('proceed', true);
    } catch (error) {
      const normalized = normalizeAppError(error, '正文保存失败，已留在当前章节。');
      setErrorMessage(getAppErrorUserMessage(normalized));
      setBusy(false);
      logWorkspaceError('leave_save_failed', normalized, {
        traceId: activeRef.current?.request.id,
        reason: activeRef.current?.request.reason,
      });
    }
  }, [busy, finish]);

  const handleDiscard = useCallback(async () => {
    if (!activeRef.current || busy) return;
    setBusy(true);
    setErrorMessage('');
    try {
      // An unavailable document has no editable body to discard. Proceeding
      // must not delete a recovery snapshot that the user has not rejected.
      if (optionsRef.current.contentAvailable) {
        await optionsRef.current.discard();
      }
      await finish('proceed', true);
    } catch (error) {
      const normalized = normalizeAppError(error, '无法清理当前章节恢复快照，已取消离开。');
      setErrorMessage(getAppErrorUserMessage(normalized));
      setBusy(false);
      logWorkspaceError('leave_discard_failed', normalized, {
        traceId: activeRef.current?.request.id,
        reason: activeRef.current?.request.reason,
      });
    }
  }, [busy, finish]);

  const handleCancel = useCallback(() => {
    if (busy) return;
    void finish('cancel', false);
  }, [busy, finish]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handledBlockedLocationRef.current = '';
      return;
    }
    if (activeRef.current) return;
    const locationKey = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`;
    if (handledBlockedLocationRef.current === locationKey) return;
    handledBlockedLocationRef.current = locationKey;
    void requestWorkspaceLeave({
      reason: 'route_change',
      continueAction: () => blocker.proceed(),
    }).then((decision) => {
      if (decision !== 'proceed' && blocker.state === 'blocked') blocker.reset();
      handledBlockedLocationRef.current = '';
    });
  }, [blocker, requestWorkspaceLeave]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void appWindow
      .onCloseRequested((event) => {
        if (bypassCloseGuardRef.current) {
          bypassCloseGuardRef.current = false;
          return;
        }
        if (!optionsRef.current.shouldGuard && !optionsRef.current.shouldPreflight) return;
        event.preventDefault();
        if (activeRef.current) return;
        void requestWorkspaceLeave({
          reason: 'window_close',
          continueAction: async () => {
            bypassCloseGuardRef.current = true;
            try {
              await appWindow.close();
            } catch (error) {
              // close() can reject before Tauri emits the recursive close event.
              // Never leave the one-shot bypass armed for the next user request.
              bypassCloseGuardRef.current = false;
              throw error;
            }
          },
        }).catch((error) => {
          // The document-guard path converts continueAction failures into
          // save_failed. Goal-only preflight closes execute directly and can
          // reject, so contain and record that promise here as well.
          bypassCloseGuardRef.current = false;
          logWorkspaceError('window_close_failed', error, {
            traceId: createTraceId('window-close'),
          });
        });
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        logWorkspaceError('window_close_listener_failed', error, {
          traceId: createTraceId('window-close-listener'),
        });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [requestWorkspaceLeave]);

  const dialog = activeRequest
    ? createElement(WorkspaceLeaveDialog, {
        request: activeRequest,
        busy,
        errorMessage,
        saveDisabled: !options.contentAvailable,
        onSave: () => void handleSave(),
        onDiscard: () => void handleDiscard(),
        onCancel: handleCancel,
      })
    : null;

  return {
    requestWorkspaceLeave,
    decisionPending: activeRequest !== null,
    dialog,
  };
}
