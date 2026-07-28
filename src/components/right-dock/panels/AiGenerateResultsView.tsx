import type { ChapterDraft, ChapterGenerationContext, OutlineKeyPoint } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftResultMetadata } from '../../../types/workspaceSafety';
import type { GenerationValidationState } from './aiGenerateValidation';
import { getOutlineValidationStatus } from './aiGenerateValidation';
import type { StreamPreviewStatus } from './useGenerationStreamPreview';

interface AiGenerateResultsViewProps {
  novelId?: string;
  chapter: Chapter;
  streamPreview: string;
  streamPreviewStatus: StreamPreviewStatus;
  statusMsg: string;
  errorMsg: string;
  validationState: GenerationValidationState | null;
  contextSummary: ChapterGenerationContext | null;
  generating: boolean;
  revising: boolean;
  latestGeneratedDraft: ChapterDraft | null;
  latestGeneratedTarget: DraftResultMetadata | null;
  latestGeneratedAlreadyDisplayed: boolean;
  candidateApplyAvailable: boolean;
  adopting: boolean;
  genMode: 'new' | 'rewrite';
  onGenerate: (options?: { retryMissingPoints?: OutlineKeyPoint[] }) => void;
  onReviseByOutline: () => void;
  onKeepDraft: () => void;
  onAppendCandidate: () => void;
  onReplaceCandidate: () => void;
  onAdopt: () => void;
}

export function AiGenerateResultsView({
  novelId,
  chapter,
  streamPreview,
  streamPreviewStatus,
  statusMsg,
  errorMsg,
  validationState,
  contextSummary,
  generating,
  revising,
  latestGeneratedDraft,
  latestGeneratedTarget,
  latestGeneratedAlreadyDisplayed,
  adopting,
  genMode,
  candidateApplyAvailable,
  onGenerate,
  onReviseByOutline,
  onKeepDraft,
  onAppendCandidate,
  onReplaceCandidate,
  onAdopt,
}: AiGenerateResultsViewProps) {
  return (
    <>
      {streamPreviewStatus !== 'idle' && (
        <div
          className="panel-section"
          data-testid="ai-stream-preview"
          data-stream-status={streamPreviewStatus}
          style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 12 }}>实时候选预览</strong>
            <span
              style={{
                fontSize: 11,
                color:
                  streamPreviewStatus === 'interrupted'
                    ? 'var(--color-warning)'
                    : 'var(--color-text-muted)',
              }}
            >
              {streamPreviewStatus === 'streaming'
                ? `输出中 · ${streamPreview.length} 字符`
                : streamPreviewStatus === 'completed'
                  ? `已完成 · ${streamPreview.length} 字符`
                  : `已停止 · ${streamPreview.length} 字符`}
            </span>
          </div>
          <div
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.7,
              padding: 10,
              background: 'var(--color-bg-primary)',
              borderRadius: 4,
            }}
          >
            {streamPreview || '正在等待模型返回首段内容……'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
            输出完成并通过校验后才会保存为草稿并载入写作工作台；中断残片不会覆盖正文。
          </div>
        </div>
      )}

      {/* 状态消息 */}
      {statusMsg && (
        <div
          style={{
            fontSize: 13,
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            background: statusMsg.includes('成功')
              ? 'var(--color-success-bg)'
              : 'var(--color-primary-light)',
            color: statusMsg.includes('成功')
              ? 'var(--color-success-text)'
              : 'var(--color-primary)',
          }}
          data-testid="success-notice"
        >
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div
          style={{
            fontSize: 13,
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            background: 'var(--color-error-bg)',
            color: 'var(--color-error-text)',
          }}
          data-testid="error-notice"
        >
          {errorMsg}
        </div>
      )}

      {validationState && (
        <div
          className="panel-section"
          data-testid="candidate-constraints"
          data-draft-id={validationState.draftId}
          data-outline-score={validationState.outlineCompliance.score}
          data-missing-outline-count={validationState.outlineCompliance.missingPoints.length}
          data-missing-required-count={validationState.missingRequiredNames.length}
          style={{
            border: `1px solid ${validationState.outlineCompliance.score < 60 || validationState.missingRequiredNames.length > 0 ? 'var(--color-error)' : validationState.outlineCompliance.score < 80 ? 'var(--color-warning)' : 'var(--color-border)'}`,
            borderRadius: 6,
            padding: 10,
          }}
        >
          <div className="panel-section-title">生成后校验</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>
              大纲遵循检查：{getOutlineValidationStatus(validationState.outlineCompliance.score)}
              <strong style={{ marginLeft: 6 }}>
                {validationState.outlineCompliance.score} 分
              </strong>
            </div>
            <div>
              已覆盖：{validationState.outlineCompliance.coveredPoints.length} 项， 缺失：
              {validationState.outlineCompliance.missingPoints.length} 项
            </div>
            <div>
              角色出场检查：
              {validationState.missingRequiredNames.length > 0
                ? `缺失（${validationState.missingRequiredNames.join('、')}）`
                : '通过'}
            </div>
          </div>
          {validationState.outlineCompliance.missingPoints.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>缺失的大纲关键点</div>
              <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {validationState.outlineCompliance.missingPoints.map((point) => (
                  <li key={point.id}>{point.text}</li>
                ))}
              </ol>
            </div>
          )}
          {(validationState.outlineCompliance.score < 80 ||
            validationState.missingRequiredNames.length > 0) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 8 }}>
                ⚠️ 正文已生成，但大纲遵循度较低。建议重新生成或按大纲修正后再确认采用。
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    onGenerate({
                      retryMissingPoints:
                        validationState.outlineCompliance.missingPoints.length > 0
                          ? validationState.outlineCompliance.missingPoints
                          : contextSummary?.outlineKeyPoints || [],
                    })
                  }
                  disabled={generating || revising}
                >
                  重新生成
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={onReviseByOutline}
                  disabled={generating || revising}
                >
                  按大纲修正
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onKeepDraft}
                  disabled={generating || revising}
                >
                  保留草稿
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {latestGeneratedDraft && (
        <div
          className="panel-section"
          data-testid="candidate-review"
          data-draft-id={latestGeneratedDraft.id}
          data-result-id={latestGeneratedTarget?.resultId ?? ''}
          data-novel-id={latestGeneratedTarget?.novelId ?? latestGeneratedDraft.novelId}
          data-chapter-id={latestGeneratedTarget?.chapterId ?? latestGeneratedDraft.chapterId}
          data-source-draft-id={latestGeneratedTarget?.sourceDraftId ?? ''}
          data-source-revision={latestGeneratedTarget?.sourceRevision ?? ''}
          data-base-content-hash={latestGeneratedTarget?.baseContentHash ?? ''}
          data-result-source={latestGeneratedTarget?.source ?? ''}
          data-ai-task-id={latestGeneratedDraft.aiTaskId ?? ''}
          data-version-no={latestGeneratedDraft.versionNo}
        >
          <div className="panel-section-title">应用最近生成结果</div>
          <pre
            data-testid="candidate-content"
            style={{
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-family-editor)',
              fontSize: 12,
              lineHeight: 1.6,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border-light)',
              borderRadius: 4,
              padding: 8,
            }}
          >
            {latestGeneratedDraft.content}
          </pre>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={onAppendCandidate}
              disabled={
                !candidateApplyAvailable ||
                !latestGeneratedTarget ||
                latestGeneratedAlreadyDisplayed
              }
              style={{ flex: 1 }}
              title={
                latestGeneratedAlreadyDisplayed
                  ? '当前编辑器已显示该草稿，避免重复追加'
                  : '追加到当前正文末尾'
              }
            >
              追加到正文
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={onReplaceCandidate}
              disabled={
                !candidateApplyAvailable ||
                !latestGeneratedTarget ||
                latestGeneratedAlreadyDisplayed
              }
              style={{ flex: 1 }}
              title={latestGeneratedAlreadyDisplayed ? '当前编辑器已显示该草稿' : '替换当前全文'}
              data-testid="candidate-replace"
            >
              替换全文
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
            当前生成结果已保存为草稿 v{latestGeneratedDraft.versionNo}。
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="panel-section">
        <button
          className="panel-btn panel-btn-primary"
          onClick={() => onGenerate()}
          disabled={generating || revising}
          data-testid="ai-generate-submit"
        >
          {generating
            ? revising
              ? '⏳ 正在修正...'
              : '⏳ 正在生成...'
            : `🤖 ${genMode === 'rewrite' ? '重新生成' : '生成本章'}`}
        </button>
        <button
          className="panel-btn panel-btn-secondary"
          onClick={onAdopt}
          disabled={generating || revising || adopting}
          data-testid="candidate-apply"
          data-result-id={latestGeneratedTarget?.resultId ?? ''}
          data-novel-id={latestGeneratedTarget?.novelId ?? novelId ?? ''}
          data-chapter-id={latestGeneratedTarget?.chapterId ?? chapter.id}
          data-apply-mode="adopt"
        >
          {adopting ? '⏳ 采用中...' : '✅ 确认采用'}
        </button>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            marginTop: 6,
          }}
        >
          AI 生成结果将保存为草稿版本，需手动确认采用
        </div>
      </div>
    </>
  );
}
