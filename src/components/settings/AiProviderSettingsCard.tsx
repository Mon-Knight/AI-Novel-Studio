import type { AiSettings } from '../../types/ai';
import { aiSettingsService } from '../../services/ai/aiClient';

interface AiProviderSettingsCardProps {
  settings: AiSettings;
  message: string;
  testing: boolean;
  update: (patch: Partial<AiSettings>) => void;
  handleTestConnection: () => void;
  onStopTest: () => void;
  handleSave: () => void;
}

function optionalPrice(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
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
  return (
    <>
      {/* AI 接口设置 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>全局 Cloud Provider</span>
        </div>
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--color-text-secondary)',
          }}
        >
          负责世界观、规划、Scene、质检等导演任务；未启用可用的专用本地正文模型时，也负责临时
          Scene/Beat 与整章候选正文生成。支持 DeepSeek 及 OpenAI-Compatible 云端 API。
        </div>

        {/* 当前 AI 模式 */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 10,
            background:
              settings.runtimeMode === 'mock' ? 'var(--color-success-bg)' : 'var(--color-info-bg)',
            border:
              settings.runtimeMode === 'mock'
                ? '1px solid var(--color-success-border)'
                : '1px solid var(--color-info-border)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
            当前模式：{settings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API 模式'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {settings.runtimeMode === 'mock'
              ? '所有 AI 功能使用本地模拟，不请求外部 API。'
              : `模型：${settings.modelName || '未配置'}`}
            {settings.lastTestAt && <> · 最近测试：{settings.lastTestOk ? '✅ 成功' : '❌ 失败'}</>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mock 模式 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              background: 'var(--color-bg-hover)',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <input
              type="checkbox"
              id="mockMode"
              checked={settings.runtimeMode === 'mock'}
              onChange={(e) => update({ runtimeMode: e.target.checked ? 'mock' : 'api' })}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <div>
              <label
                htmlFor="mockMode"
                style={{ fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              >
                Mock 模式 {settings.runtimeMode === 'mock' ? '✅ 已开启' : '❌ 已关闭'}
              </label>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                开启后所有 AI 功能使用本地模拟结果，关闭后使用真实 API。两种模式互斥。
              </div>
            </div>
          </div>

          {/* API 配置区域 — 始终可见 */}
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--color-bg-hover)',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--color-text-secondary)',
              }}
            >
              🔧 API 接口配置{settings.runtimeMode === 'mock' ? '（Mock 模式下可选）' : '（必填）'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="panel-field-label">Provider</label>
                <select
                  className="panel-select"
                  value={settings.runtimeMode === 'mock' ? 'mock' : settings.provider}
                  onChange={(e) => update({ provider: e.target.value as AiSettings['provider'] })}
                  disabled={settings.runtimeMode === 'mock'}
                  style={{ width: '100%' }}
                >
                  <option value="mock" disabled={settings.runtimeMode === 'api'}>
                    mock
                  </option>
                  <option value="deepseek">deepseek</option>
                  <option value="openai_compatible">openai_compatible</option>
                </select>
              </div>
              <div>
                <label className="panel-field-label">
                  API Base URL{' '}
                  {settings.runtimeMode === 'api' && (
                    <span style={{ color: 'var(--color-error)' }}>*</span>
                  )}
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={settings.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  placeholder="例如：https://api.deepseek.com/v1 或你的 OpenAI 兼容服务地址"
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
              <div>
                <label className="panel-field-label">
                  API Key{' '}
                  {settings.runtimeMode === 'api' && (
                    <span style={{ color: 'var(--color-error)' }}>*</span>
                  )}
                </label>
                <input
                  type="password"
                  className="form-input"
                  value={settings.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  style={{ width: '100%', fontSize: 13 }}
                />
                {settings.apiKey ? (
                  <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 4 }}>
                    ✅ 本次应用会话已绑定到当前模型：
                    {aiSettingsService.maskApiKey(settings.apiKey)}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    ⚠️ 未填写 API Key
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Key 仅保留在本机进程内存，不写入项目、数据库、LocalStorage、备份或同步服务；
                  真实鉴权仅发送到当前 Provider、Base URL 与模型组成的精确 Endpoint。
                </div>
              </div>
              <div>
                <label className="panel-field-label">
                  模型名称{' '}
                  {settings.runtimeMode === 'api' && (
                    <span style={{ color: 'var(--color-error)' }}>*</span>
                  )}
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={settings.modelName}
                  onChange={(e) => update({ modelName: e.target.value })}
                  placeholder="例如：deepseek-chat / deepseek-reasoner"
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="panel-field-label">温度参数</label>
                  <input
                    type="number"
                    className="form-input"
                    value={settings.temperature || 0.7}
                    onChange={(e) => update({ temperature: Number(e.target.value) })}
                    min={0}
                    max={2}
                    step={0.1}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="panel-field-label">最大输出 Token</label>
                  <input
                    type="number"
                    className="form-input"
                    value={settings.maxTokens || 8000}
                    onChange={(e) => update({ maxTokens: Number(e.target.value) })}
                    min={100}
                    max={64000}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div>
                <label className="panel-field-label">超时时间（秒）</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.timeoutSeconds || 120}
                  onChange={(e) => update({ timeoutSeconds: Number(e.target.value) })}
                  min={30}
                  max={600}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="panel-field-label">输入价格（USD / 百万 Token）</label>
                  <input
                    type="number"
                    className="form-input"
                    value={settings.inputPricePerMillionTokens ?? ''}
                    onChange={(event) =>
                      update({
                        inputPricePerMillionTokens: optionalPrice(event.target.value),
                      })
                    }
                    min={0}
                    step={0.000001}
                    placeholder="未配置"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="panel-field-label">输出价格（USD / 百万 Token）</label>
                  <input
                    type="number"
                    className="form-input"
                    value={settings.outputPricePerMillionTokens ?? ''}
                    onChange={(event) =>
                      update({
                        outputPricePerMillionTokens: optionalPrice(event.target.value),
                      })
                    }
                    min={0}
                    step={0.000001}
                    placeholder="未配置"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* DeepSeek V4 配置说明 */}
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--color-info-bg)',
              borderRadius: 8,
              border: '1px solid var(--color-info-border)',
              fontSize: 12,
              color: 'var(--color-info-text)',
              lineHeight: 1.8,
            }}
          >
            <strong>📖 DeepSeek V4 / OpenAI-Compatible 配置说明：</strong>
            <br />
            1. 关闭 Mock 模式
            <br />
            2. 填写 API Base URL（你的服务商地址）
            <br />
            3. 填写 API Key
            <br />
            4. 填写模型名称
            <br />
            5. 点击「测试连接」验证
            <br />
            6. 点击「保存设置」
            <br />
            <span style={{ color: 'var(--color-text-muted)' }}>
              不同服务商的 Base URL 和模型名称可能不同，请以服务商提供的信息为准。
            </span>
          </div>

          {message && (
            <div
              style={{
                fontSize: 13,
                padding: '6px 12px',
                background: message.includes('✅')
                  ? 'var(--color-success-bg)'
                  : message.includes('❌')
                    ? 'var(--color-error-bg)'
                    : 'var(--color-primary-light)',
                borderRadius: 6,
                color: message.includes('✅')
                  ? 'var(--color-success-text)'
                  : message.includes('❌')
                    ? 'var(--color-error-text)'
                    : 'var(--color-primary)',
              }}
            >
              {message}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? '⏳ 测试中...' : '🔌 测试连接'}
            </button>
            {testing && (
              <button className="btn btn-secondary btn-sm" onClick={() => onStopTest()}>
                停止测试
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleSave}>
              💾 保存设置
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default AiProviderSettingsCard;
