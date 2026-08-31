export function WorkspaceDocumentSkeleton() {
  return (
    <div
      className="workspace-document-skeleton"
      data-testid="workspace-document-loading"
      role="status"
      aria-live="polite"
    >
      <span className="workspace-loading-label">正在加载写作工作台...</span>
      <div className="workspace-skeleton-line is-title" aria-hidden="true" />
      <div className="workspace-skeleton-line is-meta" aria-hidden="true" />
      <div className="workspace-skeleton-paper" aria-hidden="true">
        <div className="workspace-skeleton-line is-paragraph" />
        <div className="workspace-skeleton-line is-paragraph is-short" />
        <div className="workspace-skeleton-line is-paragraph" />
      </div>
    </div>
  );
}
