/**
 * AI Novel Studio - 全局错误边界
 */
import { Component, type ReactNode } from 'react';
import { novelRepository } from '../../services/database/novelRepository';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💥</div>
          <h2 style={{ color: 'var(--color-error)', marginBottom: 8 }}>页面渲染出错</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8, maxWidth: 640, whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, maxWidth: 640 }}>
            {this.state.error?.stack ? this.state.error.stack.split('\n').slice(0,4).join('\n') : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { this.setState({ hasError: false, error: null }); }}>重试</button>
            <button className="btn btn-primary btn-sm" onClick={() => { window.location.hash = '#/'; }}>← 返回首页</button>
            <button className="btn btn-warning btn-sm" onClick={async () => {
              try {
                const res = await novelRepository.repairData();
                alert(`修复完成：${res.before} → ${res.after}（已备份原始数据）`);
                this.setState({ hasError: false, error: null });
                window.location.hash = '#/';
              } catch (e: any) {
                alert('修复失败：' + (e?.message || '未知错误'));
              }
            }}>🔧 修复本地数据</button>
            <button className="btn btn-outline btn-sm" onClick={() => {
              const info = `Error: ${this.state.error?.message}\n\nStack:\n${this.state.error?.stack || ''}`;
              try { navigator.clipboard.writeText(info); alert('错误信息已复制到剪贴板'); } catch { alert('复制失败，请手动复制'); }
            }}>复制错误信息</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
