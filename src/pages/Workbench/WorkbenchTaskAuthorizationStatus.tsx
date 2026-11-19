import type { TaskAuthorization, TaskAuthorizationReceipt } from '../../types/taskAuthorization';

/** Compact task feedback only; issuance, inspection and revocation stay in the existing dialog. */
export function WorkbenchTaskAuthorizationStatus({
  authorizations,
  receipts = [],
  loading,
  error = '',
  stage,
  stopReason,
  sourceTurnId,
  onManage,
}: {
  authorizations: TaskAuthorization[];
  receipts?: TaskAuthorizationReceipt[];
  loading: boolean;
  error?: string;
  stage?: string;
  stopReason?: string;
  sourceTurnId?: string;
  onManage: () => void;
}) {
  const active = authorizations.filter(
    (grant) => grant.status === 'active' && (!sourceTurnId || grant.sourceTurnId === sourceTurnId),
  );
  const remaining = active.reduce(
    (count, grant) => count + Math.max(0, grant.spec.maxWrites - grant.usedWrites),
    0,
  );
  const latest = receipts
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return (
    <section aria-label="本任务授权与执行状态" className="workbench-readiness-hint">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        data-testid="workbench-task-authorization-manage"
        onClick={onManage}
        aria-label="查看或管理本任务授权"
      >
        本任务授权：
        {loading ? '读取中' : active.length ? `有效 · 剩余 ${remaining} 次写入` : '人工确认'}
      </button>
      <span role="status" aria-live="polite">
        {stage ? `当前阶段：${stage}。` : ''}
        {stopReason ? `已停止自动应用：${stopReason}。` : ''}
        {latest
          ? `根据任务预授权已${latest.action === 'adopt_chapter_text' ? '采用正文' : '应用候选'}；回执 ${latest.receiptId}。`
          : ''}
      </span>
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
