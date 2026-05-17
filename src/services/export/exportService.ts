/**
 * AI Novel Studio - 导出服务（TXT / Markdown / JSON 备份）
 */
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { characterService } from '../characters/characterService';
import { chapterCharacterService } from '../characters/chapterCharacterService';
import { chapterEventService } from '../characters/chapterEventService';
import { styleProfileService } from '../styles/styleProfileService';
import { outputProfileService } from '../styles/outputProfileService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { contextRecordService } from '../context/contextRecordService';

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名';
}

function buildTxt(novelTitle: string, content: string): string {
  return `${novelTitle}\n\n${content}`;
}

function buildMarkdown(novelTitle: string, content: string): string {
  return `# ${novelTitle}\n\n${content}`;
}

function downloadBlob(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function getAdoptedContent(chapterId: string): Promise<string | null> {
  const draft = await draftVersionService.getLatestByChapterId(chapterId);
  if (!draft || !draft.isAdopted) return null;
  return draft.content;
}

export async function exportChapterToTxt(chapterId: string): Promise<void> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const content = await getAdoptedContent(chapterId);
  if (!content) throw new Error('该章节没有已采用的正文，无法导出');
  const volume = chapter.volumeId ? await volumeRepository.getById(chapter.volumeId) : null;
  const header = volume ? `第${chapter.chapterNumber}章 ${chapter.title}` : `第${chapter.chapterNumber}章 ${chapter.title}`;
  const text = buildTxt(novel?.title || '', `${header}\n\n${content}\n\n字数：${chapter.wordCount} 字\n导出时间：${new Date().toLocaleString('zh-CN')}`);
  downloadBlob(text, `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.txt`, 'text/plain;charset=utf-8');
}

export async function exportChapterToMarkdown(chapterId: string): Promise<void> {
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const novel = await novelRepository.getById(chapter.novelId);
  const content = await getAdoptedContent(chapterId);
  if (!content) throw new Error('该章节没有已采用的正文，无法导出');
  const md = `# ${novel?.title || ''}\n\n## 第${chapter.chapterNumber}章 ${chapter.title}\n\n${content}\n\n---\n\n*字数：${chapter.wordCount} 字 · 导出时间：${new Date().toLocaleString('zh-CN')}*`;
  downloadBlob(md, `${sanitizeFilename(novel?.title || '作品')}_第${chapter.chapterNumber}章_${sanitizeFilename(chapter.title)}.md`, 'text/markdown;charset=utf-8');
}

export async function exportNovelToTxt(novelId: string): Promise<void> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const chapters = await chapterRepository.getByNovelId(novelId);
  const adoptedChapters = chapters.filter((c) => c.status === 'adopted' || c.status === 'summarized');
  if (adoptedChapters.length === 0) throw new Error('该作品没有已采用的章节，无法导出');

  let text = `${novel.title}\n${novel.description || ''}\n\n`;
  for (const ch of adoptedChapters.sort((a, b) => a.orderIndex - b.orderIndex)) {
    const content = await getAdoptedContent(ch.id);
    if (!content) continue;
    const volume = ch.volumeId ? await volumeRepository.getById(ch.volumeId) : null;
    text += `${'-'.repeat(40)}\n`;
    if (volume) text += `${volume.title}\n`;
    text += `第${ch.chapterNumber}章 ${ch.title}\n${'-'.repeat(40)}\n\n${content}\n\n`;
  }
  text += `\n总字数：${adoptedChapters.reduce((s, c) => s + c.wordCount, 0)} 字\n导出时间：${new Date().toLocaleString('zh-CN')}`;
  downloadBlob(text, `${sanitizeFilename(novel.title)}_全文.txt`, 'text/plain;charset=utf-8');
}

export async function exportNovelToMarkdown(novelId: string): Promise<void> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('作品不存在');
  const chapters = await chapterRepository.getByNovelId(novelId);
  const adoptedChapters = chapters.filter((c) => c.status === 'adopted' || c.status === 'summarized');
  if (adoptedChapters.length === 0) throw new Error('该作品没有已采用的章节，无法导出');

  let md = `# ${novel.title}\n\n${novel.description || ''}\n\n`;
  const volumes = await volumeRepository.getByNovelId(novelId);
  for (const vol of volumes.sort((a, b) => a.orderIndex - b.orderIndex)) {
    md += `## ${vol.title}\n\n`;
    const volChapters = adoptedChapters.filter((c) => c.volumeId === vol.id).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const ch of volChapters) {
      const content = await getAdoptedContent(ch.id);
      if (!content) continue;
      md += `### 第${ch.chapterNumber}章 ${ch.title}\n\n${content}\n\n---\n\n`;
    }
  }
  const orphanChapters = adoptedChapters.filter((c) => !c.volumeId).sort((a, b) => a.orderIndex - b.orderIndex);
  orphanChapters.forEach((ch) => { md += `### 第${ch.chapterNumber}章 ${ch.title}\n\n（未关联分卷）\n\n---\n\n`; });
  md += `\n*总字数：${adoptedChapters.reduce((s, c) => s + c.wordCount, 0)} 字 · 导出时间：${new Date().toLocaleString('zh-CN')}*`;
  downloadBlob(md, `${sanitizeFilename(novel.title)}_全文.md`, 'text/markdown;charset=utf-8');
}

export async function exportNovelBackupJson(novelId: string): Promise<void> {
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

  const chapterChars: any[] = [];
  const chapterEvents: any[] = [];

  const backup = {
    type: 'ai_novel_studio_project',
    version: '1.0.7',
    exportedAt: new Date().toISOString(),
    novel: { ...novel },
    volumes,
    chapters,
    worldSettings: worldSettings || [],
    ruleSystems: ruleSystems || [],
    protagonist: protagonist || null,
    characters: characters || [],
    chapterCharacters: chapterChars,
    chapterEvents: chapterEvents,
    styleProfiles: styles || [],
    outputProfiles: outputs || [],
    chapterSummaries: summaries || [],
    contextRecords: contexts || [],
  };

  downloadBlob(
    JSON.stringify(backup, null, 2),
    `${sanitizeFilename(novel.title)}_备份_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json;charset=utf-8',
  );
}

export const exportService = {
  exportChapterToTxt, exportChapterToMarkdown,
  exportNovelToTxt, exportNovelToMarkdown,
  exportNovelBackupJson,
};
