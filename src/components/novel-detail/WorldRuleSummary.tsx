import { summarizeWorldRule } from './worldRulePresentation';

export default function WorldRuleSummary({ structuredJson }: { structuredJson?: string }) {
  const summary = summarizeWorldRule(structuredJson);
  return (
    <div className="detail-rule-summary" data-testid="world-rule-structure-summary">
      <p className="text-sm text-muted">{summary.notice}</p>
      {summary.aspects.length > 0 && (
        <dl className="detail-rule-summary-list">
          {summary.aspects.map((aspect) => (
            <div key={aspect.key} className="detail-rule-summary-row">
              <dt>{aspect.label}</dt>
              <dd data-determined={aspect.determined ? 'true' : 'false'}>{aspect.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.gaps.length > 0 && (
        <ul className="detail-rule-gaps" data-testid="world-rule-structure-gaps">
          {summary.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
