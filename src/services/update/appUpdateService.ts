import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/shell';
import { APP_VERSION } from '../../constants/version';
import type { AppError } from '../../types/appError';
import { appLogger } from '../observability/appLogger';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

export type AppUpdateChannel = 'stable' | 'beta';
export type AppUpdateStatus = 'PENDING' | 'DOWNLOADED' | 'DONE' | 'ERROR' | 'UPTODATE';

export interface AppUpdateCapabilities {
  desktopRuntime: boolean;
  supportedPlatform: boolean;
  updaterConfigured: boolean;
  currentVersion: string;
}

export interface AppUpdateCheckResult {
  channel: AppUpdateChannel;
  currentVersion: string;
  shouldUpdate: boolean;
  latestVersion?: string;
  publishedAt?: string;
  releaseNotes?: string;
}

export type AppUpdateRuntimeEvent =
  | { type: 'status'; status: AppUpdateStatus; failed: boolean }
  | { type: 'progress'; chunkLength: number; contentLength?: number };

interface BackendCapabilities {
  supportedPlatform: boolean;
  updaterConfigured: boolean;
  currentVersion: string;
}

interface BackendCheckResult {
  channel: string;
  currentVersion: string;
  shouldUpdate: boolean;
  latestVersion?: string | null;
  publishedAt?: string | null;
  releaseNotes?: string | null;
}

interface UpdaterStatusPayload {
  status?: unknown;
  error?: unknown;
}

interface UpdaterProgressPayload {
  chunkLength?: unknown;
  contentLength?: unknown;
}

const CHANNEL_STORAGE_KEY = 'ai_novel_studio_update_channel_v1';
const DEFAULT_CHANNEL: AppUpdateChannel = 'stable';
const MAX_RELEASE_NOTES_CHARS = 4_000;
const RELEASE_ROOT = 'https://github.com/Mon-Knight/AI-Novel-Studio/releases/tag';
const UPDATE_STATUSES = new Set<AppUpdateStatus>([
  'PENDING',
  'DOWNLOADED',
  'DONE',
  'ERROR',
  'UPTODATE',
]);

function updateError(code: string, message: string, retryable = false): AppError {
  return { code, message, retryable };
}

export function parseAppUpdateChannel(value: unknown): AppUpdateChannel | null {
  return value === 'stable' || value === 'beta' ? value : null;
}

export function versionMatchesUpdateChannel(version: string, channel: AppUpdateChannel): boolean {
  const withoutBuildMetadata = version.split('+', 1)[0] ?? version;
  const isPrerelease = withoutBuildMetadata.includes('-');
  return channel === 'stable' ? !isPrerelease : isPrerelease;
}

export function sanitizeAppUpdateReleaseNotes(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || character === '\n' || character === '\r' || character === '\t';
    })
    .slice(0, MAX_RELEASE_NOTES_CHARS)
    .join('')
    .trim();
  return sanitized || undefined;
}

export function getAppUpdateChannel(): AppUpdateChannel {
  try {
    return (
      parseAppUpdateChannel(globalThis.localStorage?.getItem(CHANNEL_STORAGE_KEY)) ??
      DEFAULT_CHANNEL
    );
  } catch {
    return DEFAULT_CHANNEL;
  }
}

export function setAppUpdateChannel(channel: AppUpdateChannel): void {
  try {
    globalThis.localStorage?.setItem(CHANNEL_STORAGE_KEY, channel);
  } catch {
    // A process-local selection still applies to the current component state.
  }
}

export function getRollbackReleaseUrl(channel: AppUpdateChannel): string {
  return `${RELEASE_ROOT}/updates-${channel}`;
}

function validateCapabilities(value: BackendCapabilities): AppUpdateCapabilities {
  if (
    typeof value?.supportedPlatform !== 'boolean' ||
    typeof value?.updaterConfigured !== 'boolean' ||
    typeof value?.currentVersion !== 'string' ||
    !value.currentVersion.trim()
  ) {
    throw updateError('APP_UPDATE_MANIFEST_INVALID', '更新能力响应格式无效');
  }
  return { desktopRuntime: true, ...value };
}

function validateCheckResult(
  value: BackendCheckResult,
  expectedChannel: AppUpdateChannel,
): AppUpdateCheckResult {
  const channel = parseAppUpdateChannel(value?.channel);
  if (
    channel !== expectedChannel ||
    typeof value?.currentVersion !== 'string' ||
    typeof value?.shouldUpdate !== 'boolean'
  ) {
    throw updateError('APP_UPDATE_MANIFEST_INVALID', '更新检查响应格式无效');
  }

  const latestVersion = typeof value.latestVersion === 'string' ? value.latestVersion : undefined;
  if (
    value.shouldUpdate &&
    (!latestVersion || !versionMatchesUpdateChannel(latestVersion, expectedChannel))
  ) {
    throw updateError('APP_UPDATE_MANIFEST_INVALID', '更新索引与所选通道不一致');
  }

  return {
    channel,
    currentVersion: value.currentVersion,
    shouldUpdate: value.shouldUpdate,
    latestVersion,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    releaseNotes: sanitizeAppUpdateReleaseNotes(value.releaseNotes),
  };
}

async function getCapabilities(): Promise<AppUpdateCapabilities> {
  if (!isTauriRuntime()) {
    return {
      desktopRuntime: false,
      supportedPlatform: false,
      updaterConfigured: false,
      currentVersion: APP_VERSION.replace(/^v/u, ''),
    };
  }
  const value = await tauriInvoke<BackendCapabilities>('get_app_update_capabilities');
  return validateCapabilities(value);
}

async function checkForUpdate(channel: AppUpdateChannel): Promise<AppUpdateCheckResult> {
  if (!isTauriRuntime()) {
    throw updateError('APP_UPDATE_PLATFORM_UNSUPPORTED', '浏览器开发模式不执行桌面更新检查');
  }
  const value = await tauriInvoke<BackendCheckResult>('check_app_update', { input: { channel } });
  return validateCheckResult(value, channel);
}

async function installUpdate(channel: AppUpdateChannel, expectedVersion: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw updateError('APP_UPDATE_PLATFORM_UNSUPPORTED', '浏览器开发模式不执行桌面更新安装');
  }
  if (!versionMatchesUpdateChannel(expectedVersion, channel)) {
    throw updateError('APP_UPDATE_MANIFEST_INVALID', '待安装版本与更新通道不一致');
  }
  await tauriInvoke<void>('install_app_update', {
    input: { channel, expectedVersion },
  });
}

async function subscribe(listener: (event: AppUpdateRuntimeEvent) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;

  const unlisteners: UnlistenFn[] = [];
  try {
    unlisteners.push(
      await listen<UpdaterStatusPayload>('tauri://update-status', ({ payload }) => {
        const status = typeof payload.status === 'string' ? payload.status : '';
        if (!UPDATE_STATUSES.has(status as AppUpdateStatus)) return;
        const failed = status === 'ERROR' || Boolean(payload.error);
        if (failed) {
          appLogger.captureError('APP_UPDATE_RUNTIME_EVENT_ERROR', payload.error, { status });
        }
        listener({ type: 'status', status: status as AppUpdateStatus, failed });
      }),
    );
    unlisteners.push(
      await listen<UpdaterProgressPayload>('tauri://update-download-progress', ({ payload }) => {
        if (
          typeof payload.chunkLength !== 'number' ||
          !Number.isFinite(payload.chunkLength) ||
          payload.chunkLength < 0
        ) {
          return;
        }
        const contentLength =
          typeof payload.contentLength === 'number' &&
          Number.isFinite(payload.contentLength) &&
          payload.contentLength > 0
            ? payload.contentLength
            : undefined;
        listener({ type: 'progress', chunkLength: payload.chunkLength, contentLength });
      }),
    );
  } catch (error) {
    for (const unlisten of unlisteners) unlisten();
    throw error;
  }

  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

async function openRollbackRelease(channel: AppUpdateChannel): Promise<void> {
  const url = getRollbackReleaseUrl(channel);
  if (isTauriRuntime()) {
    await open(url);
    return;
  }
  globalThis.open?.(url, '_blank', 'noopener,noreferrer');
}

export const appUpdateService = {
  getCapabilities,
  checkForUpdate,
  installUpdate,
  subscribe,
  openRollbackRelease,
  getChannel: getAppUpdateChannel,
  setChannel: setAppUpdateChannel,
};

export const appUpdateChannelStorageKey = CHANNEL_STORAGE_KEY;
