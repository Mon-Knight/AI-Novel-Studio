import { beforeEach, describe, expect, it } from 'vitest';
import {
  appUpdateChannelStorageKey,
  getAppUpdateChannel,
  getRollbackReleaseUrl,
  parseAppUpdateChannel,
  sanitizeAppUpdateReleaseNotes,
  setAppUpdateChannel,
  versionMatchesUpdateChannel,
} from '../../services/update/appUpdateService';

describe('appUpdateService channel and manifest guards', () => {
  beforeEach(() => localStorage.clear());

  it('persists only the two explicit release channels', () => {
    expect(parseAppUpdateChannel('stable')).toBe('stable');
    expect(parseAppUpdateChannel('beta')).toBe('beta');
    expect(parseAppUpdateChannel('nightly')).toBeNull();
    expect(getAppUpdateChannel()).toBe('stable');

    setAppUpdateChannel('beta');
    expect(getAppUpdateChannel()).toBe('beta');
    localStorage.setItem(appUpdateChannelStorageKey, 'nightly');
    expect(getAppUpdateChannel()).toBe('stable');
  });

  it('keeps stable and prerelease versions isolated', () => {
    expect(versionMatchesUpdateChannel('3.1.0', 'stable')).toBe(true);
    expect(versionMatchesUpdateChannel('3.1.0-beta.1', 'stable')).toBe(false);
    expect(versionMatchesUpdateChannel('3.1.0-beta.1+build.4', 'beta')).toBe(true);
    expect(versionMatchesUpdateChannel('3.1.0', 'beta')).toBe(false);
  });

  it('bounds release notes and removes unsafe control characters', () => {
    const notes = `line one\0\n${'x'.repeat(4_100)}`;
    const result = sanitizeAppUpdateReleaseNotes(notes);
    expect(result).not.toContain('\0');
    expect(result).toContain('\n');
    expect(Array.from(result ?? '')).toHaveLength(4_000);
  });

  it('uses fixed channel release pages for rollback instructions', () => {
    expect(getRollbackReleaseUrl('stable')).toMatch(/\/updates-stable$/u);
    expect(getRollbackReleaseUrl('beta')).toMatch(/\/updates-beta$/u);
  });
});
