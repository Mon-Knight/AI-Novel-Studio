import {
  Bot,
  CheckCircle2,
  LoaderCircle,
  Search,
  Square,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import type { CheckPanelViewProps } from './CheckPanelView';

export function CheckPanelActionSections({
  chapter,
  aiSettings,
  currentDraft,
  loading,
  operationPhase,
  activeReport,
  viewingHistory,
  statistics,
  fixLoading,
  fixStage,
  fixProgress,
  fixError,
  fixRoundUsed,
  error,
  onRunCheck,
  onStopOperation,
  onAiFix,
}: CheckPanelViewProps) {
  return (
    <>
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Bot size={14} strokeWidth={1.8} aria-hidden="true" />
          AI 状态
        </div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? 'Mock 模式' : '真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div
                style={{
                  color: 'var(--color-error)',
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
                未配置 API Key，请先到设置中心配置
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          质量检查
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          第{chapter.chapterNumber}章 {chapter.title}
        </div>
        {currentDraft && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            草稿 v{currentDraft.versionNo}（{currentDraft.wordCount} 字）
          </div>
        )}
        <button
          className="btn btn-primary btn-sm"
          data-testid="quality-check-run"
          onClick={onRunCheck}
          disabled={loading || operationPhase !== 'idle'}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {loading ? (
            <>
              <LoaderCircle size={14} strokeWidth={1.8} aria-hidden="true" />
              检查中...
            </>
          ) : (
            <>
              <Search size={14} strokeWidth={1.8} aria-hidden="true" />
              开始质量检查
            </>
          )}
        </button>
        {operationPhase !== 'idle' && (
          <button
            className="btn btn-sm btn-secondary"
            data-testid="quality-operation-stop"
            onClick={onStopOperation}
            disabled={operationPhase !== 'available'}
            style={{
              width: '100%',
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {operationPhase === 'committing' ? (
              '正在提交，暂不可停止'
            ) : operationPhase === 'cancelling' ? (
              '正在停止...'
            ) : (
              <>
                <Square size={13} strokeWidth={1.8} aria-hidden="true" />
                停止当前操作
              </>
            )}
          </button>
        )}

        {activeReport && !viewingHistory && statistics.pending > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="btn btn-sm"
              data-testid="quality-fix-run"
              onClick={onAiFix}
              disabled={fixRoundUsed || fixLoading || loading || operationPhase !== 'idle'}
              style={{
                width: '100%',
                background:
                  fixRoundUsed || fixLoading
                    ? 'var(--color-bg-hover)'
                    : 'var(--color-secondary-accent)',
                color:
                  fixRoundUsed || fixLoading
                    ? 'var(--color-text-muted)'
                    : 'var(--color-on-primary)',
                border: 'none',
                cursor: fixRoundUsed || fixLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {fixLoading ? (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <LoaderCircle size={14} strokeWidth={1.8} aria-hidden="true" />
                  {fixStage || '修复中...'}
                </span>
              ) : fixRoundUsed ? (
                '已使用外部修稿轮次'
              ) : (
                <>
                  <Wrench size={14} strokeWidth={1.8} aria-hidden="true" />
                  AI 修复并复检
                </>
              )}
            </button>
            {fixRoundUsed && !fixLoading && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                当前正文最多允许一轮外部 AI 修稿；如仍未通过，请人工处理。
              </div>
            )}
            {fixLoading && (
              <div
                style={{
                  marginTop: 6,
                  background: 'var(--color-bg-primary)',
                  borderRadius: 4,
                  height: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${fixProgress}%`,
                    background: 'var(--color-secondary-accent)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            )}
          </div>
        )}
        {fixStage && !fixLoading && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-success)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
            {fixStage}
          </div>
        )}
        {fixError && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{fixError}</div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>
        )}
      </div>
    </>
  );
}
