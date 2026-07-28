import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  appUpdateService,
  type AppUpdateCapabilities,
  type AppUpdateChannel,
  type AppUpdateCheckResult,
  type AppUpdateRuntimeEvent,
} from '../../services/update/appUpdateService';
import { appLogger } from '../../services/observability/appLogger';
import { getAppErrorUserMessage, normalizeAppError } from '../../types/appError';
import { confirmInfo } from '../../utils/nativeDialog';

const CHANNELS: Array<{
  value: AppUpdateChannel;
  label: string;
  description: string;
}> = [
  { value: 'stable', label: 'Stable 稳定通道', description: '接收经过完整发布门禁的正式版本' },
  { value: 'beta', label: 'Beta 预览通道', description: '提前接收带预发布标识的测试版本' },
];

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function friendlyDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString('zh-CN');
}

function AppUpdateSettingsCard() {
  const [channel, setChannel] = useState<AppUpdateChannel>(() => appUpdateService.getChannel());
  const [capabilities, setCapabilities] = useState<AppUpdateCapabilities | null>(null);
  const [checkResult, setCheckResult] = useState<AppUpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | undefined>();
  const [message, setMessage] = useState('正在读取桌面更新能力…');
  const [messageTone, setMessageTone] = useState<'neutral' | 'success' | 'warning' | 'error'>(
    'neutral',
  );

  const handleRuntimeEvent = useCallback((event: AppUpdateRuntimeEvent) => {
    if (event.type === 'progress') {
      setDownloadedBytes((value) => value + event.chunkLength);
      if (event.contentLength) setContentLength(event.contentLength);
      return;
    }
    if (event.status === 'PENDING') {
      setMessage('正在下载已签名的更新包…');
      setMessageTone('neutral');
    } else if (event.status === 'DOWNLOADED') {
      setMessage('更新包已下载并通过签名校验，正在启动安装程序…');
      setMessageTone('success');
    } else if (event.status === 'DONE') {
      setInstalling(false);
      setMessage('更新安装已完成。');
      setMessageTone('success');
    } else if (event.status === 'ERROR' || event.failed) {
      setInstalling(false);
      setMessage('更新安装失败，现有版本保持不变。');
      setMessageTone('error');
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => {};
    void Promise.all([
      appUpdateService.getCapabilities(),
      appUpdateService.subscribe(handleRuntimeEvent),
    ])
      .then(([nextCapabilities, stopListening]) => {
        if (disposed) {
          stopListening();
          return;
        }
        unsubscribe = stopListening;
        setCapabilities(nextCapabilities);
        if (!nextCapabilities.desktopRuntime) {
          setMessage('浏览器开发模式仅保存通道选择；检查与安装由 Windows 桌面包承载。');
          setMessageTone('neutral');
        } else if (!nextCapabilities.supportedPlatform) {
          setMessage('当前桌面平台未启用此更新通道。');
          setMessageTone('warning');
        } else if (!nextCapabilities.updaterConfigured) {
          setMessage('此构建未注入发布公钥；正式发布流水线注入后启用签名更新。');
          setMessageTone('warning');
        } else {
          setMessage('选择通道后可显式检查更新；应用不会在后台自动安装。');
          setMessageTone('neutral');
        }
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const appError = appLogger.captureError('APP_UPDATE_CAPABILITIES_FAILED', error);
        setMessage(getAppErrorUserMessage(appError));
        setMessageTone('error');
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [handleRuntimeEvent]);

  const ready = Boolean(
    capabilities?.desktopRuntime &&
    capabilities.supportedPlatform &&
    capabilities.updaterConfigured,
  );
  const publishedAt = useMemo(() => friendlyDate(checkResult?.publishedAt), [checkResult]);
  const progress =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
      : undefined;

  const selectChannel = (nextChannel: AppUpdateChannel) => {
    if (installing) return;
    appUpdateService.setChannel(nextChannel);
    setChannel(nextChannel);
    setCheckResult(null);
    setDownloadedBytes(0);
    setContentLength(undefined);
    setMessage(
      nextChannel === 'stable'
        ? '已选择 Stable 稳定通道。'
        : '已选择 Beta 预览通道，更新版本可能仍在测试。',
    );
    setMessageTone(nextChannel === 'stable' ? 'success' : 'warning');
  };

  const handleCheck = async () => {
    if (!ready || checking || installing) return;
    setChecking(true);
    setCheckResult(null);
    setMessage(`正在检查 ${channel === 'stable' ? 'Stable' : 'Beta'} 通道…`);
    setMessageTone('neutral');
    try {
      const result = await appUpdateService.checkForUpdate(channel);
      setCheckResult(result);
      setMessage(
        result.shouldUpdate && result.latestVersion
          ? `发现新版本 v${result.latestVersion}。确认后再下载并安装。`
          : `当前已是 ${channel === 'stable' ? 'Stable' : 'Beta'} 通道最新版本。`,
      );
      setMessageTone('success');
    } catch (error: unknown) {
      const appError = appLogger.captureError('APP_UPDATE_CHECK_FAILED', error, { channel });
      setMessage(getAppErrorUserMessage(appError));
      setMessageTone('error');
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    const version = checkResult?.latestVersion;
    if (!ready || !checkResult?.shouldUpdate || !version || installing) return;
    const confirmed = await confirmInfo({
      title: `安装 AI Novel Studio v${version}`,
      message:
        '请先保存正在编辑的正文。系统将重新核对通道与版本，下载签名更新包；Windows 安装阶段会关闭当前应用。是否继续？',
      okLabel: '下载并安装',
      cancelLabel: '稍后处理',
      testId: 'app-update-install-confirmation',
    });
    if (!confirmed) return;

    setInstalling(true);
    setDownloadedBytes(0);
    setContentLength(undefined);
    setMessage('正在重新核对更新版本…');
    setMessageTone('neutral');
    try {
      await appUpdateService.installUpdate(channel, version);
      setMessage('安装程序已启动。');
      setMessageTone('success');
    } catch (error: unknown) {
      const appError = appLogger.captureError('APP_UPDATE_INSTALL_FAILED', error, {
        channel,
        version,
      });
      setInstalling(false);
      setMessage(getAppErrorUserMessage(appError));
      setMessageTone('error');
    }
  };

  const handleRollback = async () => {
    try {
      await appUpdateService.openRollbackRelease(channel);
    } catch (error: unknown) {
      const appError = normalizeAppError(error, '回滚发布页打开失败。');
      appLogger.captureError('APP_UPDATE_ROLLBACK_PAGE_FAILED', appError, { channel });
      setMessage(getAppErrorUserMessage(appError));
      setMessageTone('error');
    }
  };

  return (
    <section className="detail-card settings-card" aria-labelledby="app-update-settings-title">
      <div className="settings-card-heading">
        <span aria-hidden="true">⬆</span>
        <span id="app-update-settings-title">应用更新与发布通道</span>
      </div>

      <div
        className="theme-choice-group update-channel-choice-group"
        role="radiogroup"
        aria-label="更新通道"
      >
        {CHANNELS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={channel === option.value}
            className={`theme-choice${channel === option.value ? ' is-selected' : ''}`}
            disabled={installing}
            onClick={() => selectChannel(option.value)}
          >
            <span className="theme-choice-label">{option.label}</span>
            <span className="theme-choice-description">{option.description}</span>
          </button>
        ))}
      </div>

      <div className={`app-update-status is-${messageTone}`} role="status" aria-live="polite">
        <strong>
          当前版本：v{capabilities?.currentVersion ?? checkResult?.currentVersion ?? '—'}
        </strong>
        <span>{message}</span>
        {installing && downloadedBytes > 0 && (
          <span>
            已下载 {formatBytes(downloadedBytes)}
            {contentLength ? ` / ${formatBytes(contentLength)}` : ''}
            {progress !== undefined ? `（${progress}%）` : ''}
          </span>
        )}
      </div>

      {checkResult?.shouldUpdate && checkResult.latestVersion && (
        <div className="app-update-release" aria-label="待安装版本信息">
          <div>
            <strong>待安装：v{checkResult.latestVersion}</strong>
            {publishedAt ? <span>发布时间：{publishedAt}</span> : null}
          </div>
          {checkResult.releaseNotes ? (
            <p className="app-update-release-notes">{checkResult.releaseNotes}</p>
          ) : (
            <p className="settings-help-text">此版本未附带更新说明。</p>
          )}
        </div>
      )}

      <div className="settings-card-actions app-update-actions">
        <span className="settings-help-text">
          回滚会使用同通道上一版安装包；操作前请导出完整项目备份。
        </span>
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleRollback()}
          >
            查看回滚版本
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!ready || checking || installing}
            onClick={() => void handleCheck()}
          >
            {checking ? '检查中…' : '检查更新'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!ready || !checkResult?.shouldUpdate || installing}
            onClick={() => void handleInstall()}
          >
            {installing ? '安装中…' : '下载并安装'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default AppUpdateSettingsCard;
