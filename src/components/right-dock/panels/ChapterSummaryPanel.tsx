/**
 * AI Novel Studio - 章节总结查看面板
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterSummary } from '../../../types/chapterSummary';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';

interface ChapterSummaryPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function ChapterSummaryPanel({ novelId, chapter }: ChapterSummaryPanelProps) {
  const [summary, setSummary] = useState<ChapterSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!chapter?.id) return;
    setLoading(true);
    try { setSummary(await chapterSummaryService.getByChapterId(chapter.id)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [chapter?.id]);

  useEffect(() => { load(); }, [load]);

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;
  if (loading) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>加载中...</div>;
  if (!summary) return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
        本章尚未生成总结
      </div>
    </div>
  );

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">📋 章节摘要</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{summary.summary}</div>
      </div>

      {summary.keyEvents && summary.keyEvents.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">⚡ 关键事件</div>
          {summary.keyEvents.map((e, i) => (
            <div key={i} style={{ padding: '4px 0', fontSize: 12 }}>• {e}</div>
          ))}
        </div>
      )}

      {summary.newForeshadows && summary.newForeshadows.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">🔮 新增伏笔</div>
          {summary.newForeshadows.map((f, i) => (
            <div key={i} style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-primary)' }}>• {f}</div>
          ))}
        </div>
      )}

      {summary.resolvedForeshadows && summary.resolvedForeshadows.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">✅ 已回收伏笔</div>
          {summary.resolvedForeshadows.map((f, i) => (
            <div key={i} style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-success)' }}>• {f}</div>
          ))}
        </div>
      )}

      {summary.nextChapterHints && (
        <div className="panel-section">
          <div className="panel-section-title">🔗 下一章衔接建议</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{summary.nextChapterHints}</div>
        </div>
      )}

      <div className="panel-section">
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          创建于：{new Date(summary.createdAt).toLocaleString('zh-CN')}
        </div>
      </div>
    </div>
  );
}

export default ChapterSummaryPanel;
