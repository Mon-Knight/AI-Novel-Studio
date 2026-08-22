import { useState, useRef } from 'react';
import type { AiSettings, RemoteWriterSettings } from '../../types/ai';
import { getDefaultRemoteWriterSettings } from '../../services/ai/aiSettingsStore';
import { validateRemoteWriterConfig } from '../../services/ai/realAiClient';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import { createProviderAdapter } from '../../services/ai/providerAdapter';

interface RemoteWriterSettingsCardProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onSave: () => void;
}

function optionalInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export default function RemoteWriterSettingsCard({
  settings,
  onChange,
  onSave,
}: RemoteWriterSettingsCardProps) {
  const remote = settings.remoteWriter ?? getDefaultRemoteWriterSettings();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const update = (patch: Partial<RemoteWriterSettings>) => {
    onChange({ remoteWriter: { ...remote, ...patch } });
  };

  const handleTestConnection = async () => {
    if (abortControllerRef.current) return;
    try {
      validateRemoteWriterConfig(remote);
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
        remoteWriter: {
          ...remote,
          enabled: true,
        },
      };
      const adapter = createProviderAdapter(testSettings, 'chapter_scene_generate', {
        selected: {
          endpointId: `remote.${remote.providerId.trim() || 'remote_openai_compatible'}.${remote.modelName.trim()}`,
          providerId: remote.providerId.trim() || 'remote_openai_compatible',
          modelId: remote.modelName.trim(),
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
    <section className="detail-card settings-card" aria-labelledby="remote-writer-model-title">
      <div className="settings-card-heading">
        <span aria-hidden="true">🌐</span>
        <span id="remote-writer-model-title">专用远程正文模型（Remote Writer / 可选）</span>
      </div>

      <div
        style={{
          padding: '10px 12px',
          marginBottom: 12,
          borderRadius: 8,
          background: remote.enabled ? 'var(--color-success-bg)' : 'var(--color-bg-hover)',
          border: '1px solid var(--color-border)',
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--color-text-secondary)',
        }}
      >
        <strong>
          {remote.enabled ? '✅ 已启用专用远程作家路由' : '☁️ 未启用独立远程作家'}
        </strong>
        <br />
        支持部署在 GPU 服务器、私有云或云端 VPC 的远程 OpenAI-Compatible 正文模型。
        <br />
        🔒 <strong>网络与安全策略</strong>：公网 Endpoint 必须使用 <code>https://</code>；局域网 /
        VPC 内网（如 10.x / 172.16-31.x / 192.168.x / 100.64-127.x）允许 <code>http://</code>。
        <strong>所有远程调用均必须配置 API Key / Token 鉴权，不允许匿名调用。</strong>
      </div>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={remote.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          style={{ width: 18, height: 18 }}
        />
        启用专用远程 Scene/Beat 正文模型（优先于全局云端 Fallback）
      </label>

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>Provider ID</span>
          <input
            className="form-input"
            value={remote.providerId}
            onChange={(event) => update({ providerId: event.target.value })}
            placeholder="remote_openai_compatible"
          />
        </label>
        <label className="settings-field">
          <span>模型名称</span>
          <input
            className="form-input"
            value={remote.modelName}
            onChange={(event) => update({ modelName: event.target.value })}
            placeholder="qwen35-32b-novel-v1"
          />
        </label>
        <label className="settings-field" style={{ gridColumn: '1 / -1' }}>
          <span>OpenAI-Compatible Base URL（公网 HTTPS 或 VPC 内网 HTTP/HTTPS）</span>
          <input
            className="form-input"
            value={remote.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://api.writer.yourdomain.com/v1 或 http://10.0.1.20:8000/v1"
          />
        </label>
        <label className="settings-field" style={{ gridColumn: '1 / -1' }}>
          <span>API Key / Token（必填，禁止匿名访问）</span>
          <input
            className="form-input"
            type="password"
            value={remote.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder="Bearer token 或 API Key"
          />
        </label>
        <label className="settings-field">
          <span>上下文 Token 预算</span>
          <input
            className="form-input"
            type="number"
            min={1024}
            max={200000}
            value={remote.contextTokens ?? 32000}
            onChange={(event) =>
              update({ contextTokens: optionalInteger(event.target.value) ?? 32000 })
            }
          />
        </label>
        <label className="settings-field">
          <span>单次最大输出 Token</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={32000}
            value={remote.maxTokens ?? 4000}
            onChange={(event) =>
              update({ maxTokens: optionalInteger(event.target.value) ?? 4000 })
            }
          />
        </label>
        <label className="settings-field">
          <span>请求超时（秒）</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={1800}
            value={remote.timeoutSeconds}
            onChange={(event) => update({ timeoutSeconds: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>温度 (Temperature)</span>
          <input
            className="form-input"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={remote.temperature ?? 0.7}
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
            value={remote.topP ?? 0.8}
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
            value={remote.topK ?? 20}
            onChange={(event) => update({ topK: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>Repeat Penalty</span>
          <input
            className="form-input"
            type="number"
            min={0.01}
            max={3}
            step={0.01}
            value={remote.repeatPenalty ?? 1.08}
            onChange={(event) => update({ repeatPenalty: Number(event.target.value) })}
          />
        </label>
        <label className="settings-field">
          <span>随机种子 (Seed，可选)</span>
          <input
            className="form-input"
            type="number"
            value={remote.seed ?? ''}
            onChange={(event) => update({ seed: optionalInteger(event.target.value) })}
            placeholder="留空表示随机"
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={testing}
          onClick={handleTestConnection}
        >
          {testing ? '正在测试连接...' : '测试远程模型连接'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave}>
          保存远程模型设置
        </button>
      </div>

      {testResult && (
        <div
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
