import { SunMoon } from 'lucide-react';
import { useThemeStore, type ThemePreference } from '../../store/themeStore';

const OPTIONS: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: 'system', label: '跟随系统', description: '自动同步 Windows 外观设置' },
  { value: 'light', label: '浅色', description: '始终使用明亮写作界面' },
  { value: 'dark', label: '深色', description: '始终使用低亮度写作界面' },
];

function AppearanceSettingsCard() {
  const preference = useThemeStore((state) => state.preference);
  const effectiveTheme = useThemeStore((state) => state.effectiveTheme);
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <section className="detail-card settings-card" aria-labelledby="appearance-settings-title">
      <div className="settings-card-heading">
        <SunMoon aria-hidden="true" size={18} strokeWidth={1.8} />
        <span id="appearance-settings-title">外观与主题</span>
      </div>
      <div className="theme-choice-group" role="radiogroup" aria-label="应用主题">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preference === option.value}
            className={`theme-choice${preference === option.value ? ' is-selected' : ''}`}
            onClick={() => setPreference(option.value)}
          >
            <span className="theme-choice-label">{option.label}</span>
            <span className="theme-choice-description">{option.description}</span>
          </button>
        ))}
      </div>
      <div className="settings-help-text" role="status">
        当前实际显示：{effectiveTheme === 'dark' ? '深色' : '浅色'}。设置仅保存在本机。
      </div>
    </section>
  );
}

export default AppearanceSettingsCard;
