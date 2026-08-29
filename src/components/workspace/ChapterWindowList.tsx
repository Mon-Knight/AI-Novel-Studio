import { memo, useEffect, useMemo, useRef } from 'react';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';
import { resolveChapterWindow } from '../../utils/chapterListWindow';

const statusDotColors: Record<string, string> = {
  not_started: 'var(--color-text-muted)',
  outline_ready: 'var(--color-primary)',
  draft_generated: 'var(--color-secondary-accent)',
  editing: 'var(--color-warning)',
  polished: 'var(--color-secondary-accent)',
  adopted: 'var(--color-success)',
  summarized: 'var(--color-success)',
};

interface ChapterWindowListProps {
  chapters: readonly Chapter[];
  activeChapterId: string;
  start: number;
  windowSize: number;
  showStatusLabel?: boolean;
  onStartChange: (start: number) => void;
  onSelectChapter: (chapterId: string) => void;
}

function ChapterWindowListComponent({
  chapters,
  activeChapterId,
  start,
  windowSize,
  showStatusLabel = true,
  onStartChange,
  onSelectChapter,
}: ChapterWindowListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const window = useMemo(
    () => resolveChapterWindow(chapters, start, windowSize),
    [chapters, start, windowSize],
  );

  useEffect(() => {
    const active = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeChapterId, window.start]);

  return (
    <div ref={containerRef}>
      {window.items.map((chapter) => (
        <button
          type="button"
          key={chapter.id}
          data-testid="chapter-item"
          data-chapter-id={chapter.id}
          data-chapter-title={chapter.title}
          data-active={activeChapterId === chapter.id ? 'true' : 'false'}
          aria-current={activeChapterId === chapter.id ? 'page' : undefined}
          className={`tree-chapter ${activeChapterId === chapter.id ? 'active' : ''}`}
          onClick={() => onSelectChapter(chapter.id)}
        >
          <span
            className="chapter-status-dot"
            style={{
              background: statusDotColors[chapter.status] || 'var(--color-text-muted)',
            }}
          />
          <span style={{ flex: 1 }}>
            第{chapter.chapterNumber}章：{chapter.title}
          </span>
          {showStatusLabel && (
            <span className="text-muted" style={{ fontSize: 9 }}>
              {ChapterStatusLabels[chapter.status]}
            </span>
          )}
        </button>
      ))}
      {(window.hasPrevious || window.hasNext) && (
        <nav className="tree-window-controls" aria-label="章节窗口导航">
          <button
            type="button"
            className="tree-load-more"
            disabled={!window.hasPrevious}
            onClick={() => onStartChange(Math.max(0, window.start - windowSize))}
          >
            上一批
          </button>
          <span>
            {window.start + 1}-{window.end} / {window.total}
          </span>
          <button
            type="button"
            className="tree-load-more"
            disabled={!window.hasNext}
            onClick={() => onStartChange(window.start + windowSize)}
          >
            下一批
          </button>
        </nav>
      )}
    </div>
  );
}

export const ChapterWindowList = memo(ChapterWindowListComponent);
