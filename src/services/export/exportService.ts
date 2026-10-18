/**
 * AI Novel Studio - 导出服务（TXT / Markdown / JSON 备份）
 * v1.7.8: 支持 Tauri 原生保存对话框 + 浏览器降级方案
 */
import { novelRepository } from '../database/novelRepository';
import { chapterRepository } from '../database/chapterRepository';
import { createCompleteProjectBackup } from '../backup/projectBackupService';
import { formatDateTime } from '../../utils/date';
import { formatNumber } from '../../utils/format';
import { formatChapterHeading } from '../../utils/chapterHeading';
import {
  readExportChapter,
  readExportManuscript,
  type ManuscriptExportOptions,
} from './manuscriptExport';

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名';
}

function buildTxt(novelTitle: string, content: string): string {
  return `${novelTitle}\n\n${content}`;
}

async function isTauriEnv(): Promise<boolean> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    await getVersion();
    return true;
  } catch {
    return false;
  }
}

async function saveFile(text: string, filename: string, mime: string): Promise<string> {
  if (await isTauriEnv()) {
    const { writeTextFromSaveDialog } = await import('../tauri/scopedDesktopFs');
    const ext = filename.endsWith('.md') ? 'md' : filename.endsWith('.json') ? 'json' : 'txt';
    const label = ext === 'md' ? 'Markdown' : ext === 'json' ? 'JSON' : '文本文件';
    const filePath = await writeTextFromSaveDialog(
      {
        title: '导出文件',
        defaultPath: filename,
        filters: [{ name: label, extensions: [ext] }],
      },
      text,
    );
    if (!filePath) throw new Error('用户取消了导出');
    return filePath;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}

export async function exportChapterToTxt(chapterId: string): Promise<string> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const { draft, wordCount } = await readExportChapter(chapter);
  const header = formatChapterHeading(chapter);
  const text = buildTxt(
    novel?.title || '',
    `${header}\n\n${draft.content}\n\n字数：${formatNumber(wordCount)} 字\n导出时间：${formatDateTime(new Date())}`,
  );
  const filename = `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.txt`;
  return await saveFile(text, filename, 'text/plain');
}

export async function exportChapterToMarkdown(chapterId: string): Promise<string> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const { draft, wordCount } = await readExportChapter(chapter);
  const md = `# ${novel?.title || ''}\n\n## ${formatChapterHeading(chapter)}\n\n${draft.content}\n\n---\n\n*字数：${formatNumber(wordCount)} 字 · 导出时间：${formatDateTime(new Date())}*`;
  const filename = `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.md`;
  return await saveFile(md, filename, 'text/markdown');
}

export async function exportNovelToTxt(
  novelId: string,
  options: ManuscriptExportOptions = {},
): Promise<string> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const manuscript = await readExportManuscript(novelId, options);
  let text = `${novel.title}\n${novel.description || ''}\n\n`;
  let previousVolume: string | undefined;
  for (const { chapter: ch, draft } of manuscript.chapters) {
    const volume = manuscript.volumes.find((item) => item.id === ch.volumeId);
    const volumeKey = volume?.id ?? '';
    text += `${'-'.repeat(40)}\n`;
    if (volumeKey !== previousVolume && manuscript.volumes.length) {
      text += `${volume?.title ?? '未分卷章节'}\n`;
    }
    previousVolume = volumeKey;
    text += `${formatChapterHeading(ch)}\n${'-'.repeat(40)}\n\n${draft.content}\n\n`;
  }
  text += `\n已导出：${manuscript.chapterCount} 章\n总字数：${formatNumber(manuscript.wordCount)} 字\n导出时间：${formatDateTime(new Date())}`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(novel.title)}_全文_${dateStr}.txt`;
  return saveManuscript(text, filename, 'text/plain', manuscript, options);
}

export async function exportNovelToMarkdown(
  novelId: string,
  options: ManuscriptExportOptions = {},
): Promise<string> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const manuscript = await readExportManuscript(novelId, options);

  let md = `# ${novel.title}\n\n${novel.description || ''}\n\n`;
  let previousVolume: string | undefined;
  for (const { chapter: ch, draft } of manuscript.chapters) {
    const volume = manuscript.volumes.find((item) => item.id === ch.volumeId);
    const volumeKey = volume?.id ?? '';
    if (volumeKey !== previousVolume && manuscript.volumes.length) {
      md += `## ${volume?.title ?? '未分卷章节'}\n\n`;
    }
    previousVolume = volumeKey;
    md += `### ${formatChapterHeading(ch)}\n\n${draft.content}\n\n---\n\n`;
  }
  md += `\n*已导出：${manuscript.chapterCount} 章 · 总字数：${formatNumber(manuscript.wordCount)} 字 · 导出时间：${formatDateTime(new Date())}*`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(novel.title)}_全文_${dateStr}.md`;
  return saveManuscript(md, filename, 'text/markdown', manuscript, options);
}

async function saveManuscript(
  text: string,
  filename: string,
  mime: string,
  receipt: { chapterCount: number; wordCount: number },
  options: ManuscriptExportOptions,
): Promise<string> {
  const counts = {
    chapterCount: receipt.chapterCount,
    wordCount: receipt.wordCount,
    totalChapters: receipt.chapterCount,
  };
  options.onProgress?.({ ...counts, stage: 'saving' });
  const path = await saveFile(text, filename, mime);
  options.onProgress?.({ ...counts, stage: 'complete' });
  return path;
}

export async function exportNovelBackupJson(novelId: string): Promise<string> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');

  const backup = await createCompleteProjectBackup(novelId);

  return await saveFile(
    JSON.stringify(backup, null, 2),
    `${sanitizeFilename(novel.title)}_备份_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  );
}

export const exportService = {
  exportChapterToTxt,
  exportChapterToMarkdown,
  exportNovelToTxt,
  exportNovelToMarkdown,
  exportNovelBackupJson,
};
