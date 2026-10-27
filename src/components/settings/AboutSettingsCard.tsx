import { Info } from 'lucide-react';
import { APP_VERSION, APP_PLATFORM_LABEL } from '../../constants/version';

export default function AboutSettingsCard() {
  return (
    <div className="detail-card settings-card-block" data-testid="settings-about-card">
      <div className="settings-card-header">
        <Info aria-hidden="true" size={18} strokeWidth={1.8} />
        <span className="settings-card-title">关于软件</span>
      </div>
      <div className="settings-card-text">
        <div>
          <strong className="settings-card-lead">AI Novel Studio v{APP_VERSION}</strong>
        </div>
        <div>{APP_PLATFORM_LABEL} AI 长篇小说创作工程系统</div>
        <div>技术栈架构：Tauri (Rust) + React 18 + TypeScript 5 + SQLite</div>
        <div>核心理念：用户控制方向 → AI 分工生成 → 章节逐步采用 → 上下文持续沉淀</div>
        <div className="resource-gap-top">
          <strong>开源仓库：</strong>
          <a
            href="https://github.com/Mon-Knight/AI-Novel-Studio"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-card-link"
          >
            Mon-Knight/AI-Novel-Studio
          </a>
        </div>
      </div>
    </div>
  );
}
