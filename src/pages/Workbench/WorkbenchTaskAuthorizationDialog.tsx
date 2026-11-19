import { useState } from 'react';
import { ModalFrame } from '../../components/common/ModalFrame';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';
import type { TaskAuthorization, TaskAuthorizationReceipt } from '../../types/taskAuthorization';
import {
  WorkbenchTaskAuthorizationForm,
  type TaskAuthorizationFormProps,
} from './WorkbenchTaskAuthorizationForm';
import {
  TASK_AUTHORIZATION_ACTION_LABELS,
  TASK_AUTHORIZATION_STATUS_LABELS,
} from './taskAuthorizationPresentation';

export interface WorkbenchTaskAuthorizationDialogProps extends Omit<
  TaskAuthorizationFormProps,
  'disabled'
> {
  novelTitle: string;
  authorizations: TaskAuthorization[];
  receipts: TaskAuthorizationReceipt[];
  loading: boolean;
  busy: boolean;
  error: string;
  stage?: string;
  stopReason?: string;
  onRevoke: (authorizationId: string) => Promise<unknown>;
  onRefresh: () => Promise<unknown> | void;
  onDismiss: () => void;
}

/** View, revoke and issue scoped task permissions; this component performs no IPC or generation. */
export function WorkbenchTaskAuthorizationDialog({
  novelTitle,
  authorizations,
  receipts,
  loading,
  busy,
  error,
  stage,
  stopReason,
  onRevoke,
  onRefresh,
  onDismiss,
  ...formProps
}: WorkbenchTaskAuthorizationDialogProps) {
  const [localError, setLocalError] = useState('');
  return (
    <ModalFrame
      title="本任务授权"
      onDismiss={onDismiss}
      busy={busy}
      maxWidth={680}
      initialFocusSelector="[data-authorization-refresh]"
      dialogProps={{
        'data-testid': 'workbench-task-authorization-dialog',
        onKeyDown: (event) => {
          if (isComposingKeyboardEvent(event)) event.stopPropagation();
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
          }
        },
      }}
      footer={
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onDismiss}>
          关闭授权详情
        </button>
      }
    >
      <p>
        作品：{novelTitle} · <strong>本任务当前目标及其受控后续阶段</strong>
        。未授予的动作继续人工确认，新的独立目标需要重新授权。
      </p>
      {stage && <p role="status">当前阶段：{stage}</p>}
      {stopReason && <p role="status">已停止自动应用：{stopReason}</p>}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        data-authorization-refresh
        disabled={loading || busy}
        onClick={() => void onRefresh()}
      >
        重新读取授权与写入回执
      </button>
      {loading && (
        <p role="status" aria-live="polite">
          正在读取原生授权记录…
        </p>
      )}
      {(error || localError) && <p role="alert">{error || localError}</p>}
      <section aria-label="已签发的本任务授权">
        <h3>已签发授权</h3>
        {!loading && !authorizations.length && <p>尚未签发预授权；生成候选不会自动采用。</p>}
        {authorizations.map((grant) => (
          <article
            className="resource-card"
            key={grant.authorizationId}
            data-testid="workbench-task-authorization-grant"
            data-authorization-id={grant.authorizationId}
            data-status={grant.status}
            data-used-writes={grant.usedWrites}
            aria-label={`授权 ${grant.authorizationId}`}
          >
            <h4>{TASK_AUTHORIZATION_STATUS_LABELS[grant.status]}</h4>
            <p>
              授权：{grant.authorizationId} · 已写入 {grant.usedWrites}/{grant.spec.maxWrites} 次
            </p>
            <p>
              绑定目标回合：{grant.sourceTurnId}；
              {grant.sourceTurnId === formProps.sourceTurnId
                ? '当前目标及其受控后续阶段'
                : '历史目标，不授权当前新的独立目标'}
              。
            </p>
            <p>
              {grant.spec.actions
                .map(
                  (item) =>
                    `${TASK_AUTHORIZATION_ACTION_LABELS[item.action]}最多 ${item.maxWrites} 次`,
                )
                .join('；')}
            </p>
            <p>
              已有章节范围：
              {grant.spec.chapterIds
                .map((id) => {
                  const chapter = formProps.chapters.find((item) => item.id === id);
                  return chapter
                    ? `第${chapter.chapterNumber}章 · ${chapter.title}`
                    : `已不可读取的章节 ${id}`;
                })
                .join('、') || '未授权已有章节'}
            </p>
            {grant.spec.allowNovelPlanning && <p>允许作品级规划；不扩大正文或总结权限。</p>}
            {grant.spec.creationScope && (
              <p>
                有限新建：第 {grant.spec.creationScope.firstVolumeIndex}～
                {grant.spec.creationScope.lastVolumeIndex} 卷，最多{' '}
                {grant.spec.creationScope.maxNewVolumes} 卷、
                {grant.spec.creationScope.maxNewChapters} 章。
              </p>
            )}
            <p>
              冻结模型：{grant.modelSnapshot.providerId} · {grant.modelSnapshot.modelId}
              ；变更后须重新授权。
            </p>
            <p>
              有效期至：{grant.expiresAt}；预算：{grant.spec.budget.maxRequests} 次模型请求 /{' '}
              {grant.spec.budget.maxToolCalls} 次工具调用 / {grant.spec.budget.maxRevisions} 次修订
              / {grant.spec.budget.maxTokens} Token / ${grant.spec.budget.maxCostUsd} /{' '}
              {grant.spec.budget.maxWallClockMs / 60000} 分钟。
            </p>
            {grant.revokedAt && (
              <p>
                撤销时间：{grant.revokedAt} · {grant.revocationReason || '用户撤销'}
              </p>
            )}
            <details>
              <summary>查看冻结模型与目标基线指纹</summary>
              <p>模型：{grant.modelSnapshotHash}</p>
              <p>基线：{grant.baselineHash}</p>
            </details>
            {grant.status === 'active' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-task-authorization-revoke"
                data-authorization-id={grant.authorizationId}
                disabled={busy}
                onClick={() => {
                  setLocalError('');
                  void onRevoke(grant.authorizationId).catch((cause: unknown) =>
                    setLocalError(
                      cause instanceof Error ? cause.message : '撤销结果未确认，请重新读取。',
                    ),
                  );
                }}
              >
                撤销授权 {grant.authorizationId}
              </button>
            )}
          </article>
        ))}
        <p>撤销后停止新的授权写入。已提交事务不会回滚或被报告为“全部取消”。</p>
      </section>
      <section aria-label="任务预授权写入回执">
        <h3>已提交写入回执</h3>
        {!receipts.length && <p>尚无已提交写入回执。</p>}
        {receipts.map((receipt) => (
          <details
            key={receipt.receiptId}
            data-testid="workbench-task-authorization-receipt"
            data-receipt-id={receipt.receiptId}
            data-action={receipt.action}
            data-authority={receipt.authority}
          >
            <summary>
              根据任务预授权{receipt.action === 'adopt_chapter_text' ? '采用正文' : '应用候选'} ·{' '}
              {receipt.receiptId}
              {receipt.replayed ? '（幂等读回）' : ''}
            </summary>
            <p>
              动作：{TASK_AUTHORIZATION_ACTION_LABELS[receipt.action]}；授权：
              {receipt.authorizationId}；操作：{receipt.operationId}
            </p>
            <p>
              候选：{receipt.cardId}；产物：{receipt.artifactId}；提交时间：{receipt.createdAt}
            </p>
            <p>写入前基线：{receipt.beforeHash}</p>
            <p>写入后基线：{receipt.afterHash}</p>
            <p>此回执是预授权结果，不表示作者已审阅或内容语义已验证。</p>
          </details>
        ))}
      </section>
      <WorkbenchTaskAuthorizationForm
        key={`${formProps.novelId}:${formProps.conversationId}:${formProps.sourceTurnId}`}
        {...formProps}
        disabled={busy || loading || Boolean(error)}
      />
    </ModalFrame>
  );
}
