import type {
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleChangeIntent,
} from '../../types/worldRules';
import {
  describeProposedChange,
  listBlockingImpact,
  listPotentialImpact,
} from './worldRulePresentation';

export default function RuleChangeReview({
  impact,
  intent,
  notes,
  confirmed,
  change,
  onIntent,
  onNotes,
  onConfirm,
}: {
  impact?: WorldRuleChangeImpact;
  intent: WorldRuleChangeIntent;
  notes: string;
  confirmed: boolean;
  change?: WorldRuleChange;
  onIntent: (value: WorldRuleChangeIntent) => void;
  onNotes: (value: string) => void;
  onConfirm: (value: boolean) => void;
}) {
  const proposed = change ? describeProposedChange(change) : undefined;
  const potential = impact ? listPotentialImpact(impact) : [];
  const blocking = impact ? listBlockingImpact(impact) : [];
  return (
    <div className="detail-form detail-form--tight">
      <label className="panel-field-label">
        作者变更意图
        <select
          className="panel-select"
          data-testid="setting-change-intent"
          value={intent}
          onChange={(e) => onIntent(e.target.value as WorldRuleChangeIntent)}
        >
          <option value="confirm_change">确认建立/普通变更（不默改已采用正文）</option>
          <option value="retcon">明确修订正史（说明受影响内容）</option>
          <option value="approve_exception">批准有限例外（说明条件与代价）</option>
        </select>
      </label>
      <label className="panel-field-label">
        变更说明
        <textarea
          className="form-textarea detail-textarea detail-textarea--sm"
          data-testid="setting-change-notes"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="正史修订/例外必须说明理由，普通变更可留空"
        />
      </label>
      {impact && (
        <section data-testid="setting-impact-result" aria-label="设定变更影响预览">
          <p>依据当前规则集与采用稿快照的保守影响预览，不代表算法证明任意小说语义一致。</p>
          {proposed && (
            <div className="detail-list-item detail-list-item--sm">
              <p data-testid="setting-change-action">{proposed.action}</p>
              <pre
                className="detail-fact-text detail-fact-text--pre"
                data-testid="setting-change-preview"
              >
                {proposed.body}
              </pre>
            </div>
          )}
          <details data-testid="setting-impact-fingerprint">
            <summary>预览身份与规则集指纹（可展开核对）</summary>
            <p className="detail-hash">
              预览 hash：
              <span data-testid="setting-impact-preview-hash">{impact.previewHash}</span>
            </p>
            <p className="detail-hash">
              规则集指纹：
              <span data-testid="setting-impact-ruleset-fingerprint">
                {impact.ruleSetFingerprint}
              </span>
            </p>
          </details>
          <p className="text-sm text-muted">
            规则来源 {impact.sources.length} 条；可能影响采用章节 {impact.affectedChapters.length}{' '}
            章。
          </p>
          <div data-testid="setting-impact-potential">
            <p className="detail-subsection-title detail-subsection-title--tight">潜在影响</p>
            {potential.length ? (
              <ul className="detail-impact-list">
                {potential.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">目前没有列出额外的潜在影响。</p>
            )}
          </div>
          <div data-testid="setting-impact-blocking">
            <p className="detail-subsection-title detail-subsection-title--tight">确定阻断</p>
            {blocking.length ? (
              <div role="alert">
                存在确定的引用冲突，不能靠确认覆盖。
                <ul className="detail-impact-list detail-impact-list--blocking">
                  {blocking.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">没有确定的引用冲突。</p>
            )}
          </div>
          <label className="panel-field-label">
            <input
              type="checkbox"
              data-testid="setting-author-confirm"
              checked={confirmed}
              onChange={(e) => onConfirm(e.target.checked)}
              disabled={impact.blockingConflicts.length > 0}
            />
            我已审阅本次具体内容、影响与不确定性，并按所选意图确认；不自动改写已采用正文。
          </label>
        </section>
      )}
    </div>
  );
}
