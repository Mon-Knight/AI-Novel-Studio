import type { AiSettings } from '../../types/ai';
import { aiRequestPolicyService } from '../../services/ai/aiRequestPolicyService';

interface AiGovernanceSettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: () => void;
}

function optionalPositive(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function AiGovernanceSettingsCard({ settings, onChange, onSave }: AiGovernanceSettingsCardProps) {
  const snapshot = aiRequestPolicyService.snapshot(settings);
  const pricingReady =
    settings.inputPricePerMillionTokens !== undefined &&
    settings.outputPricePerMillionTokens !== undefined;

  return (
    <section className="detail-card settings-card" aria-labelledby="ai-governance-title">
      <div className="settings-card-heading">
        <span aria-hidden="true">⏱</span>
        <span id="ai-governance-title">调用保护与每日预算</span>
      </div>
      <div className="settings-form-grid">
        <label className="settings-field">
          <span>每分钟最多请求</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={120}
            value={settings.maxRequestsPerMinute ?? 12}
            onChange={(event) => onChange({ maxRequestsPerMinute: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>最大并发请求</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={8}
            value={settings.maxConcurrentAiRequests ?? 2}
            onChange={(event) => onChange({ maxConcurrentAiRequests: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>每日 Token 硬预算</span>
          <input
            className="form-input"
            type="number"
            min={1}
            value={settings.dailyTokenBudget ?? ''}
            placeholder="留空表示不限制"
            onChange={(event) =>
              onChange({ dailyTokenBudget: optionalPositive(event.target.value) })
            }
          />
        </label>
        <label className="settings-field">
          <span>每日成本硬预算（USD）</span>
          <input
            className="form-input"
            type="number"
            min={0.000001}
            step={0.01}
            value={settings.dailyCostBudgetUsd ?? ''}
            placeholder={pricingReady ? '留空表示不限制' : '请先配置输入/输出单价'}
            disabled={!pricingReady}
            onChange={(event) =>
              onChange({ dailyCostBudgetUsd: optionalPositive(event.target.value) })
            }
          />
        </label>
        <label className="settings-field">
          <span>预算提醒阈值（%）</span>
          <input
            className="form-input"
            type="number"
            min={50}
            max={99}
            value={settings.budgetWarningPercent ?? 80}
            onChange={(event) => onChange({ budgetWarningPercent: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className={`budget-summary${snapshot.warning ? ' is-warning' : ''}`} role="status">
        <strong>今日用量</strong>
        <span>
          Token {snapshot.tokenUsed.toLocaleString()}
          {snapshot.reservedTokens
            ? `（运行中预留 ${snapshot.reservedTokens.toLocaleString()}）`
            : ''}
          {snapshot.tokenBudget ? ` / ${snapshot.tokenBudget.toLocaleString()}` : ''}
        </span>
        <span>
          估算成本 ${snapshot.costUsedUsd.toFixed(6)} USD
          {snapshot.costBudgetUsd ? ` / ${snapshot.costBudgetUsd.toFixed(2)} USD` : ''}
        </span>
        <span>
          最近一分钟 {snapshot.requestsLastMinute} 次 · 正在运行 {snapshot.activeRequests} 次
          {snapshot.usageMissingCount
            ? ` · ${snapshot.usageMissingCount} 次缺少 Provider 用量`
            : ''}
        </span>
      </div>
      <div className="settings-card-actions">
        <span className="settings-help-text">
          发起请求前会预留最坏情况预算；完成后按 Provider 实际 Token 结算。
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
          保存调用保护
        </button>
      </div>
    </section>
  );
}

export default AiGovernanceSettingsCard;
