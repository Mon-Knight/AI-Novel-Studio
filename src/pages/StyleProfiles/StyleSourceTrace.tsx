import {
  getStyleProfileTrace,
  STYLE_SOURCE_STATE_LABELS,
} from '../../services/styles/styleProfilePromptProjection';
import type { StyleProfile } from '../../types/style';

function sourceStateColor(state: StyleProfile['sourceState']): string {
  if (state === 'available') return 'var(--color-success)';
  if (state === 'outdated') return 'var(--color-warning)';
  if (state === 'missing') return 'var(--color-error)';
  return 'var(--color-text-secondary)';
}

export function StyleSourceTrace({ profile }: { profile: StyleProfile }) {
  const trace = getStyleProfileTrace(profile);
  if (
    trace.sourceState === 'none' &&
    !trace.sourceReferenceWorkId &&
    !trace.sourceReferenceImportId &&
    !trace.sourceContentHash
  ) {
    return null;
  }
  return (
    <div
      aria-label={`${profile.name} 来源追溯`}
      data-source-state={trace.sourceState}
      style={{
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 6,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-hover)',
        color: 'var(--color-text-secondary)',
        fontSize: 11,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
      }}
    >
      <div style={{ color: sourceStateColor(trace.sourceState), fontWeight: 600 }}>
        {STYLE_SOURCE_STATE_LABELS[trace.sourceState]}
      </div>
      {trace.sourceReferenceWorkId && <div>参考作品：{trace.sourceReferenceWorkId}</div>}
      {trace.sourceReferenceImportId && <div>导入版本：{trace.sourceReferenceImportId}</div>}
      {trace.sourceContentHash && (
        <div title={trace.sourceContentHash}>来源哈希：{trace.sourceContentHash}</div>
      )}
      {(trace.analyzerVersion || trace.promptVersion) && (
        <div>
          分析协议：{trace.analyzerVersion ?? '未知'} / {trace.promptVersion ?? '未知'}
        </div>
      )}
      {(trace.model?.provider || trace.model?.modelName) && (
        <div>
          分析模型：{trace.model.provider ?? '未知'} / {trace.model.modelName ?? '未知'}
        </div>
      )}
      {trace.confidenceOverall !== undefined && (
        <div>总体置信度：{Math.round(trace.confidenceOverall * 100)}%</div>
      )}
      {trace.samples.length > 0 && <div>可重放采样范围：{trace.samples.length} 个</div>}
    </div>
  );
}
