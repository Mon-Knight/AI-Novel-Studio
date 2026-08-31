import { BarChart3, Eye, Gauge, MessageSquare, Palette, PenLine, Save } from 'lucide-react';
import type { StyleAnalyzeResult } from '../../../types/style';

interface StyleAnalysisResultCardProps {
  result: StyleAnalyzeResult;
  onSave: () => void;
}

export function StyleAnalysisResultCard({ result, onSave }: StyleAnalysisResultCardProps) {
  return (
    <div
      style={{
        border: '1px solid var(--color-primary-light)',
        borderRadius: 6,
        padding: 10,
        marginTop: 8,
      }}
    >
      <div
        className="panel-field-label"
        style={{
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <BarChart3 size={14} strokeWidth={1.8} aria-hidden="true" />
        分析结果
      </div>
      {result.narrativePerspective && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Eye size={13} strokeWidth={1.8} aria-hidden="true" />
          视角：{result.narrativePerspective}
        </div>
      )}
      {result.tone && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Palette size={13} strokeWidth={1.8} aria-hidden="true" />
          基调：{result.tone}
        </div>
      )}
      {result.pace && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Gauge size={13} strokeWidth={1.8} aria-hidden="true" />
          节奏：{result.pace}
        </div>
      )}
      {result.sentenceStyle && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <PenLine size={13} strokeWidth={1.8} aria-hidden="true" />
          句式：{result.sentenceStyle}
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          marginBottom: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <MessageSquare size={13} strokeWidth={1.8} aria-hidden="true" />
        对话比：{Math.round((result.dialogueRatio ?? 0) * 100)}%
        <PenLine size={13} strokeWidth={1.8} aria-hidden="true" />
        描写比：{Math.round((result.descriptionRatio ?? 0) * 100)}%
      </div>
      {result.styleSummary && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.6,
            marginTop: 6,
            padding: 6,
            background: 'var(--color-bg-primary)',
            borderRadius: 4,
          }}
        >
          {result.styleSummary}
        </div>
      )}
      <button
        className="btn btn-primary btn-sm"
        onClick={onSave}
        style={{ marginTop: 8, width: '100%' }}
      >
        <Save size={14} strokeWidth={1.8} aria-hidden="true" />
        保存为风格方案
      </button>
    </div>
  );
}
