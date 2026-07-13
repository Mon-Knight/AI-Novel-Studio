/**
 * AI Novel Studio - 导出服务（TXT / Markdown / JSON 备份）
 * v1.7.8: 支持 Tauri 原生保存对话框 + 浏览器降级方案
 */
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { characterService } from '../characters/characterService';
import { styleProfileService } from '../styles/styleProfileService';
import { outputProfileService } from '../styles/outputProfileService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { contextRecordService } from '../context/contextRecordService';
import { formatDateTime } from '../../utils/date';
import { formatNumber } from '../../utils/format';

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
  } catch { return false; }
}

async function saveFile(text: string, filename: string, mime: string): Promise<string | null> {
  if (await isTauriEnv()) {
    const { save } = await import('@tauri-apps/api/dialog');
    const { writeTextFile } = await import('@tauri-apps/api/fs');
    const ext = filename.endsWith('.md') ? 'md' : filename.endsWith('.json') ? 'json' : 'txt';
    const label = ext === 'md' ? 'Markdown' : ext === 'json' ? 'JSON' : '文本文件';
    const filePath = await save({ title: '导出文件', defaultPath: filename, filters: [{ name: label, extensions: [ext] }] });
    if (!filePath) return null;
    await writeTextFile(filePath, text);
    return filePath;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  return filename;
}

async function getAdoptedContent(chapterId: string): Promise<string | null> {
  const draft = await draftVersionService.getAdoptedByChapterId(chapterId);
  if (draft?.contentState?.status === 'unavailable') {
    throw new Error('已采用正文暂时无法完整读取，已停止导出以避免生成残缺文件');
  }
  return draft?.content || null;
}

export async function exportChapterToTxt(chapterId: string): Promise<string | null> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const content = await getAdoptedContent(chapterId);
  if (!content) throw new Error('该章节没有已采用的正文，无法导出');
  const header = `第${chapter.chapterNumber}章 ${chapter.title}`;
  const text = buildTxt(novel?.title || '', `${header}\n\n${content}\n\n字数：${formatNumber(chapter.wordCount)} 字\n导出时间：${formatDateTime(new Date())}`);
  const filename = `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.txt`;
  return await saveFile(text, filename, 'text/plain');
}

export async function exportChapterToMarkdown(chapterId: string): Promise<string | null> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const content = await getAdoptedContent(chapterId);
  if (!content) throw new Error('该章节没有已采用的正文，无法导出');
  const md = `# ${novel?.title || ''}\n\n## 第${chapter.chapterNumber}章 ${chapter.title}\n\n${content}\n\n---\n\n*字数：${formatNumber(chapter.wordCount)} 字 · 导出时间：${formatDateTime(new Date())}*`;
  const filename = `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.md`;
  return await saveFile(md, filename, 'text/markdown');
}

export async function exportNovelToTxt(novelId: string): Promise<string | null> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const chapters = await chapterRepository.getByNovelId(novelId);
  const adoptedChapters = (await Promise.all(chapters.map(async (chapter) => ({
    chapter,
    content: await getAdoptedContent(chapter.id),
  })))).filter((entry): entry is { chapter: typeof chapters[number]; content: string } => !!entry.content);
  if (adoptedChapters.length === 0) throw new Error('该作品没有已采用的章节，无法导出');

  let text = `${novel.title}\n${novel.description || ''}\n\n`;
  for (const { chapter: ch, content } of adoptedChapters.sort((a, b) => a.chapter.orderIndex - b.chapter.orderIndex)) {
    const volume = ch.volumeId ? await volumeRepository.getById(ch.volumeId) : null;
    text += `${'-'.repeat(40)}\n`;
    if (volume) text += `${volume.title}\n`;
    text += `第${ch.chapterNumber}章 ${ch.title}\n${'-'.repeat(40)}\n\n${content}\n\n`;
  }
  text += `\n总字数：${formatNumber(adoptedChapters.reduce((sum, entry) => sum + Array.from(entry.content).length, 0))} 字\n导出时间：${formatDateTime(new Date())}`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(novel.title)}_全文_${dateStr}.txt`;
  return await saveFile(text, filename, 'text/plain');
}

export async function exportNovelToMarkdown(novelId: string): Promise<string | null> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const chapters = await chapterRepository.getByNovelId(novelId);
  const adoptedChapters = (await Promise.all(chapters.map(async (chapter) => ({
    chapter,
    content: await getAdoptedContent(chapter.id),
  })))).filter((entry): entry is { chapter: typeof chapters[number]; content: string } => !!entry.content);
  if (adoptedChapters.length === 0) throw new Error('该作品没有已采用的章节，无法导出');

  let md = `# ${novel.title}\n\n${novel.description || ''}\n\n`;
  const volumes = await volumeRepository.getByNovelId(novelId);
  for (const vol of volumes.sort((a, b) => a.orderIndex - b.orderIndex)) {
    md += `## ${vol.title}\n\n`;
    const volChapters = adoptedChapters.filter((entry) => entry.chapter.volumeId === vol.id)
      .sort((a, b) => a.chapter.orderIndex - b.chapter.orderIndex);
    for (const { chapter: ch, content } of volChapters) {
      md += `### 第${ch.chapterNumber}章 ${ch.title}\n\n${content}\n\n---\n\n`;
    }
  }
  const orphanChapters = adoptedChapters.filter((entry) => !entry.chapter.volumeId)
    .sort((a, b) => a.chapter.orderIndex - b.chapter.orderIndex);
  for (const { chapter: ch, content } of orphanChapters) {
    md += `### 第${ch.chapterNumber}章 ${ch.title}\n\n${content}\n\n---\n\n`;
  }
  md += `\n*总字数：${formatNumber(adoptedChapters.reduce((sum, entry) => sum + Array.from(entry.content).length, 0))} 字 · 导出时间：${formatDateTime(new Date())}*`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(novel.title)}_全文_${dateStr}.md`;
  return await saveFile(md, filename, 'text/markdown');
}

export async function buildNovelBackup(novelId: string): Promise<Record<string, unknown>> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');

  const [
    volumes, chapters, worldSettings, ruleSystems, protagonist,
    characters, styles, outputs, summaries, contexts,
  ] = await Promise.all([
    volumeRepository.getByNovelId(novelId),
    chapterRepository.getByNovelId(novelId),
    settingRepository.getWorldSettings(novelId),
    settingRepository.getRuleSystems(novelId),
    protagonistRepository.getByNovelId(novelId),
    characterService.getByNovelId(novelId),
    styleProfileService.getAll(novelId),
    outputProfileService.getAll?.(novelId) ?? Promise.resolve([]),
    chapterSummaryService.getByNovelId(novelId),
    contextRecordService.getByNovelId(novelId),
  ]);

  const chapterBackups = await Promise.all(chapters.map(async (chapter) => {
    const draft = await draftVersionService.getAdoptedByChapterId(chapter.id);
    if (draft?.contentState?.status === 'unavailable') {
      throw new Error(`章节「${chapter.title}」的已采用正文暂时无法完整读取，已停止备份`);
    }
    return {
      ...chapter,
      adoptedDraft: draft ? {
        content: draft.content,
        source: draft.source,
        versionNo: draft.versionNo,
        wordCount: draft.wordCount,
      } : null,
    };
  }));

  const backup = {
    type: 'ai_novel_studio_project',
    schemaVersion: 2,
    version: '2.0',
    exportedAt: new Date().toISOString(),
    novel: {
      ...novel,
      outline: novel.outline ?? '',
      protagonistMode: novel.protagonistMode ?? 'single',
      protagonists: novel.protagonists ?? [],
      dualProtagonistRelation: novel.dualProtagonistRelation ?? {},
    },
    volumes,
    chapters: chapterBackups,
    worldSettings: worldSettings || [],
    ruleSystems: ruleSystems || [],
    protagonist: protagonist || null,
    characters: characters || [],
    chapterCharacters: [],
    chapterEvents: [],
    styleProfiles: (styles || []).filter((profile) => profile.novelId === novelId),
    outputProfiles: (outputs || []).filter((profile) => profile.novelId === novelId),
    chapterSummaries: summaries || [],
    contextRecords: contexts || [],
  };

  return backup;
}

export async function exportNovelBackupJson(novelId: string): Promise<string | null> {
  const backup = await buildNovelBackup(novelId);
  const novel = backup.novel as { title?: string };
  return await saveFile(
    JSON.stringify(backup, null, 2),
    `${sanitizeFilename(novel.title || '作品')}_备份_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  );
}

export const exportService = {
  exportChapterToTxt, exportChapterToMarkdown,
  exportNovelToTxt, exportNovelToMarkdown,
  exportNovelBackupJson, buildNovelBackup,
};
