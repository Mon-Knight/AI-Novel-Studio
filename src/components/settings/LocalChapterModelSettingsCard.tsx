import type { AiSettings, LocalChapterModelSettings } from '../../types/ai';
import {
  getDefaultLocalChapterModelSettings,
  resolveSessionModelApiKey,
} from '../../services/ai/aiSettingsStore';
import type { LocalChapterModelHealthResult } from '../../services/ai/localChapterModelHealthService';

interface LocalChapterModelSettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: () => void;
  healthResult?: LocalChapterModelHealthResult | null;
  healthChecking: boolean;
  onCheckHealth: () => void;
}

function optionalInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function LocalChapterModelSettingsCard({
  settings,
  onChange,
  onSave,
  healthResult,
  healthChecking,
  onCheckHealth,
}: LocalChapterModelSettingsCardProps) {
  const local = settings.localChapterModel ?? getDefaultLocalChapterModelSettings();
  const update = (patch: Partial<LocalChapterModelSettings>) => {
    const updated = { ...local, ...patch };
    const identityChanged =
      updated.providerId !== local.providerId ||
      updated.baseUrl !== local.baseUrl ||
      updated.modelName !== local.modelName;
    if (
      identityChanged &&
      local.apiKey ===
        resolveSessionModelApiKey({
          scope: 'local_chapter_model',
          providerId: local.providerId,
          baseUrl: local.baseUrl,
          modelId: local.modelName,
        })
    ) {
      updated.apiKey =
        resolveSessionModelApiKey({
          scope: 'local_chapter_model',
          providerId: updated.providerId,
          baseUrl: updated.baseUrl,
          modelId: updated.modelName,
        }) || 'local-no-key-required';
    }
    onChange({ localChapterModel: updated });
  };

  return (
    <section className="detail-card settings-card" aria-labelledby="local-chapter-model-title">
      <div className="settings-card-heading">
        <span aria-hidden="true">🧩</span>
        <span id="local-chapter-model-title">专用本地正文模型（可选）</span>
      </div>
      <div
        style={{
          padding: '10px 12px',
          marginBottom: 12,
          borderRadius: 8,
          background: local.enabled ? 'var(--color-success-bg)' : 'var(--color-bg-hover)',
          border: '1px solid var(--color-border)',
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--color-text-secondary)',
        }}
      >
        <strong>
          {local.enabled ? '✅ 已启用可选本地作家路由' : '☁️ 云端正文模式（推荐当前使用）'}
        </strong>
        <br />
        未启用或尚未通过 Benchmark 时，世界观、规划和正文均由上方全局 Cloud Provider 完成；已有
        Scene/Beat 计划仍按 Beat 生成。启用后，本地模型只负责正文，训练、测试、故障或 Context
        超限时自动由同一云端流程接管，不改变 Scene、Prompt 约束或审核流程。
      </div>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={local.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          style={{ width: 18, height: 18 }}
        />
        启用已通过 Benchmark 的本地 Scene/Beat 正文模型
      </label>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={local.allowCloudWriterFallback !== false}
          onChange={(event) => update({ allowCloudWriterFallback: event.target.checked })}
          style={{ width: 18, height: 18 }}
        />
        本地训练、测试或不可用时由云端代写同一 Beat（不改 Scene/目标）
      </label>

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>Provider ID</span>
          <input
            className="form-input"
            value={local.providerId}
            onChange={(event) => update({ providerId: event.target.value })}
            placeholder="local_llama_cpp"
          />
        </label>
        <label className="settings-field">
          <span>模型名称</span>
          <input
            className="form-input"
            value={local.modelName}
            onChange={(event) => update({ modelName: event.target.value })}
            placeholder="qwen35-9b-novel-v3"
          />
        </label>
        <label className="settings-field" style={{ gridColumn: '1 / -1' }}>
          <span>OpenAI-Compatible Base URL（仅限本机回环地址）</span>
          <input
            className="form-input"
            value={local.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="http://127.0.0.1:8080/v1"
          />
        </label>
        <label className="settings-field" style={{ gridColumn: '1 / -1' }}>
          <span>本地 API Key（通常无需真实密钥）</span>
          <input
            className="form-input"
            type="password"
            value={local.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder="local-no-key-required"
          />
        </label>
        <label className="settings-field">
          <span>上下文 Token（固定）</span>
          <input className="form-input" value={local.contextTokens} readOnly />
        </label>
        <label className="settings-field">
          <span>最大输出 Token（固定）</span>
          <input className="form-input" value={local.maxTokens} readOnly />
        </label>
        <label className="settings-field">
          <span>温度</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={local.temperature}
            onChange={(event) => update({ temperature: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>Top P</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={local.topP}
            onChange={(event) => update({ topP: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>Top K</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={4096}
            step={1}
            value={local.topK}
            onChange={(event) => update({ topK: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>Repeat penalty</span>
          <input
            className="form-input"
            type="number"
            min={0.01}
            max={3}
            step={0.01}
            value={local.repeatPenalty}
            onChange={(event) => update({ repeatPenalty: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>Seed（可选）</span>
          <input
            className="form-input"
            type="number"
            step={1}
            value={local.seed ?? ''}
            onChange={(event) => update({ seed: optionalInteger(event.target.value) })}
            placeholder="留空"
          />
        </label>
        <label className="settings-field">
          <span>超时时间（秒）</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={1800}
            value={local.timeoutSeconds}
            onChange={(event) => update({ timeoutSeconds: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="settings-card-actions">
        <span className="settings-help-text">
          仅允许 localhost、127.0.0.0/8 或 [::1]；推荐协议：qwen35-9b-novel-v3 · 单 user 消息 · 4096
          context · 1024 max output。
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
          保存可选本地模型设置
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCheckHealth}
          disabled={healthChecking}
        >
          {healthChecking ? '检查中...' : '检查本地模型'}
        </button>
      </div>
      {healthResult && (
        <div
          style={{
            marginTop: 10,
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background:
              healthResult.healthOk && healthResult.modelOk && healthResult.smokeOk
                ? 'var(--color-success-bg)'
                : 'var(--color-error-bg)',
            fontSize: 12,
            lineHeight: 1.7,
          }}
          data-testid="local-model-health-result"
        >
          <strong>{healthResult.message}</strong>
          <br />
          /health：{healthResult.healthOk ? '通过' : '失败'} · /v1/models：
          {healthResult.modelOk ? '匹配' : '不匹配'} · Beat smoke：
          {healthResult.smokeOk ? '通过' : '失败'}
          {healthResult.textPreview && (
            <>
              <br />
              预览：{healthResult.textPreview}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default LocalChapterModelSettingsCard;
