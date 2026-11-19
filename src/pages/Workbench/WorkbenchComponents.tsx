import { memo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleAlert, CircleDashed, LoaderCircle } from 'lucide-react';
import type { ToolCallEvent } from '../../types/conversation';
import { GenerationContextReceipt, GenerationContextSummary } from './WorkbenchContextReceipt';
import {
  hideContextReceiptInternals,
  resolveToolContextReceipt,
} from './workbenchContextReceiptModel';
import { TOOL_LABELS, statusLabel } from './workbenchHelpers';

export { MemoryInspectorCard } from './WorkbenchMemoryInspectorCard';
export { ArtifactCard } from './ArtifactCard';
export type { ArtifactCardProps } from './ArtifactCard';

function ToolStatusIcon({ status }: { status: ToolCallEvent['status'] }) {
  if (status === 'succeeded')
    return <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />;
  if (status === 'failed') return <CircleAlert aria-hidden="true" size={14} strokeWidth={1.8} />;
  if (status === 'running') return <LoaderCircle aria-hidden="true" size={14} strokeWidth={1.8} />;
  return <CircleDashed aria-hidden="true" size={14} strokeWidth={1.8} />;
}

const WRITER_PROGRESS_LABELS: Record<string, string> = {
  compiling_context: '整理创作上下文',
  generating_draft: '生成章节初稿',
  repairing_length: '收敛章节长度',
  repairing_integrity: '修复正文完整性',
  validating_candidate: '校验章节候选',
};

function formatProgressNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function resolveWriterProgressLabel(event: ToolCallEvent): string | undefined {
  if (
    event.status !== 'running' ||
    !['generate_chapter', 'polish_chapter'].includes(event.toolName)
  ) {
    return undefined;
  }
  if (!event.result || typeof event.result !== 'object' || Array.isArray(event.result)) {
    return undefined;
  }
  const progress = event.result as Record<string, unknown>;
  const phase =
    typeof progress.phase === 'string' ? WRITER_PROGRESS_LABELS[progress.phase] : undefined;
  if (!phase) return undefined;

  const parts = [phase];
  if (
    typeof progress.repairAttempt === 'number' &&
    Number.isSafeInteger(progress.repairAttempt) &&
    typeof progress.repairMaximumAttempts === 'number' &&
    Number.isSafeInteger(progress.repairMaximumAttempts)
  ) {
    parts.push(`${progress.repairAttempt}/${progress.repairMaximumAttempts}`);
  }
  if (
    typeof progress.currentWordCount === 'number' &&
    Number.isSafeInteger(progress.currentWordCount)
  ) {
    parts.push(`${formatProgressNumber(progress.currentWordCount)} 字`);
  }
  const range = progress.acceptedWordRange;
  if (range && typeof range === 'object' && !Array.isArray(range)) {
    const { minimum, maximum } = range as Record<string, unknown>;
    if (
      typeof minimum === 'number' &&
      Number.isSafeInteger(minimum) &&
      typeof maximum === 'number' &&
      Number.isSafeInteger(maximum)
    ) {
      parts.push(`允许 ${formatProgressNumber(minimum)}-${formatProgressNumber(maximum)} 字`);
    }
  }
  return parts.join(' · ');
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
  const writerProgressLabel = resolveWriterProgressLabel(event);
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
      <span
        className={`workbench-tool-status${writerProgressLabel ? ' has-progress' : ''}`}
        data-testid={writerProgressLabel ? 'workbench-writer-progress' : undefined}
      >
        {writerProgressLabel ??
          (event.status === 'succeeded' ? '已完成' : statusLabel(event.status))}
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
    <details
      {...commonProps}
      data-disclosure-key={`tool:${event.eventId}`}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
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
