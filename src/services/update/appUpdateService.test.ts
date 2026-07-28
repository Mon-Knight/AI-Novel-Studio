import { beforeEach, describe, expect, it } from 'vitest';
import {
  appUpdateService,
  getAppUpdateChannel,
  getRollbackReleaseUrl,
  parseAppUpdateChannel,
  sanitizeAppUpdateReleaseNotes,
  setAppUpdateChannel,
  versionMatchesUpdateChannel,
} from './appUpdateService';

describe('app update service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps stable and beta channels explicit', () => {
    expect(parseAppUpdateChannel('stable')).toBe('stable');
    expect(parseAppUpdateChannel('beta')).toBe('beta');
    expect(parseAppUpdateChannel('nightly')).toBeNull();
    expect(versionMatchesUpdateChannel('3.1.0', 'stable')).toBe(true);
    expect(versionMatchesUpdateChannel('3.1.0-beta.2', 'stable')).toBe(false);
    expect(versionMatchesUpdateChannel('3.1.0-beta.2+build.4', 'beta')).toBe(true);
    expect(versionMatchesUpdateChannel('3.1.0', 'beta')).toBe(false);
  });

  it('persists a bounded channel choice and uses fixed HTTPS rollback releases', () => {
    expect(getAppUpdateChannel()).toBe('stable');
    setAppUpdateChannel('beta');
    expect(getAppUpdateChannel()).toBe('beta');
    expect(getRollbackReleaseUrl('beta')).toBe(
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/tag/updates-beta',
    );
  });

  it('sanitizes and bounds release notes before display', () => {
    const notes = `line one\0\n${'x'.repeat(4_100)}`;
    const sanitized = sanitizeAppUpdateReleaseNotes(notes);
    expect(sanitized).toBeDefined();
    expect(sanitized).not.toContain('\0');
    expect(Array.from(sanitized ?? '')).toHaveLength(4_000);
  });

  it('reports browser mode explicitly without invoking desktop update IPC', async () => {
    await expect(appUpdateService.getCapabilities()).resolves.toMatchObject({
      desktopRuntime: false,
      supportedPlatform: false,
      updaterConfigured: false,
    });
    await expect(appUpdateService.checkForUpdate('stable')).rejects.toMatchObject({
      code: 'APP_UPDATE_PLATFORM_UNSUPPORTED',
    });
    await expect(appUpdateService.installUpdate('stable', '3.1.0')).rejects.toMatchObject({
      code: 'APP_UPDATE_PLATFORM_UNSUPPORTED',
    });
  });
});
