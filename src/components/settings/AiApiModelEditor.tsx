import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CloudApiProvider } from '../../types/ai';
import { aiSettingsService } from '../../services/ai/aiClient';
import { getCredentialStorageCopy } from '../../services/ai/credentialStorageCopy';
import type { ApiModelEditorDraft } from './apiModelEditorDraft';
import { AiApiSourceModelCatalog } from './AiApiSourceModelCatalog';

interface AiApiModelEditorProps {
  draft: ApiModelEditorDraft;
  onChange: (patch: Partial<ApiModelEditorDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onFetchModels?: () => void;
  onRestoreDefaults?: () => void;
  fetchingModels?: boolean;
  fetchMessage?: string;
}

export function AiApiModelEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  onFetchModels,
  onRestoreDefaults,
  fetchingModels,
  fetchMessage,
}: AiApiModelEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const editing = Boolean(draft.id || draft.sourceId);
  const title = draft.label.trim() || '自定义来源';

  return (
    <div className="api-source-editor" data-testid="ai-api-model-editor">
      <div className="api-source-editor-title">{title}</div>
      <div className="settings-field">
        <label className="panel-field-label" htmlFor="saved-api-model-key">
          API 密钥
        </label>
        <input
          id="saved-api-model-key"
          type="password"
          className="form-input"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={draft.apiKey ? '已配置——输入新值可替换' : 'sk-...'}
        />
        <div className="settings-help-text">
          {draft.apiKey ? '当前填写：' + aiSettingsService.maskApiKey(draft.apiKey) + '。' : ''}
          {getCredentialStorageCopy().keyHelp}
        </div>
      </div>

      <div className="api-source-advanced">
        <button
          type="button"
          className="api-source-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? (
            <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
          ) : (
            <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
          )}
          自定义设置
        </button>
        <div className="api-source-advanced-body" data-open={advancedOpen ? 'true' : 'false'}>
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
              placeholder="例如：cpa"
            />
          </div>
          <div className="settings-field">
            <label className="panel-field-label" htmlFor="saved-api-model-url">
              API 地址 <span className="resource-text-error">*</span>
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
            <label className="panel-field-label" htmlFor="saved-api-model-provider">
              API 协议
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
            <label className="panel-field-label" htmlFor="saved-api-model-timeout">
              超时时间（秒）
            </label>
            <input
              id="saved-api-model-timeout"
              type="number"
              className="form-input"
              value={draft.timeoutSeconds}
              min={30}
              max={1800}
              step={30}
              onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) })}
            />
          </div>
        </div>
      </div>

      <AiApiSourceModelCatalog
        draft={draft}
        onChange={onChange}
        onFetchModels={onFetchModels}
        onRestoreDefaults={onRestoreDefaults}
        fetchingModels={fetchingModels}
        fetchMessage={fetchMessage}
      />

      <div className="api-source-editor-actions">
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
          {editing ? '保存' : '保存'}
        </button>
      </div>
    </div>
  );
}
