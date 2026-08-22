/**
 * AI Novel Studio - 作品详情页上下文概览卡片
 */
import { useState, useEffect, useCallback } from 'react';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { contextRecordService } from '../../services/context/contextRecordService';

interface ContextOverviewCardProps {
  novelId: string;
}

function ContextOverviewCard({ novelId }: ContextOverviewCardProps) {
  const [summaryCount, setSummaryCount] = useState(0);
  const [recordCount, setRecordCount] = useState(0);
  const [activeRecordCount, setActiveRecordCount] = useState(0);

  const load = useCallback(async () => {
    const [summaries, records] = await Promise.all([
      chapterSummaryService.getByNovelId(novelId),
      contextRecordService.getByNovelId(novelId),
    ]);
    setSummaryCount(summaries.length);
    setRecordCount(records.length);
    setActiveRecordCount(records.filter((r) => r.isActive).length);
  }, [novelId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📦</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>上下文记录</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <div
          style={{
            textAlign: 'center',
            padding: 10,
            background: 'var(--color-bg-primary)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-primary)' }}>
            {summaryCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>章节总结</div>
        </div>
        <div
          style={{
            textAlign: 'center',
            padding: 10,
            background: 'var(--color-bg-primary)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-success)' }}>
            {activeRecordCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>启用上下文</div>
        </div>
        <div
          style={{
            textAlign: 'center',
            padding: 10,
            background: 'var(--color-bg-primary)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-muted)' }}>
            {recordCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>总记录数</div>
        </div>
      </div>
      <div className="detail-card-desc" style={{ marginTop: 8 }}>
        章节总结保存后自动生成上下文记录，用于下一章 AI 生成时提供前文衔接
      </div>
    </div>
  );
}

export default ContextOverviewCard;
