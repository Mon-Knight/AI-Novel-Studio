/**
 * AI Novel Studio - TXT 导入服务
 */
import { dbCall } from '../database/db';
import { normalizeNovel } from '../../features/novels/novelNormalizer';
import type { Novel } from '../../types/novel';

export interface ImportedChapterDraft {
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
}

export interface TxtAnalyzeResult {
  totalChars: number;
  totalWords: number;
  detectedChapterCount: number;
  chapters: ImportedChapterDraft[];
  warnings: string[];
}

const CHAPTER_PATTERNS = [
  /(?:^|\n)\s*(第\s*[0-9零一二三四五六七八九十百千]+[章节回卷部集篇])\s*[^\n]*/g,
  /(?:^|\n)\s*(Chapter\s*\d+)/gi,
  /(?:^|\n)\s*(第\s*\d+\s*[章节回])/g,
];

function countWords(text: string): number {
  const cleaned = text.replace(/[\s\n\r]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const other = cleaned
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + other;
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

export function analyzeTxtForChapters(content: string): TxtAnalyzeResult {
  if (!content?.trim())
    return {
      totalChars: 0,
      totalWords: 0,
      detectedChapterCount: 0,
      chapters: [],
      warnings: ['文件内容为空'],
    };

  const totalChars = content.length;
  const totalWords = countWords(content);
  const warnings: string[] = [];

  // 找章节标题位置
  const matches: { index: number; title: string }[] = [];
  for (const pattern of CHAPTER_PATTERNS) {
    let m: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((m = regex.exec(content)) !== null) {
      const title = m[1]?.trim() || m[0]?.trim();
      if (title && !matches.some((x) => x.index === m!.index)) {
        matches.push({ index: m.index, title });
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) {
    warnings.push('未识别到章节标题，建议作为单章导入');
    return {
      totalChars,
      totalWords,
      detectedChapterCount: 0,
      chapters: [
        { title: '第1章：导入正文', content: content.trim(), orderIndex: 1, wordCount: totalWords },
      ],
      warnings,
    };
  }

  // 按标题切分
  const chapters: ImportedChapterDraft[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : content.length;
    const body = content.slice(start, end).trim();
    const titleLineEnd = body.indexOf('\n');
    const title =
      titleLineEnd > 0 ? body.slice(0, titleLineEnd).trim().slice(0, 60) : body.slice(0, 60);
    const bodyContent = titleLineEnd > 0 ? body.slice(titleLineEnd).trim() : body;
    chapters.push({
      title,
      content: bodyContent,
      orderIndex: i + 1,
      wordCount: countWords(bodyContent),
    });
  }

  if (chapters.length > 50) {
    warnings.push(`检测到 ${chapters.length} 个章节，数量较多，请确认切分是否正确`);
  }

  return { totalChars, totalWords, detectedChapterCount: chapters.length, chapters, warnings };
}

export interface ImportTxtNovelInput {
  title: string;
  genre?: string;
  description?: string;
  volumeTitle?: string;
  chapters: Array<Pick<ImportedChapterDraft, 'title' | 'content' | 'orderIndex'>>;
}

export interface ImportedTxtChapter {
  chapterId: string;
  draftId: string;
  title: string;
  orderIndex: number;
  wordCount: number;
  storageMode: 'inline' | 'chunked';
}

export interface ImportTxtNovelResult {
  novel: Novel;
  volumeId: string;
  chapterCount: number;
  totalWordCount: number;
  chapters: ImportedTxtChapter[];
}

export interface ImportTxtNovelProgress {
  stage: string;
  message: string;
  percent: number;
}

/**
 * 浏览器开发模式没有 SQLite 事务：逐步写入，失败时级联删除已创建的作品作为补偿。
 * 桌面端不会走到这里。
 */
export interface BrowserImportSteps {
  createNovel: (input: { title: string; genre?: string; description: string }) => Promise<Novel>;
  createVolume: (input: { novelId: string; title: string; orderIndex: number }) => Promise<{
    id: string;
  }>;
  createChapter: (input: {
    novelId: string;
    volumeId: string;
    title: string;
    orderIndex: number;
  }) => Promise<{ id: string }>;
  createDraft: (input: {
    novelId: string;
    chapterId: string;
    content: string;
  }) => Promise<{ id: string }>;
  deleteNovelCascade: (novelId: string) => Promise<void>;
}

export async function importTxtNovelInBrowser(
  input: ImportTxtNovelInput,
  steps: BrowserImportSteps,
  onProgress?: (progress: ImportTxtNovelProgress) => void,
): Promise<ImportTxtNovelResult> {
  const chapters = [...input.chapters].sort((left, right) => left.orderIndex - right.orderIndex);
  onProgress?.({ stage: '创建作品……', message: '正在创建作品和章节……', percent: 0 });
  const novel = await steps.createNovel({
    title: input.title.trim(),
    genre: input.genre?.trim() || undefined,
    description: input.description?.trim() || '由 TXT 导入',
  });
  try {
    const volume = await steps.createVolume({
      novelId: novel.id,
      title: input.volumeTitle?.trim() || '第一卷',
      orderIndex: 1,
    });
    const imported: ImportedTxtChapter[] = [];
    let totalWordCount = 0;
    for (const [index, chapter] of chapters.entries()) {
      onProgress?.({
        stage: `正在写入：${chapter.title}`,
        message: `正在导入章节 ${index + 1} / ${chapters.length}……`,
        percent: Math.round(((index + 1) / chapters.length) * 90),
      });
      const created = await steps.createChapter({
        novelId: novel.id,
        volumeId: volume.id,
        title: chapter.title,
        orderIndex: chapter.orderIndex,
      });
      const draft = await steps.createDraft({
        novelId: novel.id,
        chapterId: created.id,
        content: chapter.content,
      });
      const wordCount = countWords(chapter.content);
      totalWordCount += wordCount;
      imported.push({
        chapterId: created.id,
        draftId: draft.id,
        title: chapter.title,
        orderIndex: chapter.orderIndex,
        wordCount,
        storageMode: 'inline',
      });
    }
    return {
      novel,
      volumeId: volume.id,
      chapterCount: imported.length,
      totalWordCount,
      chapters: imported,
    };
  } catch (error) {
    // Compensation: a half-imported novel must not survive a failed browser import.
    await steps.deleteNovelCascade(novel.id).catch(() => undefined);
    throw error;
  }
}

/**
 * 桌面端：作品、卷、章节与导入草稿在 Rust 单一 SQLite 事务内落库（`import_txt_novel`），
 * 任一步失败零部分写入；浏览器模式回退到带补偿的逐步写入。
 */
export function importTxtNovel(
  input: ImportTxtNovelInput,
  browserSteps: BrowserImportSteps,
  onProgress?: (progress: ImportTxtNovelProgress) => void,
): Promise<ImportTxtNovelResult> {
  const payload: ImportTxtNovelInput = {
    ...input,
    chapters: input.chapters.map((chapter) => ({
      title: chapter.title,
      content: chapter.content,
      orderIndex: chapter.orderIndex,
    })),
  };
  onProgress?.({ stage: '正在原子写入作品与章节……', message: '正在导入……', percent: 10 });
  return dbCall<ImportTxtNovelResult>('import_txt_novel', { input: payload }, () =>
    importTxtNovelInBrowser(payload, browserSteps, onProgress),
  ).then((result) => {
    const novel = normalizeNovel(result.novel);
    if (!novel) throw new Error('导入结果中的作品数据无效');
    return { ...result, novel };
  });
}
