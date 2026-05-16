import { useNavigate } from 'react-router-dom';

function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: 32, maxWidth: 600, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>⚙️ 设置中心</div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>AI 接口设置</span>
        </div>
        <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
          AI 小说生成功能将在 v0.5.0 接入。请勿在此版本填写真实 API Key。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="panel-field-label">API Base URL</label>
            <input type="text" className="form-input" placeholder="https://api.openai.com/v1" disabled
              style={{ width: '100%', opacity: 0.6 }} />
          </div>
          <div>
            <label className="panel-field-label">API Key</label>
            <input type="password" className="form-input" placeholder="sk-..." disabled
              style={{ width: '100%', opacity: 0.6 }} />
          </div>
          <div>
            <label className="panel-field-label">模型名称</label>
            <input type="text" className="form-input" placeholder="gpt-4" disabled
              style={{ width: '100%', opacity: 0.6 }} />
          </div>
        </div>
      </div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>关于</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div>AI Novel Studio v0.2.0</div>
          <div>Windows 桌面端 AI 小说创作工作台</div>
          <div>技术路线：Tauri + React + TypeScript + SQLite</div>
        </div>
      </div>

      <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ marginTop: 8 }}>
        ← 返回首页
      </button>
    </div>
  );
}

export default SettingsPage;
