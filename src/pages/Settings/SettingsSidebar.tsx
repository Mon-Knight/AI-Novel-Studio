import {
  ArrowLeft,
  Bot,
  Database,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type SettingsTabKey = 'general' | 'ai_models' | 'governance' | 'data' | 'diagnostics';

export interface SettingsNavTab {
  key: SettingsTabKey;
  label: string;
  icon: LucideIcon;
  description: string;
}

const SETTINGS_TABS: SettingsNavTab[] = [
  { key: 'general', label: '常规与外观', icon: Palette, description: '主题、更新与基本偏好' },
  {
    key: 'ai_models',
    label: 'AI 模型配置',
    icon: Bot,
    description: 'Cloud / Local / Gateway 模型',
  },
  { key: 'governance', label: '网关与流控', icon: ShieldCheck, description: '预算限制与安全合规' },
  { key: 'data', label: '数据与存储', icon: Database, description: '数据库、备份与数据修复' },
  { key: 'diagnostics', label: '诊断与关于', icon: Search, description: '系统诊断与软件信息' },
];

interface SettingsSidebarProps {
  activeTab: SettingsTabKey;
  onSelectTab: (tab: SettingsTabKey) => void;
  onBackHome: () => void;
}

export function SettingsSidebar({ activeTab, onSelectTab, onBackHome }: SettingsSidebarProps) {
  return (
    <aside
      className="settings-sidebar"
      data-testid="settings-sidebar"
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--color-bg-sidebar, #f8fafc)',
        borderRight: '1px solid var(--color-border, #e2e8f0)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '20px 12px',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            padding: '0 8px 16px 8px',
            color: 'var(--color-text-primary, #0f172a)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 12,
          }}
        >
          <Settings2 aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>设置中心</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={`settings-nav-${tab.key}`}
                onClick={() => onSelectTab(tab.key)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 3,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--color-primary-light, #e0e7ff)' : 'transparent',
                  color: isActive
                    ? 'var(--color-primary, #4338ca)'
                    : 'var(--color-text-secondary, #475569)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>{tab.label}</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    paddingLeft: 25,
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 400,
                  }}
                >
                  {tab.description}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        data-testid="settings-back-home-btn"
        onClick={onBackHome}
        style={{ width: '100%', marginTop: 16 }}
      >
        <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
        返回首页
      </button>
    </aside>
  );
}
