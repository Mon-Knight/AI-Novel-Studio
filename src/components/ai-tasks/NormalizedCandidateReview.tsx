import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NormalizedCandidate, NormalizedCandidateChange } from '../../types/normalizedCandidate';
import '../../styles/normalized-candidate-review.css';

export type CandidateReviewTone = 'ready' | 'warning' | 'blocked' | 'working' | 'neutral';

export interface CandidateReviewStatus {
  label: string;
  message: string;
  tone: CandidateReviewTone;
}

interface NormalizedCandidateReviewProps {
  eyebrow?: string;
  title: string;
  metadata?: string[];
  candidate: NormalizedCandidate;
  status: CandidateReviewStatus;
  constraintIssues?: string[];
  technicalDetails?: Array<{ label: string; value?: string }>;
  canAdopt: boolean;
  cannotAdoptReason?: string;
  adopting?: boolean;
  onDiscard: () => void;
  onRegenerate?: () => void;
  onAdopt?: () => void;
  extraAction?: ReactNode;
  adoptLabel?: string;
}

function candidateParagraphs(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n?/g, '\n').split(/\n{2,}/u);
}

function scrollToElement(element: Element | null | undefined): void {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function NormalizedCandidateReview({
  eyebrow = 'AI 修订候选',
  title,
  metadata = [],
  candidate,
  status,
  constraintIssues = [],
  technicalDetails = [],
  canAdopt,
  cannotAdoptReason,
  adopting = false,
  onDiscard,
  onRegenerate,
  onAdopt,
  extraAction,
  adoptLabel = '审查并采用',
}: NormalizedCandidateReviewProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'diff'>('content');
  const [activeChangeIndex, setActiveChangeIndex] = useState(0);
  const [highlightedParagraph, setHighlightedParagraph] = useState<number | undefined>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const changeRefs = useRef<Array<HTMLElement | null>>([]);
  const paragraphs = useMemo(() => candidateParagraphs(candidate.fullText), [candidate.fullText]);
  const changes = candidate.changes;

  useEffect(() => {
    if (activeChangeIndex >= changes.length) setActiveChangeIndex(Math.max(0, changes.length - 1));
  }, [activeChangeIndex, changes.length]);

  useEffect(() => {
    if (activeTab !== 'content' || highlightedParagraph === undefined) return;
    scrollToElement(paragraphRefs.current[highlightedParagraph]);
  }, [activeTab, highlightedParagraph]);

  const selectChange = (index: number) => {
    const safeIndex = Math.min(Math.max(index, 0), changes.length - 1);
    setActiveChangeIndex(safeIndex);
    scrollToElement(changeRefs.current[safeIndex]);
  };

  const locateChange = (change: NormalizedCandidateChange) => {
    setHighlightedParagraph(change.candidateParagraphIndex);
    setActiveTab('content');
  };

  const openDiff = () => {
    if (changes.length === 0) return;
    setActiveTab('diff');
    requestAnimationFrame(() => scrollToElement(changeRefs.current[activeChangeIndex]));
  };

  return (
    <div className="normalized-candidate-review">
      <header className="normalized-candidate-header">
        <div className="normalized-candidate-heading">
          <div className="normalized-candidate-eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          {metadata.length > 0 && <div className="normalized-candidate-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>}
        </div>
        <div className={`normalized-candidate-status tone-${status.tone}`} role="status">
          <strong>{status.label}</strong>
          <span>{status.message}</span>
        </div>
      </header>

      {candidate.revisionSummary && candidate.status === 'ready' && (
        <section className="normalized-candidate-summary" aria-label="本次修改摘要">
          <strong>本次修改摘要</strong>
          <p>{candidate.revisionSummary}</p>
        </section>
      )}

      <nav className="normalized-candidate-tabs" role="tablist" aria-label="候选审查视图">
        <button type="button" role="tab" aria-selected={activeTab === 'content'} className={activeTab === 'content' ? 'active' : ''} onClick={() => setActiveTab('content')}>
          候选全文
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'diff'} className={activeTab === 'diff' ? 'active' : ''} onClick={openDiff} disabled={changes.length === 0}>
          正文差异{changes.length > 0 ? <span aria-hidden="true">（{changes.length}）</span> : null}
        </button>
      </nav>

      <div className="normalized-candidate-scroll">
        {candidate.status !== 'ready' ? (
          <div className="normalized-candidate-format-error" role="alert">
            <strong>候选格式异常</strong>
            <p>{candidate.error || '无法从 AI 响应中重建完整章节正文。'}</p>
            <span>原始响应已保留在下方“高级工程 / 技术详情”中，当前候选禁止采用。</span>
          </div>
        ) : activeTab === 'content' ? (
          <article className="normalized-candidate-paper" data-testid="candidate-full-text">
            {paragraphs.map((paragraph, index) => (
              <p
                className={highlightedParagraph === index ? 'located' : undefined}
                key={`paragraph-${index}`}
                ref={(node) => { paragraphRefs.current[index] = node; }}
              >
                {paragraph || '\u00a0'}
              </p>
            ))}
          </article>
        ) : (
          <section className="normalized-candidate-diffs" aria-label="逐项正文差异">
            <header className="normalized-candidate-diff-nav">
              <div>
                <strong>逐项查看修改</strong>
                <span>{changes.length > 0 ? `第 ${activeChangeIndex + 1} / ${changes.length} 处` : '没有可展示的修改'}</span>
              </div>
              <div>
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => selectChange(activeChangeIndex - 1)} disabled={activeChangeIndex <= 0}>上一处</button>
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => selectChange(activeChangeIndex + 1)} disabled={activeChangeIndex >= changes.length - 1}>下一处</button>
              </div>
            </header>
            {changes.map((change, index) => (
              <article
                className={`normalized-candidate-diff-card${index === activeChangeIndex ? ' active' : ''}`}
                key={change.id}
                ref={(node) => { changeRefs.current[index] = node; }}
                onClick={() => setActiveChangeIndex(index)}
              >
                <header>
                  <strong>修改 {index + 1}</strong>
                  {change.candidateParagraphIndex !== undefined && (
                    <button type="button" className="btn btn-text btn-xs" onClick={(event) => { event.stopPropagation(); locateChange(change); }}>
                      定位到候选正文
                    </button>
                  )}
                </header>
                {change.summary && <p className="normalized-candidate-change-summary">{change.summary}</p>}
                <div className="normalized-candidate-comparison">
                  <div className="before"><span>原文</span><p>{change.originalText || '（无）'}</p></div>
                  <div className="after"><span>修改后</span><p>{change.revisedText || '（已删除）'}</p></div>
                </div>
              </article>
            ))}
          </section>
        )}

        {constraintIssues.length > 0 && (
          <details className="normalized-candidate-issues">
            <summary>检查提醒（{constraintIssues.length}）</summary>
            <ul>{constraintIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>
          </details>
        )}

        <details
          className="normalized-candidate-advanced"
          open={advancedOpen}
        >
          <summary onClick={(event) => { event.preventDefault(); setAdvancedOpen((open) => !open); }}>
            高级工程 / 技术详情
          </summary>
          {advancedOpen && (
            <>
              <div className="normalized-candidate-audit">
                {technicalDetails.filter((item) => item.value).map((item) => (
                  <div key={item.label}><span>{item.label}</span><code>{item.value}</code></div>
                ))}
              </div>
              <strong>原始 AI 响应</strong>
              <pre data-testid="candidate-raw-response">{candidate.rawResponse || '（无原始响应）'}</pre>
            </>
          )}
        </details>
      </div>

      <footer className="normalized-candidate-actions">
        <div className="normalized-candidate-action-reason">
          {canAdopt ? '确认采用前，不会修改当前正式正文。' : cannotAdoptReason || candidate.error || '当前候选不可采用。'}
        </div>
        <button type="button" className="btn btn-text" onClick={onDiscard}>放弃候选</button>
        <button type="button" className="btn btn-secondary" onClick={onRegenerate} disabled={!onRegenerate}>重新生成</button>
        <button type="button" className="btn btn-secondary" onClick={openDiff} disabled={changes.length === 0}>查看差异</button>
        {extraAction}
        <button type="button" className="btn btn-primary" onClick={onAdopt} disabled={!canAdopt || !onAdopt || adopting} title={!canAdopt ? cannotAdoptReason : undefined}>
          {adopting ? '正在采用…' : adoptLabel}
        </button>
      </footer>
    </div>
  );
}

export default NormalizedCandidateReview;
