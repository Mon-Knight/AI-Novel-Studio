import { aiSettingsService } from '../../services/ai/aiClient';
import { getCredentialStorageCopy } from '../../services/ai/credentialStorageCopy';
import type { LocalModelEditorDraft } from './optionalModelEditorDraft';

interface LocalModelEditorProps {
  draft: LocalModelEditorDraft;
  onChange: (patch: Partial<LocalModelEditorDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function LocalModelEditor({ draft, onChange, onSave, onCancel }: LocalModelEditorProps) {
  return (
    <div className="settings-form-grid" data-testid="local-model-editor">
      <label className="settings-field">
        <span>显示名称</span>
        <input
          className="form-input"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="例如：本机 Qwen 作家"
        />
      </label>
      <label className="settings-field">
        <span>Provider ID</span>
        <input
          className="form-input"
          value={draft.providerId}
          onChange={(e) => onChange({ providerId: e.target.value })}
          placeholder="local_llama_cpp"
        />
      </label>
      <label className="settings-field">
        <span>模型名称</span>
        <input
          className="form-input"
          value={draft.modelName}
          onChange={(e) => onChange({ modelName: e.target.value })}
          placeholder="qwen35-9b-novel-v3"
        />
      </label>
      <label className="settings-field settings-span-full">
        <span>OpenAI-Compatible Base URL（仅限本机回环地址）</span>
        <input
          className="form-input"
          value={draft.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="http://127.0.0.1:8080/v1"
        />
      </label>
      <label className="settings-field settings-span-full">
        <span>本地 API Key（通常无需真实密钥）</span>
        <input
          className="form-input"
          type="password"
          value={draft.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder="local-no-key-required"
        />
        <span className="settings-help-text">
          {draft.apiKey ? '当前填写：' + aiSettingsService.maskApiKey(draft.apiKey) + '。' : ''}
          {getCredentialStorageCopy().localKeyHelp}
        </span>
      </label>
      <div className="settings-card-actions settings-span-full">
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
