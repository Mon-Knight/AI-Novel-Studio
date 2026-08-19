import { create } from 'zustand';
import {
  isThemePreference,
  startThemeRuntime,
  type EffectiveTheme,
  type ThemePreference,
} from '../services/theme/themeRuntimeService';

export type { EffectiveTheme, ThemePreference } from '../services/theme/themeRuntimeService';
export { applyThemeToDocument, themeStorageKey } from '../services/theme/themeRuntimeService';

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

interface ThemeState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  systemPrefersDark: boolean;
  initialized: boolean;
  setPreference: (preference: ThemePreference) => void;
  syncSystemTheme: (prefersDark?: boolean) => void;
  hydrate: (preference: ThemePreference, systemPrefersDark: boolean) => void;
  initialize: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  effectiveTheme: 'light',
  systemPrefersDark: false,
  initialized: false,
  setPreference: (preference) => {
    if (!isThemePreference(preference)) return;
    set((state) => ({
      preference,
      effectiveTheme: resolveEffectiveTheme(preference, state.systemPrefersDark),
    }));
  },
  syncSystemTheme: (prefersDark) => {
    const nextSystemPrefersDark = prefersDark ?? get().systemPrefersDark;
    set((state) => ({
      systemPrefersDark: nextSystemPrefersDark,
      effectiveTheme: resolveEffectiveTheme(state.preference, nextSystemPrefersDark),
    }));
  },
  hydrate: (preference, systemPrefersDark) =>
    set({
      preference,
      effectiveTheme: resolveEffectiveTheme(preference, systemPrefersDark),
      systemPrefersDark,
      initialized: true,
    }),
  initialize: () => initializeTheme(),
}));

/** Applies the stored theme before React paints and returns a system-theme cleanup callback. */
export function initializeTheme(): () => void {
  return startThemeRuntime({
    hydrate: (preference, systemPrefersDark) =>
      useThemeStore.getState().hydrate(preference, systemPrefersDark),
    syncSystemTheme: (prefersDark) => useThemeStore.getState().syncSystemTheme(prefersDark),
    subscribe: (listener) =>
      useThemeStore.subscribe((state, previous) =>
        listener(
          {
            preference: state.preference,
            effectiveTheme: state.effectiveTheme,
          },
          {
            preference: previous.preference,
            effectiveTheme: previous.effectiveTheme,
          },
        ),
      ),
  });
}
