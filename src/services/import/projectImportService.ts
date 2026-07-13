import { normalizeNovel } from '../../features/novels/novelNormalizer';
import type { ChapterStatus } from '../../types/chapter';
import type { OutputProfile } from '../../types/output';
import type { VolumeStatus } from '../../types/volume';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { volumeRepository } from '../database/volumeRepository';
import { novelService } from '../novels/novelService';
import { outputProfileService } from '../styles/outputProfileService';
import { styleProfileService } from '../styles/styleProfileService';
import { rollbackFailedProjectImport } from './importRollbackService';
import type { TxtAnalyzeResult } from './txtImportService';

type JsonRecord = Record<string, unknown>;

export interface ProjectImportProgress {
  stage: string;
  current: number;
  total: number;
}

export interface ProjectImportResult {
  novelId: string;
  novelTitle: string;
  volumeCount: number;
  chapterCount: number;
  adoptedChapterCount: number;
  missingContentCount: number;
  styleProfileCount: number;
  outputProfileCount: number;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => !!item) : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function chapterContent(chapter: JsonRecord): string | null {
  const direct = text(chapter.adoptedContent ?? chapter.adopted_content ?? chapter.content).trim();
  if (direct) return direct;
  const adoptedDraft = record(chapter.adoptedDraft ?? chapter.adopted_draft);
  const adopted = text(adoptedDraft?.content).trim();
  if (adopted) return adopted;
  const drafts = records(chapter.drafts);
  const legacy = drafts.find((draft) => draft.isAdopted === true || draft.is_adopted === true || draft.is_adopted === 1);
  const legacyContent = text(legacy?.content).trim();
  return legacyContent || null;
}

function volumeStatus(value: unknown): VolumeStatus | undefined {
  return ['planned', 'writing', 'completed'].includes(String(value)) ? value as VolumeStatus : undefined;
}

function chapterStatus(value: unknown): ChapterStatus | undefined {
  return ['not_started', 'outline_ready', 'draft_generated', 'editing', 'polished', 'adopted', 'summarized']
    .includes(String(value)) ? value as ChapterStatus : undefined;
}

async function rollbackNovel(novelId: string): Promise<void> {
  await rollbackFailedProjectImport(novelId);
}

export async function importTxtNovel(input: {
  title: string;
  genre?: string;
  description?: string;
  analysis: TxtAnalyzeResult;
  onProgress?: (progress: ProjectImportProgress) => void;
}): Promise<ProjectImportResult> {
  const novel = await novelService.createNovel({
    title: input.title.trim(),
    genre: input.genre?.trim() || undefined,
    description: input.description?.trim() || '由 TXT 导入',
  });
  try {
    const volume = await volumeRepository.create({ novelId: novel.id, title: '第一卷', orderIndex: 0 });
    let adoptedChapterCount = 0;
    for (const [index, source] of input.analysis.chapters.entries()) {
      input.onProgress?.({ stage: source.title, current: index + 1, total: input.analysis.chapters.length });
      const chapter = await chapterRepository.create({
        novelId: novel.id,
        volumeId: volume.id,
        title: source.title,
        orderIndex: index,
        outline: '',
      });
      const draft = await draftVersionService.create({
        novelId: novel.id,
        chapterId: chapter.id,
        content: source.content,
        source: 'imported',
        note: 'TXT 作品导入',
      });
      await draftVersionService.adopt(draft.id, chapter.id);
      await chapterRepository.update(chapter.id, { status: 'adopted' });
      adoptedChapterCount += 1;
    }
    return {
      novelId: novel.id,
      novelTitle: novel.title,
      volumeCount: 1,
      chapterCount: input.analysis.chapters.length,
      adoptedChapterCount,
      missingContentCount: 0,
      styleProfileCount: 0,
      outputProfileCount: 0,
    };
  } catch (error) {
    try {
      await rollbackNovel(novel.id);
    } catch (rollbackError) {
      throw Object.assign(new Error('导入失败，且未能完整回滚新建作品'), {
        importError: error,
        rollbackError,
      });
    }
    throw error;
  }
}

export async function importProjectBackup(
  data: unknown,
  onProgress?: (progress: ProjectImportProgress) => void,
): Promise<ProjectImportResult> {
  const backup = record(data);
  const rawNovel = record(backup?.novel);
  if (!backup || !rawNovel || !text(rawNovel.title).trim()) throw new Error('作品 JSON 缺少必要的 novel.title 字段');
  const normalized = normalizeNovel(rawNovel);
  if (!normalized) throw new Error('作品信息格式无效');

  const sourceVolumes = records(backup.volumes).sort((a, b) => (number(a.orderIndex ?? a.order_index) ?? 0) - (number(b.orderIndex ?? b.order_index) ?? 0));
  const sourceChapters = records(backup.chapters).sort((a, b) => (number(a.orderIndex ?? a.order_index) ?? 0) - (number(b.orderIndex ?? b.order_index) ?? 0));
  const styles = records(backup.styleProfiles ?? backup.style_profiles);
  const outputs = records(backup.outputProfiles ?? backup.output_profiles);
  const total = sourceVolumes.length + sourceChapters.length + styles.length + outputs.length;
  let progress = 0;

  const novel = await novelService.createNovel({
    title: normalized.title,
    subtitle: normalized.subtitle,
    description: normalized.description,
    outline: normalized.outline,
    genre: normalized.genre,
    targetWordCount: normalized.targetWordCount,
  });
  try {
    await novelService.updateNovel(novel.id, {
      title: normalized.title,
      subtitle: normalized.subtitle,
      description: normalized.description,
      outline: normalized.outline,
      genre: normalized.genre,
      status: normalized.status,
      targetWordCount: normalized.targetWordCount,
      protagonistMode: normalized.protagonistMode,
      protagonists: normalized.protagonists,
      dualProtagonistRelation: normalized.dualProtagonistRelation,
      mainCharacter: normalized.mainCharacter,
      protagonistAbility: normalized.protagonistAbility,
    });

    const volumeIds = new Map<string, string>();
    for (const [index, source] of sourceVolumes.entries()) {
      const created = await volumeRepository.create({
        novelId: novel.id,
        title: text(source.title).trim() || `第${index + 1}卷`,
        summary: text(source.summary ?? source.description),
        goal: text(source.goal),
        mainConflict: text(source.mainConflict ?? source.main_conflict),
        orderIndex: number(source.orderIndex ?? source.order_index) ?? index,
      });
      const oldId = text(source.id);
      if (oldId) volumeIds.set(oldId, created.id);
      const status = volumeStatus(source.status);
      if (status) await volumeRepository.update(created.id, { status });
      onProgress?.({ stage: `导入分卷：${created.title}`, current: ++progress, total });
    }

    let adoptedChapterCount = 0;
    let missingContentCount = 0;
    for (const [index, source] of sourceChapters.entries()) {
      const oldVolumeId = text(source.volumeId ?? source.volume_id);
      const created = await chapterRepository.create({
        novelId: novel.id,
        volumeId: volumeIds.get(oldVolumeId),
        title: text(source.title).trim() || `第${index + 1}章`,
        outline: text(source.outline),
        goal: text(source.goal),
        targetWordCount: number(source.targetWordCount ?? source.target_word_count),
        orderIndex: number(source.orderIndex ?? source.order_index) ?? index,
      });
      const content = chapterContent(source);
      if (content) {
        const draft = await draftVersionService.create({
          novelId: novel.id,
          chapterId: created.id,
          content,
          source: 'imported',
          note: 'JSON 项目备份恢复',
        });
        await draftVersionService.adopt(draft.id, created.id);
        await chapterRepository.update(created.id, {
          status: source.status === 'summarized' ? 'summarized' : 'adopted',
        });
        adoptedChapterCount += 1;
      } else {
        missingContentCount += 1;
        const status = chapterStatus(source.status);
        if (status && !['adopted', 'summarized'].includes(status)) {
          await chapterRepository.update(created.id, { status });
        }
      }
      onProgress?.({ stage: `导入章节：${created.title}`, current: ++progress, total });
    }

    for (const source of styles) {
      await styleProfileService.create({
        novelId: novel.id,
        name: text(source.name).trim() || '导入风格',
        sourceType: 'json_import',
        narrativePerspective: text(source.narrativePerspective) || undefined,
        tone: text(source.tone) || undefined,
        pace: text(source.pace) || undefined,
        sentenceStyle: text(source.sentenceStyle) || undefined,
        dialogueRatio: number(source.dialogueRatio),
        descriptionRatio: number(source.descriptionRatio),
        psychologicalRatio: number(source.psychologicalRatio),
        battleStyle: text(source.battleStyle) || undefined,
        battleIntensity: text(source.battleIntensity) || undefined,
        emotionTendency: text(source.emotionTendency) || undefined,
        chapterEnding: text(source.chapterEnding) || undefined,
        forbiddenStyles: Array.isArray(source.forbiddenStyles ?? source.prohibitedStyles)
          ? (source.forbiddenStyles ?? source.prohibitedStyles) as string[] : [],
        styleSummary: text(source.styleSummary),
      });
      onProgress?.({ stage: '导入风格方案', current: ++progress, total });
    }

    for (const source of outputs) {
      const range = record(source.chapterWordRange);
      await outputProfileService.create({
        novelId: novel.id,
        name: text(source.name).trim() || '导入输出方案',
        targetWordCount: number(source.targetWordCount) ?? number(range?.default),
        minWordCount: number(source.minWordCount) ?? number(range?.min),
        maxWordCount: number(source.maxWordCount) ?? number(range?.max),
        paceLevel: ['slow', 'medium', 'fast'].includes(String(source.paceLevel)) ? source.paceLevel as OutputProfile['paceLevel'] : undefined,
        dialogueRatio: number(source.dialogueRatio),
        descriptionRatio: number(source.descriptionRatio),
        battleIntensity: ['low', 'medium', 'high'].includes(String(source.battleIntensity)) ? source.battleIntensity as OutputProfile['battleIntensity'] : undefined,
        emotionTendency: text(source.emotionTendency) || undefined,
        endingHookRequired: source.endingHookRequired === true,
        extraRequirements: text(source.extraRequirements) || undefined,
        forbiddenItems: Array.isArray(source.forbiddenItems) ? source.forbiddenItems as string[] : [],
        isDefault: source.isDefault === true,
      });
      onProgress?.({ stage: '导入输出方案', current: ++progress, total });
    }

    return {
      novelId: novel.id,
      novelTitle: novel.title,
      volumeCount: sourceVolumes.length,
      chapterCount: sourceChapters.length,
      adoptedChapterCount,
      missingContentCount,
      styleProfileCount: styles.length,
      outputProfileCount: outputs.length,
    };
  } catch (error) {
    try {
      await rollbackNovel(novel.id);
    } catch (rollbackError) {
      throw Object.assign(new Error('导入失败，且未能完整回滚新建作品'), {
        importError: error,
        rollbackError,
      });
    }
    throw error;
  }
}
