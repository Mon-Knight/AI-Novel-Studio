import { useCallback, useEffect, useState } from 'react';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { appLogger } from '../../services/observability/appLogger';
import { aiPerformanceMonitor } from '../../services/observability/aiPerformanceMonitor';
import { nativeCrashReportService } from '../../services/observability/nativeCrashReportService';
import { isTauriRuntime } from '../../services/tauri/runtime';
import { confirmDanger } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';
import { getAppErrorUserMessage } from '../../types/appError';

function fileName(): string {
  return `ai-novel-studio-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function saveReport(content: string): Promise<boolean> {
  if (isTauriRuntime()) {
    const target = await save({
      title: '导出本地诊断报告',
      defaultPath: fileName(),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return false;
    await writeTextFile(target, content);
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName();
    anchor.click();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function DiagnosticsSettingsCard() {
  const [reportCount, setReportCount] = useState(() => appLogger.getLocalErrorReports().length);
  const [nativeReportCount, setNativeReportCount] = useState(0);
  const [performanceSummary, setPerformanceSummary] = useState(() =>
    aiPerformanceMonitor.summary(),
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void nativeCrashReportService
      .list()
      .then((reports) => {
        if (active) setNativeReportCount(reports.length);
      })
      .catch((error) => {
        appLogger.captureError('NATIVE_CRASH_REPORT_LIST_FAILED', error);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleExport = useCallback(async () => {
    setMessage('');
    try {
      const reports = appLogger.getLocalErrorReports();
      const nativeCrashReports = await nativeCrashReportService.list();
      const performance = aiPerformanceMonitor.summary();
      const saved = await saveReport(
        `${JSON.stringify(
          {
            schemaVersion: 2,
            exportedAt: new Date().toISOString(),
            reportCount: reports.length,
            reports,
            nativeCrashReportCount: nativeCrashReports.length,
            nativeCrashReports,
            aiPerformance: performance,
          },
          null,
          2,
        )}\n`,
      );
      setMessage(saved ? '诊断报告已导出。' : '已取消导出。');
    } catch (error) {
      setMessage(describeUnknownError(error, '诊断报告导出失败'));
    }
  }, []);

  const handleClear = useCallback(async () => {
    const confirmed = await confirmDanger({
      title: '清空本地诊断报告',
      message: '此操作只删除本机已脱敏的错误报告，且不可撤销。是否继续？',
    });
    if (!confirmed) return;
    try {
      await nativeCrashReportService.clear();
      appLogger.clearLocalErrorReports();
      aiPerformanceMonitor.clear();
      setReportCount(0);
      setNativeReportCount(0);
      setPerformanceSummary(aiPerformanceMonitor.summary());
      setMessage('本地诊断报告已清空。');
    } catch (error) {
      const normalized = appLogger.captureError('DIAGNOSTIC_REPORT_CLEAR_FAILED', error);
      setMessage(getAppErrorUserMessage(normalized));
    }
  }, []);

  return (
    <section className="detail-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span aria-hidden="true">🩺</span>
        <strong>诊断与崩溃报告</strong>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        前端未处理错误与原生进程崩溃会在本机保存脱敏记录，不包含正文、Prompt、API Key、 Provider
        原始响应、panic 内容或堆栈。当前前端 {reportCount} 条，原生 {nativeReportCount} 条。
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        AI 延迟样本 {performanceSummary.sampleCount} 条；P50 {performanceSummary.p50DurationMs} ms，
        P95 {performanceSummary.p95DurationMs} ms，失败 {performanceSummary.failedCount} 次， 取消{' '}
        {performanceSummary.cancelledCount} 次。
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={handleExport}>
          导出诊断报告
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={handleClear}
          disabled={reportCount === 0 && nativeReportCount === 0}
        >
          清空本地报告
        </button>
      </div>
      {message && <div style={{ marginTop: 8, fontSize: 12 }}>{message}</div>}
    </section>
  );
}

export default DiagnosticsSettingsCard;
