import { memo } from 'react';
import { Brain } from 'lucide-react';

export const MemoryInspectorCard = memo(function MemoryInspectorCard({
  sceneName,
  povName,
  versionNumber = 1,
  longTermCount = 0,
  midTermCount = 0,
  shortTermCount = 0,
  retrievedCount = 0,
}: {
  sceneName?: string;
  povName?: string;
  versionNumber?: number;
  longTermCount?: number;
  midTermCount?: number;
  shortTermCount?: number;
  retrievedCount?: number;
}) {
  const totalMemories = longTermCount + midTermCount + shortTermCount + retrievedCount;
  if (totalMemories === 0 && !povName && !sceneName) {
    return (
      <div
        className="workbench-memory-inspector-empty"
        data-testid="workbench-memory-empty"
        style={{
          padding: 16,
          textAlign: 'center',
          color: 'var(--color-text-muted, #64748b)',
          fontSize: 13,
        }}
      >
        No memory context available
      </div>
    );
  }

  return (
    <div
      className="workbench-memory-inspector-card"
      data-testid="workbench-memory-inspector-card"
      style={{
        border: '1px solid var(--color-border-light, #e2e8f0)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--color-bg-card, #ffffff)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong className="workbench-memory-title">
          <Brain aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>Memory Context · v{versionNumber}</span>
        </strong>
        <span style={{ color: 'var(--color-text-muted, #64748b)' }}>{sceneName || '当前分镜'}</span>
      </div>
      <div style={{ color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
        POV: {povName || '默认全知'} · 召回碎片: {retrievedCount} 条
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          fontSize: 11,
          color: 'var(--color-text-muted, #64748b)',
        }}
      >
        <span>长期: {longTermCount}</span>
        <span>中期: {midTermCount}</span>
        <span>短期: {shortTermCount}</span>
      </div>
    </div>
  );
});
