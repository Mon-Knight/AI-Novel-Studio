import { useMemo, useRef, useState } from 'react';
import type { Chapter } from '../../types/chapter';
import type { CandidateLifecycleContext, CandidateReviewRecord } from '../../types/placement';

interface CandidateReviewPaneProps {
  chapter: Chapter;
  context: CandidateLifecycleContext;
  onAdopt: (record: CandidateReviewRecord) => Promise<void>;
  onClose: () => void;
  onOpenGenerator: () => void;
}

type ReviewTab = 'content' | 'diff';

const DIFF_LABELS = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  unchanged: '未变化',
} as const;

const STATUS_COPY: Record<CandidateLifecycleContext['status'], { className: string; label: string; action: string }> = {
  empty: { className: 'neutral', label: '暂无候选', action: '打开 AI 创作并生成正文。' },
  generating: { className: 'working', label: '正在生成', action: '可以继续阅读正文，生成完成后会自动进入审查。' },
  validating: { className: 'working', label: '正在检查', action: '正在核对约束、差异和采用目标。' },
  ready: { className: 'ready', label: '可以采用', action: '审查全文或差异后采用此候选。' },
  blocked: { className: 'blocked', label: '已被阻断', action: '调整生成设置并重新生成。' },
  baseline_changed: { className: 'warning', label: '正文已变化', action: '差异基于旧基线；请重新生成候选。' },
  adopted: { className: 'neutral', label: '候选已采用', action: '该候选已进入正式正文，无需再次采用。' },
  invalidated: { className: 'blocked', label: '候选已失效', action: '返回目标章节并重新生成。' },
  cancelled: { className: 'neutral', label: '生成已取消', action: '可以保留旧候选或重新生成。' },
  failed: { className: 'blocked', label: '生成失败', action: '检查错误后重试；旧候选不会受影响。' },
  read_failed: { className: 'blocked', label: '候选读取失败', action: '重试读取或重新生成，当前正文未被修改。' },
  diff_failed: { className: 'blocked', label: '差异计算失败', action: '重新生成以建立新的冻结基线。' },
  empty_content: { className: 'blocked', label: '候选正文为空', action: '重新生成正文。' },
  identity_mismatch: { className: 'blocked', label: '候选身份异常', action: '已阻止采用，请重新生成。' },
};

function CandidateReviewPane({ chapter, context, onAdopt, onClose, onOpenGenerator }: CandidateReviewPaneProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>('content');
  const [adopting, setAdopting] = useState(false);
  const adoptLockRef = useRef(false);
  const candidate = context.candidate;
  const statusCopy = context.status === 'ready' && context.constraintStatus === 'passed_with_warnings'
    ? { className: 'warning', label: '需要复核', action: `有 ${candidate?.constraintValidation?.warningCount || 0} 项建议性提醒，仍可采用。` }
    : STATUS_COPY[context.status];

  const visibleIssues = useMemo(() => {
    const validation = candidate?.constraintValidation;
    if (!validation) return [];
    return [...validation.must, ...validation.should, ...validation.forbid]
      .filter((item) => item.status !== 'passed');
  }, [candidate?.constraintValidation]);
  const changedBlocks = useMemo(
    () => candidate?.diff?.blocks.filter((block) => block.kind !== 'unchanged') || [],
    [candidate?.diff],
  );

  const canAdopt = context.canAdopt && !!context.record && !adopting;
  const handleAdopt = async () => {
    if (!canAdopt || !context.record || adoptLockRef.current) return;
    adoptLockRef.current = true;
    setAdopting(true);
    try {
      await onAdopt(context.record);
    } finally {
      adoptLockRef.current = false;
      setAdopting(false);
    }
  };

  return (
    <section className="candidate-review" aria-label="AI 正文候选审查">
      <header className="candidate-review-header">
        <div>
          <div className="candidate-review-kicker">AI 正文候选</div>
          <h2>第{chapter.chapterNumber}章：{chapter.title}</h2>
          <div className="candidate-review-meta">
            {candidate && <span>{candidate.wordCount.toLocaleString()} 字</span>}
            {candidate?.diff?.summary && <span>基于草稿 v{candidate.diff.summary.baseDraftVersion}</span>}
            {context.candidateId && <span>候选 {context.candidateId.slice(0, 8)}</span>}
          </div>
        </div>
        <div className={`candidate-review-status ${statusCopy.className}`} role="status">
          <strong>{statusCopy.label}</strong>
          <span>{context.cannotAdoptReason || statusCopy.action}</span>
        </div>
      </header>

      {context.generation && context.record && ['generating', 'validating', 'failed', 'cancelled'].includes(context.generation.status) && (
        <div className={`candidate-review-activity ${context.generation.status}`}>
          <strong>{context.generation.status === 'generating' ? '新候选正在生成'
            : context.generation.status === 'validating' ? '新候选正在检查'
              : context.generation.status === 'failed' ? '新候选生成失败' : '新候选生成已取消'}</strong>
          <span>{context.generation.message || '当前候选仍保持原状态。'}</span>
        </div>
      )}

      {candidate ? (
        <>
          <div className="candidate-review-tabs" role="tablist" aria-label="候选审查视图">
            <button type="button" role="tab" aria-selected={activeTab === 'content'} className={activeTab === 'content' ? 'active' : ''} onClick={() => setActiveTab('content')}>
              候选全文
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'diff'} className={activeTab === 'diff' ? 'active' : ''} onClick={() => setActiveTab('diff')} disabled={!candidate.diff?.summary}>
              正文差异
            </button>
          </div>

          <div className="candidate-review-body">
            {context.baselineChanged && (
              <div className="candidate-baseline-warning" role="alert">
                <strong>正文已变化</strong>
                <span>下方差异仍对应生成时的草稿 v{context.baseDraftVersion}，不会覆盖当前正文。</span>
              </div>
            )}
            {activeTab === 'content' ? (
              <article className="candidate-review-paper">{candidate.content || '候选正文为空。'}</article>
            ) : (
              <div className="candidate-diff-list">
                {candidate.diff?.summary && (
                  <>
                    <div className="candidate-diff-baseline">冻结基线：草稿 v{candidate.diff.summary.baseDraftVersion} · {candidate.diff.summary.baseContentHash.slice(0, 12)}</div>
                    <div className="candidate-diff-summary">
                      <span>新增 {candidate.diff.summary.addedBlocks}</span>
                      <span>删除 {candidate.diff.summary.removedBlocks}</span>
                      <span>修改 {candidate.diff.summary.modifiedBlocks}</span>
                      <span>未变化 {candidate.diff.summary.unchangedBlocks}</span>
                    </div>
                  </>
                )}
                {changedBlocks.map((block, index) => (
                  <div className={`candidate-diff-block ${block.kind}`} key={`${block.kind}-${block.baseIndex}-${block.candidateIndex}-${index}`}>
                    <strong>{DIFF_LABELS[block.kind]}</strong>
                    {block.baseText !== undefined && <div className="candidate-diff-before"><span>原稿</span>{block.baseText}</div>}
                    {block.candidateText !== undefined && <div className="candidate-diff-after"><span>候选</span>{block.candidateText}</div>}
                  </div>
                ))}
                {candidate.diff?.status !== 'ready' && <div className="candidate-review-empty">{candidate.diff?.reason || '当前差异不可用。'}</div>}
              </div>
            )}

            {visibleIssues.length > 0 && (
              <details className="candidate-review-issues">
                <summary>查看约束提醒（{visibleIssues.length}）</summary>
                <ul>{visibleIssues.map((item) => <li key={`${item.severity}-${item.constraintId}`}>{item.message}</li>)}</ul>
              </details>
            )}
          </div>
        </>
      ) : (
        <div className="candidate-review-body candidate-review-state">
          <strong>{statusCopy.label}</strong>
          <p>{context.cannotAdoptReason || statusCopy.action}</p>
        </div>
      )}

      <footer className="candidate-review-actions">
        <div className="candidate-review-action-note">{context.canAdopt ? '采用前不会修改当前正式正文' : context.cannotAdoptReason}</div>
        <button type="button" className="btn btn-secondary" onClick={onClose}>返回当前正文</button>
        <button type="button" className="btn btn-secondary" onClick={onOpenGenerator}>{context.status === 'read_failed' ? '重试并打开生成器' : '调整生成设置'}</button>
        {candidate && (
          <button type="button" className="btn btn-primary" onClick={() => void handleAdopt()} disabled={!canAdopt} title={!canAdopt ? context.cannotAdoptReason : undefined}>
            {adopting ? '正在采用…' : `采用此候选（${candidate.wordCount.toLocaleString()} 字）`}
          </button>
        )}
      </footer>
    </section>
  );
}

export default CandidateReviewPane;
