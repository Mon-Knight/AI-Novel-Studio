/**
 * AI Novel Studio - 统一章节创建服务 v1.0.20
 * 确保 volume → chapter → draft 完整闭环，创建后必须反查验证
 */

import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';

export interface ChapterCreationResult {
  volume: Volume;
  chapter: Chapter;
  draft: ChapterDraft;
}

/**
 * 创建第一卷 + 第一章 + 空草稿（完整闭环 + 每步反查）
 */
export async function createFirstVolumeAndChapter(novelId: string): Promise<ChapterCreationResult> {
  if (!novelId) throw new Error('novelId 缺失，无法创建章节');

  // 1. 创建分卷
  const volume = await volumeRepository.create({ novelId, title: '第一卷' });
  if (!volume?.id) throw new Error('创建分卷失败：未返回有效 volume.id');

  // 反查
  const volsAfter = await volumeRepository.getByNovelId(novelId);
  if (!volsAfter.some((v) => v.id === volume.id)) {
    throw new Error('分卷创建后无法从存储中读取，请检查 volumeService');
  }

  // 2. 创建章节
  const chapter = await chapterRepository.create({
    novelId, volumeId: volume.id, title: '第1章',
  });
  if (!chapter?.id) throw new Error('创建章节失败：未返回有效 chapter.id');

  // 反查
  const chsAfter = await chapterRepository.getByNovelId(novelId);
  if (!chsAfter.some((c) => c.id === chapter.id)) {
    throw new Error('章节创建后无法从存储中读取，请检查 chapterService');
  }

  // 3. 创建空草稿
  const draft = await draftVersionService.create({
    novelId, chapterId: chapter.id, title: chapter.title,
    content: '', source: 'user_edited',
  });
  if (!draft?.id) throw new Error('创建草稿失败：未返回有效 draft.id');

  // 反查草稿
  const loadedDraft = await draftVersionService.getLatestByChapterId(chapter.id);
  if (!loadedDraft?.id) {
    throw new Error('草稿创建后无法从存储中读取，请检查 draftService');
  }

  return { volume, chapter, draft: loadedDraft };
}

/**
 * 在已有分卷中创建章节 + 空草稿（完整闭环 + 每步反查）
 */
export async function createChapterInVolume(
  novelId: string,
  volumeId: string,
  title: string,
): Promise<{ chapter: Chapter; draft: ChapterDraft }> {
  if (!novelId) throw new Error('novelId 缺失');
  if (!volumeId) throw new Error('volumeId 缺失');
  if (!title?.trim()) throw new Error('章节标题不能为空');

  // 1. 创建章节
  const chapter = await chapterRepository.create({ novelId, volumeId, title: title.trim() });
  if (!chapter?.id) throw new Error('创建章节失败：未返回有效 chapter.id');

  // 反查
  const chsAfter = await chapterRepository.getByNovelId(novelId);
  if (!chsAfter.some((c) => c.id === chapter.id)) {
    throw new Error('章节创建后无法从存储中读取，请检查 chapterService');
  }

  // 2. 创建空草稿
  const draft = await draftVersionService.create({
    novelId, chapterId: chapter.id, title: chapter.title,
    content: '', source: 'user_edited',
  });
  if (!draft?.id) throw new Error('创建草稿失败：未返回有效 draft.id');

  // 反查草稿
  const loadedDraft = await draftVersionService.getLatestByChapterId(chapter.id);
  if (!loadedDraft?.id) {
    throw new Error('草稿创建后无法从存储中读取，请检查 draftService');
  }

  return { chapter, draft: loadedDraft };
}
