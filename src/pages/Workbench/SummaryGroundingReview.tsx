import type { ConversationArtifactCard } from '../../types/conversation';
import {
  SUMMARY_STATUS_LABELS,
  summaryClaimViews,
  summaryGroundingPayload,
} from '../../services/ai/chapterSummaryGrounding';

interface Props {
  artifact: ConversationArtifactCard;
  disabled?: boolean;
  onRedo?: (notes: string) => void;
}

function sourceLocations(
  artifact: ConversationArtifactCard,
  path: string,
): Array<{ quote: string; line: number; context?: string }> {
  const report = artifact.artifactEvidence?.validationIssues.find(
    (issue) => issue.code === 'SUMMARY_SEMANTICS_REQUIRE_REVIEW',
  )?.detailsJson;
  const claims: unknown[] = Array.isArray(report?.claims) ? report.claims : [];
  const claim = claims.find(
    (item) => item && typeof item === 'object' && 'path' in item && item.path === path,
  );
  if (!claim || typeof claim !== 'object' || !('sources' in claim) || !Array.isArray(claim.sources))
    return [];
  return (claim.sources as unknown[]).filter(
    (source): source is { quote: string; line: number; context?: string } =>
      Boolean(source) &&
      typeof source === 'object' &&
      source !== null &&
      'quote' in source &&
      'line' in source &&
      typeof source.quote === 'string' &&
      typeof source.line === 'number',
  );
}

/** Evidence is host verified; candidate text remains immutable and needs author review. */
export function SummaryGroundingReview({ artifact, disabled, onRedo }: Props) {
  const payload = summaryGroundingPayload(artifact.content ?? '');
  const claims = summaryClaimViews(payload);
  const issues = (artifact.artifactEvidence?.validationIssues ?? []).filter(
    (issue) =>
      issue.code.startsWith('SUMMARY_') && issue.code !== 'SUMMARY_SEMANTICS_REQUIRE_REVIEW',
  );
  const missing = !payload?.grounding;
  const notes = missing
    ? '为所有进入后续上下文的断言补充当前完整采用稿的逐字引句及已确认/推测/待查/计划分类。没有依据的断言删除；未知和计划不得写成已发生事实。'
    : issues.map((issue) => `${issue.jsonPath ?? '总结'}：${issue.message}`).join('\n');
  return (
    <section className="workbench-artifact-evidence" data-testid="summary-grounding-review">
      <h4>本次新增断言与原文依据（{claims.length}）</h4>
      <p>
        这些内容将进入后续创作上下文。请核对原文是否支持每条概括，尤其是推测、待查和计划；引句匹配不代表语义已经核实。
      </p>
      {missing && <p role="alert">这份候选未提供逐条原文依据，请先要求补齐依据并重新审阅。</p>}
      {issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={issue.issueId} role={issue.severity === 'error' ? 'alert' : undefined}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {claims.map((claim) => {
        const sources = sourceLocations(artifact, claim.path);
        const prefix = `【${claim.status === 'unclassified' ? '未分类' : SUMMARY_STATUS_LABELS[claim.status]}】`;
        return (
          <details key={claim.path} data-testid="summary-grounding-claim">
            <summary>
              {!claim.statement.startsWith(prefix) && prefix}
              {claim.statement}
            </summary>
            {claim.quotes.length ? (
              claim.quotes.map((quote, index) => {
                const source = sources.find((row) => row.quote === quote);
                return (
                  <div key={index}>
                    <p>{source ? `当前采用稿第 ${source.line} 行` : '原文位置尚未核实'}</p>
                    <blockquote>{quote}</blockquote>
                    {typeof source?.context === 'string' &&
                      source.context.trim() !== quote.trim() && (
                        <div>
                          <p>对应完整原句（请保留限定）</p>
                          <blockquote>{source.context}</blockquote>
                        </div>
                      )}
                  </div>
                );
              })
            ) : (
              <p>缺少原文依据。</p>
            )}
            {onRedo && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() =>
                  onRedo(
                    `请重新核对这条${claim.status === 'unclassified' ? '未分类' : SUMMARY_STATUS_LABELS[claim.status]}断言：${claim.statement}\n对应字段 ${claim.path}。仅据当前完整采用稿保留原文支持的结论；保留否定、未知、口述与计划，不增加确定性。`,
                  )
                }
              >
                针对这条重做总结
              </button>
            )}
          </details>
        );
      })}
      {notes && onRedo && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() => onRedo(notes)}
        >
          将核对问题带入重做
        </button>
      )}
    </section>
  );
}
