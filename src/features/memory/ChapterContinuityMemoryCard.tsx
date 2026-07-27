import { useChapterContinuityMemory } from './useChapterContinuityMemory';

export interface ChapterContinuityMemoryCardProps {
  novelId?: string;
  chapterId?: string;
}

export function ChapterContinuityMemoryCard({
  novelId,
  chapterId,
}: ChapterContinuityMemoryCardProps) {
  const memory = useChapterContinuityMemory(novelId, chapterId);
  const snapshot = memory.bundle?.snapshot;
  const verificationLabel = memory.verification
    ? memory.verification.valid ? '来源一致' : `来源漂移 ${memory.verification.drift.length} 项`
    : '尚未复验';

  return (
    <section
      className="agent-plan-card memory-card"
      data-testid="chapter-continuity-memory"
      data-memory-status={snapshot ? 'ready' : 'none'}
      data-memory-snapshot-id={snapshot?.snapshotId ?? ''}
      data-memory-valid={memory.verification ? String(memory.verification.valid) : 'unknown'}
    >
      <div className="agent-plan-card__header">
        <div>
          <div className="agent-plan-card__title">章节连续性记忆</div>
          <div className="agent-plan-card__subtitle">SQLite 快照 · 本地编译 · 不调用 AI</div>
        </div>
        {snapshot && <span className="agent-plan-status agent-plan-status--completed">已冻结</span>}
      </div>

      {!memory.available && (
        <div className="agent-plan-card__notice">
          浏览器开发模式不创建模拟 Memory；请在桌面应用中使用。
        </div>
      )}
      {memory.loading && !snapshot && (
        <div className="agent-plan-card__notice">正在读取记忆快照…</div>
      )}

      {snapshot && (
        <div className="memory-card__summary">
          <div>
            <span>纳入 {snapshot.includedCount}</span>
            <span>预算省略 {snapshot.omittedCount}</span>
            <span>{(snapshot.memoryBytes / 1024).toFixed(1)} KiB</span>
          </div>
          <div className={memory.verification?.valid === false ? 'is-drifted' : ''}>
            {verificationLabel}
          </div>
        </div>
      )}

      {memory.error && <div className="agent-plan-card__error" role="alert">{memory.error}</div>}

      {memory.available && (
        <div className="agent-plan-card__actions">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => void memory.create()}
            disabled={memory.loading || memory.creating || !novelId || !chapterId}
            data-testid="chapter-memory-create"
          >
            {memory.creating ? '编译中…' : snapshot ? '创建新快照' : '编译记忆快照'}
          </button>
          {snapshot && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void memory.verify()}
              disabled={memory.verifying}
              data-testid="chapter-memory-verify"
            >
              {memory.verifying ? '复验中…' : '复验来源'}
            </button>
          )}
          {snapshot && !memory.creating && !memory.verifying && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void memory.reload()}
            >
              刷新
            </button>
          )}
        </div>
      )}
    </section>
  );
}

