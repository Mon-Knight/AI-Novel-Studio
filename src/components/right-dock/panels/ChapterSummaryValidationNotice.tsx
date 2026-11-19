import type { ChapterSummaryValidation } from '../../../types/chapterSummary';
import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react';
import { evaluateSummaryApplicationPolicy } from '../../../services/ai/summaryApplicationPolicy';

type ValidationTone = 'passed' | 'review' | 'warning' | 'failed';

function validationTone(validation: ChapterSummaryValidation): ValidationTone {
  const policy = evaluateSummaryApplicationPolicy(validation);
  if (policy.blocking || policy.stopReason === 'SUMMARY_VALIDATION_INVALID') return 'failed';
  if (!policy.eligible) return 'review';
  return policy.legacyManualReview ? 'warning' : 'passed';
}

export function ChapterSummaryValidationNotice({
  validation,
}: {
  validation: ChapterSummaryValidation;
}) {
  const tone = validationTone(validation);
  const policy = evaluateSummaryApplicationPolicy(validation);
  const advisories = validation.advisories ?? [];
  const label =
    tone === 'passed'
      ? '结构与依据检查通过 · 语义未自动核验'
      : tone === 'review'
        ? '结构检查无阻断错误 · 应用条件未满足'
        : tone === 'warning'
          ? '作者已审阅 · 语义未自动核验'
          : '存在阻断性校验错误';
  const color =
    tone === 'passed'
      ? 'var(--color-success)'
      : tone === 'failed'
        ? 'var(--color-error)'
        : 'var(--color-warning-text)';
  const background =
    tone === 'passed'
      ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
      : tone === 'failed'
        ? 'color-mix(in srgb, var(--color-error) 6%, transparent)'
        : 'color-mix(in srgb, var(--color-warning) 6%, transparent)';
  const border =
    tone === 'passed'
      ? 'color-mix(in srgb, var(--color-success) 25%, transparent)'
      : tone === 'failed'
        ? 'color-mix(in srgb, var(--color-error) 25%, transparent)'
        : 'color-mix(in srgb, var(--color-warning) 25%, transparent)';

  return (
    <div
      data-testid="chapter-summary-validation-notice"
      style={{
        fontSize: 12,
        padding: '6px 8px',
        borderRadius: 4,
        marginBottom: 8,
        background,
        border: `1px solid ${border}`,
      }}
    >
      <div className="panel-inline-status" style={{ fontWeight: 600, color }}>
        {tone === 'passed' ? (
          <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
        ) : tone === 'failed' ? (
          <CircleX aria-hidden="true" size={14} strokeWidth={1.8} />
        ) : (
          <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
        )}
        <span>
          {label}（{validation.score} 分）
          {validation.passed && advisories.length > 0 ? ' · 有审阅提示' : ''}
        </span>
      </div>
      {validation.problems.map((problem, index) => (
        <div key={`problem:${index}`} style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
          • {problem.message}
        </div>
      ))}
      {advisories.map((advisory, index) => (
        <div
          key={`advisory:${advisory.code}:${advisory.path}:${index}`}
          data-testid="chapter-summary-validation-advisory"
          style={{ color: 'var(--color-warning-text)', marginTop: 2 }}
        >
          • 审阅提示：{advisory.message}
        </div>
      ))}
      {!policy.eligible && (
        <div role="status" style={{ color: 'var(--color-error)', marginTop: 4, fontWeight: 500 }}>
          {policy.humanReviewRequired
            ? '此总结需要作者完成具体审阅，任务预授权不能代替；当前不会启用为上下文。'
            : policy.blocking
              ? '存在阻断性错误，保存后不会启用为上下文或更新人物状态；请修正或重新生成后重新校验。'
              : '应用条件未满足，保存后不会启用为上下文；请核对证据或重新生成。'}
        </div>
      )}
    </div>
  );
}

export function ChapterSummaryAdvisoryList({
  validation,
}: {
  validation?: ChapterSummaryValidation;
}) {
  const advisories = validation?.advisories ?? [];
  if (advisories.length === 0) return null;
  return (
    <div className="panel-section" data-testid="chapter-summary-advisories">
      <div className="panel-section-title panel-section-title--icon">
        <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>审阅提示</span>
      </div>
      {advisories.map((advisory, index) => (
        <div
          key={`${advisory.code}:${advisory.path}:${index}`}
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--color-warning-text)',
            padding: '3px 0',
          }}
        >
          • {advisory.message}
        </div>
      ))}
    </div>
  );
}
