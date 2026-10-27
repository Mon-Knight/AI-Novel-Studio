import { CircleAlert, LoaderCircle, RefreshCw, Square, X } from 'lucide-react';
import ChapterSummaryDialog from '../../components/chapter-summary/ChapterSummaryDialog';
import type { useWorkspaceSummary } from '../../features/workspace/useWorkspaceSummary';

export function WorkspaceSummaryDialogs({
  summary,
  chapterTitle,
}: {
  summary: ReturnType<typeof useWorkspaceSummary>;
  chapterTitle: string;
}) {
  return (
    <>
      {summary.dialogOpen && summary.result && (
        <ChapterSummaryDialog
          result={summary.result}
          chapterTitle={chapterTitle}
          loading={summary.loading}
          error={summary.error}
          onClose={() => {
            summary.setDialogOpen(false);
            summary.setResult(null);
            summary.setError('');
          }}
          onConfirm={summary.save}
          onRegenerate={summary.regenerate}
        />
      )}
      {summary.loading && !summary.result && (
        <>
          <div className="right-panel-overlay" onClick={summary.stop} />
          <div className="right-panel workspace-summary-panel">
            <div className="right-panel-header">
              <span className="right-panel-title">
                <LoaderCircle
                  className="workspace-spinning-icon"
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.8}
                />
                <span>生成章节总结</span>
              </span>
              <button
                className="right-panel-close"
                onClick={summary.stop}
                aria-label="停止生成"
                title="停止生成"
              >
                <Square aria-hidden="true" size={13} strokeWidth={1.8} />
              </button>
            </div>
            <div className="right-panel-body">
              <div className="workspace-summary-state">
                AI 正在分析已采用正文，提取关键信息……
                <button className="btn btn-secondary workspace-summary-stop" onClick={summary.stop}>
                  停止总结
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {summary.error && !summary.dialogOpen && (
        <>
          <div className="right-panel-overlay" onClick={() => summary.setError('')} />
          <div className="right-panel workspace-summary-panel">
            <div className="right-panel-header">
              <span className="right-panel-title">
                <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
                <span>总结失败</span>
              </span>
              <button
                className="right-panel-close"
                onClick={() => summary.setError('')}
                aria-label="关闭错误"
                title="关闭"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </div>
            <div className="right-panel-body">
              <div className="workspace-summary-error">{summary.error}</div>
              <div className="workspace-summary-actions">
                <button className="btn btn-primary btn-sm" onClick={summary.regenerate}>
                  <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>重试</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
