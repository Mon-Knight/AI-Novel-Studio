import { BookOpenText, Bot, CheckCircle2, Clock3, LoaderCircle, Save } from 'lucide-react';
import type { VolumeCompletionCheck, VolumeSummarizeResult } from '../../../types/chapterSummary';
import type { Volume } from '../../../types/volume';

interface VolumeContextGenerationSectionProps {
  volumes: Volume[];
  volumeChecks: Record<string, VolumeCompletionCheck>;
  loadingByVolume: Record<string, boolean>;
  errorByVolume: Record<string, string>;
  resultByVolume: Record<string, VolumeSummarizeResult>;
  onGenerate: (volume: Volume) => void;
  onSave: (volume: Volume) => void;
  onDiscard: (volumeId: string) => void;
}

export function VolumeContextGenerationSection({
  volumes,
  volumeChecks,
  loadingByVolume,
  errorByVolume,
  resultByVolume,
  onGenerate,
  onSave,
  onDiscard,
}: VolumeContextGenerationSectionProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          marginBottom: 6,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <BookOpenText size={13} strokeWidth={1.8} aria-hidden="true" />
          卷上下文生成
        </span>
      </div>
      {volumes.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: 8 }}>
          暂无分卷。请先在作品详情页创建分卷。
        </div>
      )}
      {volumes.map((volume) => {
        const check = volumeChecks[volume.id];
        const isLoading = loadingByVolume[volume.id];
        const error = errorByVolume[volume.id];
        const result = resultByVolume[volume.id];
        return (
          <div
            key={volume.id}
            style={{
              padding: 8,
              marginBottom: 6,
              borderRadius: 6,
              border: '1px solid var(--color-border-light)',
              background: 'var(--color-bg-primary)',
            }}
          >
            <div
              style={{
                fontWeight: 500,
                fontSize: 12,
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <BookOpenText size={13} strokeWidth={1.8} aria-hidden="true" />
              {volume.title}
              {check && (
                <span
                  style={{
                    fontSize: 10,
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: check.completed
                      ? 'color-mix(in srgb, var(--color-success) 13%, transparent)'
                      : 'color-mix(in srgb, var(--color-warning) 13%, transparent)',
                    color: check.completed ? 'var(--color-success)' : 'var(--color-warning-text)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {check.completed ? (
                      <CheckCircle2 size={11} strokeWidth={1.8} aria-hidden="true" />
                    ) : (
                      <Clock3 size={11} strokeWidth={1.8} aria-hidden="true" />
                    )}
                    {check.completed ? '可生成' : '未就绪'}
                  </span>
                </span>
              )}
            </div>
            {check && !check.completed && check.reasons.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--color-warning-text)', marginBottom: 6 }}>
                {check.reasons.map((reason, index) => (
                  <div key={index}>• {reason}</div>
                ))}
              </div>
            )}
            {check?.completed && !result && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onGenerate(volume)}
                disabled={isLoading}
                style={{
                  width: '100%',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                {isLoading ? (
                  <>
                    <LoaderCircle size={13} strokeWidth={1.8} aria-hidden="true" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Bot size={13} strokeWidth={1.8} aria-hidden="true" />
                    生成卷上下文
                  </>
                )}
              </button>
            )}
            {error && (
              <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 4 }}>{error}</div>
            )}
            {result && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <div
                  style={{
                    fontWeight: 500,
                    color: 'var(--color-success)',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  {result.summaryTitle}
                </div>
                <div
                  style={{
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.5,
                    marginBottom: 4,
                  }}
                >
                  {result.volumeMainArc.slice(0, 150)}…
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onSave(volume)}
                    style={{ flex: 1, fontSize: 10 }}
                  >
                    <Save size={12} strokeWidth={1.8} aria-hidden="true" />
                    保存为上下文
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => onDiscard(volume.id)}
                    style={{ flex: 1, fontSize: 10 }}
                  >
                    放弃
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
