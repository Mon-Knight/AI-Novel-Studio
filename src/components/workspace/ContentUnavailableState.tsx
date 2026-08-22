import type { DraftContentState } from '../../types/draftContentState';
import { getAppErrorUserMessage } from '../../types/appError';

interface ContentUnavailableStateProps {
  state: Extract<DraftContentState, { status: 'unavailable' }>;
  retrying?: boolean;
  onRetry: () => void;
  onOpenHistory?: () => void;
  onBackToChapters?: () => void;
}

function ContentUnavailableState({
  state,
  retrying = false,
  onRetry,
  onOpenHistory,
  onBackToChapters,
}: ContentUnavailableStateProps) {
  const [title, detail] = state.error
    ? [
        getAppErrorUserMessage(state.error),
        `${state.error.code}${state.error.traceId ? ` · traceId: ${state.error.traceId}` : ''}`,
      ]
    : ['完整正文暂时无法读取。', state.errorCode];

  return (
    <div className="content-unavailable-state" role="alert" data-testid="content-unavailable-state">
      <div className="content-unavailable-icon" aria-hidden="true">
        ⚠️
      </div>
      <div className="content-unavailable-title">正文暂时无法完整读取</div>
      <p>{title}</p>
      <p className="text-muted">
        为避免用截断内容覆盖完整正文，编辑、保存、采用和 AI 正文操作已暂停。
        当前预览仅用于识别草稿，不代表完整正文。
      </p>
      <div className="content-unavailable-actions">
        <button
          className="btn btn-primary btn-sm"
          data-testid="content-unavailable-retry"
          onClick={onRetry}
          disabled={retrying || !state.retryable}
        >
          {retrying ? '正在读取…' : '重新读取正文'}
        </button>
        {onOpenHistory && (
          <button
            className="btn btn-secondary btn-sm"
            data-testid="content-unavailable-history"
            onClick={onOpenHistory}
          >
            打开草稿历史
          </button>
        )}
        {onBackToChapters && (
          <button
            className="btn btn-secondary btn-sm"
            data-testid="content-unavailable-back"
            onClick={onBackToChapters}
          >
            返回章节列表
          </button>
        )}
      </div>
      <details className="content-unavailable-details">
        <summary>查看错误详情</summary>
        <div>{detail}</div>
        {state.expectedHash && <div>期望哈希：{state.expectedHash}</div>}
        {state.actualHash && <div>实际哈希：{state.actualHash}</div>}
      </details>
    </div>
  );
}

export default ContentUnavailableState;
