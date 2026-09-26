import type { ArtifactDecisionKind, ReviewAuthorizationStatus } from '../../types/conversation';

export function ArtifactDecisionActions({
  revisionCount,
  revisionNotes,
  isChapter,
  reviewConfirmed = false,
  reviewStatus,
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
  reviewConfirmed?: boolean;
  reviewStatus?: ReviewAuthorizationStatus;
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
          data-testid={
            reviewStatus === 'consumed'
              ? 'workbench-artifact-view-adopted'
              : reviewConfirmed
                ? 'workbench-artifact-continue-review'
                : 'workbench-artifact-confirm-review'
          }
          disabled={busy || isInvalid || reviewStatus === 'expired'}
          title={
            reviewStatus === 'expired'
              ? '授权已失效，请要求修改并审阅新候选；不会沿用过期授权'
              : isInvalid
                ? '产物结构与来源校验未通过，不能进入章节审阅'
                : reviewConfirmed
                  ? '仅打开已授权的章节，不重复生成、保存或采用'
                  : undefined
          }
          onClick={() => onDecide?.('confirm')}
        >
          {reviewStatus === 'consumed'
            ? '查看正式正文'
            : reviewStatus === 'expired'
              ? '审阅授权已失效'
              : reviewConfirmed
                ? '继续审阅'
                : '确认进入审阅'}
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
      {(!reviewConfirmed || reviewStatus === 'expired') && (
        <>
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
        </>
      )}
    </div>
  );
}
