import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeToDocument,
  initializeTheme,
  resolveEffectiveTheme,
  themeStorageKey,
  useThemeStore,
} from './themeStore';

describe('themeStore', () => {
  let stopThemeRuntime: () => void = () => undefined;

  beforeEach(() => {
    stopThemeRuntime();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-effective-theme');
    document.documentElement.style.colorScheme = '';
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    useThemeStore.setState({
      preference: 'system',
      effectiveTheme: 'light',
      systemPrefersDark: false,
      initialized: false,
    });
  });

  afterEach(() => stopThemeRuntime());

  it('resolves system and explicit preferences deterministically', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark');
    expect(resolveEffectiveTheme('system', false)).toBe('light');
    expect(resolveEffectiveTheme('light', true)).toBe('light');
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
  });

  it('keeps store actions free of browser side effects until the runtime is installed', () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().effectiveTheme).toBe('dark');
    expect(localStorage.getItem(themeStorageKey)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('applies accessible document state and persists manual choice', () => {
    stopThemeRuntime = initializeTheme();
    applyThemeToDocument('system', 'light');
    expect(document.documentElement.dataset.theme).toBe('system');
    expect(document.documentElement.dataset.effectiveTheme).toBe('light');

    useThemeStore.getState().setPreference('dark');
    expect(localStorage.getItem(themeStorageKey)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.effectiveTheme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('only follows system changes while preference is system', () => {
    stopThemeRuntime = initializeTheme();
    useThemeStore.getState().syncSystemTheme(true);
    expect(useThemeStore.getState().effectiveTheme).toBe('dark');
    useThemeStore.getState().setPreference('light');
    useThemeStore.getState().syncSystemTheme(true);
    expect(useThemeStore.getState().effectiveTheme).toBe('light');
  });
});
