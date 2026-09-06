import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import { ChapterLocator } from './ChapterLocator';

const chapters = Array.from(
  { length: 1000 },
  (_, index) =>
    ({
      id: `chapter-${index + 1}`,
      chapterNumber: index + 1,
      title: `测试章节${index + 1}`,
    }) as Chapter,
);

it('finds any of 1000 chapters by number/title while keeping select options bounded', () => {
  const onSelect = vi.fn();
  render(
    <ChapterLocator
      chapters={chapters}
      activeChapterId="chapter-1"
      onSelectChapter={onSelect}
      selectTestId="chapter-select"
    />,
  );
  expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(81);
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '第999章' } });
  expect(screen.getByRole('option', { name: '第999章：测试章节999' })).toBeTruthy();
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith('chapter-999');
  expect((search as HTMLInputElement).value).toBe('');
});

it('offers bounded directory search results and returns to the current chapter without changing it', () => {
  const onSelect = vi.fn();
  const onLocateCurrent = vi.fn();
  render(
    <ChapterLocator
      chapters={chapters}
      activeChapterId="chapter-850"
      mode="directory"
      onSelectChapter={onSelect}
      onLocateCurrent={onLocateCurrent}
    />,
  );
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '测试' } });
  expect(screen.getAllByRole('button').length).toBeLessThanOrEqual(21);
  expect(screen.getByRole('status').textContent).toContain('匹配 1000 章');
  fireEvent.change(search, { target: { value: '测试章节999' } });
  fireEvent.click(screen.getByRole('button', { name: '第999章：测试章节999' }));
  expect(onSelect).toHaveBeenCalledWith('chapter-999');
  fireEvent.click(screen.getByRole('button', { name: '返回当前章' }));
  expect(onLocateCurrent).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledTimes(1);
});
