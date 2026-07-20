/**
 * Native Feel P2.2 — 原生确认对话框工具封装
 *
 * 优先使用 Tauri 原生 dialog，失败时回退 window.confirm / window.alert。
 * 调用方不需要知道底层实现。
 */

let tauriDialogApi: typeof import('@tauri-apps/api/dialog') | null = null;

export interface DialogOptions {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  testId?: string;
}

export interface E2eDialogRequest extends Required<Pick<DialogOptions, 'message'>> {
  id: number;
  title: string;
  okLabel: string;
  cancelLabel?: string;
  testId: string;
  kind: 'confirm' | 'message';
  tone: 'info' | 'danger' | 'error';
  resolve: (confirmed: boolean) => void;
}

type E2eDialogListener = (request: E2eDialogRequest) => void;

let e2eDialogListener: E2eDialogListener | null = null;
let nextDialogId = 1;

const e2eDialogsEnabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';

export function registerE2eDialogHost(listener: E2eDialogListener): () => void {
  e2eDialogListener = listener;
  return () => {
    if (e2eDialogListener === listener) e2eDialogListener = null;
  };
}

function showE2eDialog(input: Omit<E2eDialogRequest, 'id' | 'resolve'>): Promise<boolean> | null {
  if (!e2eDialogsEnabled || !e2eDialogListener) return null;

  return new Promise<boolean>((resolve) => {
    e2eDialogListener?.({
      ...input,
      id: nextDialogId++,
      resolve,
    });
  });
}

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
export async function confirmDanger(options: DialogOptions): Promise<boolean> {
  const {
    title = '确认操作', message, okLabel = '确认', cancelLabel = '取消', testId = 'dialog-confirmation',
  } = options;

  const e2eResult = showE2eDialog({
    title, message, okLabel, cancelLabel, testId, kind: 'confirm', tone: 'danger',
  });
  if (e2eResult) return await e2eResult;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      return await dialog.ask(message, { title, type: 'warning' });
    }
  } catch (err) {
    console.warn('[nativeDialog] Tauri dialog failed, falling back to window.confirm:', err);
  }

  try {
    return window.confirm(`${title}\n\n${message}`);
  } catch {
    // 极端情况：window.confirm 也不可用，危险操作绝不默认执行
    console.error('[nativeDialog] window.confirm unavailable, denying dangerous action');
    return false;
  }
}

/** 普通确认 */
export async function confirmInfo(options: DialogOptions): Promise<boolean> {
  const {
    title = '提示', message, okLabel = '确认', cancelLabel = '取消', testId = 'dialog-confirmation',
  } = options;

  const e2eResult = showE2eDialog({
    title, message, okLabel, cancelLabel, testId, kind: 'confirm', tone: 'info',
  });
  if (e2eResult) return await e2eResult;

  try {
    const dialog = await getTauriDialog();
    if (dialog) {
      return await dialog.ask(message, { title, type: 'info' });
    }
  } catch (err) {
    console.warn('[nativeDialog] Tauri dialog failed, falling back to window.confirm:', err);
  }

  try {
    return window.confirm(`${title}\n\n${message}`);
  } catch {
    return false;
  }
}

/** 信息提示（无确认/取消） */
export async function showInfo(options: {
  title?: string;
  message: string;
  testId?: string;
}): Promise<void> {
  const { title = '提示', message, testId = 'info-notice' } = options;

  const e2eResult = showE2eDialog({
    title, message, okLabel: '确定', testId, kind: 'message', tone: 'info',
  });
  if (e2eResult) {
    await e2eResult;
    return;
  }

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
  testId?: string;
}): Promise<void> {
  const { title = '错误', message, testId = 'error-notice' } = options;

  const e2eResult = showE2eDialog({
    title, message, okLabel: '确定', testId, kind: 'message', tone: 'error',
  });
  if (e2eResult) {
    await e2eResult;
    return;
  }

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
