import { useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AiSettings, SavedApiModelProfile } from '../../types/ai';
import { aiSettingsService } from '../../services/ai/aiClient';
import { applySavedApiModel } from '../../services/ai/savedApiModels';
import {
  assignSourceId,
  primaryProfileInSource,
  profilesFromSourceCatalog,
  replaceSavedApiSourceModels,
  savedApiSourceKey,
  type SavedApiSourceGroup,
} from '../../services/ai/savedApiSources';
import { listCloudModels, mergeFetchedModelIds } from '../../services/ai/cloudModelCatalog';
import { AiApiModelEditor } from './AiApiModelEditor';
import {
  draftFromSourceProfiles,
  emptyApiModelDraft,
  syncPrimaryModelFields,
  type ApiModelEditorDraft,
  type ApiSourceModelDraft,
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

type CloudEditorSettingsSnapshot = Pick<
  AiSettings,
  'provider' | 'baseUrl' | 'modelName' | 'temperature' | 'maxTokens' | 'timeoutSeconds' | 'apiKey'
>;

function snapshotCloudEditorSettings(settings: AiSettings): CloudEditorSettingsSnapshot {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    modelName: settings.modelName,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
    apiKey: settings.apiKey,
  };
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

function sessionKeyForSource(models: SavedApiModelProfile[]): string {
  for (const model of models) {
    const key = sessionKeyFor(model);
    if (key) return key;
  }
  return models[0] ? sessionKeyFor(models[0]) : '';
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
  const [expandedSourceKey, setExpandedSourceKey] = useState<string | 'new' | null>(
    profiles.length === 0 ? 'new' : null,
  );
  const [draft, setDraft] = useState<ApiModelEditorDraft>(emptyApiModelDraft);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchMessage, setFetchMessage] = useState('');
  const editorSettingsSnapshotRef = useRef<CloudEditorSettingsSnapshot | null>(null);
  const catalogBaselineRef = useRef<ApiSourceModelDraft[]>([]);
  const editingSourceKey =
    expandedSourceKey === 'new' ? undefined : (expandedSourceKey ?? undefined);

  const patchDraft = (next: Partial<ApiModelEditorDraft>) => {
    if (!editorSettingsSnapshotRef.current) {
      editorSettingsSnapshotRef.current = snapshotCloudEditorSettings(settings);
    }
    const merged = syncPrimaryModelFields({
      ...draft,
      ...next,
      models: next.models ?? draft.models,
    });
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
    const next = emptyApiModelDraft();
    editorSettingsSnapshotRef.current = null;
    catalogBaselineRef.current = next.models.map((model) => ({ ...model }));
    setFetchMessage('');
    setDraft(next);
    setExpandedSourceKey('new');
  };

  const openSource = (group: SavedApiSourceGroup) => {
    const next = draftFromSourceProfiles(
      group.models,
      sessionKeyForSource(group.models),
      settings.activeSavedApiModelId,
    );
    editorSettingsSnapshotRef.current = null;
    catalogBaselineRef.current = next.models.map((model) => ({ ...model }));
    setFetchMessage('');
    setDraft(next);
    setExpandedSourceKey(group.key);
  };

  const closeEditor = () => {
    editorSettingsSnapshotRef.current = null;
    setFetchMessage('');
    setExpandedSourceKey(null);
  };

  const discardEditor = () => {
    const snapshot = editorSettingsSnapshotRef.current;
    closeEditor();
    if (!snapshot) return;
    update({
      ...snapshot,
      provider:
        settings.runtimeMode === 'mock'
          ? 'mock'
          : snapshot.provider === 'mock'
            ? 'openai_compatible'
            : snapshot.provider,
    });
  };

  const toggleSource = (group: SavedApiSourceGroup) => {
    if (expandedSourceKey === group.key) discardEditor();
    else openSource(group);
  };

  const selectSource = (group: SavedApiSourceGroup) => {
    const primary = primaryProfileInSource(group, settings.activeSavedApiModelId);
    const next = applySavedApiModel(settings, primary, sessionKeyFor(primary));
    update(next);
    handleSave(next);
  };

  const deleteSource = (group: SavedApiSourceGroup) => {
    const remaining = profiles.filter((profile) => savedApiSourceKey(profile) !== group.key);
    const nextActive =
      remaining.find((item) => item.id === settings.activeSavedApiModelId) ?? remaining[0];
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
      setExpandedSourceKey('new');
      handleSave(cleared);
      return;
    }
    const next = {
      ...applySavedApiModel(settings, nextActive, sessionKeyFor(nextActive)),
      savedApiModels: remaining,
    };
    update(next);
    if (expandedSourceKey === group.key) closeEditor();
    handleSave(next);
  };

  const saveDraftAsCard = () => {
    const named = draft.models.filter((model) => model.modelName.trim());
    if (!draft.baseUrl.trim() || named.length === 0) return;
    const sourceId = assignSourceId(draft.sourceId);
    const previous = editingSourceKey
      ? profiles.filter((profile) => savedApiSourceKey(profile) === editingSourceKey)
      : [];
    const nextProfiles = profilesFromSourceCatalog({
      sourceId,
      sourceLabel: draft.label,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      temperature: draft.temperature,
      timeoutSeconds: draft.timeoutSeconds,
      previous,
      models: named,
    });
    if (nextProfiles.length === 0) return;
    const selected =
      nextProfiles[Math.min(draft.selectedModelIndex, nextProfiles.length - 1)] ?? nextProfiles[0]!;
    for (const profile of nextProfiles) {
      aiSettingsService.rememberProviderApiKey(profile, draft.apiKey);
    }
    const nextSettings = applySavedApiModel(
      {
        ...settings,
        savedApiModels: replaceSavedApiSourceModels(profiles, editingSourceKey, nextProfiles),
      },
      selected,
      draft.apiKey,
    );
    editorSettingsSnapshotRef.current = null;
    setFetchMessage('');
    update(nextSettings);
    setExpandedSourceKey(null);
    handleSave(nextSettings);
  };

  const fetchUpstreamModels = async () => {
    setFetchingModels(true);
    setFetchMessage('');
    try {
      const ids = await listCloudModels({ baseUrl: draft.baseUrl, apiKey: draft.apiKey });
      const mergedIds = mergeFetchedModelIds(draft.models, ids);
      patchDraft({
        models: mergedIds.map((modelName) => {
          const existing = draft.models.find((model) => model.modelName.trim() === modelName);
          return (
            existing ?? {
              modelName,
              label: '',
              maxTokens: draft.maxTokens,
              contextTokens: 0,
            }
          );
        }),
      });
      setFetchMessage(ids.length ? `已获取 ${ids.length} 个上游模型。` : '上游未返回可用模型。');
    } catch (error) {
      setFetchMessage(error instanceof Error ? error.message : '获取上游模型失败。');
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <section className="detail-card settings-card" data-testid="ai-provider-settings-card">
      <div className="settings-card-heading">
        <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>全局 Cloud Provider</span>
      </div>
      <p className="settings-help-text">
        负责世界观、规划、Scene、质检等导演任务；未启用可用的专用本地正文模型时，也负责临时
        Scene/Beat 与整章候选正文生成。已保存模型按来源分组，不展示密钥。
      </p>

      <div
        className={`settings-mode-banner ${settings.runtimeMode === 'mock' ? 'is-mock' : 'is-live'}`}
      >
        <div className="settings-mode-banner-title">
          当前模式：{settings.runtimeMode === 'mock' ? 'Mock 模式' : '真实 API 模式'}
        </div>
        <div className="settings-mode-banner-text">
          {settings.runtimeMode === 'mock'
            ? '所有 AI 功能使用本地模拟，不请求外部 API。'
            : '当前使用已保存来源卡片中的模型；点击卡片选中该来源，点击「编辑」打开或收起设置。'}
        </div>
      </div>

      <label htmlFor="mockMode" className="settings-toggle-row">
        <input
          type="checkbox"
          id="mockMode"
          className="settings-checkbox"
          checked={settings.runtimeMode === 'mock'}
          onChange={(event) => update({ runtimeMode: event.target.checked ? 'mock' : 'api' })}
        />
        <span>
          <strong>Mock 模式</strong>
          <span className="settings-help-text settings-help-block">
            开启后使用本地模拟；关闭后使用当前选中的 API 来源卡片。
          </span>
        </span>
      </label>

      <AiSavedApiModelCards
        profiles={profiles}
        activeId={settings.activeSavedApiModelId}
        expandedKey={expandedSourceKey}
        keyBound={(profile) => Boolean(sessionKeyFor(profile))}
        onSelect={selectSource}
        onEdit={toggleSource}
        onDelete={deleteSource}
        onAdd={openAdd}
        editor={
          expandedSourceKey ? (
            <AiApiModelEditor
              draft={draft}
              onChange={patchDraft}
              onSave={saveDraftAsCard}
              onFetchModels={() => {
                void fetchUpstreamModels();
              }}
              onRestoreDefaults={() =>
                patchDraft({
                  models: catalogBaselineRef.current.map((model) => ({ ...model })),
                })
              }
              fetchingModels={fetchingModels}
              fetchMessage={fetchMessage}
              onCancel={discardEditor}
            />
          ) : null
        }
      />

      {message && (
        <div
          className={`settings-result ${
            message.includes('失败') || message.includes('错误')
              ? 'is-error'
              : message.includes('成功') || message.includes('已保存')
                ? 'is-ok'
                : 'is-info'
          }`}
          role="status"
        >
          {message}
        </div>
      )}

      <div className="settings-card-actions resource-gap-top">
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
