import { APP_VERSION, APP_PLATFORM_LABEL } from '../../constants/version';

export default function AboutSettingsCard() {
  return (
    <div className="detail-card" data-testid="settings-about-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>ℹ️</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>关于软件</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
        <div>
          <strong style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
            AI Novel Studio v{APP_VERSION}
          </strong>
        </div>
        <div>{APP_PLATFORM_LABEL} AI 长篇小说创作工程系统</div>
        <div>技术栈架构：Tauri (Rust) + React 18 + TypeScript 5 + SQLite</div>
        <div>核心理念：用户控制方向 → AI 分工生成 → 章节逐步采用 → 上下文持续沉淀</div>
        <div style={{ marginTop: 8 }}>
          <strong>开源仓库：</strong>
          <a
            href="https://github.com/Mon-Knight/AI-Novel-Studio"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-primary, #4f46e5)', marginLeft: 4 }}
          >
            Mon-Knight/AI-Novel-Studio
          </a>
        </div>
      </div>
    </div>
  );
}
