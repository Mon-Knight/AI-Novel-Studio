import { Component, type ErrorInfo, type ReactNode } from 'react';
import { appLogger } from '../../services/observability/appLogger';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  panelTitle?: string;
  onReset?: () => void;
  fallbackClassName?: string;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || '组件渲染发生未知错误',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    appLogger.captureError('PANEL_RENDER_ERROR', error, {
      panelTitle: this.props.panelTitle,
      componentStack: errorInfo.componentStack?.slice(0, 1000),
    });
  }

  handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const title = this.props.panelTitle ?? '该区域';
      return (
        <div
          className={`panel-error-fallback ${this.props.fallbackClassName ?? ''}`}
          role="alert"
          style={{
            padding: '16px',
            margin: '8px',
            borderRadius: '6px',
            backgroundColor: 'var(--color-bg-secondary, #f8f9fa)',
            border: '1px solid var(--color-border-error, #f5c6cb)',
            color: 'var(--color-text-primary, #333)',
            fontSize: '13px',
            textAlign: 'center',
          }}
        >
          <div
            style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--color-error, #d9534f)' }}
          >
            ⚠️ {title}渲染出现异常
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-muted, #666)',
              marginBottom: '10px',
              wordBreak: 'break-word',
            }}
          >
            {this.state.errorMessage}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={this.handleRetry}
            style={{ fontSize: '12px', padding: '3px 12px' }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PanelErrorBoundary;
