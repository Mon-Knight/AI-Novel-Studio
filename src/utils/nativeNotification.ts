/**
 * Native Feel P2.2 — 原生通知工具封装
 *
 * 优先使用 Tauri 原生通知，失败时静默回退。
 * 通知是辅助提示，不替代页面内状态 UI。
 */

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
    // 静默回退：通知仅供辅助，不打断流程
    if (kind === 'error') {
      console.error(`[${title}] ${body}`);
    } else {
      console.info(`[${title}] ${body}`);
    }
    return;
  }

  try {
    const notif = await getTauriNotification();
    if (notif) {
      notif.sendNotification({ title, body });
    }
  } catch {
    // 通知失败不影响主流程
  }
}
