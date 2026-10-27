import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type { Volume } from '../../types/volume';
import { countTextWords } from '../../utils/contentHash';
import { formatChapterHeading } from '../../utils/chapterHeading';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { draftVersionService } from '../database/draftVersionService';

export interface ManuscriptExportProgress {
  stage: 'reading' | 'saving' | 'complete';
  chapterCount: number;
  totalChapters: number;
  wordCount: number;
}

export interface ManuscriptExportOptions {
  onProgress?: (progress: ManuscriptExportProgress) => void;
}

export interface ExportChapter {
  chapter: Chapter;
  draft: ChapterDraft;
  wordCount: number;
}

export function hasFormalChapter(chapter: Chapter): boolean {
  return (
    !chapter.deletedAt &&
    (Boolean(chapter.adoptedDraftId) || ['adopted', 'summarized'].includes(chapter.status))
  );
}

export async function readExportChapter(chapter: Chapter): Promise<ExportChapter> {
  const label = formatChapterHeading(chapter);
  if (!chapter.adoptedDraftId) throw new Error(`${label}：采用稿指针缺失，请重新加载章节。`);
  const draft = await draftVersionService.getAdoptedByChapterId(chapter.id);
  if (
    !draft ||
    draft.id !== chapter.adoptedDraftId ||
    draft.novelId !== chapter.novelId ||
    draft.chapterId !== chapter.id ||
    !draft.isAdopted
  ) {
    throw new Error(`${label}：采用稿已变化或归属不匹配，请重新加载后导出。`);
  }
  if (
    draft.contentState?.status !== 'ready' ||
    draft.contentState.content !== draft.content ||
    !draft.content.trim()
  ) {
    throw new Error(`${label}：完整正文读取失败，请先在章节中重试读取。`);
  }
  return { chapter, draft, wordCount: countTextWords(draft.content) };
}

function chapterBaseline(chapters: readonly Chapter[]): string {
  return JSON.stringify(
    chapters
      .filter(hasFormalChapter)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((chapter) => [
        chapter.id,
        chapter.novelId,
        chapter.adoptedDraftId,
        chapter.orderIndex,
        chapter.sortOrder,
        chapter.createdAt,
        chapter.volumeId,
        chapter.chapterNumber,
        chapter.title,
      ]),
  );
}

function volumeBaseline(volumes: readonly Volume[]): string {
  return JSON.stringify(
    volumes
      .filter((volume) => !volume.deletedAt)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((volume) => [
        volume.id,
        volume.novelId,
        volume.title,
        volume.orderIndex,
        volume.sortOrder,
      ]),
  );
}

function orderChapters(chapters: readonly Chapter[], volumes: readonly Volume[]): Chapter[] {
  const volumeOrder = new Map(volumes.map((volume, index) => [volume.id, index + 1]));
  return [...chapters].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId ?? '') ?? 0) - (volumeOrder.get(right.volumeId ?? '') ?? 0) ||
      left.orderIndex - right.orderIndex ||
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** Read every formal chapter before opening a save dialog; partial books never leave here. */
export async function readExportManuscript(novelId: string, options: ManuscriptExportOptions = {}) {
  const [allChapters, allVolumes] = await Promise.all([
    chapterRepository.getByNovelId(novelId),
    volumeRepository.getByNovelId(novelId),
  ]);
  const volumes = allVolumes
    .filter((volume) => !volume.deletedAt)
    .sort(
      (left, right) =>
        left.orderIndex - right.orderIndex ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
    );
  if (volumes.some((volume) => volume.novelId !== novelId)) {
    throw new Error('分卷归属不匹配，请重新加载后导出。');
  }
  const chapters = orderChapters(allChapters.filter(hasFormalChapter), volumes);
  if (!chapters.length) throw new Error('该作品没有已采用的章节，无法导出');
  const baseline = chapterBaseline(chapters);
  const volumesBaseline = volumeBaseline(volumes);
  const result: ExportChapter[] = [];
  const errors: string[] = [];
  const progress: ManuscriptExportProgress = {
    stage: 'reading',
    chapterCount: 0,
    totalChapters: chapters.length,
    wordCount: 0,
  };
  options.onProgress?.({ ...progress });
  for (const chapter of chapters) {
    try {
      if (chapter.novelId !== novelId)
        throw new Error(`${formatChapterHeading(chapter)}：作品归属不匹配。`);
      const item = await readExportChapter(chapter);
      result.push(item);
      progress.wordCount += item.wordCount;
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `${formatChapterHeading(chapter)}：正文读取失败。`,
      );
    }
    progress.chapterCount++;
    options.onProgress?.({ ...progress });
  }
  if (errors.length)
    throw new Error(`导出已停止，以下章节未通过完整性检查：\n${errors.join('\n')}`);
  // A previously adopted draft can be edited after another draft is adopted, then adopted again.
  // A matching chapter pointer alone cannot detect this same-id content change.
  for (const item of result) {
    const current = await readExportChapter(item.chapter);
    if (current.draft.content !== item.draft.content) {
      throw new Error(
        `${formatChapterHeading(item.chapter)}：读取期间采用稿正文已变化，请重新导出。`,
      );
    }
  }
  const [latestChapters, latestVolumes] = await Promise.all([
    chapterRepository.getByNovelId(novelId),
    volumeRepository.getByNovelId(novelId),
  ]);
  if (
    chapterBaseline(latestChapters) !== baseline ||
    volumeBaseline(latestVolumes) !== volumesBaseline
  ) {
    throw new Error('读取期间分卷、章节或采用稿已变化，未导出文件。请重新导出以读取一致的正文。');
  }
  return { chapters: result, volumes, wordCount: progress.wordCount, chapterCount: result.length };
}

export function formatExportProgress(progress: ManuscriptExportProgress): string {
  if (progress.stage === 'reading')
    return `正在校验完整正文：${progress.chapterCount}/${progress.totalChapters} 章`;
  const receipt = `${progress.totalChapters} 章 · ${progress.wordCount.toLocaleString('zh-CN')} 字`;
  return progress.stage === 'saving' ? `已校验 ${receipt}，请选择保存位置` : `已导出 ${receipt}`;
}
