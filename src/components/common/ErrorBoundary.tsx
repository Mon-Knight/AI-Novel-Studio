/**
 * AI Novel Studio - 全局错误边界
 */
import { Component, type ReactNode } from 'react';
import { ArrowLeft, CircleAlert, Wrench } from 'lucide-react';
import { novelRepository } from '../../services/database/novelRepository';
import { describeUnknownError } from '../../utils/errorMessage';
import { appLogger } from '../../services/observability/appLogger';
import { showError, showInfo } from '../../utils/nativeDialog';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  diagnosticId: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, diagnosticId: null };
  }
  static getDerivedStateFromError(): State {
    return { hasError: true, diagnosticId: null };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    appLogger.captureError('REACT_RENDER_ERROR', error, {
      componentStack: info.componentStack?.slice(0, 2_000),
    });
    const entries = appLogger.getEntries();
    this.setState({ diagnosticId: entries[entries.length - 1]?.id ?? null });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircleAlert
            aria-hidden="true"
            size={48}
            strokeWidth={1.8}
            style={{ marginBottom: 16, color: 'var(--color-error)' }}
          />
          <h2 style={{ color: 'var(--color-error)', marginBottom: 8 }}>页面渲染出错</h2>
          <p
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 13,
              marginBottom: 8,
              maxWidth: 640,
              whiteSpace: 'pre-wrap',
            }}
          >
            页面渲染遇到异常，未保存的内容仍保留在本机恢复区。请重试或返回首页。
          </p>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              marginBottom: 12,
              maxWidth: 640,
            }}
          >
            {this.state.diagnosticId
              ? `本地诊断编号：${this.state.diagnosticId}`
              : '正在保存本地诊断…'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => this.setState({ hasError: false, diagnosticId: null })}
            >
              重试
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                window.location.hash = '#/';
              }}
            >
              <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
              返回首页
            </button>
            <button
              className="btn btn-warning btn-sm"
              onClick={async () => {
                try {
                  const res = await novelRepository.repairData();
                  await showInfo({
                    title: '修复完成',
                    message: `${res.before} → ${res.after}（已备份原始数据）`,
                  });
                  this.setState({ hasError: false, diagnosticId: null });
                  window.location.hash = '#/';
                } catch (error: unknown) {
                  appLogger.captureError('LOCAL_DATA_REPAIR_FAILED', error);
                  await showError({
                    title: '修复失败',
                    message: describeUnknownError(error, '本地数据修复失败'),
                  });
                }
              }}
            >
              <Wrench aria-hidden="true" size={15} strokeWidth={1.8} />
              修复本地数据
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                const info = `AI Novel Studio 本地诊断编号：${this.state.diagnosticId ?? '待生成'}`;
                try {
                  await navigator.clipboard.writeText(info);
                  await showInfo({ title: '复制完成', message: '本地诊断编号已复制。' });
                } catch (error) {
                  appLogger.captureError('DIAGNOSTIC_ID_COPY_FAILED', error);
                  await showError({ title: '复制失败', message: '请前往设置中心导出诊断报告。' });
                }
              }}
            >
              复制诊断编号
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
