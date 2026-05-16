import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiSettingsService } from '../../services/ai/aiClient';
import type { AiSettings } from '../../types/ai';
import '../../styles/novel-detail.css';

function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AiSettings>(aiSettingsService.getSettings());
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSettings(aiSettingsService.getSettings());
  }, []);

  const handleSave = () => {
    aiSettingsService.saveSettings(settings);
    setMessage('AI 设置已保存');
    setTimeout(() => setMessage(''), 2000);
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mock 模式 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: settings.mockMode ? '#e8f5e9' : '#fff3e0', borderRadius: 8, border: settings.mockMode ? '1px solid #c8e6c9' : '1px solid #ffe0b2' }}>
            <input type="checkbox" id="mockMode" checked={settings.mockMode}
              onChange={(e) => update({ mockMode: e.target.checked })}
              style={{ width: 18, height: 18, cursor: 'pointer' }} />
            <div>
              <label htmlFor="mockMode" style={{ fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Mock 模式 {settings.mockMode ? '✅ 已开启' : '❌ 已关闭'}
              </label>
              <div className="text-sm text-muted">
                {settings.mockMode
                  ? '使用模拟 AI 返回正文，方便测试工作流。'
                  : '使用真实 AI API，需要正确配置下方参数。'}
              </div>
            </div>
          </div>

          {!settings.mockMode && (
            <>
              <div>
                <label className="panel-field-label">API Base URL</label>
                <input type="text" className="form-input" value={settings.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="panel-field-label">API Key</label>
                <input type="password" className="form-input" value={settings.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  style={{ width: '100%' }} />
                {settings.apiKey && (
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                    当前 Key：{aiSettingsService.maskApiKey(settings.apiKey)}
                  </div>
                )}
              </div>
              <div>
                <label className="panel-field-label">模型名称</label>
                <input type="text" className="form-input" value={settings.modelName}
                  onChange={(e) => update({ modelName: e.target.value })}
                  placeholder="gpt-4 / deepseek-chat" style={{ width: '100%' }} />
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
            </>
          )}

          {message && (
            <div style={{ fontSize: 13, padding: '6px 12px', background: 'var(--color-primary-light)', borderRadius: 6, color: 'var(--color-primary)' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
          <div>存储方式：LocalStorage（浏览器本地存储）</div>
          <div>数据库：SQLite（Tauri 环境下自动启用）</div>
          <div>数据保存位置：浏览器缓存 / 应用数据目录</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            💡 完整数据备份与恢复功能将在后续版本增强
          </div>
        </div>
      </div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>ℹ️</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>关于软件</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div><strong>AI Novel Studio v1.0.0</strong></div>
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
