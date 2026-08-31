import { useRef, useState } from 'react';
import { Network } from 'lucide-react';
import type { AiSettings, SavedGatewayModelProfile } from '../../types/ai';
import { resolveSessionModelApiKey } from '../../services/ai/aiSettingsStore';
import { validateGatewayConfig } from '../../services/ai/realAiClient';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import { createProviderAdapter } from '../../services/ai/providerAdapter';
import {
  applySavedGatewayModel,
  createGatewayModelProfile,
  upsertByIdentity,
} from '../../services/ai/savedOptionalModels';
import { GatewayModelEditor } from './GatewayModelEditor';
import {
  draftFromGatewayProfile,
  emptyGatewayModelDraft,
  type GatewayModelEditorDraft,
} from './optionalModelEditorDraft';
import { SettingsSavedModelCards } from './SettingsSavedModelCards';

interface AiGatewaySettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: (next?: AiSettings) => void;
}

function gatewaySessionKey(
  profile: Pick<SavedGatewayModelProfile, 'providerId' | 'baseUrl' | 'modelName'>,
): string {
  return resolveSessionModelApiKey({
    scope: 'gateway',
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    modelId: profile.modelName,
  });
}

export default function AiGatewaySettingsCard({
  settings,
  onChange,
  onSave,
}: AiGatewaySettingsCardProps) {
  const gateway = settings.gateway ?? settings.remoteWriter;
  const profiles = settings.savedGatewayModels ?? [];
  const [editorOpen, setEditorOpen] = useState(profiles.length === 0);
  const [draft, setDraft] = useState<GatewayModelEditorDraft>(emptyGatewayModelDraft);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const persist = (next: AiSettings) => {
    onChange(next);
    onSave(next);
  };

  const patchDraft = (next: Partial<GatewayModelEditorDraft>) => {
    const merged = { ...draft, ...next };
    const identityChanged =
      merged.providerId !== draft.providerId ||
      merged.baseUrl !== draft.baseUrl ||
      merged.modelName !== draft.modelName;
    if (identityChanged && !Object.prototype.hasOwnProperty.call(next, 'apiKey')) {
      merged.apiKey = gatewaySessionKey(merged);
    }
    setDraft(merged);
  };

  const handleTestConnection = async () => {
    if (!gateway || abortControllerRef.current) return;
    try {
      validateGatewayConfig(gateway);
    } catch (err) {
      setTestResult({ ok: false, message: describeUnknownError(err, '配置校验未通过') });
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setTesting(true);
    setTestResult(null);
    try {
      const adapter = createProviderAdapter(
        { ...settings, gateway: { ...gateway, enabled: true } },
        'chapter_scene_generate',
        {
          selected: {
            endpointId:
              'remote.' +
              (gateway.providerId.trim() || 'ai_gateway') +
              '.' +
              gateway.modelName.trim(),
            providerId: gateway.providerId.trim() || 'ai_gateway',
            modelId: gateway.modelName.trim(),
            kind: 'remote',
          },
        },
      );
      await adapter.execute(
        {
          taskType: 'chapter_scene_generate',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 5,
        },
        { signal: controller.signal },
      );
      setTestResult({ ok: true, message: '连接成功' });
    } catch (err) {
      setTestResult({
        ok: controller.signal.aborted || isAiRequestCancelled(err) ? false : false,
        message:
          controller.signal.aborted || isAiRequestCancelled(err)
            ? '测试已取消'
            : '连接失败: ' + describeUnknownError(err, '请求异常'),
      });
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setTesting(false);
    }
  };

  return (
    <section className="detail-card settings-card" aria-labelledby="ai-gateway-model-title">
      <div className="settings-card-heading">
        <Network aria-hidden="true" size={18} strokeWidth={1.8} />
        <span id="ai-gateway-model-title">AI Model Gateway（外部模型网关 / 可选）</span>
      </div>
      <p className="settings-help-text">
        公网必须 https，内网可 http。已保存网关以卡片显示，不展示地址、Token
        或采样参数。调用必须鉴权。
      </p>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={gateway?.enabled === true}
          disabled={!gateway}
          onChange={(event) =>
            gateway &&
            onChange({
              gateway: { ...gateway, enabled: event.target.checked },
              remoteWriter: { ...gateway, enabled: event.target.checked },
            })
          }
          style={{ width: 18, height: 18 }}
        />
        启用外部 AI Model Gateway 接入
      </label>

      <SettingsSavedModelCards
        listTestId="gateway-saved-model-list"
        addTestId="gateway-saved-model-add"
        cardTestId="gateway-saved-model-card"
        help="可保存多份外部网关模型，卡片只显示名称与绑定状态。"
        empty="还没有保存的网关模型。添加后会显示为卡片。"
        addLabel="添加网关模型"
        items={profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          badge: '外部网关',
          active: profile.id === settings.activeSavedGatewayModelId,
          keyBound: Boolean(gatewaySessionKey(profile)),
          lastTestOk: profile.lastTestOk,
        }))}
        onAdd={() => {
          setDraft(emptyGatewayModelDraft());
          setEditorOpen(true);
        }}
        onUse={(id) => {
          const profile = profiles.find((item) => item.id === id);
          if (profile) {
            persist(applySavedGatewayModel(settings, profile, gatewaySessionKey(profile)));
            setEditorOpen(false);
          }
        }}
        onEdit={(id) => {
          const profile = profiles.find((item) => item.id === id);
          if (!profile) return;
          setDraft(draftFromGatewayProfile(profile, gatewaySessionKey(profile)));
          setEditorOpen(true);
        }}
        onDelete={(id) => {
          const remaining = profiles.filter((item) => item.id !== id);
          const nextActive = remaining[0];
          if (!nextActive) {
            persist({
              ...settings,
              savedGatewayModels: undefined,
              activeSavedGatewayModelId: undefined,
              gateway: undefined,
              remoteWriter: undefined,
            });
            setDraft(emptyGatewayModelDraft());
            setEditorOpen(true);
            return;
          }
          persist({
            ...applySavedGatewayModel(settings, nextActive, gatewaySessionKey(nextActive)),
            savedGatewayModels: remaining,
          });
        }}
      />

      {editorOpen && (
        <GatewayModelEditor
          draft={draft}
          onChange={patchDraft}
          onSave={() => {
            if (!draft.baseUrl.trim() || !draft.modelName.trim()) return;
            const profile = createGatewayModelProfile({
              id: draft.id,
              label: draft.label.trim() || draft.modelName.trim(),
              providerId: draft.providerId,
              baseUrl: draft.baseUrl,
              modelName: draft.modelName,
              timeoutSeconds: draft.timeoutSeconds,
              contextTokens: draft.contextTokens,
              maxTokens: draft.maxTokens,
              temperature: draft.temperature,
            });
            persist(
              applySavedGatewayModel(
                { ...settings, savedGatewayModels: upsertByIdentity(profiles, profile) },
                profile,
                draft.apiKey,
              ),
            );
            setEditorOpen(false);
          }}
          onCancel={() => setEditorOpen(false)}
        />
      )}

      <div className="settings-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void handleTestConnection()}
          disabled={testing || !gateway}
        >
          {testing ? '正在测试...' : '测试当前网关'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave()}>
          保存网关设置
        </button>
      </div>
      {testResult && (
        <div
          role="status"
          className="settings-help-text"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            background: testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
          }}
        >
          {testResult.message}
        </div>
      )}
    </section>
  );
}
