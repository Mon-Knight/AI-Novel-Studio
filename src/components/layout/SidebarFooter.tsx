import { Bot, ChevronsUpDown, Database, Info, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../../constants/version';
import { useThemeStore, type ThemePreference } from '../../store/themeStore';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';

interface SidebarFooterProps {
  className?: string;
  action?: ReactNode;
}

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

const MENU_LINKS = [
  { path: '/settings?tab=ai_models', label: 'AI 模型配置', icon: Bot },
  { path: '/import-export', label: '数据与备份', icon: Database },
  { path: '/settings?tab=general', label: '常规与更新', icon: Settings2 },
  { path: '/settings?tab=diagnostics', label: '诊断与关于', icon: Info },
] as const;

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** ZCode-style identity row with an upward user-center popover shared by sidebars. */
export function SidebarFooter({ className = '', action }: SidebarFooterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ bottom: number; left: number; width: number }>({
    bottom: 56,
    left: 12,
    width: 248,
  });
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useClientLayoutEffect(() => {
    if (!open || !triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(244, Math.min(272, rect.width));
    const left = Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - width - 8)));
    const bottom = Math.max(8, window.innerHeight - rect.top + 6);
    setCoords({ bottom, left, width });
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const closeMenu = (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isComposingKeyboardEvent(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const handleResize = () => closeMenu();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  const openDestination = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className={`sidebar-footer ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className={`sidebar-footer-trigger ${open ? 'is-open' : ''}`.trim()}
        data-testid="sidebar-user-menu-trigger"
        aria-label="打开应用与个人设置菜单"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        title="打开应用与个人设置菜单"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sidebar-avatar" aria-hidden="true">
          AI
        </span>
        <span className="sidebar-footer-copy">
          <span className="sidebar-footer-name">AI Novel Studio</span>
          <span className="version">{APP_VERSION}</span>
        </span>
        <ChevronsUpDown
          className="sidebar-footer-chevron"
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
        />
      </button>
      {action}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            className="sidebar-user-popover"
            data-testid="sidebar-user-menu"
            role="dialog"
            aria-label="应用与偏好菜单"
            style={{
              bottom: `${coords.bottom}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
            }}
          >
            <div className="sidebar-user-header">
              <span className="sidebar-avatar" aria-hidden="true">
                AI
              </span>
              <div className="sidebar-user-identity">
                <strong>AI Novel Studio</strong>
                <span>本地创作工作台 · {APP_VERSION}</span>
              </div>
            </div>

            <div className="sidebar-user-theme" role="group" aria-label="外观主题">
              <span className="sidebar-user-section-label">外观主题</span>
              <div className="sidebar-user-theme-options">
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = preference === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`sidebar-user-theme-option ${selected ? 'is-active' : ''}`.trim()}
                      data-testid={`sidebar-theme-${option.value}`}
                      aria-pressed={selected}
                      onClick={() => setPreference(option.value)}
                    >
                      <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sidebar-user-links">
              {MENU_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    type="button"
                    className="sidebar-user-link"
                    onClick={() => openDestination(item.path)}
                  >
                    <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
