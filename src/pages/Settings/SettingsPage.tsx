import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiSettingsService } from '../../services/ai/aiClient';
import { novelRepository } from '../../services/database/novelRepository';
import type { AiSettings } from '../../types/ai';
import '../../styles/novel-detail.css';

function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AiSettings>(aiSettingsService.getSettings());
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [repairMsg, setRepairMsg] = useState('');

  const handleRepairData = async () => {
    if (!confirm('将尝试修复异常作品数据，修复前会自动备份。是否继续？')) return;
    try {
      const result = await novelRepository.repairData();
      setRepairMsg(`✅ 修复完成：${result.before} 条 → ${result.after} 条（已备份原数据）`);
      setTimeout(() => setRepairMsg(''), 4000);
    } catch (e: any) {
      setRepairMsg(`❌ 修复失败：${e.message || '未知错误'}`);
    }
  };

  useEffect(() => {
    setSettings(aiSettingsService.getSettings());
  }, []);

  const handleSave = () => {
    // 保存前确保 mockMode 与 runtimeMode 一致
    const final = { ...settings, mockMode: settings.runtimeMode === 'mock' };
    aiSettingsService.saveSettings(final);
    setSettings(final);
    setMessage('✅ AI 设置已保存');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleTestConnection = async () => {
    if (settings.runtimeMode === 'mock') { setMessage('Mock 模式无需测试连接，Mock 工作流可用'); setTimeout(() => setMessage(''), 3000); return; }
    if (!settings.baseUrl || !settings.apiKey || !settings.modelName) { setMessage('请先填写 API Base URL、API Key 和模型名称'); setTimeout(() => setMessage(''), 3000); return; }
    setTesting(true); setMessage('正在测试连接...');
    const start = Date.now();
    try {
      const result = await aiSettingsService.testConnection(settings);
      const latency = Date.now() - start;
      const updated = { ...settings, lastTestAt: new Date().toISOString(), lastTestOk: result.ok, lastTestMessage: result.message };
      aiSettingsService.saveSettings(updated);
      setSettings(updated);
      setMessage(result.ok ? `✅ 连接成功！（${latency}ms）` : `❌ 连接失败：${result.message}`);
    } catch (e: any) { setMessage(`❌ 连接失败：${e.message || '未知错误'}`); }
    finally { setTesting(false); }
  };

  const update = (patch: Partial<AiSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  return (
    <div style={{ padding: 32, maxWidth: 640, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>⚙️ 设置中心</div>

      {/* AI 接口设置 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>AI 接口设置</span>
        </div>

        {/* 当前 AI 模式 */}
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 10, background: settings.runtimeMode === 'mock' ? '#e8f5e9' : '#e3f2fd', border: settings.runtimeMode === 'mock' ? '1px solid #c8e6c9' : '1px solid #bbdefb' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
            当前模式：{settings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API 模式'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {settings.runtimeMode === 'mock' ? '所有 AI 功能使用本地模拟，不请求外部 API。' : `模型：${settings.modelName || '未配置'}`}
            {settings.lastTestAt && <> · 最近测试：{settings.lastTestOk ? '✅ 成功' : '❌ 失败'}</>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mock 模式 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fafafa', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <input type="checkbox" id="mockMode" checked={settings.runtimeMode === 'mock'}
              onChange={(e) => update({ runtimeMode: e.target.checked ? 'mock' : 'api' })}
              style={{ width: 18, height: 18, cursor: 'pointer' }} />
            <div>
              <label htmlFor="mockMode" style={{ fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Mock 模式 {settings.runtimeMode === 'mock' ? '✅ 已开启' : '❌ 已关闭'}
              </label>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                开启后所有 AI 功能使用本地模拟结果，关闭后使用真实 API。两种模式互斥。
              </div>
            </div>
          </div>

          {/* API 配置区域 — 始终可见 */}
          <div style={{ padding: '10px 14px', background: '#fafafa', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
              🔧 API 接口配置{settings.mockMode ? '（Mock 模式下可选）' : '（必填）'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="panel-field-label">API Base URL {!settings.mockMode && <span style={{ color: 'var(--color-error)' }}>*</span>}</label>
                <input type="text" className="form-input" value={settings.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  placeholder="例如：https://api.deepseek.com/v1 或你的 OpenAI 兼容服务地址"
                  style={{ width: '100%', fontSize: 13 }} />
              </div>
              <div>
                <label className="panel-field-label">API Key {!settings.mockMode && <span style={{ color: 'var(--color-error)' }}>*</span>}</label>
                <input type="password" className="form-input" value={settings.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  style={{ width: '100%', fontSize: 13 }} />
                {settings.apiKey ? (
                  <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 4 }}>
                    ✅ 已保存：{aiSettingsService.maskApiKey(settings.apiKey)}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    ⚠️ 未填写 API Key
                  </div>
                )}
              </div>
              <div>
                <label className="panel-field-label">模型名称 {!settings.mockMode && <span style={{ color: 'var(--color-error)' }}>*</span>}</label>
                <input type="text" className="form-input" value={settings.modelName}
                  onChange={(e) => update({ modelName: e.target.value })}
                  placeholder="例如：deepseek-chat / deepseek-reasoner"
                  style={{ width: '100%', fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="panel-field-label">温度参数</label>
                  <input type="number" className="form-input" value={settings.temperature || 0.7}
                    onChange={(e) => update({ temperature: Number(e.target.value) })}
                    min={0} max={2} step={0.1} style={{ width: '100%' }} />
                </div>
                <div>
                  <label className="panel-field-label">最大输出 Token</label>
                  <input type="number" className="form-input" value={settings.maxTokens || 4000}
                    onChange={(e) => update({ maxTokens: Number(e.target.value) })}
                    min={100} max={32000} style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <label className="panel-field-label">超时时间（秒）</label>
                <input type="number" className="form-input" value={settings.timeoutSeconds || 120}
                  onChange={(e) => update({ timeoutSeconds: Number(e.target.value) })}
                  min={30} max={600} style={{ width: '100%' }} />
              </div>
            </div>
          </div>

          {/* DeepSeek V4 配置说明 */}
          <div style={{ padding: '10px 14px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1', lineHeight: 1.8 }}>
            <strong>📖 DeepSeek V4 / OpenAI-Compatible 配置说明：</strong><br />
            1. 关闭 Mock 模式<br />
            2. 填写 API Base URL（你的服务商地址）<br />
            3. 填写 API Key<br />
            4. 填写模型名称<br />
            5. 点击「测试连接」验证<br />
            6. 点击「保存设置」<br />
            <span style={{ color: 'var(--color-text-muted)' }}>不同服务商的 Base URL 和模型名称可能不同，请以服务商提供的信息为准。</span>
          </div>

          {message && (
            <div style={{ fontSize: 13, padding: '6px 12px', background: message.includes('✅') ? '#dcfce7' : message.includes('❌') ? '#fee2e2' : 'var(--color-primary-light)', borderRadius: 6, color: message.includes('✅') ? '#166534' : message.includes('❌') ? '#991b1b' : 'var(--color-primary)' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleTestConnection} disabled={testing}>
              {testing ? '⏳ 测试中...' : '🔌 测试连接'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>💾 保存设置</button>
          </div>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="detail-card" style={{ marginBottom: 16, border: '1px solid #ffcdd2', background: '#fff5f5' }}>
        <div style={{ fontSize: 14, color: '#c62828', lineHeight: 1.8 }}>
          <strong>⚠️ 安全提醒</strong>
          <ul style={{ paddingLeft: 18, marginTop: 4, fontSize: 13 }}>
            <li>API Key 仅保存在本地，不会上传到任何服务器</li>
            <li>请勿将 API Key 提交到 GitHub</li>
            <li>AI 任务记录不会保存完整 API Key</li>
          </ul>
        </div>
      </div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>数据与存储</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div>存储方式：LocalStorage（浏览器模式）/ SQLite（Tauri 桌面模式）</div>
          <div>数据目录：<code>C:\Users\...\AppData\Local\AI Novel Studio\</code></div>
          <div style={{ marginTop: 8 }}>
            <strong>📦 备份与恢复：</strong><br />
            · 在作品详情页使用「💾 备份完整 JSON」导出全部数据<br />
            · 在首页使用「📋 导入 JSON」恢复已备份的作品<br />
            · 备份文件包含作品、章节、草稿、设定、角色、事件等
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>🔧 数据修复：</strong><br />
            <button className="btn btn-secondary btn-sm" onClick={handleRepairData} style={{ marginTop: 4 }}>
              🔧 修复异常作品数据
            </button>
            {repairMsg && <div style={{ marginTop: 4, fontSize: 12, color: repairMsg.includes('✅') ? 'var(--color-success)' : 'var(--color-error)' }}>{repairMsg}</div>}
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              修复缺失字段、异常日期、损坏记录。修复前自动备份。
            </div>
          </div>
        </div>
      </div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>ℹ️</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>关于软件</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div><strong>AI Novel Studio v1.0.14</strong></div>
          <div>Windows 桌面端 AI 小说创作工作台</div>
          <div>技术路线：Tauri + React + TypeScript + SQLite</div>
          <div>本地路径：F:\ai-novel-studio</div>
          <div>项目定位：逐章辅助完成长篇小说创作</div>
          <div style={{ marginTop: 8 }}>GitHub：<a href="https://github.com/Mon-Knight/AI-Novel-Studio" target="_blank" rel="noopener">Mon-Knight/AI-Novel-Studio</a></div>
        </div>
      </div>

      <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ marginTop: 8 }}>
        ← 返回首页
      </button>
    </div>
  );
}

export default SettingsPage;
