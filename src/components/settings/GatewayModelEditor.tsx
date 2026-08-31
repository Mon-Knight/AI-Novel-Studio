import { aiSettingsService } from '../../services/ai/aiClient';
import type { GatewayModelEditorDraft } from './optionalModelEditorDraft';

interface GatewayModelEditorProps {
  draft: GatewayModelEditorDraft;
  onChange: (patch: Partial<GatewayModelEditorDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function GatewayModelEditor({ draft, onChange, onSave, onCancel }: GatewayModelEditorProps) {
  return (
    <div className="settings-form-grid" data-testid="gateway-model-editor">
      <label className="settings-field">
        <span>显示名称</span>
        <input
          className="form-input"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="例如：集群网关"
        />
      </label>
      <label className="settings-field">
        <span>Provider ID</span>
        <input
          className="form-input"
          value={draft.providerId}
          onChange={(e) => onChange({ providerId: e.target.value })}
          placeholder="ai_gateway"
        />
      </label>
      <label className="settings-field" style={{ gridColumn: '1 / -1' }}>
        <span>Endpoint Base URL</span>
        <input
          className="form-input"
          value={draft.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="https://gateway.example.com/v1"
        />
      </label>
      <label className="settings-field">
        <span>模型名称</span>
        <input
          className="form-input"
          value={draft.modelName}
          onChange={(e) => onChange({ modelName: e.target.value })}
          placeholder="qwen35-32b-novel-v1"
        />
      </label>
      <label className="settings-field">
        <span>API Key / Token</span>
        <input
          className="form-input"
          type="password"
          value={draft.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder="网关访问 Token"
        />
        <span className="settings-help-text">
          {draft.apiKey
            ? '本次会话已绑定：' + aiSettingsService.maskApiKey(draft.apiKey)
            : 'Key 不写入卡片或备份。'}
        </span>
      </label>
      <div className="settings-card-actions" style={{ gridColumn: '1 / -1' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave}>
          {draft.id ? '保存卡片' : '保存为卡片'}
        </button>
      </div>
    </div>
  );
}
