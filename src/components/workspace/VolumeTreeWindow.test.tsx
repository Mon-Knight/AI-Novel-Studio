import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import VolumeTree from './VolumeTree';

const volume: Volume = {
  id: 'volume-1',
  novelId: 'novel-1',
  title: '第一卷',
  orderIndex: 1,
  volumeNumber: 1,
  sortOrder: 1,
  status: 'writing',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function chapter(index: number): Chapter {
  return {
    id: `chapter-${index}`,
    novelId: 'novel-1',
    volumeId: volume.id,
    title: `章节 ${index}`,
    outline: '',
    goal: '',
    chapterNumber: index + 1,
    orderIndex: index,
    sortOrder: index,
    status: 'not_started',
    wordCount: 0,
    currentWords: 0,
    targetWords: 0,
    drafts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('VolumeTree chapter window', () => {
  it('keeps a 1,000-chapter volume bounded while centering a late active chapter', async () => {
    const chapters = Array.from({ length: 1_000 }, (_, index) => chapter(index));
    render(
      <VolumeTree
        volumes={[volume]}
        chapters={chapters}
        activeChapterId="chapter-999"
        onSelectChapter={vi.fn()}
        onCreateVolume={vi.fn(async () => undefined)}
        onCreateChapter={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId('chapter-item')).toHaveLength(80));
    expect(
      screen.getByTestId('chapter-list').querySelector('[data-chapter-id="chapter-999"]'),
    ).toBeTruthy();
    expect(screen.getByText('921-1000 / 1000')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上一批' }));
    await waitFor(() => expect(screen.getByText('841-920 / 1000')).toBeTruthy());
    expect(screen.getAllByTestId('chapter-item')).toHaveLength(80);
  });
});
