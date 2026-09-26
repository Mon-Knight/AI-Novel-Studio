import { memo, useState } from 'react';
import { Database, ShieldCheck } from 'lucide-react';
import type { WorkbenchPresentationContext } from '../../features/workbench/workbenchPresentation';
import type { ConversationArtifactCard, TaskRun } from '../../types/conversation';
import { isContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';
import {
  isReadOnlyReportType,
  parseJsonPayload,
  supportsStructuredApply as supportsStructuredApplyPolicy,
} from '../../services/conversation/structuredApplyPolicy';
import { ArtifactApplyScopeNotice, ArtifactCandidateList } from './ArtifactCandidateList';
import { ArtifactDecisionActions } from './ArtifactDecisionActions';
import { useArtifactCandidateReview } from './hooks/useArtifactCandidateReview';
import { isStructuredCandidateArtifactType } from './artifactCandidateOptions';
import {
  formatWorkbenchCandidateNumber,
  formatWorkbenchModelShortName,
  resolveArtifactNextStep,
  resolveWorkbenchArtifactTargetLabels,
} from './workbenchHelpers';

const ARTIFACT_LABELS: Record<string, string> = {
  generic_text: '文本候选',
  generic_json: '结构化候选',
  chapter_text: '章节正文候选',
  scene_text: '分镜正文候选',
  outline: '大纲候选',
  character_candidates: '人物候选',
  event_candidates: '事件候选',
  setting_candidates: '设定候选',
  quality_report: '质量检查报告',
  style_analysis: '风格分析报告',
  chapter_summary: '章节总结候选',
  volume_summary: '分卷总结候选',
  tool_result: '工具结果',
  plan: '创作规划候选',
  generic: '创作候选',
};

const ARTIFACT_VALIDATION_LABELS = {
  raw: '等待结构与来源校验',
  parsing: '正在校验结构与来源',
  valid: '结构与来源校验通过 · 内容仍需审阅',
  valid_with_warnings: '结构与来源校验通过，含警告 · 内容仍需审阅',
  invalid: '结构与来源校验未通过',
} as const;

function isDeterministicContextCompression(artifact: ConversationArtifactCard): boolean {
  if (artifact.artifactType !== 'generic_json' || !artifact.content) return false;
  return isContextCompressionCandidate(parseJsonPayload(artifact.content));
}

function compactHash(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function compactIdentifier(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export interface ArtifactCardProps {
  artifact: ConversationArtifactCard;
  candidateNumber?: number;
  sourceRun?: TaskRun;
  presentationContext?: WorkbenchPresentationContext;
  parentCandidateNumber?: number;
  hasRevisionSource?: boolean;
  onDecide?: (
    decision: 'confirm' | 'reject' | 'request_revision' | 'request_apply',
    revisionNotes?: string,
  ) => void;
  onReload?: () => void;
  busy?: boolean;
  newlyArrived?: boolean;
}

/**
 * 候选产物交互卡片（支持采纳、确认入审、申请应用、修改与拒绝）
 */
export const ArtifactCard = memo(function ArtifactCard({
  artifact,
  candidateNumber,
  sourceRun,
  presentationContext,
  parentCandidateNumber,
  hasRevisionSource = false,
  onDecide,
  onReload,
  busy = false,
  newlyArrived = false,
}: ArtifactCardProps) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const review = useArtifactCandidateReview(artifact);
  const decision = artifact.latestDecision?.decision;
  const evidence = artifact.artifactEvidence;
  const validationIssues = evidence?.validationIssues ?? [];
  const validationErrors = validationIssues.filter((issue) => issue.severity === 'error').length;
  const validationWarnings = validationIssues.filter(
    (issue) => issue.severity === 'warning',
  ).length;
  const isInvalid = evidence?.processingStatus === 'invalid';
  const isChapter = artifact.artifactType === 'chapter_text';
  const reviewStatus = isChapter ? artifact.reviewAuthorization?.status : undefined;
  const reviewConfirmed = isChapter && decision === 'confirm';
  const isReadOnlyReport = isReadOnlyReportType(artifact.artifactType);
  const isDeterministicCompression = isDeterministicContextCompression(artifact);
  const supportsStructuredApply = supportsStructuredApplyPolicy({
    artifactType: artifact.artifactType,
    derivationType: artifact.artifactEvidence?.derivationType,
    payload:
      artifact.artifactType === 'generic_json' ? parseJsonPayload(artifact.content) : undefined,
  });
  const structuredApplyAvailable = !artifact.artifactId?.startsWith('browser-');
  const projectedStatus = isInvalid
    ? '结构与来源未通过'
    : artifact.latestDecision?.conflictCode
      ? artifact.latestDecision.conflictCode === 'STRUCTURED_APPLY_ATOMIC_UNAVAILABLE'
        ? '原子应用迁移中'
        : artifact.latestDecision.conflictCode === 'BROWSER_APPLY_UNSUPPORTED'
          ? '当前环境不可应用'
          : `冲突 · ${artifact.latestDecision.conflictCode}`
      : artifact.latestDecision?.applyTransactionId
        ? '已应用'
        : decision === 'confirm'
          ? isReadOnlyReport
            ? '已阅'
            : isChapter
              ? reviewStatus === 'consumed'
                ? '已采用'
                : reviewStatus === 'expired'
                  ? '审阅授权已失效'
                  : reviewStatus === 'issued'
                    ? '待审阅 · 尚未采用'
                    : '已确认 · 待恢复审阅'
              : '已确认'
          : decision === 'reject'
            ? '已拒绝'
            : decision === 'request_revision'
              ? '需修订'
              : decision === 'request_apply'
                ? '待应用'
                : supportsStructuredApply
                  ? structuredApplyAvailable
                    ? '待应用'
                    : '当前环境不可应用'
                  : artifact.status === 'candidate'
                    ? '待确认'
                    : artifact.status === 'confirmed'
                      ? '已确认'
                      : '已拒绝';
  const canAct = Boolean(
    onDecide &&
    artifact.artifactId &&
    (!decision ||
      (decision === 'request_apply' &&
        artifact.latestDecision?.conflictCode &&
        !artifact.latestDecision.applyTransactionId)),
  );
  const canApply = supportsStructuredApply && !decision;
  const applyUnavailable = canApply && !structuredApplyAvailable;
  const showStructuredOptions =
    isStructuredCandidateArtifactType(artifact.artifactType) &&
    Boolean(artifact.content) &&
    !artifact.contentLoadError;
  const target = resolveWorkbenchArtifactTargetLabels({
    presentationContext,
    evidence,
    sourceRun,
  });
  const targetSummary = target.chapterLabel
    ? `${target.novelLabel} · ${target.chapterLabel}`
    : target.novelLabel;
  const modelShortName = formatWorkbenchModelShortName(sourceRun);
  const sourceSummary = modelShortName || '来源模型待恢复';
  const baselineSummary = evidence
    ? evidence.sourceDraftVersion != null
      ? `草稿 v${evidence.sourceDraftVersion}`
      : evidence.baseContentHash
        ? `哈希 ${compactHash(evidence.baseContentHash)}`
        : '基线待恢复'
    : '基线待恢复';
  const nextStep = resolveArtifactNextStep({
    decision,
    isChapter,
    isInvalid,
    isReadOnlyReport,
    reviewStatus,
    contentLoadError: artifact.contentLoadError,
    supportsStructuredApply: canApply,
    applyUnavailable,
    applyTransactionId: artifact.latestDecision?.applyTransactionId,
    conflictCode: artifact.latestDecision?.conflictCode,
  });
  const revisionLabel = parentCandidateNumber
    ? `修订自${formatWorkbenchCandidateNumber(parentCandidateNumber)}`
    : hasRevisionSource
      ? '修订来源待恢复'
      : undefined;
  return (
    <article
      className={`workbench-artifact-card ${isChapter ? 'is-chapter' : ''} ${
        newlyArrived ? 'is-newly-arrived' : ''
      }`.trim()}
      data-testid="workbench-artifact-card"
      data-card-id={artifact.cardId}
      data-artifact-id={artifact.artifactId}
      data-run-id={artifact.runId}
      data-status={artifact.status}
      data-decision={decision ?? ''}
      data-review-status={reviewStatus}
      data-newly-arrived={newlyArrived ? 'true' : undefined}
      data-derivation-mode={isDeterministicCompression ? 'deterministic-local' : undefined}
    >
      <div className="workbench-artifact-heading">
        <div>
          <div className="workbench-eyebrow">
            {isDeterministicCompression
              ? '确定性小说上下文压缩'
              : (ARTIFACT_LABELS[artifact.artifactType] ?? '创作候选')}
          </div>
          <h3>{artifact.title}</h3>
        </div>
        <span className="workbench-artifact-status">{projectedStatus}</span>
      </div>
      <div className="workbench-artifact-identity" data-testid="workbench-artifact-identity">
        <span className="workbench-artifact-number" data-testid="workbench-artifact-number">
          {formatWorkbenchCandidateNumber(candidateNumber)}
        </span>
        <span data-testid="workbench-artifact-target" title={targetSummary}>
          目标：{targetSummary}
        </span>
        <span data-testid="workbench-artifact-model" title={sourceSummary}>
          来源：{sourceSummary}
        </span>
        <span title={baselineSummary}>基线：{baselineSummary}</span>
        {revisionLabel && (
          <span data-testid="workbench-artifact-revision-source">{revisionLabel}</span>
        )}
      </div>
      <p className="workbench-artifact-next-step" data-testid="workbench-artifact-next-step">
        下一步：{nextStep}
      </p>
      {!isInvalid && <p>{artifact.summary}</p>}
      {supportsStructuredApply && <ArtifactApplyScopeNotice />}
      {isDeterministicCompression && (
        <p
          className="workbench-artifact-derivation-note"
          data-testid="workbench-artifact-derivation"
        >
          本地确定性提取 · 不使用当前任务的冻结模型
        </p>
      )}
      {evidence && (
        <div
          className="workbench-artifact-evidence"
          data-testid="workbench-artifact-evidence"
          data-processing-status={evidence.processingStatus}
        >
          <div className="workbench-artifact-evidence-summary">
            <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
            <p data-testid="workbench-artifact-validation">
              {ARTIFACT_VALIDATION_LABELS[evidence.processingStatus]}
              {validationErrors > 0 ? ` · ${validationErrors} 个错误` : ''}
              {validationWarnings > 0 ? ` · ${validationWarnings} 个警告` : ''}
            </p>
          </div>
          {validationIssues.length > 0 && (
            <details
              className="workbench-artifact-validation-details"
              data-testid="workbench-artifact-validation-details"
              data-disclosure-key={`artifact-validation:${artifact.cardId}`}
            >
              <summary>查看全部校验证据（{validationIssues.length}）</summary>
              <ul>
                {validationIssues.map((issue) => (
                  <li key={issue.issueId}>
                    <span className={`workbench-artifact-issue-severity is-${issue.severity}`}>
                      {issue.severity === 'error' ? '错误' : '警告'}
                    </span>
                    <code>{issue.code}</code>
                    <span>{issue.message}</span>
                    {issue.jsonPath && <code>{issue.jsonPath}</code>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details
            className="workbench-artifact-technical-evidence"
            data-disclosure-key={`artifact-technical:${artifact.cardId}`}
          >
            <summary>
              <Database aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>技术证据</span>
            </summary>
            <div>
              <p data-testid="workbench-artifact-source">
                生成来源：作品 {compactIdentifier(evidence.sourceNovelId)}
                {evidence.sourceChapterId
                  ? ` · 章节 ${compactIdentifier(evidence.sourceChapterId)}`
                  : ''}
                {evidence.sourceDraftId
                  ? ` · 草稿 ${compactIdentifier(evidence.sourceDraftId)}`
                  : ''}
              </p>
              {(evidence.sourceDraftVersion != null || evidence.baseContentHash) && (
                <p data-testid="workbench-artifact-baseline">
                  生成时基线：
                  {evidence.sourceDraftVersion != null
                    ? `源草稿 v${evidence.sourceDraftVersion}`
                    : ''}
                  {evidence.sourceDraftVersion != null && evidence.baseContentHash ? ' · ' : ''}
                  {evidence.baseContentHash
                    ? `内容哈希 ${compactHash(evidence.baseContentHash)}`
                    : ''}
                </p>
              )}
            </div>
          </details>
        </div>
      )}
      {showStructuredOptions && artifact.content ? (
        <ArtifactCandidateList
          key={artifact.artifactId ?? artifact.cardId}
          artifactType={artifact.artifactType}
          content={artifact.content}
          drafts={review.drafts}
          onDraftChange={review.updateDraft}
          reviewAvailable={canAct}
          disabled={busy || isInvalid}
        />
      ) : null}
      {artifact.contentLoadError && (
        <div
          className="workbench-artifact-load-error"
          data-testid="workbench-artifact-load-error"
          role="alert"
        >
          <span>{artifact.contentLoadError}</span>
          {onReload && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReload}>
              重新读取
            </button>
          )}
        </div>
      )}
      <details
        data-disclosure-key={`artifact-content:${artifact.cardId}`}
        onToggle={(event) => setContentExpanded(event.currentTarget.open)}
      >
        <summary>{showStructuredOptions ? '原始数据' : '查看候选内容'}</summary>
        {contentExpanded && !artifact.contentLoadError && (
          <pre>{artifact.content || '候选内容正在载入。'}</pre>
        )}
      </details>
      {(canAct || (reviewConfirmed && onDecide)) && (
        <ArtifactDecisionActions
          revisionCount={review.revisionCount}
          revisionNotes={review.revisionNotes}
          isChapter={isChapter}
          reviewConfirmed={reviewConfirmed}
          reviewStatus={reviewStatus}
          canApply={canApply}
          isReadOnlyReport={isReadOnlyReport}
          isInvalid={isInvalid}
          applyUnavailable={applyUnavailable}
          busy={busy}
          onDecide={onDecide}
        />
      )}
    </article>
  );
});
