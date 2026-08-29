import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import {
  findNextPlannedChapter,
  isNextChapterGoal,
  requestedChapterNumber,
  resolveWorkbenchChapterTarget,
  shouldResolveWorkbenchChapterTarget,
} from './workbenchChapterTarget';

function volume(id: string, orderIndex: number): Volume {
  return {
    id,
    novelId: 'novel-1',
    title: id,
    orderIndex,
    volumeNumber: orderIndex + 1,
    sortOrder: orderIndex,
    status: 'planned',
    createdAt: `2026-08-28T00:00:0${orderIndex}.000Z`,
    updatedAt: `2026-08-28T00:00:0${orderIndex}.000Z`,
  };
}

function chapter(id: string, volumeId: string, orderIndex: number, adopted = false): Chapter {
  return {
    id,
    novelId: 'novel-1',
    volumeId,
    title: id,
    chapterNumber: orderIndex + 1,
    orderIndex,
    sortOrder: orderIndex,
    status: adopted ? 'adopted' : 'outline_ready',
    adoptedDraftId: adopted ? `draft-${id}` : undefined,
    wordCount: adopted ? 4000 : 0,
    currentWords: adopted ? 4000 : 0,
    targetWords: 4100,
    targetWordCount: 4100,
    drafts: [],
    createdAt: `2026-08-28T00:00:0${orderIndex}.000Z`,
    updatedAt: `2026-08-28T00:00:0${orderIndex}.000Z`,
  };
}

test('next-chapter intent stays narrow and respects an explicit current chapter', () => {
  for (const goal of ['继续', '继续写', '接着写', '往下写', '再写一章', '下一章']) {
    assert.equal(isNextChapterGoal(goal), true, goal);
  }
  assert.equal(isNextChapterGoal('继续写下一章，保持克制'), true);
  assert.equal(isNextChapterGoal('生成下一章正文'), true);
  assert.equal(isNextChapterGoal('继续写本章'), false);
  assert.equal(isNextChapterGoal('我想写一个悬疑故事'), false);
});

test('next chapter follows volume order before volume-local chapter order', () => {
  const volumes = [volume('volume-2', 1), volume('volume-1', 0)];
  const chapters = [
    chapter('v2-c1', 'volume-2', 0),
    chapter('v1-c2', 'volume-1', 1, true),
    chapter('v1-c1', 'volume-1', 0, true),
  ];
  assert.equal(findNextPlannedChapter(chapters, volumes, 'v1-c2')?.id, 'v2-c1');
});

test('continue advances only after the current chapter is adopted', async () => {
  const volumes = [volume('volume-1', 0)];
  const unadopted = [chapter('chapter-1', 'volume-1', 0), chapter('chapter-2', 'volume-1', 1)];
  const adopted = [chapter('chapter-1', 'volume-1', 0, true), chapter('chapter-2', 'volume-1', 1)];

  assert.deepEqual(
    await resolveWorkbenchChapterTarget(
      { novelId: 'novel-1', currentChapterId: 'chapter-1', goal: '继续写' },
      { listChapters: async () => unadopted, listVolumes: async () => volumes },
    ),
    { status: 'current', chapterId: 'chapter-1' },
  );
  assert.deepEqual(
    await resolveWorkbenchChapterTarget(
      { novelId: 'novel-1', currentChapterId: 'chapter-1', goal: '继续写' },
      { listChapters: async () => adopted, listVolumes: async () => volumes },
    ),
    { status: 'advanced', chapterId: 'chapter-2' },
  );
});

test('continue skips adopted chapters and selects the first subsequent unadopted chapter', async () => {
  const volumes = [volume('volume-1', 0)];
  const chapters = [
    chapter('chapter-1', 'volume-1', 0, true),
    chapter('chapter-2', 'volume-1', 1, true),
    chapter('chapter-3', 'volume-1', 2),
  ];

  assert.equal(findNextPlannedChapter(chapters, volumes, 'chapter-1')?.id, 'chapter-3');
  for (const goal of ['继续', '继续写', '接着写', '往下写', '再写一章', '下一章']) {
    assert.deepEqual(
      await resolveWorkbenchChapterTarget(
        { novelId: 'novel-1', currentChapterId: 'chapter-1', goal },
        { listChapters: async () => chapters, listVolumes: async () => volumes },
      ),
      { status: 'advanced', chapterId: 'chapter-3' },
      goal,
    );
  }
});

test('explicit Arabic and Chinese chapter numbers select the requested planned chapter', async () => {
  const volumes = [volume('volume-1', 0)];
  const chapters = [
    chapter('chapter-1', 'volume-1', 0, true),
    chapter('chapter-2', 'volume-1', 1),
    chapter('chapter-3', 'volume-1', 2),
  ];

  assert.equal(requestedChapterNumber('写第二章'), 2);
  assert.equal(requestedChapterNumber('生成第2章'), 2);
  assert.equal(requestedChapterNumber('生成第十二章'), 12);
  for (const goal of ['写第二章', '生成第2章']) {
    assert.deepEqual(
      await resolveWorkbenchChapterTarget(
        { novelId: 'novel-1', currentChapterId: 'chapter-1', goal },
        { listChapters: async () => chapters, listVolumes: async () => volumes },
      ),
      { status: 'advanced', chapterId: 'chapter-2' },
      goal,
    );
  }
});

test('an explicit chapter outline goal resolves the requested chapter instead of the current one', async () => {
  const volumes = [volume('volume-1', 0)];
  const chapters = Array.from({ length: 12 }, (_, index) =>
    chapter(`chapter-${index + 1}`, 'volume-1', index),
  );

  assert.equal(shouldResolveWorkbenchChapterTarget('生成第十二章大纲'), true);
  assert.equal(shouldResolveWorkbenchChapterTarget('完善当前章节大纲'), false);
  assert.equal(shouldResolveWorkbenchChapterTarget('分析第十二章大纲'), false);
  assert.deepEqual(
    await resolveWorkbenchChapterTarget(
      { novelId: 'novel-1', currentChapterId: 'chapter-1', goal: '生成第十二章大纲' },
      { listChapters: async () => chapters, listVolumes: async () => volumes },
    ),
    { status: 'advanced', chapterId: 'chapter-12' },
  );
});

test('an analysis request that mentions a chapter keeps the current target', async () => {
  const volumes = [volume('volume-1', 0)];
  const chapters = [chapter('chapter-1', 'volume-1', 0, true), chapter('chapter-2', 'volume-1', 1)];

  assert.deepEqual(
    await resolveWorkbenchChapterTarget(
      { novelId: 'novel-1', currentChapterId: 'chapter-1', goal: '分析第二章的人物动机' },
      { listChapters: async () => chapters, listVolumes: async () => volumes },
    ),
    { status: 'current', chapterId: 'chapter-1' },
  );
});

test('continue fails closed when the final planned chapter is already adopted', async () => {
  const volumes = [volume('volume-1', 0)];
  const chapters = [chapter('chapter-1', 'volume-1', 0, true)];
  assert.deepEqual(
    await resolveWorkbenchChapterTarget(
      { novelId: 'novel-1', currentChapterId: 'chapter-1', goal: '继续写' },
      { listChapters: async () => chapters, listVolumes: async () => volumes },
    ),
    { status: 'complete' },
  );
});
