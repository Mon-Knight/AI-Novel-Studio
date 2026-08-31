import type { CloudApiProvider } from '../../types/ai';
import { aiSettingsService } from '../../services/ai/aiClient';
import type { ApiModelEditorDraft } from './apiModelEditorDraft';

interface AiApiModelEditorProps {
  draft: ApiModelEditorDraft;
  onChange: (patch: Partial<ApiModelEditorDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function AiApiModelEditor({ draft, onChange, onSave, onCancel }: AiApiModelEditorProps) {
  const editing = Boolean(draft.id);
  return (
    <div className="settings-form-grid" data-testid="ai-api-model-editor">
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-label">
          显示名称
        </label>
        <input
          id="saved-api-model-label"
          type="text"
          className="form-input"
          value={draft.label}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="例如：DeepSeek 写作"
        />
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-provider">
          Provider
        </label>
        <select
          id="saved-api-model-provider"
          data-testid="ai-api-model-provider"
          className="panel-select"
          value={draft.provider}
          onChange={(event) => onChange({ provider: event.target.value as CloudApiProvider })}
        >
          <option value="deepseek">deepseek</option>
          <option value="openai_compatible">openai_compatible</option>
        </select>
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-url">
          API Base URL <span style={{ color: 'var(--color-error)' }}>*</span>
        </label>
        <input
          id="saved-api-model-url"
          type="text"
          className="form-input"
          value={draft.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          placeholder="例如：https://api.deepseek.com/v1"
        />
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-key">
          API Key <span style={{ color: 'var(--color-error)' }}>*</span>
        </label>
        <input
          id="saved-api-model-key"
          type="password"
          className="form-input"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder="sk-..."
        />
        <div className="settings-help-text">
          {draft.apiKey
            ? '本次应用会话已绑定：' + aiSettingsService.maskApiKey(draft.apiKey)
            : 'Key 仅保留在本次应用会话，不写入模型卡片、项目备份或 Git。'}
        </div>
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-name">
          模型名称 <span style={{ color: 'var(--color-error)' }}>*</span>
        </label>
        <input
          id="saved-api-model-name"
          type="text"
          className="form-input"
          value={draft.modelName}
          onChange={(event) => onChange({ modelName: event.target.value })}
          placeholder="例如：deepseek-chat / deepseek-reasoner"
        />
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-temperature">
          温度参数
        </label>
        <input
          id="saved-api-model-temperature"
          type="number"
          className="form-input"
          value={draft.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(event) => onChange({ temperature: Number(event.target.value) })}
        />
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-max-tokens">
          最大输出 Token
        </label>
        <input
          id="saved-api-model-max-tokens"
          type="number"
          className="form-input"
          value={draft.maxTokens}
          min={100}
          max={64000}
          step={100}
          onChange={(event) => onChange({ maxTokens: Number(event.target.value) })}
        />
      </div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-timeout">
          超时时间（秒）
        </label>
        <input
          id="saved-api-model-timeout"
          type="number"
          className="form-input"
          value={draft.timeoutSeconds}
          min={30}
          max={600}
          step={30}
          onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) })}
        />
      </div>
      <div className="settings-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="ai-api-model-cancel"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="ai-api-model-save"
          onClick={onSave}
        >
          {editing ? '保存卡片' : '保存为卡片'}
        </button>
      </div>
    </div>
  );
}
