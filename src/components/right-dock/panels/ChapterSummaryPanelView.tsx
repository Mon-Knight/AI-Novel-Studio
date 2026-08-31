import type { AiSettings } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  ChapterSummary,
  ChapterSummarizeResult,
  ChapterSummaryValidation,
} from '../../../types/chapterSummary';
import { formatDateTime } from '../../../utils/date';
import {
  Bot,
  CheckCircle2,
  CircleX,
  ClipboardList,
  FileText,
  FolderOpen,
  Lightbulb,
  Link2,
  Pause,
  Pin,
  RefreshCw,
  Save,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { PanelLoaderIcon } from './PanelLoaderIcon';

interface ChapterSummaryPanelViewProps {
  aiSettings: AiSettings;
  chapter: Chapter;
  summary: ChapterSummary | null;
  genResult: ChapterSummarizeResult | null;
  validation: ChapterSummaryValidation | null;
  genLoading: boolean;
  genError: string;
  saveSuccess: boolean;
  onGenerateSummary: () => void;
  onSaveSummary: () => void;
  onDiscardResult: () => void;
  onToggleSummary: () => void;
}

export function ChapterSummaryPanelView({
  aiSettings,
  chapter,
  summary,
  genResult,
  validation,
  genLoading,
  genError,
  saveSuccess,
  onGenerateSummary,
  onSaveSummary,
  onDiscardResult,
  onToggleSummary,
}: ChapterSummaryPanelViewProps) {
  return (
    <div
      data-testid="chapter-summary-panel"
      data-chapter-id={chapter.id}
      data-summary-id={summary?.id || ''}
      data-summary-expired={summary?.isExpired ? 'true' : 'false'}
    >
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title panel-section-title--icon">
          <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>AI 状态</span>
        </div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? 'Mock 模式' : '真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div
                className="panel-inline-status"
                style={{ color: 'var(--color-error)', marginTop: 4 }}
              >
                <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>未配置 API Key，请先到设置中心配置</span>
              </div>
            )}
          </>
        )}
      </div>

      {genError && (
        <div
          className="panel-section"
          data-testid="chapter-summary-error"
          style={{ fontSize: 12, color: 'var(--color-error)' }}
        >
          {genError}
        </div>
      )}

      {summary?.isExpired && (
        <div
          className="panel-section"
          style={{
            border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
            background: 'color-mix(in srgb, var(--color-warning) 6%, transparent)',
            borderRadius: 6,
            padding: 8,
          }}
        >
          <div
            className="panel-inline-status"
            style={{ fontSize: 12, color: 'var(--color-warning-text)', fontWeight: 500 }}
          >
            <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>章节正文已修改</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-warning-text)', marginTop: 2 }}>
            当前章节上下文可能不再准确，建议重新生成。
          </div>
        </div>
      )}

      {!summary && !genResult && (
        <div className="panel-section">
          <div className="panel-section-title panel-section-title--icon">
            <Sparkles aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>生成章节上下文</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            对当前章节正文进行 AI
            分析，生成结构化上下文。总结将自动校验一致性后写入上下文记录，供后续 AI 生成调用。
          </div>
          <button
            className="btn btn-primary btn-sm"
            data-testid="chapter-summary-generate"
            onClick={onGenerateSummary}
            disabled={genLoading}
            style={{ width: '100%', marginBottom: 6 }}
          >
            {genLoading ? (
              <>
                <PanelLoaderIcon />
                <span>AI 正在分析正文...</span>
              </>
            ) : (
              <>
                <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>生成章节上下文</span>
              </>
            )}
          </button>
        </div>
      )}

      {genResult && (
        <div
          className="panel-section"
          style={{ border: '1px solid var(--color-primary-light)', padding: 10, borderRadius: 6 }}
        >
          <div className="panel-section-title panel-section-title--icon">
            <ClipboardList aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>生成结果预览</span>
          </div>

          {validation && (
            <div
              style={{
                fontSize: 11,
                padding: '6px 8px',
                borderRadius: 4,
                marginBottom: 8,
                background: validation.passed
                  ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                  : validation.safeToContext
                    ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)'
                    : 'color-mix(in srgb, var(--color-error) 6%, transparent)',
                border: `1px solid ${validation.passed ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : validation.safeToContext ? 'color-mix(in srgb, var(--color-warning) 25%, transparent)' : 'color-mix(in srgb, var(--color-error) 25%, transparent)'}`,
              }}
            >
              <div
                className="panel-inline-status"
                style={{
                  fontWeight: 600,
                  color: validation.passed
                    ? 'var(--color-success)'
                    : validation.safeToContext
                      ? 'var(--color-warning-text)'
                      : 'var(--color-error)',
                }}
              >
                {validation.passed ? (
                  <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : validation.safeToContext ? (
                  <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : (
                  <CircleX aria-hidden="true" size={14} strokeWidth={1.8} />
                )}
                <span>
                  {validation.passed
                    ? '校验通过'
                    : validation.safeToContext
                      ? '校验有警告'
                      : '校验失败'}
                  （{validation.score} 分）
                </span>
              </div>
              {validation.problems.map((problem, index) => (
                <div key={index} style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                  • {problem.message}
                </div>
              ))}
              {!validation.safeToContext && (
                <div style={{ color: 'var(--color-error)', marginTop: 4, fontWeight: 500 }}>
                  校验未通过，保存后不会自动启用为可用上下文。你可以手动启用或重新生成。
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            {genResult.summary}
          </div>
          {genResult.keyEvents && genResult.keyEvents.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                <span className="panel-inline-status">
                  <Zap aria-hidden="true" size={13} strokeWidth={1.8} />
                  <span>关键事件：</span>
                </span>
              </div>
              {genResult.keyEvents.map((event, index) => (
                <div key={index} style={{ fontSize: 11, paddingLeft: 8 }}>
                  • {event}
                </div>
              ))}
            </div>
          )}
          {genResult.nextChapterHints && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                <span className="panel-inline-status">
                  <Link2 aria-hidden="true" size={13} strokeWidth={1.8} />
                  <span>下章建议：</span>
                </span>
              </div>
              <div style={{ fontSize: 11, paddingLeft: 8 }}>{genResult.nextChapterHints}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              data-testid="chapter-summary-save"
              onClick={onSaveSummary}
              disabled={genLoading}
              style={{ flex: 1 }}
            >
              {genLoading ? (
                <>
                  <PanelLoaderIcon />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>确认保存</span>
                </>
              )}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onDiscardResult}
              style={{ flex: 1 }}
            >
              放弃
            </button>
          </div>
        </div>
      )}

      {saveSuccess && (
        <div
          style={{ fontSize: 12, color: 'var(--color-success)', textAlign: 'center', padding: 8 }}
        >
          <span className="panel-inline-status" data-testid="chapter-summary-save-success">
            <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>章节上下文已保存成功！</span>
          </span>
        </div>
      )}

      {summary && (
        <>
          <div
            className="panel-section"
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
          >
            {summary.validationStatus === 'passed' && (
              <span
                className="panel-inline-status"
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-success) 13%, transparent)',
                  color: 'var(--color-success)',
                }}
              >
                <CheckCircle2 aria-hidden="true" size={12} strokeWidth={1.8} /> 校验通过
              </span>
            )}
            {summary.validationStatus === 'failed' && (
              <span
                className="panel-inline-status"
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-error) 13%, transparent)',
                  color: 'var(--color-error)',
                }}
              >
                <CircleX aria-hidden="true" size={12} strokeWidth={1.8} /> 校验未通过
              </span>
            )}
            {summary.enabled && (
              <span
                className="panel-inline-status"
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-primary) 13%, transparent)',
                  color: 'var(--color-primary)',
                }}
              >
                <Pin aria-hidden="true" size={12} strokeWidth={1.8} /> 已启用
              </span>
            )}
            {!summary.enabled && (
              <span
                className="panel-inline-status"
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-text-muted) 13%, transparent)',
                  color: 'var(--color-text-muted)',
                }}
              >
                <Pause aria-hidden="true" size={12} strokeWidth={1.8} /> 已停用
              </span>
            )}
            {summary.volumeId && (
              <span
                className="panel-inline-status"
                style={{ fontSize: 10, color: 'var(--color-text-muted)' }}
              >
                <FolderOpen aria-hidden="true" size={12} strokeWidth={1.8} />
                <span>已归卷</span>
              </span>
            )}
          </div>

          <div
            className="panel-section"
            data-testid="chapter-summary-record"
            data-summary-id={summary.id}
            data-summary-expired={summary.isExpired ? 'true' : 'false'}
          >
            <div className="panel-section-title panel-section-title--icon">
              <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>章节摘要</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{summary.summary}</div>
          </div>

          {summary.keyEvents && summary.keyEvents.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title panel-section-title--icon">
                <Zap aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>关键事件</span>
              </div>
              {summary.keyEvents.map((event, index) => (
                <div key={index} style={{ padding: '4px 0', fontSize: 12 }}>
                  • {event}
                </div>
              ))}
            </div>
          )}

          {summary.newForeshadows && summary.newForeshadows.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title panel-section-title--icon">
                <Lightbulb aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>新增伏笔</span>
              </div>
              {summary.newForeshadows.map((foreshadow, index) => (
                <div
                  key={index}
                  style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-primary)' }}
                >
                  • {foreshadow}
                </div>
              ))}
            </div>
          )}

          {summary.resolvedForeshadows && summary.resolvedForeshadows.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title panel-section-title--icon">
                <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>已回收伏笔</span>
              </div>
              {summary.resolvedForeshadows.map((foreshadow, index) => (
                <div
                  key={index}
                  style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-success)' }}
                >
                  • {foreshadow}
                </div>
              ))}
            </div>
          )}

          {summary.nextChapterHints && (
            <div className="panel-section">
              <div className="panel-section-title panel-section-title--icon">
                <Link2 aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>下一章衔接建议</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {summary.nextChapterHints}
              </div>
            </div>
          )}

          <div className="panel-section">
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              创建于：{formatDateTime(summary.createdAt)}
            </div>
          </div>

          <div className="panel-section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onGenerateSummary}
              disabled={genLoading}
            >
              {genLoading ? (
                <>
                  <PanelLoaderIcon />
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>重新生成</span>
                </>
              )}
            </button>
            <button
              className={`btn btn-sm ${summary.enabled ? 'btn-secondary' : 'btn-primary'}`}
              onClick={onToggleSummary}
            >
              {summary.enabled ? (
                <>
                  <Pause aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>停用</span>
                </>
              ) : (
                <>
                  <Pin aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>启用</span>
                </>
              )}
            </button>
          </div>
        </>
      )}

      {!summary && !genResult && !saveSuccess && (
        <div style={{ padding: 16 }}>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              padding: 24,
            }}
          >
            本章尚未生成章节上下文
          </div>
        </div>
      )}
    </div>
  );
}
