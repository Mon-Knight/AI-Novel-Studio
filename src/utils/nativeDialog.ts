/**
 * Native Feel P2.2 — 原生确认对话框工具封装
 *
 * 优先使用 Tauri 原生 dialog，失败时回退 window.confirm / window.alert。
 * 调用方不需要知道底层实现。
 */

let tauriDialogApi: typeof import('@tauri-apps/api/dialog') | null = null;

async function getTauriDialog() {
  if (tauriDialogApi) return tauriDialogApi;
  try {
    tauriDialogApi = await import('@tauri-apps/api/dialog');
  } catch {
    tauriDialogApi = null;
  }
  return tauriDialogApi;
}

/** 危险操作确认 — 默认按钮为"取消"/"确认"，强调风险 */
export async function confirmDanger(options: {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  const { title = '确认操作', message, okLabel = '确认删除', cancelLabel = '取消' } = options;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      return await dialog.ask(message, { title, okLabel, cancelLabel, type: 'warning' });
    }
  } catch {
    // 静默回退
  }

  return window.confirm(`${title}\n\n${message}`);
}

/** 普通确认 */
export async function confirmInfo(options: {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  const { title = '提示', message, okLabel = '确定', cancelLabel = '取消' } = options;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      return await dialog.ask(message, { title, okLabel, cancelLabel, type: 'info' });
    }
  } catch {
    // 静默回退
  }

  return window.confirm(`${title}\n\n${message}`);
}

/** 信息提示（无确认/取消） */
export async function showInfo(options: {
  title?: string;
  message: string;
}): Promise<void> {
  const { title = '提示', message } = options;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      await dialog.message(message, { title, type: 'info' });
      return;
    }
  } catch {
    // 静默回退
  }

  window.alert(`${title}\n\n${message}`);
}

/** 错误提示 */
export async function showError(options: {
  title?: string;
  message: string;
}): Promise<void> {
  const { title = '错误', message } = options;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      await dialog.message(message, { title, type: 'error' });
      return;
    }
  } catch {
    // 静默回退
  }

  window.alert(`[${title}]\n${message}`);
}
