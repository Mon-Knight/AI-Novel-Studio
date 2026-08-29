import { memo, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Database,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import type { ConversationArtifactCard, ToolCallEvent } from '../../types/conversation';
import { isContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';
import { GenerationContextReceipt, GenerationContextSummary } from './WorkbenchContextReceipt';
import {
  hideContextReceiptInternals,
  resolveToolContextReceipt,
} from './workbenchContextReceiptModel';
import { TOOL_LABELS, statusLabel } from './workbenchHelpers';

function ToolStatusIcon({ status }: { status: ToolCallEvent['status'] }) {
  const props = { 'aria-hidden': true as const, size: 14, strokeWidth: 1.9 };
  if (status === 'succeeded') return <CheckCircle2 {...props} />;
  if (status === 'failed') return <CircleAlert {...props} />;
  if (status === 'running') return <LoaderCircle {...props} />;
  return <CircleDashed {...props} />;
}

/**
 * 简化工具摘要行（默认在对话流中紧凑展示）
 */
export const ToolEventRow = memo(function ToolEventRow({
  event,
  runEvents = [],
}: {
  event: ToolCallEvent;
  runEvents?: ToolCallEvent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const semanticName = TOOL_LABELS[event.toolName] ?? '运行时事件';
  const visibleArguments = hideContextReceiptInternals(event.argumentsSummary);
  const hasArguments = visibleArguments !== undefined;
  const contextReceipt = resolveToolContextReceipt(event, runEvents);
  const visibleResult = hideContextReceiptInternals(event.result);
  const hasDetails =
    Boolean(contextReceipt) || hasArguments || visibleResult !== undefined || Boolean(event.error);
  const summary = (
    <>
      <span className="workbench-tool-icon" aria-hidden="true">
        <ToolStatusIcon status={event.status} />
      </span>
      <span className="workbench-tool-label">{semanticName}</span>
      <span className="workbench-tool-name">{event.toolName}</span>
      <span className="workbench-tool-status">
        {event.status === 'succeeded' ? '已完成' : statusLabel(event.status)}
      </span>
      {event.durationMs !== undefined && (
        <span className="workbench-tool-duration">{event.durationMs} ms</span>
      )}
      {hasDetails && (
        <span className="workbench-tool-disclosure" aria-hidden="true">
          <ChevronRight size={14} strokeWidth={1.8} />
        </span>
      )}
      {contextReceipt && <GenerationContextSummary receipt={contextReceipt} />}
    </>
  );
  const commonProps = {
    className: `workbench-tool-event is-${event.status}`,
    'data-testid': 'workbench-tool-event',
    'data-event-id': event.eventId,
    'data-call-id': event.callId,
    'data-tool-name': event.toolName,
    'data-status': event.status,
  };

  if (!hasDetails) return <div {...commonProps}>{summary}</div>;

  return (
    <details {...commonProps} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {expanded && (
        <div className="workbench-tool-detail">
          {contextReceipt && <GenerationContextReceipt receipt={contextReceipt} />}
          {hasArguments && (
            <div>
              <span>输入摘要</span>
              <pre>{JSON.stringify(visibleArguments, null, 2)}</pre>
            </div>
          )}
          {visibleResult !== undefined && (
            <div>
              <span>执行结果</span>
              <pre>
                {typeof visibleResult === 'string'
                  ? visibleResult
                  : JSON.stringify(visibleResult, null, 2)}
              </pre>
            </div>
          )}
          {event.error && <div className="workbench-tool-error">{event.error}</div>}
        </div>
      )}
    </details>
  );
});

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
  valid: '结构与来源校验通过',
  valid_with_warnings: '结构与来源校验通过，含警告',
  invalid: '结构与来源校验未通过',
} as const;

const STRUCTURED_APPLY_TYPES = new Set([
  'outline',
  'character_candidates',
  'event_candidates',
  'setting_candidates',
  'chapter_summary',
]);

function isApplicableContextCompression(artifact: ConversationArtifactCard): boolean {
  if (artifact.artifactType !== 'generic_json') return false;
  if (artifact.artifactEvidence?.derivationType === 'context_compression') return true;
  if (!artifact.content) return false;
  try {
    const candidate = JSON.parse(artifact.content) as unknown;
    return isContextCompressionCandidate(candidate) && candidate.valid;
  } catch {
    return false;
  }
}

function compactHash(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function compactIdentifier(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

/**
 * 候选产物交互卡片（支持采纳、确认入审、申请应用、修改与拒绝）
 */
export const ArtifactCard = memo(function ArtifactCard({
  artifact,
  onDecide,
  onReload,
  busy = false,
}: {
  artifact: ConversationArtifactCard;
  onDecide?: (decision: 'confirm' | 'reject' | 'request_revision' | 'request_apply') => void;
  onReload?: () => void;
  busy?: boolean;
}) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const decision = artifact.latestDecision?.decision;
  const evidence = artifact.artifactEvidence;
  const validationIssues = evidence?.validationIssues ?? [];
  const validationErrors = validationIssues.filter((issue) => issue.severity === 'error').length;
  const validationWarnings = validationIssues.filter(
    (issue) => issue.severity === 'warning',
  ).length;
  const isInvalid = evidence?.processingStatus === 'invalid';
  const isChapter = artifact.artifactType === 'chapter_text';
  const supportsStructuredApply =
    STRUCTURED_APPLY_TYPES.has(artifact.artifactType) || isApplicableContextCompression(artifact);
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
          ? '已确认'
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
  return (
    <article
      className={`workbench-artifact-card ${isChapter ? 'is-chapter' : ''}`}
      data-testid="workbench-artifact-card"
      data-card-id={artifact.cardId}
      data-artifact-id={artifact.artifactId}
      data-run-id={artifact.runId}
      data-status={artifact.status}
      data-decision={decision ?? ''}
    >
      <div className="workbench-artifact-heading">
        <div>
          <div className="workbench-eyebrow">
            {ARTIFACT_LABELS[artifact.artifactType] ?? '创作候选'}
          </div>
          <h3>{artifact.title}</h3>
        </div>
        <span className="workbench-artifact-status">{projectedStatus}</span>
      </div>
      {!isInvalid && <p>{artifact.summary}</p>}
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
          <details className="workbench-artifact-technical-evidence">
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
              {(evidence.sourceDraftVersion !== undefined || evidence.baseContentHash) && (
                <p data-testid="workbench-artifact-baseline">
                  生成时基线：
                  {evidence.sourceDraftVersion !== undefined
                    ? `源草稿 v${evidence.sourceDraftVersion}`
                    : ''}
                  {evidence.sourceDraftVersion !== undefined && evidence.baseContentHash
                    ? ' · '
                    : ''}
                  {evidence.baseContentHash
                    ? `内容哈希 ${compactHash(evidence.baseContentHash)}`
                    : ''}
                </p>
              )}
            </div>
          </details>
        </div>
      )}
      <details onToggle={(event) => setContentExpanded(event.currentTarget.open)}>
        <summary>查看候选内容</summary>
        {contentExpanded &&
          (artifact.contentLoadError ? (
            <div className="workbench-artifact-load-error" role="alert">
              <span>{artifact.contentLoadError}</span>
              {onReload && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onReload}>
                  重新读取
                </button>
              )}
            </div>
          ) : (
            <pre>{artifact.content || '候选内容正在载入。'}</pre>
          ))}
      </details>
      {canAct && (
        <div className="workbench-artifact-actions">
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
                isInvalid
                  ? 'validation-failed'
                  : applyUnavailable
                    ? 'runtime-unsupported'
                    : 'available'
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
          ) : null}
          <button
            className="btn btn-secondary btn-sm"
            data-testid="workbench-artifact-revise"
            disabled={busy}
            onClick={() => onDecide?.('request_revision')}
          >
            要求修改
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
      )}
    </article>
  );
});

export const MemoryInspectorCard = memo(function MemoryInspectorCard({
  sceneName,
  povName,
  versionNumber = 1,
  longTermCount = 0,
  midTermCount = 0,
  shortTermCount = 0,
  retrievedCount = 0,
}: {
  sceneName?: string;
  povName?: string;
  versionNumber?: number;
  longTermCount?: number;
  midTermCount?: number;
  shortTermCount?: number;
  retrievedCount?: number;
}) {
  const totalMemories = longTermCount + midTermCount + shortTermCount + retrievedCount;
  if (totalMemories === 0 && !povName && !sceneName) {
    return (
      <div
        className="workbench-memory-inspector-empty"
        data-testid="workbench-memory-empty"
        style={{
          padding: 16,
          textAlign: 'center',
          color: 'var(--color-text-muted, #64748b)',
          fontSize: 13,
        }}
      >
        No memory context available
      </div>
    );
  }

  return (
    <div
      className="workbench-memory-inspector-card"
      data-testid="workbench-memory-inspector-card"
      style={{
        border: '1px solid var(--color-border-light, #e2e8f0)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--color-bg-card, #ffffff)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong className="workbench-memory-title">
          <Brain aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>Memory Context · v{versionNumber}</span>
        </strong>
        <span style={{ color: 'var(--color-text-muted, #64748b)' }}>{sceneName || '当前分镜'}</span>
      </div>
      <div style={{ color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
        POV: {povName || '默认全知'} · 召回碎片: {retrievedCount} 条
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          fontSize: 11,
          color: 'var(--color-text-muted, #64748b)',
        }}
      >
        <span>长期: {longTermCount}</span>
        <span>中期: {midTermCount}</span>
        <span>短期: {shortTermCount}</span>
      </div>
    </div>
  );
});
