import { memo } from 'react';
import { Brain, CheckCircle2, ClipboardCheck, TriangleAlert } from 'lucide-react';
import type { AgentDecisionTrace, AgentQualityReview } from '../../types/agentHarness';

export interface DecisionTraceProps {
  decisionTraces?: AgentDecisionTrace[];
  qualityReviews?: AgentQualityReview[];
}

export const DecisionTraceCard = memo(function DecisionTraceCard({
  trace,
}: {
  trace: AgentDecisionTrace;
}) {
  return (
    <div
      className="agent-decision-trace-card"
      data-testid="agent-decision-trace-card"
      style={{
        border: '1px solid #c7d2fe',
        borderRadius: 8,
        padding: '12px 14px',
        background: '#f5f3ff',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
            color: '#4338ca',
          }}
        >
          <Brain aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>Agent Decision (第 {trace.turn} 轮)</span>
        </div>
        {typeof trace.confidenceScore === 'number' && (
          <span
            data-testid="decision-confidence-badge"
            style={{
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 11,
              background: '#ede9fe',
              color: '#6d28d9',
              fontWeight: 600,
            }}
          >
            置信度:{' '}
            {Math.round(
              trace.confidenceScore <= 1 ? trace.confidenceScore * 100 : trace.confidenceScore,
            )}
            %
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#334155' }}>
        <div>
          <strong style={{ color: '#475569' }}>目标: </strong>
          <span>{trace.goal}</span>
        </div>
        {trace.selectedTool && (
          <div>
            <strong style={{ color: '#475569' }}>当前选择: </strong>
            <code
              style={{
                background: '#e0e7ff',
                padding: '1px 4px',
                borderRadius: 3,
                color: '#3730a3',
              }}
            >
              {trace.selectedTool}
            </code>
          </div>
        )}
        {trace.selectedToolReason && (
          <div>
            <strong style={{ color: '#475569' }}>原因: </strong>
            <span>{trace.selectedToolReason}</span>
          </div>
        )}
        {trace.expectedOutcome && (
          <div>
            <strong style={{ color: '#475569' }}>预期产出: </strong>
            <span>{trace.expectedOutcome}</span>
          </div>
        )}
        {trace.nextAdjustment && (
          <div style={{ marginTop: 2, color: '#6366f1', fontSize: 11 }}>
            <strong>下一步调整: </strong>
            <span>{trace.nextAdjustment}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export const QualityReviewCard = memo(function QualityReviewCard({
  review,
}: {
  review: AgentQualityReview;
}) {
  return (
    <div
      className="agent-quality-review-card"
      data-testid="agent-quality-review-card"
      style={{
        border: '1px solid #fed7aa',
        borderRadius: 8,
        padding: '12px 14px',
        background: '#fffbeb',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
            color: '#c2410c',
          }}
        >
          <ClipboardCheck aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>Quality Review 质量审查</span>
        </div>
        <span
          data-testid="agent-quality-overall-badge"
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 4,
            background: review.passed ? '#dcfce7' : '#fee2e2',
            color: review.passed ? '#15803d' : '#b91c1c',
            border: `1px solid ${review.passed ? '#86efac' : '#fca5a5'}`,
          }}
        >
          最终: {review.overallScore}/100{' '}
          {review.passed ? (
            <>
              <CheckCircle2 aria-hidden="true" size={12} strokeWidth={1.8} /> 达标
            </>
          ) : (
            <>
              <TriangleAlert aria-hidden="true" size={12} strokeWidth={1.8} /> 需重写
            </>
          )}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            padding: '6px',
            background: '#ffffff',
            borderRadius: 4,
            border: '1px solid #fef3c7',
          }}
        >
          <div style={{ color: '#9a3412', fontSize: 11 }}>人物一致性</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#431407' }}>
            {review.characterConsistency}
          </div>
        </div>
        <div
          style={{
            padding: '6px',
            background: '#ffffff',
            borderRadius: 4,
            border: '1px solid #fef3c7',
          }}
        >
          <div style={{ color: '#9a3412', fontSize: 11 }}>剧情推进</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#431407' }}>
            {review.plotProgression}
          </div>
        </div>
        <div
          style={{
            padding: '6px',
            background: '#ffffff',
            borderRadius: 4,
            border: '1px solid #fef3c7',
          }}
        >
          <div style={{ color: '#9a3412', fontSize: 11 }}>文风匹配</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#431407' }}>{review.styleMatch}</div>
        </div>
        <div
          style={{
            padding: '6px',
            background: '#ffffff',
            borderRadius: 4,
            border: '1px solid #fef3c7',
          }}
        >
          <div style={{ color: '#9a3412', fontSize: 11 }}>连贯性</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#431407' }}>{review.coherence}</div>
        </div>
      </div>

      {review.suggestions.length > 0 && (
        <div style={{ color: '#78350f', fontSize: 11 }}>
          <span style={{ fontWeight: 600 }}>建议: </span>
          {review.suggestions.join('; ')}
        </div>
      )}
    </div>
  );
});

export const DecisionTrace = memo(function DecisionTrace({
  decisionTraces,
  qualityReviews,
}: DecisionTraceProps) {
  const hasTraces = decisionTraces && decisionTraces.length > 0;
  const hasReviews = qualityReviews && qualityReviews.length > 0;

  if (!hasTraces && !hasReviews) return null;

  return (
    <div
      className="agent-decision-trace-wrapper"
      data-testid="agent-decision-trace-wrapper"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '8px 0' }}
    >
      {hasTraces && (
        <div
          className="agent-decision-traces-section"
          data-testid="agent-decision-traces-section"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {decisionTraces.map((trace, idx) => (
            <DecisionTraceCard key={trace.id || `trace-${idx}`} trace={trace} />
          ))}
        </div>
      )}

      {hasReviews && (
        <div
          className="agent-quality-reviews-section"
          data-testid="agent-quality-reviews-section"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {qualityReviews.map((review, idx) => (
            <QualityReviewCard key={review.id || `review-${idx}`} review={review} />
          ))}
        </div>
      )}
    </div>
  );
});
