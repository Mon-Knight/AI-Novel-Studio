import { beforeEach, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';

const mocks = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  storage: new Map<string, unknown>(),
  writes: vi.fn(),
}));
vi.mock('../database/db', () => ({
  dbCall: (command: string, args: unknown, fallback?: () => unknown) =>
    mocks.desktop ? mocks.invoke(command, args) : fallback?.(),
  lsGet: (key: string) => structuredClone(mocks.storage.get(key)),
  lsSet: (key: string, value: unknown) => {
    mocks.writes(key, value);
    mocks.storage.set(key, structuredClone(value));
  },
  generateId: () => 'unused',
  nowISO: () => 'after',
}));
import { chapterDetailsPatch, rebaseChapterDetails, chapterDetailsValues } from './chapterDetails';
import { chapterRepository } from '../database/chapterRepository';

const chapter: Chapter = {
  id: 'c',
  novelId: 'n',
  title: '旧标题',
  volumeId: 'v',
  outline: '采用章纲',
  goal: '旧目标',
  status: 'adopted',
  targetWordCount: 3400,
  wordCount: 3200,
  currentWords: 3200,
  targetWords: 3400,
  chapterNumber: 3,
  orderIndex: 2,
  sortOrder: 2,
  drafts: [],
  createdAt: 'created',
  updatedAt: 'before',
};
beforeEach(() => {
  mocks.desktop = false;
  mocks.invoke.mockReset();
  mocks.writes.mockReset();
  mocks.storage.clear();
  mocks.storage.set('ai_novel_studio_novels', [{ id: 'n' }]);
  mocks.storage.set('ai_novel_studio_chapters', [chapter]);
});

it('submits only the changed goal, with no stale outline or other fields', () => {
  expect(
    chapterDetailsPatch(chapter, { ...chapterDetailsValues(chapter), goal: '新目标' }),
  ).toEqual({ goal: '新目标' });
});

it('explicit rebase preserves local edits and refreshes untouched metadata', () => {
  expect(
    rebaseChapterDetails(
      chapter,
      { ...chapterDetailsValues(chapter), goal: '待保存目标' },
      { ...chapter, title: '新标题', outline: '新采用章纲', targetWordCount: 4000 },
    ),
  ).toEqual({
    ...chapterDetailsValues(chapter),
    title: '新标题',
    goal: '待保存目标',
    targetWordCount: 4000,
  });
});

it('uses guarded native save and never falls back after native conflict', async () => {
  mocks.desktop = true;
  mocks.invoke.mockResolvedValue({ ...chapter, goal: '新目标', updatedAt: 'after' });
  expect((await chapterRepository.saveDetails(chapter, { goal: '新目标' })).goal).toBe('新目标');
  expect(mocks.invoke).toHaveBeenCalledWith('save_chapter_details', {
    input: {
      baseline: expect.objectContaining({
        id: 'c',
        novelId: 'n',
        outline: '采用章纲',
        updatedAt: 'before',
      }),
      patch: { goal: '新目标' },
    },
  });
  mocks.invoke.mockRejectedValue(new Error('CHAPTER_DETAILS_CONFLICT: stale'));
  await expect(chapterRepository.saveDetails(chapter, { goal: '新目标' })).rejects.toThrow(
    'CHAPTER_DETAILS_CONFLICT',
  );
  expect(mocks.writes).not.toHaveBeenCalled();
});

it.each([
  { updatedAt: 'new' },
  { outline: '新采用章纲' },
  { novelId: 'other' },
  { deletedAt: 'gone' },
])(
  'browser save rejects stale, cross project or removed chapter without writes: %j',
  async (patch) => {
    mocks.storage.set('ai_novel_studio_chapters', [{ ...chapter, ...patch }]);
    await expect(chapterRepository.saveDetails(chapter, { goal: '新目标' })).rejects.toThrow(
      'CHAPTER_DETAILS_CONFLICT',
    );
    expect(mocks.writes).not.toHaveBeenCalled();
  },
);

it('browser save clears optional values while preserving adopted outline and body metadata', async () => {
  const saved = await chapterRepository.saveDetails(chapter, {
    goal: '',
    volumeId: '',
    targetWordCount: 0,
  });
  expect(saved).toMatchObject({
    goal: '',
    outline: '采用章纲',
    wordCount: 3200,
    status: 'adopted',
    updatedAt: 'after',
  });
  expect(saved.volumeId).toBeUndefined();
  expect(saved.targetWordCount).toBeUndefined();
});
