// src/agent-tools/project-tools.ts
// AI Novel Studio — 项目相关 Agent Tools（只读）
// 版本：v1.0.46
// 用途：提供项目/作品上下文的只读 Tool 接口
// 安全：只读，不创建/修改/删除数据

import type { AgentToolResult, AgentToolContext } from './tool-types';
import { errorResult, resolveNovelId, successResult } from './tool-types';
import { novelService } from '../services/novels/novelService';
import { volumeRepository } from '../services/database/volumeRepository';
import { chapterRepository } from '../services/database/chapterRepository';
import { settingRepository } from '../services/database/settingRepository';
import { protagonistRepository } from '../services/database/protagonistRepository';
import { novelRepository } from '../services/database/novelRepository';
import { getDbMode } from '../services/database/db';
import {
  chapterOutlineService,
  masterOutlineService,
  volumeOutlineService,
} from '../services/outlines/outlineService';
import { loadGenerationAssetContext } from '../services/generation/generationAssetContext';
import { resolveGenerationProfiles } from '../services/styles/generationProfileResolver';
import { styleProfileService } from '../services/styles/styleProfileService';
import { outputProfileService } from '../services/styles/outputProfileService';
import { buildStylePromptProjection } from '../services/styles/styleProfilePromptProjection';
import type { Novel, ProtagonistProfile } from '../types/novel';
import type { Protagonist } from '../types/protagonist';
import type { RuleSystem, WorldSetting } from '../types/setting';
import type { Volume } from '../types/volume';
import type { Chapter } from '../types/chapter';

export interface ProjectContextReadDependencies {
  getNovel: typeof novelRepository.getById;
  getWorldSettings: typeof settingRepository.getWorldSettings;
  getRuleSystems: typeof settingRepository.getRuleSystems;
  getLegacyProtagonist: typeof protagonistRepository.getByNovelId;
  getVolumes: typeof volumeRepository.getByNovelId;
  getChapters: typeof chapterRepository.getByNovelId;
  getMasterOutline: typeof masterOutlineService.getActive;
  getVolumeOutline: typeof volumeOutlineService.getActive;
  getChapterOutline: typeof chapterOutlineService.getActive;
  resolveProfiles: typeof resolveGenerationProfiles;
  getStyleProfile: typeof styleProfileService.getById;
  getOutputProfile: typeof outputProfileService.getById;
  loadGenerationAssets: typeof loadGenerationAssetContext;
}

const defaultProjectContextDependencies: ProjectContextReadDependencies = {
  getNovel: (novelId) => novelRepository.getById(novelId),
  getWorldSettings: (novelId) => settingRepository.getWorldSettings(novelId),
  getRuleSystems: (novelId) => settingRepository.getRuleSystems(novelId),
  getLegacyProtagonist: (novelId) => protagonistRepository.getByNovelId(novelId),
  getVolumes: (novelId) => volumeRepository.getByNovelId(novelId),
  getChapters: (novelId) => chapterRepository.getByNovelId(novelId),
  getMasterOutline: (novelId) => masterOutlineService.getActive(novelId),
  getVolumeOutline: (novelId, volumeId) => volumeOutlineService.getActive(novelId, volumeId),
  getChapterOutline: (novelId, chapterId) => chapterOutlineService.getActive(novelId, chapterId),
  resolveProfiles: (novelId) => resolveGenerationProfiles(novelId, { initialize: false }),
  getStyleProfile: (profileId) => styleProfileService.getById(profileId),
  getOutputProfile: (profileId) => outputProfileService.getById(profileId),
  loadGenerationAssets: (novelId, relevanceText) =>
    loadGenerationAssetContext(novelId, relevanceText),
};

function limitedText(value: string | undefined, maximum: number): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(0, maximum - 18))}...[内容已截断]`;
}

function projectWorldSettings(settings: readonly WorldSetting[]) {
  return [...settings]
    .sort(
      (left, right) =>
        Number(right.isActive) - Number(left.isActive) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 8)
    .map((setting, index) => ({
      id: setting.id,
      title: setting.title,
      content: limitedText(setting.content, index === 0 ? 6_000 : 1_500),
      isActive: setting.isActive,
      updatedAt: setting.updatedAt,
    }));
}

function projectRuleSystems(rules: readonly RuleSystem[]) {
  const activeRules = rules.filter((rule) => rule.isActive);
  return activeRules.slice(0, 12).map((rule) => ({
    id: rule.id,
    title: rule.title,
    category: rule.category,
    content: limitedText(rule.content, 2_000),
    forbiddenRules: limitedText(rule.forbiddenRules, 1_000),
    isActive: rule.isActive,
    updatedAt: rule.updatedAt,
  }));
}

function projectVolumes(volumes: readonly Volume[]) {
  return [...volumes]
    .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
    .slice(0, 80)
    .map((volume) => ({
      id: volume.id,
      title: volume.title,
      summary: limitedText(volume.summary, 800),
      goal: limitedText(volume.goal, 600),
      mainConflict: limitedText(volume.mainConflict, 600),
      orderIndex: volume.orderIndex,
      status: volume.status,
    }));
}

function projectChapters(chapters: readonly Chapter[], currentChapterId?: string) {
  const ordered = [...chapters].sort(
    (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
  );
  const selected = ordered.slice(0, 160);
  const currentChapter = currentChapterId
    ? ordered.find((chapter) => chapter.id === currentChapterId)
    : undefined;
  if (currentChapter && !selected.some((chapter) => chapter.id === currentChapter.id)) {
    selected.push(currentChapter);
  }
  return selected.map((chapter) => ({
    id: chapter.id,
    novelId: chapter.novelId,
    volumeId: chapter.volumeId,
    title: chapter.title,
    outline: limitedText(chapter.outline, 800),
    goal: limitedText(chapter.goal, 600),
    summary: limitedText(chapter.summary, 600),
    orderIndex: chapter.orderIndex,
    status: chapter.status,
    targetWordCount: chapter.targetWordCount,
    wordCount: chapter.wordCount,
  }));
}

async function readOptional<T>(
  loader: () => Promise<T>,
  fallback: T,
  warning: string,
  warnings: string[],
): Promise<T> {
  try {
    return await loader();
  } catch {
    warnings.push(warning);
    return fallback;
  }
}

async function resolveProjectProtagonists(
  novel: Novel,
  getLegacyProtagonist: ProjectContextReadDependencies['getLegacyProtagonist'],
  warnings: string[],
): Promise<{ protagonists: Array<ProtagonistProfile | Protagonist>; source: string }> {
  const authoredProtagonists = novel.protagonists.filter((protagonist) =>
    [
      protagonist.name,
      protagonist.identity,
      protagonist.goal,
      protagonist.ability,
      protagonist.specialAbility,
      protagonist.background,
    ].some((value) => typeof value === 'string' && value.trim().length > 0),
  );
  if (authoredProtagonists.length > 0) {
    return { protagonists: authoredProtagonists, source: 'novels.protagonists' };
  }
  const legacy = await readOptional(
    () => getLegacyProtagonist(novel.id),
    null,
    '无法读取兼容主角信息',
    warnings,
  );
  return {
    protagonists: legacy ? [legacy] : [],
    source: legacy ? 'legacy_protagonists' : 'none',
  };
}

function projectOutline(
  outline:
    | Awaited<ReturnType<typeof masterOutlineService.getActive>>
    | Awaited<ReturnType<typeof volumeOutlineService.getActive>>
    | Awaited<ReturnType<typeof chapterOutlineService.getActive>>,
  maximum: number,
) {
  if (!outline) return null;
  return {
    id: outline.id,
    title: outline.title,
    content: limitedText(outline.content, maximum),
    version: outline.version,
    updatedAt: outline.updatedAt,
  };
}

function projectOutputProfile(profile: Awaited<ReturnType<typeof outputProfileService.getById>>) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    targetWordCount: profile.targetWordCount ?? profile.chapterWordRange.default,
    minWordCount: profile.minWordCount ?? profile.chapterWordRange.min,
    maxWordCount: profile.maxWordCount ?? profile.chapterWordRange.max,
    paceLevel: profile.paceLevel,
    povType: profile.povType,
    tenseType: profile.tenseType,
    dialogueRatio: profile.dialogueRatio,
    descriptionRatio: profile.descriptionRatio,
    endingHookRequired: profile.endingHookRequired,
    extraRequirements: limitedText(profile.extraRequirements, 2_000),
    forbiddenItems: profile.forbiddenItems?.slice(0, 20) ?? [],
  };
}

function dataSource(): 'sqlite' | 'localstorage' {
  return getDbMode() === 'tauri' ? 'sqlite' : 'localstorage';
}

/**
 * 读取项目上下文
 * 包括：作品基本信息、世界设定、主角信息、卷章结构概览
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 作品上下文信息
 */
export async function readProjectContext(
  context: AgentToolContext,
  dependencyOverrides: Partial<ProjectContextReadDependencies> = {},
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID（projectId / novelId / workId）', {
      source: 'tool-layer',
    });
  }

  try {
    const dependencies = { ...defaultProjectContextDependencies, ...dependencyOverrides };
    const novel = await dependencies.getNovel(novelId);
    if (!novel) {
      return errorResult(`作品 ${novelId} 不存在`, { source: dataSource() });
    }

    const warnings: string[] = [];
    const [worldSettings, ruleSystems, volumes, chapters, protagonistResolution, masterOutline] =
      await Promise.all([
        readOptional(
          () => dependencies.getWorldSettings(novelId),
          [],
          '无法读取世界设定',
          warnings,
        ),
        readOptional(() => dependencies.getRuleSystems(novelId), [], '无法读取规则体系', warnings),
        readOptional(() => dependencies.getVolumes(novelId), [], '无法读取分卷信息', warnings),
        readOptional(() => dependencies.getChapters(novelId), [], '无法读取章节列表', warnings),
        resolveProjectProtagonists(novel, dependencies.getLegacyProtagonist, warnings),
        readOptional(
          () => dependencies.getMasterOutline(novelId),
          null,
          '无法读取活动总纲',
          warnings,
        ),
      ]);

    const currentChapter =
      chapters.find((chapter) => chapter.id === context.chapterId) ??
      chapters.find((chapter) => chapter.id === novel.currentChapterId);
    const currentVolumeId = currentChapter?.volumeId ?? novel.currentVolumeId;
    const relevanceText = [
      novel.description,
      novel.outline,
      novel.worldBackground,
      currentChapter?.title,
      currentChapter?.outline,
      currentChapter?.goal,
    ]
      .filter(Boolean)
      .join('\n');
    const [volumeOutline, chapterOutline, resolvedProfiles, generationAssets] = await Promise.all([
      currentVolumeId
        ? readOptional(
            () => dependencies.getVolumeOutline(novelId, currentVolumeId),
            null,
            '无法读取当前分卷活动大纲',
            warnings,
          )
        : Promise.resolve(null),
      currentChapter
        ? readOptional(
            () => dependencies.getChapterOutline(novelId, currentChapter.id),
            null,
            '无法读取当前章节活动大纲',
            warnings,
          )
        : Promise.resolve(null),
      readOptional(
        () => dependencies.resolveProfiles(novelId),
        {},
        '无法解析活动风格或输出方案',
        warnings,
      ),
      readOptional(
        () => dependencies.loadGenerationAssets(novelId, relevanceText),
        { sources: [], warnings: [] },
        '无法读取参考资料或势力地点资产',
        warnings,
      ),
    ]);
    warnings.push(...generationAssets.warnings);
    const [styleProfile, outputProfile] = await Promise.all([
      resolvedProfiles.styleProfileId
        ? readOptional(
            () => dependencies.getStyleProfile(resolvedProfiles.styleProfileId!),
            null,
            '无法读取活动风格方案',
            warnings,
          )
        : Promise.resolve(null),
      resolvedProfiles.outputProfileId
        ? readOptional(
            () => dependencies.getOutputProfile(resolvedProfiles.outputProfileId!),
            null,
            '无法读取默认输出方案',
            warnings,
          )
        : Promise.resolve(null),
    ]);

    return successResult(
      {
        novel: {
          id: novel.id,
          title: novel.title,
          genre: novel.genre ?? '',
          description: limitedText(novel.description, 4_000),
          outline: limitedText(novel.outline, 8_000),
          worldBackground: limitedText(novel.worldBackground, 6_000),
          status: novel.status,
          totalWordCount: novel.totalWordCount,
          targetWordCount: novel.targetWordCount,
          currentVolumeId,
          currentChapterId: currentChapter?.id ?? novel.currentChapterId,
          updatedAt: novel.updatedAt,
        },
        worldSettings: projectWorldSettings(worldSettings),
        ruleSystems: projectRuleSystems(ruleSystems),
        protagonists: protagonistResolution.protagonists,
        protagonistSource: protagonistResolution.source,
        volumes: projectVolumes(volumes),
        chapters: projectChapters(chapters, currentChapter?.id ?? novel.currentChapterId),
        structureSummary: {
          totalVolumeCount: volumes.length,
          totalChapterCount: chapters.length,
        },
        activeOutlines: {
          master: projectOutline(masterOutline, 12_000),
          volume: projectOutline(volumeOutline, 8_000),
          chapter: projectOutline(chapterOutline, 6_000),
        },
        generationProfiles: {
          style: styleProfile
            ? {
                id: styleProfile.id,
                name: styleProfile.name,
                promptProjection: limitedText(buildStylePromptProjection(styleProfile), 4_000),
              }
            : null,
          output: projectOutputProfile(outputProfile),
        },
        generationAssets: {
          storyAssets: generationAssets.storyAssetText ?? '',
          referenceMaterials: generationAssets.referenceText ?? '',
          sources: generationAssets.sources,
        },
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取项目上下文失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 读取作品列表
 *
 * @param context - Agent Tool 执行上下文（可选）
 * @returns Promise<AgentToolResult> — 作品列表摘要
 */
export async function readProjectList(
  context?: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>[]>> {
  void context;
  try {
    const novels = await novelService.listNovels();
    const summaries = novels.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      totalWordCount: n.totalWordCount,
      updatedAt: (n as unknown as Record<string, unknown>).updatedAt ?? '',
    }));
    return successResult(summaries, { source: dataSource() });
  } catch (err) {
    return errorResult(`读取作品列表失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 读取作品设置摘要
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 作品设置信息
 */
export async function readProjectSettings(
  context: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID', { source: 'tool-layer' });
  }

  try {
    const novel = await novelRepository.getById(novelId);
    if (!novel) {
      return errorResult(`作品 ${novelId} 不存在`, { source: dataSource() });
    }

    const warnings: string[] = [];

    let worldSettings: unknown = null;
    try {
      worldSettings = await settingRepository.getWorldSettings(novelId);
    } catch {
      warnings.push('无法读取世界设定');
    }

    let ruleSystems: unknown = null;
    try {
      ruleSystems = projectRuleSystems(await settingRepository.getRuleSystems(novelId));
    } catch {
      warnings.push('无法读取规则体系');
    }

    const protagonistResolution = await resolveProjectProtagonists(
      novel,
      (id) => protagonistRepository.getByNovelId(id),
      warnings,
    );

    return successResult(
      {
        novelId: novel.id,
        novelTitle: novel.title,
        status: novel.status,
        worldSettings: Array.isArray(worldSettings)
          ? projectWorldSettings(worldSettings as WorldSetting[])
          : worldSettings,
        ruleSystems,
        protagonists: protagonistResolution.protagonists,
        protagonistSource: protagonistResolution.source,
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取作品设置失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}
