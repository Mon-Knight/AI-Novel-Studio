import { ArrowLeft, ClipboardList, RefreshCw } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import { useChapterSummaryWorkflow } from '../../features/workspace/useChapterSummaryWorkflow';
import { ChapterSummaryDetails } from './ChapterSummaryDetails';

interface Props {
  novelId?: string;
  chapter?: Chapter;
  authorizationId?: string;
  compact?: boolean;
  returnOnly?: boolean;
  onBeforeNavigate?: () => boolean | Promise<boolean>;
}

const LABELS = {
  unadopted: '正文尚未采用',
  missing: '正文已采用 · 总结待生成',
  generating: '正文已采用 · 总结生成中',
  awaiting_apply: '正文已采用 · 总结待审阅应用',
  rejected: '正文已采用 · 总结需重做',
  failed: '正文已采用 · 总结未完成',
  applied: '正文已采用 · 总结已应用',
  disabled: '正文已采用 · 总结已停用',
  expired: '正文已采用 · 总结已过期',
};

/** Navigation only: summary generation and adoption stay in the governed conversation. */
export function ChapterSummaryWorkflowNotice({
  novelId,
  chapter,
  authorizationId,
  compact,
  returnOnly,
  onBeforeNavigate,
}: Props) {
  const workflow = useChapterSummaryWorkflow(novelId, chapter, authorizationId);
  const { state, loading, error } = workflow;
  const contextAvailable =
    state?.summary?.enabled &&
    !state.summary.isExpired &&
    state.summary.adoptedDraftId === state.chapter.adoptedDraftId;
  const open = async (redo = false) => {
    if (onBeforeNavigate && !(await onBeforeNavigate())) return;
    workflow.open(redo, returnOnly);
  };
  if (!chapter) return null;
  if (returnOnly)
    return (
      <button
        type="button"
        className="back-button"
        disabled={loading}
        title={error || '返回本章来源会话'}
        onClick={() => (error ? void workflow.refresh() : void open())}
      >
        <ArrowLeft aria-hidden="true" size={15} />
        <span>{error ? '重新定位来源任务' : '返回本章任务'}</span>
      </button>
    );
  return (
    <section
      className="chapter-summary-workflow"
      data-testid="chapter-summary-workflow"
      style={{ padding: compact ? '8px 16px' : 16 }}
      aria-label="章节采用与总结状态"
    >
      {loading && <span role="status">正在读取本章总结状态…</span>}
      {error && <p role="alert">{error}</p>}
      {state && (
        <>
          <p role="status" data-testid="chapter-summary-workflow-state">
            {LABELS[state.phase]}
          </p>
          {!compact && state.model && (
            <p>
              {state.actualModel ? '本次总结实际模型' : '来源会话后续模型'}：{state.model.modelId}
              <br />
              <small>
                {state.model.providerId} · {state.conversationTitle}
              </small>
            </p>
          )}
          {!compact && state.summary && <ChapterSummaryDetails summary={state.summary} />}
          {!compact &&
            state.summary &&
            (state.summary.isExpired ||
              state.summary.adoptedDraftId !== state.chapter.adoptedDraftId) && (
              <p role="status">此总结已过期，不能作为当前采用稿的正式上下文。</p>
            )}
          {!compact && state.phase !== 'applied' && state.phase !== 'unadopted' && (
            <p>
              {contextAvailable
                ? '已应用的总结仍可用；本次新候选需审阅应用后才会更新正式上下文。'
                : '本章尚无启用且有效的总结上下文。后续章节可以继续处理，需保留此处的停用或待处理状态。'}
            </p>
          )}
          {state.archived && <p>来源会话已归档，请在会话中恢复后再重新生成。</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => void open()}
              data-testid="chapter-summary-open-source"
            >
              {state.phase === 'unadopted' ? (
                <ArrowLeft aria-hidden="true" size={14} />
              ) : (
                <ClipboardList aria-hidden="true" size={14} />
              )}
              {state.phase === 'unadopted'
                ? '返回来源任务'
                : state.conversationId
                  ? '查看本章总结'
                  : '在创作会话中总结'}
            </button>
            {['rejected', 'failed', 'applied', 'disabled', 'expired'].includes(state.phase) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading || state.archived}
                onClick={() => void open(true)}
                data-testid="chapter-summary-redo"
              >
                重新总结本章
              </button>
            )}
            {!compact && state.summary && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={
                  loading ||
                  Boolean(
                    !state.summary.enabled &&
                    (state.summary.isExpired ||
                      state.summary.adoptedDraftId !== state.chapter.adoptedDraftId),
                  )
                }
                onClick={() => void workflow.toggleSummary()}
              >
                {state.summary.enabled ? '停用此总结' : '启用此总结'}
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void workflow.refresh()}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" size={14} />
          重新读取
        </button>
      )}
    </section>
  );
}
