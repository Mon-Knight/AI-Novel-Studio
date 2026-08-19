export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = Exclude<ThemePreference, 'system'>;

const THEME_STORAGE_KEY = 'ai_novel_studio_theme_preference';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeRuntimeSnapshot {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
}

export interface ThemeRuntimeBinding {
  hydrate(preference: ThemePreference, systemPrefersDark: boolean): void;
  syncSystemTheme(prefersDark: boolean): void;
  subscribe(
    listener: (snapshot: ThemeRuntimeSnapshot, previous: ThemeRuntimeSnapshot) => void,
  ): () => void;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function persistThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme selection remains process-local when storage is unavailable.
  }
}

export function readSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

export function applyThemeToDocument(
  preference: ThemePreference,
  effectiveTheme: EffectiveTheme,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = preference;
  root.dataset.effectiveTheme = effectiveTheme;
  root.style.colorScheme = effectiveTheme;
}

function listenForSystemThemeChange(listener: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia(DARK_QUERY);
  const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
  media.addEventListener?.('change', handleChange);
  return () => media.removeEventListener?.('change', handleChange);
}

let stopActiveRuntime: (() => void) | undefined;

/** Owns every browser side effect while the Zustand store remains a pure state container. */
export function startThemeRuntime(binding: ThemeRuntimeBinding): () => void {
  stopActiveRuntime?.();

  const preference = readStoredThemePreference();
  const systemPrefersDark = readSystemPrefersDark();
  binding.hydrate(preference, systemPrefersDark);

  const initialEffectiveTheme =
    preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
  applyThemeToDocument(preference, initialEffectiveTheme);

  const unsubscribe = binding.subscribe((snapshot, previous) => {
    if (snapshot.preference !== previous.preference) {
      persistThemePreference(snapshot.preference);
    }
    if (
      snapshot.preference !== previous.preference ||
      snapshot.effectiveTheme !== previous.effectiveTheme
    ) {
      applyThemeToDocument(snapshot.preference, snapshot.effectiveTheme);
    }
  });
  const stopSystemListener = listenForSystemThemeChange(binding.syncSystemTheme);

  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    unsubscribe();
    stopSystemListener();
    if (stopActiveRuntime === cleanup) stopActiveRuntime = undefined;
  };
  stopActiveRuntime = cleanup;
  return cleanup;
}

export const themeStorageKey = THEME_STORAGE_KEY;
