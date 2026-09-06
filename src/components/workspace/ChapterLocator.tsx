import { useMemo, useRef, useState } from 'react';
import type { Chapter } from '../../types/chapter';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';
import '../../styles/chapter-locator.css';

interface Props {
  chapters: readonly Chapter[];
  activeChapterId?: string;
  onSelectChapter: (chapterId: string) => void;
  onLocateCurrent?: () => void;
  selectId?: string;
  selectTestId?: string;
  includeProject?: boolean;
  disabled?: boolean;
  mode?: 'select' | 'directory';
}

function chapterLabel(chapter: Chapter): string {
  const title = chapter.title?.trim();
  if (title && /^第[\d一二三四五六七八九十百千万]+章(?:[：:]|\s|$)/u.test(title)) return title;
  return `第${chapter.chapterNumber}章：${title || '未命名章节'}`;
}

export function ChapterLocator({
  chapters,
  activeChapterId = '',
  onSelectChapter,
  onLocateCurrent,
  selectId,
  selectTestId,
  includeProject = false,
  disabled = false,
  mode = 'select',
}: Props) {
  const [query, setQuery] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const matches = useMemo(() => {
    const normalized = query
      .trim()
      .toLocaleLowerCase()
      .replace(/^第\s*(\d+)\s*章$/u, '$1');
    if (/^\d+$/u.test(normalized))
      return chapters.filter((chapter) => chapter.chapterNumber === Number(normalized));
    return normalized
      ? chapters.filter((chapter) =>
          `${chapter.chapterNumber} ${chapter.title}`.toLocaleLowerCase().includes(normalized),
        )
      : chapters;
  }, [chapters, query]);
  const shown = matches.slice(0, mode === 'directory' ? 20 : 80);
  const active = chapters.find((chapter) => chapter.id === activeChapterId);
  const options =
    active && !shown.some((chapter) => chapter.id === active.id) ? [active, ...shown] : shown;
  const choose = (id: string) => {
    if (disabled || (id && !chapters.some((chapter) => chapter.id === id))) return;
    onSelectChapter(id);
    setQuery('');
  };
  return (
    <div className="chapter-locator">
      <div className="chapter-locator-search">
        <input
          type="search"
          aria-label="按章号或标题查找章节"
          placeholder="章号或标题"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !isComposingKeyboardEvent(event) &&
              query.trim() &&
              matches.length === 1
            ) {
              event.preventDefault();
              choose(matches[0].id);
            }
            if (event.key === 'Escape' && !isComposingKeyboardEvent(event) && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }
          }}
        />
        <button
          type="button"
          className="chapter-locator-current"
          disabled={disabled || !active}
          onClick={() => {
            setQuery('');
            onLocateCurrent?.();
            selectRef.current?.focus();
          }}
        >
          返回当前章
        </button>
      </div>
      {mode === 'select' ? (
        <select
          ref={selectRef}
          id={selectId}
          data-testid={selectTestId}
          aria-label={includeProject ? '目标范围' : '目标章节'}
          disabled={disabled}
          value={activeChapterId}
          onChange={(event) => choose(event.target.value)}
        >
          {includeProject ? (
            <option value="">整个小说项目</option>
          ) : !activeChapterId ? (
            <option value="" disabled>
              选择目标章节
            </option>
          ) : null}
          {options.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapterLabel(chapter)}
            </option>
          ))}
        </select>
      ) : (
        query.trim() && (
          <div className="chapter-locator-results" aria-label="章节查找结果">
            {shown.map((chapter) => (
              <button
                type="button"
                key={chapter.id}
                onClick={() => choose(chapter.id)}
                disabled={disabled}
              >
                {chapterLabel(chapter)}
              </button>
            ))}
          </div>
        )
      )}
      {query.trim() && (
        <span className="chapter-locator-count" role="status">
          {matches.length === 0
            ? '没有匹配的章节'
            : `匹配 ${matches.length} 章${matches.length > shown.length ? `，显示前 ${shown.length} 章，请细化关键词` : ''}`}
        </span>
      )}
    </div>
  );
}
