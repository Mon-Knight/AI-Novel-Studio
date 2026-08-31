import { useState } from 'react';
import { Bot } from 'lucide-react';
import type { AiSettings, SavedApiModelProfile } from '../../types/ai';
import { aiSettingsService } from '../../services/ai/aiClient';
import {
  applySavedApiModel,
  createSavedApiModelProfile,
  upsertSavedApiModel,
} from '../../services/ai/savedApiModels';
import { AiApiModelEditor } from './AiApiModelEditor';
import {
  draftFromSavedProfile,
  emptyApiModelDraft,
  type ApiModelEditorDraft,
} from './apiModelEditorDraft';
import { AiSavedApiModelCards } from './AiSavedApiModelCards';

interface AiProviderSettingsCardProps {
  settings: AiSettings;
  message: string;
  testing: boolean;
  update: (patch: Partial<AiSettings>) => void;
  handleTestConnection: () => void;
  onStopTest: () => void;
  handleSave: (next?: AiSettings) => void;
}

function sessionKeyFor(
  profile: Pick<SavedApiModelProfile, 'provider' | 'baseUrl' | 'modelName'>,
): string {
  return aiSettingsService.resolveSessionApiKey({
    scope: 'provider',
    providerId: profile.provider,
    baseUrl: profile.baseUrl,
    modelId: profile.modelName,
  });
}

function AiProviderSettingsCard({
  settings,
  message,
  testing,
  update,
  handleTestConnection,
  onStopTest,
  handleSave,
}: AiProviderSettingsCardProps) {
  const profiles = settings.savedApiModels ?? [];
  const [editorOpen, setEditorOpen] = useState(profiles.length === 0);
  const [draft, setDraft] = useState<ApiModelEditorDraft>(emptyApiModelDraft);

  const patchDraft = (next: Partial<ApiModelEditorDraft>) => {
    const merged = { ...draft, ...next };
    const identityChanged =
      merged.provider !== draft.provider ||
      merged.baseUrl !== draft.baseUrl ||
      merged.modelName !== draft.modelName;
    if (identityChanged && !Object.prototype.hasOwnProperty.call(next, 'apiKey')) {
      merged.apiKey = sessionKeyFor(merged);
    }
    setDraft(merged);
    update({
      provider: merged.provider,
      baseUrl: merged.baseUrl,
      modelName: merged.modelName,
      temperature: merged.temperature,
      maxTokens: merged.maxTokens,
      timeoutSeconds: merged.timeoutSeconds,
      ...(Object.prototype.hasOwnProperty.call(next, 'apiKey') || identityChanged
        ? { apiKey: merged.apiKey }
        : {}),
    });
  };

  const openAdd = () => {
    setDraft(emptyApiModelDraft());
    setEditorOpen(true);
  };

  const openEdit = (profile: SavedApiModelProfile) => {
    setDraft(draftFromSavedProfile(profile, sessionKeyFor(profile)));
    setEditorOpen(true);
  };

  const useProfile = (profile: SavedApiModelProfile) => {
    const next = applySavedApiModel(settings, profile, sessionKeyFor(profile));
    update(next);
    setEditorOpen(false);
    handleSave(next);
  };

  const deleteProfile = (profile: SavedApiModelProfile) => {
    const remaining = profiles.filter((item) => item.id !== profile.id);
    const nextActive = remaining[0];
    if (!nextActive) {
      const cleared: AiSettings = {
        ...settings,
        savedApiModels: [],
        activeSavedApiModelId: undefined,
        provider: settings.runtimeMode === 'mock' ? 'mock' : 'openai_compatible',
        baseUrl: '',
        modelName: '',
        apiKey: '',
      };
      update(cleared);
      setDraft(emptyApiModelDraft());
      setEditorOpen(true);
      handleSave(cleared);
      return;
    }
    const next = {
      ...applySavedApiModel(settings, nextActive, sessionKeyFor(nextActive)),
      savedApiModels: remaining,
    };
    update(next);
    handleSave(next);
  };

  const saveDraftAsCard = () => {
    if (!draft.baseUrl.trim() || !draft.modelName.trim()) return;
    const profile = createSavedApiModelProfile({
      id: draft.id,
      label: draft.label.trim() || draft.modelName.trim(),
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      modelName: draft.modelName,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      timeoutSeconds: draft.timeoutSeconds,
    });
    const nextSettings = applySavedApiModel(
      { ...settings, savedApiModels: upsertSavedApiModel(profiles, profile) },
      profile,
      draft.apiKey,
    );
    update(nextSettings);
    setEditorOpen(false);
    handleSave(nextSettings);
  };

  return (
    <section className="detail-card settings-card" data-testid="ai-provider-settings-card">
      <div className="settings-card-heading">
        <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>全局 Cloud Provider</span>
      </div>
      <p className="settings-help-text">
        负责世界观、规划、Scene、质检等导演任务；未启用可用的专用本地正文模型时，也负责临时
        Scene/Beat 与整章候选正文生成。已保存模型只显示名称与状态，不展示具体参数。
      </p>

      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          marginBottom: 12,
          background:
            settings.runtimeMode === 'mock' ? 'var(--color-success-bg)' : 'var(--color-info-bg)',
          border:
            settings.runtimeMode === 'mock'
              ? '1px solid var(--color-success-border)'
              : '1px solid var(--color-info-border)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
          当前模式：{settings.runtimeMode === 'mock' ? 'Mock 模式' : '真实 API 模式'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {settings.runtimeMode === 'mock'
            ? '所有 AI 功能使用本地模拟，不请求外部 API。'
            : '当前使用已保存卡片中的模型；参数仅在添加或编辑时填写。'}
        </div>
      </div>

      <label
        htmlFor="mockMode"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          marginBottom: 12,
          background: 'var(--color-bg-hover)',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}
      >
        <input
          type="checkbox"
          id="mockMode"
          checked={settings.runtimeMode === 'mock'}
          onChange={(event) => update({ runtimeMode: event.target.checked ? 'mock' : 'api' })}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <span>
          <strong>Mock 模式</strong>
          <span className="settings-help-text" style={{ display: 'block', marginTop: 2 }}>
            开启后使用本地模拟；关闭后使用当前选中的 API 模型卡片。
          </span>
        </span>
      </label>

      <AiSavedApiModelCards
        profiles={profiles}
        activeId={settings.activeSavedApiModelId}
        keyBound={(profile) => Boolean(sessionKeyFor(profile))}
        onUse={useProfile}
        onEdit={openEdit}
        onDelete={deleteProfile}
        onAdd={openAdd}
      />

      {editorOpen && (
        <AiApiModelEditor
          draft={draft}
          onChange={patchDraft}
          onSave={saveDraftAsCard}
          onCancel={() => {
            setEditorOpen(false);
            const active = profiles.find(
              (profile) => profile.id === settings.activeSavedApiModelId,
            );
            if (active) update(applySavedApiModel(settings, active, sessionKeyFor(active)));
          }}
        />
      )}

      {message && (
        <div
          className="settings-help-text"
          role="status"
          style={{
            marginTop: 8,
            padding: '6px 12px',
            borderRadius: 6,
            background:
              message.includes('失败') || message.includes('错误')
                ? 'var(--color-error-bg)'
                : message.includes('成功') || message.includes('已保存')
                  ? 'var(--color-success-bg)'
                  : 'var(--color-primary-light)',
          }}
        >
          {message}
        </div>
      )}

      <div className="settings-card-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? '测试中...' : '测试当前模型'}
        </button>
        {testing && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStopTest()}>
            停止测试
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleSave()}>
          保存设置
        </button>
      </div>
    </section>
  );
}

export default AiProviderSettingsCard;
