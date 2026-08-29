import { useState, useRef } from 'react';
import type { AiSettings, GatewayModelConfig } from '../../types/ai';
import {
  getDefaultGatewaySettings,
  resolveSessionModelApiKey,
} from '../../services/ai/aiSettingsStore';
import { validateGatewayConfig } from '../../services/ai/realAiClient';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import { createProviderAdapter } from '../../services/ai/providerAdapter';

interface AiGatewaySettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: () => void;
}

function optionalInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export default function AiGatewaySettingsCard({
  settings,
  onChange,
  onSave,
}: AiGatewaySettingsCardProps) {
  const gateway = settings.gateway ?? settings.remoteWriter ?? getDefaultGatewaySettings();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const update = (patch: Partial<GatewayModelConfig>) => {
    const updated = { ...gateway, ...patch };
    const identityChanged =
      updated.providerId !== gateway.providerId ||
      updated.baseUrl !== gateway.baseUrl ||
      updated.modelName !== gateway.modelName;
    if (
      identityChanged &&
      gateway.apiKey ===
        resolveSessionModelApiKey({
          scope: 'gateway',
          providerId: gateway.providerId,
          baseUrl: gateway.baseUrl,
          modelId: gateway.modelName,
        })
    ) {
      updated.apiKey = resolveSessionModelApiKey({
        scope: 'gateway',
        providerId: updated.providerId,
        baseUrl: updated.baseUrl,
        modelId: updated.modelName,
      });
    }
    onChange({ gateway: updated, remoteWriter: updated });
  };

  const handleTestConnection = async () => {
    if (abortControllerRef.current) return;
    try {
      validateGatewayConfig(gateway);
    } catch (err) {
      setTestResult({
        ok: false,
        message: describeUnknownError(err, '配置校验未通过'),
      });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setTesting(true);
    setTestResult(null);
    const start = performance.now();

    try {
      const testSettings: AiSettings = {
        ...settings,
        gateway: {
          ...gateway,
          enabled: true,
        },
      };
      const adapter = createProviderAdapter(testSettings, 'chapter_scene_generate', {
        selected: {
          endpointId: `remote.${gateway.providerId.trim() || 'ai_gateway'}.${gateway.modelName.trim()}`,
          providerId: gateway.providerId.trim() || 'ai_gateway',
          modelId: gateway.modelName.trim(),
          kind: 'remote',
        },
      });

      const result = await adapter.execute(
        {
          taskType: 'chapter_scene_generate',
          messages: [
            {
              role: 'user',
              content: 'ping',
            },
          ],
          maxTokens: 5,
        },
        { signal: controller.signal },
      );

      const latencyMs = Math.round(performance.now() - start);
      setTestResult({
        ok: true,
        message: `✅ 连接成功！响应耗时 ${latencyMs}ms (模型: ${result.modelId})`,
        latencyMs,
      });
    } catch (err) {
      if (controller.signal.aborted || isAiRequestCancelled(err)) {
        setTestResult({ ok: false, message: '测试已取消' });
      } else {
        setTestResult({
          ok: false,
          message: `❌ 连接失败: ${describeUnknownError(err, '请求异常')}`,
        });
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setTesting(false);
    }
  };

  return (
    <section className="detail-card settings-card" aria-labelledby="ai-gateway-model-title">
      <div className="settings-card-heading">
        <span aria-hidden="true">🌐</span>
        <span id="ai-gateway-model-title">AI Model Gateway（外部模型网关 / 可选）</span>
      </div>

      <div
        style={{
          padding: '10px 12px',
          marginBottom: 12,
          borderRadius: 8,
          background: gateway.enabled ? 'var(--color-success-bg)' : 'var(--color-bg-hover)',
          border: '1px solid var(--color-border)',
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--color-text-secondary)',
        }}
      >
        <strong>
          {gateway.enabled ? '✅ 已启用外部 AI Model Gateway 路由' : '☁️ 未启用外部模型网关'}
        </strong>
        <br />
        支持统一接入云 GPU 算力集群、私有 VPC 或第三方 OpenAI-Compatible 外部模型服务。
        <br />
        🔒 <strong>网络与安全策略</strong>：公网 Endpoint 必须使用 <code>https://</code>；局域网 /
        VPC 内网（如 10.x / 172.16-31.x / 192.168.x / 100.64-127.x）允许 <code>http://</code>。
        <strong>所有网关调用均必须配置 API Key / Token 鉴权，不允许匿名调用。</strong>
      </div>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={gateway.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          style={{ width: 18, height: 18 }}
        />
        启用外部 AI Model Gateway 接入（本地不可用时优先降级至网关）
      </label>

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>Provider ID</span>
          <input
            className="form-input"
            value={gateway.providerId}
            onChange={(event) => update({ providerId: event.target.value })}
            placeholder="ai_gateway"
          />
        </label>

        <label className="settings-field">
          <span>
            Endpoint Base URL <span style={{ color: 'var(--color-error)' }}>*</span>
          </span>
          <input
            className="form-input"
            value={gateway.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://gateway.example.com/v1 或 http://10.0.1.20:8000/v1"
          />
        </label>

        <label className="settings-field">
          <span>
            Default Model <span style={{ color: 'var(--color-error)' }}>*</span>
          </span>
          <input
            className="form-input"
            value={gateway.modelName}
            onChange={(event) => update({ modelName: event.target.value })}
            placeholder="如: qwen35-32b-novel-v1"
          />
        </label>

        <label className="settings-field">
          <span>
            API Key / Auth Token <span style={{ color: 'var(--color-error)' }}>*</span>
          </span>
          <input
            className="form-input"
            type="password"
            value={gateway.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder="网关访问 Token / 密钥"
          />
        </label>

        <label className="settings-field">
          <span>超时时间 (秒)</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={1800}
            value={gateway.timeoutSeconds}
            onChange={(event) => update({ timeoutSeconds: Number(event.target.value) || 120 })}
          />
        </label>

        <label className="settings-field">
          <span>上下文窗口上限 (Tokens)</span>
          <input
            className="form-input"
            type="number"
            min={1024}
            max={200000}
            value={gateway.contextTokens ?? 32000}
            onChange={(event) =>
              update({ contextTokens: optionalInteger(event.target.value) ?? 32000 })
            }
          />
        </label>

        <label className="settings-field">
          <span>最大输出 Tokens</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={32000}
            value={gateway.maxTokens ?? 4000}
            onChange={(event) => update({ maxTokens: optionalInteger(event.target.value) ?? 4000 })}
          />
        </label>

        <label className="settings-field">
          <span>Temperature (0 ~ 2.0)</span>
          <input
            className="form-input"
            type="number"
            step="0.05"
            min={0}
            max={2}
            value={gateway.temperature ?? 0.7}
            onChange={(event) => update({ temperature: Number(event.target.value) })}
          />
        </label>

        <label className="settings-field">
          <span>Top P (0 ~ 1.0)</span>
          <input
            className="form-input"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={gateway.topP ?? 0.8}
            onChange={(event) => update({ topP: Number(event.target.value) })}
          />
        </label>

        <label className="settings-field">
          <span>Top K (0 ~ 4096)</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={4096}
            value={gateway.topK ?? 20}
            onChange={(event) => update({ topK: optionalInteger(event.target.value) ?? 20 })}
          />
        </label>

        <label className="settings-field">
          <span>Repeat Penalty (0.01 ~ 3.0)</span>
          <input
            className="form-input"
            type="number"
            step="0.01"
            min={0.01}
            max={3}
            value={gateway.repeatPenalty ?? 1.08}
            onChange={(event) => update({ repeatPenalty: Number(event.target.value) })}
          />
        </label>

        <label className="settings-field">
          <span>Random Seed (可选)</span>
          <input
            className="form-input"
            type="number"
            value={gateway.seed ?? ''}
            placeholder="留空为随机"
            onChange={(event) => update({ seed: optionalInteger(event.target.value) })}
          />
        </label>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? '正在测试连接...' : '⚡ 测试网关连接'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave}>
          保存网关设置
        </button>
      </div>

      {testResult && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            background: testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
            color: testResult.ok ? 'var(--color-success-text)' : 'var(--color-error-text)',
            border: `1px solid ${testResult.ok ? 'var(--color-success-border)' : 'var(--color-error-border)'}`,
          }}
        >
          {testResult.message}
        </div>
      )}
    </section>
  );
}
