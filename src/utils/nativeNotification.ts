/**
 * Native Feel P2.3.2 — 原生通知工具封装（Toast 回退版）
 *
 * 优先 Tauri 原生通知 → DOM Toast → console 回退。
 */

import { showToast } from './toast';

let tauriNotificationApi: typeof import('@tauri-apps/api/notification') | null = null;
let permissionChecked = false;
let permissionGranted = false;

async function getTauriNotification() {
  if (tauriNotificationApi) return tauriNotificationApi;
  try {
    tauriNotificationApi = await import('@tauri-apps/api/notification');
  } catch {
    tauriNotificationApi = null;
  }
  return tauriNotificationApi;
}

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return permissionGranted;

  try {
    const notif = await getTauriNotification();
    if (!notif) {
      permissionChecked = true;
      return false;
    }

    const permission = await notif.requestPermission();
    permissionGranted = permission === 'granted';
  } catch {
    permissionGranted = false;
  }

  permissionChecked = true;
  return permissionGranted;
}

export type NotificationKind = 'success' | 'info' | 'warning' | 'error';

export async function notifyNative(options: {
  title?: string;
  body: string;
  kind?: NotificationKind;
}): Promise<void> {
  const { title = 'AI Novel Studio', body, kind = 'info' } = options;

  if (!(await ensurePermission())) {
    // 回退：Toast → console
    showToast({ kind, title, message: body });
    return;
  }

  try {
    const notif = await getTauriNotification();
    if (notif) {
      notif.sendNotification({ title, body });
    }
  } catch {
    // 原生通知失败 → Toast 回退
    showToast({ kind, title, message: body });
  }
}
