import { dbCall, lsGet, lsRemove, lsSet, nowISO } from '../database/db';
import { normalizeAppError } from '../../types/appError';
import type {
  UpsertWorkspaceRecoveryInput,
  WorkspaceRecoverySnapshot,
  WorkspaceRecoveryTarget,
} from '../../types/workspaceRecovery';

const RECOVERY_KEY_PREFIX = 'ai_novel_studio_workspace_recovery_';

type RecoveryRecord = Partial<WorkspaceRecoverySnapshot> & {
  novel_id?: string;
  chapter_id?: string;
  base_draft_id?: string | null;
  base_draft_version?: number | null;
  base_content_hash?: string | null;
  recovery_content?: string;
  recovery_content_hash?: string;
  selection_start?: number | null;
  selection_end?: number | null;
  created_at?: string;
  updated_at?: string;
};

function keyOf(target: WorkspaceRecoveryTarget): string {
  return `${RECOVERY_KEY_PREFIX}${encodeURIComponent(target.novelId)}_${encodeURIComponent(target.chapterId)}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeRecovery(raw: unknown): WorkspaceRecoverySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as RecoveryRecord;
  const novelId = optionalString(record.novelId ?? record.novel_id);
  const chapterId = optionalString(record.chapterId ?? record.chapter_id);
  const recoveryContent = typeof record.recoveryContent === 'string'
    ? record.recoveryContent
    : record.recovery_content;
  const recoveryContentHash = optionalString(record.recoveryContentHash ?? record.recovery_content_hash);
  if (!novelId || !chapterId || typeof recoveryContent !== 'string' || !recoveryContentHash) return null;
  const now = nowISO();
  return {
    novelId,
    chapterId,
    baseDraftId: optionalString(record.baseDraftId ?? record.base_draft_id),
    baseDraftVersion: optionalNumber(record.baseDraftVersion ?? record.base_draft_version),
    baseContentHash: optionalString(record.baseContentHash ?? record.base_content_hash),
    recoveryContent,
    recoveryContentHash,
    selectionStart: optionalNumber(record.selectionStart ?? record.selection_start),
    selectionEnd: optionalNumber(record.selectionEnd ?? record.selection_end),
    createdAt: optionalString(record.createdAt ?? record.created_at) ?? now,
    updatedAt: optionalString(record.updatedAt ?? record.updated_at) ?? now,
  };
}

function getLocal(target: WorkspaceRecoveryTarget): WorkspaceRecoverySnapshot | null {
  return normalizeRecovery(lsGet<unknown>(keyOf(target)));
}

export const workspaceRecoveryService = {
  async get(target: WorkspaceRecoveryTarget, traceId: string): Promise<WorkspaceRecoverySnapshot | null> {
    try {
      const raw = await dbCall<unknown | null>(
        'get_workspace_recovery_snapshot',
        { input: { ...target, traceId } },
        () => getLocal(target),
      );
      const snapshot = normalizeRecovery(raw);
      if (snapshot && (snapshot.novelId !== target.novelId || snapshot.chapterId !== target.chapterId)) {
        throw {
          code: 'RECOVERY_CONTENT_INVALID',
          message: '恢复快照与请求目标不一致。',
          retryable: false,
          traceId,
        };
      }
      return snapshot;
    } catch (error) {
      const normalized = normalizeAppError(error, '读取恢复快照失败。', { traceId });
      if (normalized.code === 'RECOVERY_SNAPSHOT_NOT_FOUND') return null;
      throw normalized;
    }
  },

  async upsert(input: UpsertWorkspaceRecoveryInput): Promise<WorkspaceRecoverySnapshot> {
    const fallback = () => {
      const existing = getLocal(input);
      const now = nowISO();
      const snapshot: WorkspaceRecoverySnapshot = {
        novelId: input.novelId,
        chapterId: input.chapterId,
        baseDraftId: input.baseDraftId,
        baseDraftVersion: input.baseDraftVersion,
        baseContentHash: input.baseContentHash,
        recoveryContent: input.recoveryContent,
        recoveryContentHash: input.recoveryContentHash,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      lsSet(keyOf(input), snapshot);
      const persisted = getLocal(input);
      if (!persisted
        || persisted.recoveryContentHash !== snapshot.recoveryContentHash
        || persisted.recoveryContent !== snapshot.recoveryContent) {
        throw {
          code: 'RECOVERY_CONTENT_INVALID',
          message: '浏览器恢复快照未能持久化。',
          retryable: true,
          traceId: input.traceId,
        };
      }
      return persisted;
    };
    try {
      const raw = await dbCall<unknown>(
        'upsert_workspace_recovery_snapshot',
        { input },
        fallback,
      );
      const snapshot = normalizeRecovery(raw);
      if (!snapshot) {
        throw {
          code: 'RECOVERY_CONTENT_INVALID',
          message: '恢复快照写入结果无效。',
          retryable: true,
          traceId: input.traceId,
        };
      }
      return snapshot;
    } catch (error) {
      throw normalizeAppError(error, '保存恢复快照失败。', { traceId: input.traceId });
    }
  },

  async delete(target: WorkspaceRecoveryTarget, traceId: string): Promise<void> {
    try {
      await dbCall<unknown>(
        'delete_workspace_recovery_snapshot',
        { input: { ...target, traceId } },
        () => {
          lsRemove(keyOf(target));
          if (getLocal(target) !== null) {
            throw {
              code: 'RECOVERY_CONTENT_INVALID',
              message: '浏览器恢复快照未能删除。',
              retryable: true,
              traceId,
            };
          }
        },
      );
    } catch (error) {
      const normalized = normalizeAppError(error, '清理恢复快照失败。', { traceId });
      if (normalized.code === 'RECOVERY_SNAPSHOT_NOT_FOUND') return;
      throw normalized;
    }
  },
};
