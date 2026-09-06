import type { ArtifactDecisionKind } from '../../types/conversation';

export function ArtifactDecisionActions({
  revisionCount,
  revisionNotes,
  isChapter,
  canApply,
  isReadOnlyReport,
  isInvalid,
  applyUnavailable,
  busy,
  onDecide,
}: {
  revisionCount: number;
  revisionNotes: string;
  isChapter: boolean;
  canApply: boolean;
  isReadOnlyReport: boolean;
  isInvalid: boolean;
  applyUnavailable: boolean;
  busy: boolean;
  onDecide?: (decision: ArtifactDecisionKind, revisionNotes?: string) => void;
}) {
  return (
    <div className="workbench-artifact-actions">
      {revisionCount > 0 && (
        <span className="workbench-artifact-review-count" role="status">
          本次会话暂存 {revisionCount} 条候选意见
        </span>
      )}
      {isChapter ? (
        <button
          className="btn btn-primary btn-sm"
          data-testid="workbench-artifact-confirm-review"
          disabled={busy || isInvalid}
          title={isInvalid ? '产物结构与来源校验未通过，不能进入章节审阅' : undefined}
          onClick={() => onDecide?.('confirm')}
        >
          确认进入审阅
        </button>
      ) : canApply ? (
        <button
          className="btn btn-secondary btn-sm"
          data-testid="workbench-artifact-apply"
          data-availability={
            isInvalid ? 'validation-failed' : applyUnavailable ? 'runtime-unsupported' : 'available'
          }
          disabled={busy || isInvalid || applyUnavailable}
          title={
            isInvalid
              ? '产物结构与来源校验未通过，不能申请应用'
              : applyUnavailable
                ? '浏览器开发预览不会写入小说正式事实，请在桌面应用中完成应用'
                : '通过原子事务应用到小说正式事实'
          }
          onClick={() => onDecide?.('request_apply')}
        >
          {isInvalid ? '结构与来源未通过' : applyUnavailable ? '仅桌面端可应用' : '应用到作品'}
        </button>
      ) : isReadOnlyReport ? (
        <button
          className="btn btn-secondary btn-sm"
          data-testid="workbench-artifact-acknowledge"
          data-decision-kind="confirm"
          disabled={busy || isInvalid}
          title={
            isInvalid
              ? '报告结构与来源校验未通过，不能标记已阅'
              : '仅记录报告已阅，不应用到小说正式事实'
          }
          onClick={() => onDecide?.('confirm')}
        >
          标记已阅
        </button>
      ) : null}
      <button
        className="btn btn-secondary btn-sm"
        data-testid="workbench-artifact-revise"
        disabled={busy || (isInvalid && revisionCount > 0)}
        title="仅追加到当前任务输入区，不自动发送或应用"
        onClick={() => onDecide?.('request_revision', revisionNotes)}
      >
        {revisionCount > 0 ? `带出全部意见（${revisionCount}）` : '要求修改'}
      </button>
      <button
        className="btn btn-secondary btn-sm"
        data-testid="workbench-artifact-reject"
        disabled={busy}
        onClick={() => onDecide?.('reject')}
      >
        拒绝
      </button>
    </div>
  );
}
