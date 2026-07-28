import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - 统一章节创建服务
 * 串起 volume -> chapter -> draft，并在每一步写入后反查。
 */

import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import type { Volume, CreateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';

export interface ChapterCreationResult {
  volume: Volume;
  chapter: Chapter;
  draft: ChapterDraft;
}

interface FirstChapterOptions {
  volumeTitle?: string;
  chapterTitle?: string;
  outline?: string;
  goal?: string;
  targetWordCount?: number;
}

type ChapterOptions = Pick<
  CreateChapterInput,
  'outline' | 'goal' | 'targetWordCount' | 'orderIndex'
>;

export async function createVolumeForNovel(
  novelId: string,
  title = '第一卷',
  options: Partial<Omit<CreateVolumeInput, 'novelId' | 'title'>> = {},
): Promise<Volume> {
  if (!novelId) throw new Error('novelId 缺失，无法创建分卷');
  if (!title?.trim()) throw new Error('分卷标题不能为空');

  appLogger.info('[chapterCreation] create volume start');
  const volume = await volumeRepository.create({ ...options, novelId, title: title.trim() });
  if (!volume?.id) throw new Error('创建分卷失败：未返回有效 volume.id');
  appLogger.info(`[chapterCreation] create volume result id=${volume.id}`);

  const volumesAfter = await volumeRepository.getByNovelId(novelId);
  appLogger.info(`[chapterCreation] volumes after count=${volumesAfter.length}`);
  if (!volumesAfter.some((v) => v.id === volume.id)) {
    throw new Error('分卷创建后无法读取，请检查存储');
  }

  return volume;
}

export async function createFirstVolumeAndChapter(
  novelId: string,
  options: FirstChapterOptions = {},
): Promise<ChapterCreationResult> {
  if (!novelId) throw new Error('novelId 缺失，无法创建章节');

  const volume = await createVolumeForNovel(novelId, options.volumeTitle || '第一卷');
  const { chapter, draft } = await createChapterInVolume(
    novelId,
    volume.id,
    options.chapterTitle || '第1章',
    {
      outline: options.outline,
      goal: options.goal,
      targetWordCount: options.targetWordCount,
    },
  );

  return { volume, chapter, draft };
}

export async function createChapterInVolume(
  novelId: string,
  volumeId: string,
  title: string,
  options: ChapterOptions = {},
): Promise<{ chapter: Chapter; draft: ChapterDraft }> {
  if (!novelId) throw new Error('novelId 缺失');
  if (!volumeId) throw new Error('volumeId 缺失');
  if (!title?.trim()) throw new Error('章节标题不能为空');

  appLogger.info('[chapterCreation] create chapter start');
  const chapter = await chapterRepository.create({
    ...options,
    novelId,
    volumeId,
    title: title.trim(),
  });
  if (!chapter?.id) throw new Error('创建章节失败：未返回有效 chapter.id');
  appLogger.info(`[chapterCreation] create chapter result id=${chapter.id}`);

  const chaptersAfter = await chapterRepository.getByNovelId(novelId);
  appLogger.info(`[chapterCreation] chapters after count=${chaptersAfter.length}`);
  if (!chaptersAfter.some((c) => c.id === chapter.id)) {
    throw new Error('章节创建后无法读取，请检查存储');
  }

  appLogger.info('[chapterCreation] create draft start');
  const draft = await draftVersionService.create({
    novelId,
    chapterId: chapter.id,
    title: chapter.title,
    content: '',
    source: 'manual_placeholder',
  });
  if (!draft?.id) throw new Error('创建草稿失败：未返回有效 draft.id');
  appLogger.info(`[chapterCreation] draft result id=${draft.id}`);

  const loadedDraft = await draftVersionService.getLatestByChapterId(chapter.id);
  if (!loadedDraft?.id) {
    throw new Error('草稿创建后无法读取，请检查存储');
  }

  return { chapter, draft: loadedDraft };
}
