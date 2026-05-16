/**
 * AI Novel Studio - 全局错误边界
 */
import { Component, type ReactNode } from 'react';

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
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 16, maxWidth: 400 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => { this.setState({ hasError: false, error: null }); window.location.hash = '#/'; }}>
            ← 返回首页
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
