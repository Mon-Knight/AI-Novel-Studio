import { useState } from 'react';
import { Puzzle } from 'lucide-react';
import type { AiSettings, SavedLocalModelProfile } from '../../types/ai';
import { resolveSessionModelApiKey } from '../../services/ai/aiSettingsStore';
import type { LocalChapterModelHealthResult } from '../../services/ai/localChapterModelHealthService';
import {
  applySavedLocalModel,
  createLocalModelProfile,
  upsertByIdentity,
} from '../../services/ai/savedOptionalModels';
import { LocalModelEditor } from './LocalModelEditor';
import {
  draftFromLocalProfile,
  emptyLocalModelDraft,
  type LocalModelEditorDraft,
} from './optionalModelEditorDraft';
import { SettingsSavedModelCards } from './SettingsSavedModelCards';

interface LocalChapterModelSettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: (next?: AiSettings) => void;
  healthResult?: LocalChapterModelHealthResult | null;
  healthChecking: boolean;
  onCheckHealth: () => void;
}

function localSessionKey(
  profile: Pick<SavedLocalModelProfile, 'providerId' | 'baseUrl' | 'modelName'>,
): string {
  return resolveSessionModelApiKey({
    scope: 'local_chapter_model',
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    modelId: profile.modelName,
  });
}

function LocalChapterModelSettingsCard({
  settings,
  onChange,
  onSave,
  healthResult,
  healthChecking,
  onCheckHealth,
}: LocalChapterModelSettingsCardProps) {
  const local = settings.localChapterModel;
  const profiles = settings.savedLocalModels ?? [];
  const [editorOpen, setEditorOpen] = useState(profiles.length === 0);
  const [draft, setDraft] = useState<LocalModelEditorDraft>(emptyLocalModelDraft);

  const patchDraft = (next: Partial<LocalModelEditorDraft>) => {
    const merged = { ...draft, ...next };
    const identityChanged =
      merged.providerId !== draft.providerId ||
      merged.baseUrl !== draft.baseUrl ||
      merged.modelName !== draft.modelName;
    if (identityChanged && !Object.prototype.hasOwnProperty.call(next, 'apiKey')) {
      merged.apiKey = localSessionKey(merged) || 'local-no-key-required';
    }
    setDraft(merged);
  };

  const persist = (next: AiSettings) => {
    onChange(next);
    onSave(next);
  };

  const useProfile = (id: string) => {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    persist(applySavedLocalModel(settings, profile, localSessionKey(profile)));
    setEditorOpen(false);
  };

  const saveDraft = () => {
    if (!draft.baseUrl.trim() || !draft.modelName.trim()) return;
    const profile = createLocalModelProfile({
      id: draft.id,
      label: draft.label.trim() || draft.modelName.trim(),
      providerId: draft.providerId,
      baseUrl: draft.baseUrl,
      modelName: draft.modelName,
      timeoutSeconds: draft.timeoutSeconds,
      temperature: draft.temperature,
      topP: draft.topP,
      topK: draft.topK,
      repeatPenalty: draft.repeatPenalty,
      seed: draft.seed,
      allowCloudWriterFallback: draft.allowCloudWriterFallback,
    });
    const next = applySavedLocalModel(
      { ...settings, savedLocalModels: upsertByIdentity(profiles, profile) },
      profile,
      draft.apiKey,
    );
    persist(next);
    setEditorOpen(false);
  };

  const deleteProfile = (id: string) => {
    const remaining = profiles.filter((item) => item.id !== id);
    const nextActive = remaining[0];
    if (!nextActive) {
      const cleared: AiSettings = {
        ...settings,
        savedLocalModels: undefined,
        activeSavedLocalModelId: undefined,
        localChapterModel: local
          ? { ...local, enabled: false, baseUrl: '', modelName: '' }
          : undefined,
      };
      persist(cleared);
      setDraft(emptyLocalModelDraft());
      setEditorOpen(true);
      return;
    }
    persist({
      ...applySavedLocalModel(settings, nextActive, localSessionKey(nextActive)),
      savedLocalModels: remaining,
    });
  };

  return (
    <section className="detail-card settings-card" aria-labelledby="local-chapter-model-title">
      <div className="settings-card-heading">
        <Puzzle aria-hidden="true" size={18} strokeWidth={1.8} />
        <span id="local-chapter-model-title">专用本地正文模型（可选）</span>
      </div>
      <p className="settings-help-text">
        未启用时正文仍走全局 Cloud Provider。已保存模型以卡片显示，不展示地址、密钥或采样参数。
      </p>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={local?.enabled === true}
          onChange={(event) => {
            if (!local) {
              if (event.target.checked) {
                setDraft(emptyLocalModelDraft());
                setEditorOpen(true);
              }
              return;
            }
            onChange({ localChapterModel: { ...local, enabled: event.target.checked } });
          }}
          style={{ width: 18, height: 18 }}
        />
        启用已通过 Benchmark 的本地 Scene/Beat 正文模型
      </label>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={local?.allowCloudWriterFallback !== false}
          onChange={(event) =>
            local &&
            onChange({
              localChapterModel: { ...local, allowCloudWriterFallback: event.target.checked },
            })
          }
          style={{ width: 18, height: 18 }}
        />
        本地训练、测试或不可用时由云端代写同一 Beat
      </label>

      <SettingsSavedModelCards
        listTestId="local-saved-model-list"
        addTestId="local-saved-model-add"
        cardTestId="local-saved-model-card"
        help="可保存多份本机模型，卡片只显示名称与绑定状态。"
        empty="还没有保存的本地模型。添加后会显示为卡片。"
        addLabel="添加本地模型"
        keyBoundLabel="本次会话已绑定"
        keyMissingLabel="待绑定会话"
        items={profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          badge: '本机 llama-server',
          active: profile.id === settings.activeSavedLocalModelId,
          keyBound: Boolean(localSessionKey(profile)),
          lastTestOk: profile.lastTestOk,
        }))}
        onAdd={() => {
          setDraft(emptyLocalModelDraft());
          setEditorOpen(true);
        }}
        onUse={useProfile}
        onEdit={(id) => {
          const profile = profiles.find((item) => item.id === id);
          if (!profile) return;
          setDraft(draftFromLocalProfile(profile, localSessionKey(profile)));
          setEditorOpen(true);
        }}
        onDelete={deleteProfile}
      />

      {editorOpen && (
        <LocalModelEditor
          draft={draft}
          onChange={patchDraft}
          onSave={saveDraft}
          onCancel={() => {
            setEditorOpen(false);
            const active = profiles.find((item) => item.id === settings.activeSavedLocalModelId);
            if (active) setDraft(draftFromLocalProfile(active, localSessionKey(active)));
          }}
        />
      )}

      <div className="settings-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCheckHealth}
          disabled={healthChecking}
        >
          {healthChecking ? '检查中...' : '检查当前本地模型'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave()}>
          保存可选本地模型设置
        </button>
      </div>
      {healthResult && (
        <div
          data-testid="local-model-health-result"
          className="settings-help-text"
          style={{
            marginTop: 10,
            padding: '9px 12px',
            borderRadius: 8,
            background:
              healthResult.healthOk && healthResult.modelOk && healthResult.smokeOk
                ? 'var(--color-success-bg)'
                : 'var(--color-error-bg)',
          }}
        >
          <strong>{healthResult.message}</strong>
        </div>
      )}
    </section>
  );
}

export default LocalChapterModelSettingsCard;
