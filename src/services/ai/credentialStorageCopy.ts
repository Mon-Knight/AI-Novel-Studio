import { isTauri } from '../database/db';

/** Copy projection only: no reads/writes to the credential vault. */
export function credentialStorageCopy(desktop: boolean) {
  const storage = desktop
    ? 'Windows 桌面端使用 DPAPI 在本机加密保存 API Key，重启后可恢复。'
    : '浏览器开发模式的 API Key 仅保留在当前会话内存，刷新或关闭后需重新填写。';
  const boundary = '密钥按 Provider、Endpoint 与模型精确绑定，不写入模型卡片、项目备份或 Git。';
  const removal = desktop
    ? '清空并保存会删除当前模型身份对应的已保存密钥。'
    : '清空并保存会移除当前模型身份对应的会话密钥。';
  return {
    storage,
    keyHelp: `${storage}${removal}${boundary}`,
    localKeyHelp: `${storage}清空并保存后不再保留原密钥；本地免鉴权使用占位值。${boundary}`,
    saved: `AI 设置已保存。${storage}`,
    restoreFailed: desktop
      ? '本机加密凭据恢复失败，请检查当前 Windows 用户权限，或重新填写并保存 API Key。'
      : '当前浏览器会话凭据不可用，请重新填写 API Key。',
    unavailableHint: desktop
      ? '请检查本机加密凭据恢复是否成功，或为相同 Provider、Endpoint 与模型重新填写并保存 API Key。'
      : '浏览器凭据只在当前会话内存中，请为相同 Provider、Endpoint 与模型重新填写 API Key。',
  };
}

export function getCredentialStorageCopy() {
  return credentialStorageCopy(isTauri());
}
