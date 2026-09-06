import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutlineCandidateResults } from '../../components/outline/OutlineCandidateResults';
import type {
  ChapterOutlineCandidate,
  VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';

const volume: VolumeOutlineCandidate = {
  title: '潮汐之卷',
  summary: '从港口展开的线索。',
  goal: '追查旧案',
  mainConflict: '航图争夺',
};
const chapters: ChapterOutlineCandidate[] = [
  { title: '灯塔来信', outline: '主角发现航图。', goal: '确认信使身份', targetWordCount: 3000 },
];
const scrollIntoView = vi.fn();

function element(
  volumeCandidate: VolumeOutlineCandidate | null,
  chapterCandidates: ChapterOutlineCandidate[] = [],
) {
  return (
    <OutlineCandidateResults
      volumeCandidate={volumeCandidate}
      chapterCandidates={chapterCandidates}
      setVolumeCandidate={vi.fn()}
      setChapterCandidates={vi.fn()}
      onSaveVolumeCandidate={vi.fn(async () => undefined)}
      onSaveChapterCandidate={vi.fn(async () => undefined)}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  scrollIntoView.mockClear();
});

describe('explicit outline candidate navigation', () => {
  it('does not move the viewport or focus when volume/chapter candidates arrive or change', () => {
    const view = render(
      <>
        <button>正在阅读的内容</button>
        {element(null)}
      </>,
    );
    const reading = screen.getByRole('button', { name: '正在阅读的内容' });
    act(() => reading.focus());
    view.rerender(
      <>
        <button>正在阅读的内容</button>
        {element(volume)}
      </>,
    );
    expect(screen.getByText('大纲候选已就绪，请审阅后确认保存。')).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(reading);
    view.rerender(
      <>
        <button>正在阅读的内容</button>
        {element(volume, chapters)}
      </>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(reading);
    view.rerender(
      <>
        <button>正在阅读的内容</button>
        {element({ ...volume, summary: '更新的候选摘要' }, chapters)}
      </>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'uses %s reduced-motion preference only after an explicit request',
    (reduced) => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: reduced,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }));
      render(element(volume, chapters));
      expect(scrollIntoView).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '查看候选' }));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'start',
      });
      expect(document.activeElement).toBe(screen.getByLabelText('大纲候选内容'));
      expect(screen.getByRole('textbox', { name: '分卷候选标题' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: '章节候选 1 大纲' })).toBeTruthy();
    },
  );
});
