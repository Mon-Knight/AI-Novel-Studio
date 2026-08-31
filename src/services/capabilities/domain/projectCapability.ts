import { readProjectContext, readProjectSettings } from '../../../agent-tools/project-tools';
import { readChapterOutline } from '../../../agent-tools/chapter-tools';
import {
  failure,
  fromToolResult,
  hashPublicValue,
  mapUnknownError,
  validateChapterScope,
  validateNovelId,
  success,
} from './domainResult';
import type {
  ChapterPosition,
  ChapterSummary,
  DomainRequest,
  DomainResult,
  ProjectReadModel,
  ProjectSummary,
  ProtagonistSummary,
  SettingSummary,
  VolumeSummary,
} from './domainTypes';
import { isRecord, optionalText, positiveNumber, text } from './domainTypes';

function list(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return value && isRecord(value) ? [value] : [];
}

function mapProject(value: unknown): ProjectSummary {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('生产项目结果缺少稳定的公开身份字段。');
  }
  return {
    id: value.id,
    title: value.title,
    description: text(value.description),
    genre: text(value.genre),
    status: text(value.status, 'draft'),
    totalWordCount: positiveNumber(value.totalWordCount),
    targetWordCount: positiveNumber(value.targetWordCount),
    ...(optionalText(value.currentVolumeId)
      ? { currentVolumeId: value.currentVolumeId as string }
      : {}),
    ...(optionalText(value.currentChapterId)
      ? { currentChapterId: value.currentChapterId as string }
      : {}),
    updatedAt: text(value.updatedAt),
  };
}

function mapSetting(value: Record<string, unknown>, novelId: string): SettingSummary {
  if (typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('世界设定结果缺少稳定身份字段。');
  }
  if (typeof value.novelId === 'string' && value.novelId !== novelId) {
    throw new Error('世界设定与当前作品归属不一致。');
  }
  return {
    id: value.id,
    title: value.title,
    details: text(value.content),
    active: value.isActive === true || value.isActive === 1,
  };
}

function mapProtagonist(value: Record<string, unknown>, novelId: string): ProtagonistSummary {
  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('主角设定结果缺少稳定身份字段。');
  }
  if (typeof value.novelId === 'string' && value.novelId !== novelId) {
    throw new Error('主角设定与当前作品归属不一致。');
  }
  return {
    id: value.id,
    name: value.name,
    identity: text(value.identity),
    goal: text(value.goal),
    ability: text(value.specialAbility),
    limits: text(value.abilityLimits),
    behaviorBoundaries: text(value.forbiddenBehaviors),
    currentState: text(value.currentState),
  };
}

function mapVolume(value: Record<string, unknown>, novelId: string): VolumeSummary {
  if (typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('分卷结果缺少稳定身份字段。');
  }
  if (typeof value.novelId === 'string' && value.novelId !== novelId) {
    throw new Error('分卷与当前作品归属不一致。');
  }
  return {
    id: value.id,
    novelId,
    title: value.title,
    summary: text(value.summary),
    goal: text(value.goal),
    mainConflict: text(value.mainConflict),
    orderIndex: positiveNumber(value.orderIndex),
    status: text(value.status, 'planned'),
  };
}

function mapChapter(value: Record<string, unknown>, novelId: string): ChapterSummary {
  if (typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('章节结果缺少稳定身份字段。');
  }
  if (typeof value.novelId !== 'string' || value.novelId !== novelId) {
    throw new Error('章节与当前作品归属不一致。');
  }
  return {
    id: value.id,
    novelId,
    ...(optionalText(value.volumeId) ? { volumeId: value.volumeId as string } : {}),
    title: value.title,
    outline: text(value.outline),
    goal: text(value.goal),
    status: text(value.status, 'not_started'),
    targetWordCount: positiveNumber(value.targetWordCount),
    wordCount: positiveNumber(value.wordCount),
    ...(optionalText(value.adoptedDraftId)
      ? { adoptedDraftId: value.adoptedDraftId as string }
      : {}),
  };
}

function projectFromToolData(novelId: string, data: unknown): ProjectReadModel {
  if (!isRecord(data)) throw new Error('生产项目结果不是公开对象。');
  const project = mapProject(data.novel);
  if (project.id !== novelId) throw new Error('生产项目结果与请求作品不一致。');
  return {
    project,
    settings: {
      world: list(data.worldSettings).map((item) => mapSetting(item, novelId)),
      protagonists: list(data.protagonists).map((item) => mapProtagonist(item, novelId)),
    },
    structure: {
      volumes: list(data.volumes).map((item) => mapVolume(item, novelId)),
      chapters: list(data.chapters).map((item) => mapChapter(item, novelId)),
    },
  };
}

function settingsFromToolData(novelId: string, data: unknown): ProjectReadModel['settings'] {
  if (!isRecord(data)) throw new Error('生产设置结果不是公开对象。');
  return {
    world: list(data.worldSettings).map((item) => mapSetting(item, novelId)),
    protagonists: list(data.protagonists).map((item) => mapProtagonist(item, novelId)),
  };
}

function normalizeErrorResult<T>(result: DomainResult<T>): DomainResult<T> {
  return result;
}

export const projectCapability = {
  async readCurrentProject(request: DomainRequest): Promise<DomainResult<ProjectReadModel>> {
    const invalid = validateNovelId(request);
    if (invalid) return invalid;
    try {
      const result = await readProjectContext({
        novelId: request.novelId,
        chapterId: request.chapterId,
      });
      const mapped = fromToolResult(result, (data) => projectFromToolData(request.novelId, data));
      if (!mapped.ok || !mapped.data) return normalizeErrorResult(mapped);
      return success(mapped.data, {
        source: mapped.source,
        storageMode: mapped.storageMode,
        warnings: mapped.warnings,
        revision: null,
        contentHash: await hashPublicValue(mapped.data),
      });
    } catch (error) {
      return mapUnknownError(error, 'runtime');
    }
  },

  async readSettings(request: DomainRequest): Promise<DomainResult<ProjectReadModel['settings']>> {
    const invalid = validateNovelId(request);
    if (invalid) return invalid;
    try {
      const result = await readProjectSettings({ novelId: request.novelId });
      const mapped = fromToolResult(result, (data) => settingsFromToolData(request.novelId, data));
      if (!mapped.ok || !mapped.data) return normalizeErrorResult(mapped);
      return success(mapped.data, {
        source: mapped.source,
        storageMode: mapped.storageMode,
        warnings: mapped.warnings,
        revision: null,
        contentHash: await hashPublicValue(mapped.data),
      });
    } catch (error) {
      return mapUnknownError(error, 'runtime');
    }
  },

  async readChapterPosition(request: DomainRequest): Promise<DomainResult<ChapterPosition>> {
    const invalid = validateChapterScope(request);
    if (invalid) return invalid;
    // Probe the authoritative chapter handler first.  This preserves a
    // distinct cross-work ownership error even when the requested work has no
    // chapter list of its own.
    const chapterProbe = await readChapterOutline({
      novelId: request.novelId,
      chapterId: request.chapterId,
    });
    const probeResult = fromToolResult(chapterProbe, (data) => data);
    if (!probeResult.ok) {
      return failure(
        probeResult.error?.code ?? 'UPSTREAM_FAILURE',
        probeResult.error?.message ?? '章节读取失败。',
        probeResult.source,
        probeResult.storageMode,
        probeResult.warnings,
      );
    }
    const projectResult = await this.readCurrentProject(request);
    if (!projectResult.ok || !projectResult.data) {
      return failure(
        projectResult.error?.code ?? 'UPSTREAM_FAILURE',
        projectResult.error?.message ?? '作品读取失败。',
        projectResult.source,
        projectResult.storageMode,
        projectResult.warnings,
      );
    }
    const chapter = projectResult.data.structure.chapters.find(
      (item) => item.id === request.chapterId,
    );
    if (!chapter)
      return failure(
        'NOT_FOUND',
        `章节 ${request.chapterId} 不存在。`,
        projectResult.source,
        projectResult.storageMode,
      );
    const volume = chapter.volumeId
      ? projectResult.data.structure.volumes.find((item) => item.id === chapter.volumeId)
      : undefined;
    if (chapter.volumeId && !volume) {
      return failure(
        'INTEGRITY_ERROR',
        '章节引用的分卷不属于当前作品。',
        projectResult.source,
        projectResult.storageMode,
      );
    }
    const data: ChapterPosition = {
      project: projectResult.data.project,
      ...(volume ? { volume } : {}),
      chapter,
      settings: projectResult.data.settings,
    };
    return success(data, {
      source: projectResult.source,
      storageMode: projectResult.storageMode,
      warnings: projectResult.warnings,
      revision: null,
      contentHash: await hashPublicValue(data),
    });
  },
};

export type ProjectCapability = typeof projectCapability;
