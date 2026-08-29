import type { Novel } from '../../types/novel';
import type { Protagonist } from '../../types/protagonist';
import type { ReferenceWork } from '../../types/reference';
import type { RuleSystem, WorldSetting } from '../../types/setting';
import type { StyleProfile } from '../../types/style';
import type { OutputProfile } from '../../types/output';
import type { ChapterCharacter } from '../../types/character';
import type { ChapterEvent } from '../../types/chapterEvent';
import type { ChapterOutline, MasterOutline, VolumeOutline } from '../../types/outline';
import { chapterCharacterService } from '../characters/chapterCharacterService';
import { chapterEventService } from '../characters/chapterEventService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { settingRepository } from '../database/settingRepository';
import {
  chapterOutlineService,
  masterOutlineService,
  volumeOutlineService,
} from '../outlines/outlineService';
import { resolveWorldBackgroundForWriter } from '../prompt/contextBuilder';
import { referenceLibraryService } from '../references/referenceLibraryService';
import {
  resolveGenerationProfiles,
  type ResolvedGenerationProfiles,
} from '../styles/generationProfileResolver';
import { outputProfileService } from '../styles/outputProfileService';
import { styleProfileService } from '../styles/styleProfileService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export type WorkbenchAssetScopeGroup = 'foundation' | 'structure' | 'controls' | 'continuity';

export type WorkbenchAssetScopeStatus =
  'ready' | 'fallback' | 'automatic' | 'missing' | 'unavailable';

export type WorkbenchAssetScopeKey =
  | 'world'
  | 'rules'
  | 'protagonist'
  | 'master_outline'
  | 'volume_outline'
  | 'chapter_outline'
  | 'chapter_characters'
  | 'chapter_events'
  | 'style_profile'
  | 'output_profile'
  | 'references'
  | 'adopted_chapter'
  | 'context_record'
  | 'memory_context'
  | 'world_state';

export interface WorkbenchAssetScopeEvidence {
  source: string;
  revision?: string;
  fingerprint?: string;
}

export interface WorkbenchAssetScopeItem {
  key: WorkbenchAssetScopeKey;
  group: WorkbenchAssetScopeGroup;
  label: string;
  value: string;
  status: WorkbenchAssetScopeStatus;
  required: boolean;
  actionPath?: string;
  evidence?: WorkbenchAssetScopeEvidence;
}

export interface WorkbenchAssetScopeSummary {
  novelId: string;
  chapterId?: string;
  items: WorkbenchAssetScopeItem[];
  requiredMissingCount: number;
  unavailableCount: number;
}

interface GenerationProfiles {
  resolution: ResolvedGenerationProfiles;
  style: StyleProfile | null;
  output: OutputProfile | null;
}

export interface WorkbenchAssetScopeDependencies {
  getNovel: (novelId: string) => Promise<Novel | null>;
  getWorldSettings: (novelId: string) => Promise<WorldSetting[]>;
  getRuleSystems: (novelId: string) => Promise<RuleSystem[]>;
  getProtagonist: (novelId: string) => Promise<Protagonist | null>;
  getMasterOutline: (novelId: string) => Promise<MasterOutline | null>;
  getVolumeOutline: (novelId: string, volumeId?: string) => Promise<VolumeOutline | null>;
  getChapterOutline: (novelId: string, chapterId?: string) => Promise<ChapterOutline | null>;
  getChapterCharacters: (chapterId: string) => Promise<ChapterCharacter[]>;
  getChapterEvents: (chapterId: string) => Promise<ChapterEvent[]>;
  getGenerationProfiles: (novelId: string) => Promise<GenerationProfiles>;
  getReferences: (novelId: string) => Promise<ReferenceWork[]>;
}

interface LoadResult<T> {
  value: T;
  failed: boolean;
}

async function capture<T>(loader: Promise<T>, fallback: T): Promise<LoadResult<T>> {
  try {
    return { value: await loader, failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
}

const defaultDependencies: WorkbenchAssetScopeDependencies = {
  getNovel: (novelId) => novelRepository.getById(novelId),
  getWorldSettings: (novelId) => settingRepository.getWorldSettings(novelId),
  getRuleSystems: (novelId) => settingRepository.getRuleSystems(novelId),
  getProtagonist: (novelId) => protagonistRepository.getByNovelId(novelId),
  getMasterOutline: (novelId) => masterOutlineService.getActive(novelId),
  getVolumeOutline: (novelId, volumeId) => volumeOutlineService.getActive(novelId, volumeId),
  getChapterOutline: (novelId, chapterId) => chapterOutlineService.getActive(novelId, chapterId),
  getChapterCharacters: (chapterId) => chapterCharacterService.getByChapterId(chapterId),
  getChapterEvents: (chapterId) => chapterEventService.getByChapterId(chapterId),
  getGenerationProfiles: async (novelId) => {
    const resolution = await resolveGenerationProfiles(novelId);
    const [style, output] = await Promise.all([
      resolution.styleProfileId
        ? styleProfileService.getById(resolution.styleProfileId)
        : Promise.resolve(null),
      resolution.outputProfileId
        ? outputProfileService.getById(resolution.outputProfileId)
        : Promise.resolve(null),
    ]);
    return { resolution, style, output };
  },
  getReferences: (novelId) => referenceLibraryService.listWorks(novelId),
};

function unavailableItem(
  key: WorkbenchAssetScopeKey,
  group: WorkbenchAssetScopeGroup,
  label: string,
  required: boolean,
  actionPath?: string,
): WorkbenchAssetScopeItem {
  return { key, group, label, value: '读取失败', status: 'unavailable', required, actionPath };
}

function summarizeNames(names: string[], empty: string): string {
  const normalized = names.map((name) => name.trim()).filter(Boolean);
  if (normalized.length === 0) return empty;
  const preview = normalized.slice(0, 2).join('、');
  return normalized.length > 2 ? `${preview} 等 ${normalized.length} 项` : preview;
}

function profileStatus(novelId: string, profile: StyleProfile | OutputProfile | null) {
  if (!profile) return 'missing' as const;
  return profile.novelId === novelId ? ('ready' as const) : ('fallback' as const);
}

function safeUpdatedAt(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ? `更新 ${match[1]}` : undefined;
}

function latestUpdatedAt(values: Array<string | undefined>): string | undefined {
  const dates = values
    .flatMap((value) => value?.trim().match(/^(\d{4}-\d{2}-\d{2})/u)?.[1] ?? [])
    .sort();
  return dates.length > 0 ? `更新 ${dates[dates.length - 1]}` : undefined;
}

function safeVersion(value: number | undefined): string | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? `v${value}` : undefined;
}

function compactSha256(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized)
    ? `sha256:${normalized.slice(0, 8)}...${normalized.slice(-4)}`
    : undefined;
}

async function fingerprint(material: unknown): Promise<string | undefined> {
  if (material === undefined || material === null || material === '') return undefined;
  try {
    return compactSha256(await computeContentSha256(JSON.stringify(material)));
  } catch {
    return undefined;
  }
}

async function assetEvidence(
  source: string,
  material: unknown,
  revision?: string,
): Promise<WorkbenchAssetScopeEvidence> {
  const contentFingerprint = await fingerprint(material);
  return {
    source,
    ...(revision ? { revision } : {}),
    ...(contentFingerprint ? { fingerprint: contentFingerprint } : {}),
  };
}

export async function loadWorkbenchAssetScope(
  input: { novelId: string; chapterId?: string; volumeId?: string },
  dependencies: WorkbenchAssetScopeDependencies = defaultDependencies,
): Promise<WorkbenchAssetScopeSummary> {
  const novelId = input.novelId.trim();
  if (!novelId) throw new Error('可用创作上下文缺少小说作用域。');

  const novelPath = `/novels/${novelId}`;
  const outlinePath = `${novelPath}/outline`;
  const chapterId = input.chapterId?.trim() || undefined;
  const volumeId = input.volumeId?.trim() || undefined;

  const [
    novel,
    worlds,
    rules,
    protagonist,
    master,
    volume,
    chapter,
    characters,
    events,
    profiles,
    references,
  ] = await Promise.all([
    capture(dependencies.getNovel(novelId), null),
    capture(dependencies.getWorldSettings(novelId), []),
    capture(dependencies.getRuleSystems(novelId), []),
    capture(dependencies.getProtagonist(novelId), null),
    capture(dependencies.getMasterOutline(novelId), null),
    capture(dependencies.getVolumeOutline(novelId, volumeId), null),
    capture(dependencies.getChapterOutline(novelId, chapterId), null),
    chapterId
      ? capture(dependencies.getChapterCharacters(chapterId), [])
      : Promise.resolve({ value: [], failed: false }),
    chapterId
      ? capture(dependencies.getChapterEvents(chapterId), [])
      : Promise.resolve({ value: [], failed: false }),
    capture(dependencies.getGenerationProfiles(novelId), {
      resolution: {},
      style: null,
      output: null,
    }),
    capture(dependencies.getReferences(novelId), []),
  ]);

  const items: WorkbenchAssetScopeItem[] = [];
  const activeWorld = worlds.value.find((item) => item.isActive && item.content.trim());
  const resolvedWorld = resolveWorldBackgroundForWriter(worlds.value, novel.value?.worldBackground);
  items.push(
    worlds.failed || novel.failed
      ? unavailableItem('world', 'foundation', '正式世界', true, novelPath)
      : {
          key: 'world',
          group: 'foundation',
          label: '正式世界',
          value: activeWorld?.title || (resolvedWorld ? '作品世界背景' : '未准备'),
          status: activeWorld ? 'ready' : resolvedWorld ? 'fallback' : 'missing',
          required: true,
          actionPath: novelPath,
          ...(activeWorld
            ? {
                evidence: await assetEvidence(
                  '正式世界设定',
                  {
                    title: activeWorld.title,
                    content: activeWorld.content,
                    structuredJson: activeWorld.structuredJson,
                  },
                  safeUpdatedAt(activeWorld.updatedAt),
                ),
              }
            : resolvedWorld
              ? {
                  evidence: await assetEvidence(
                    '作品背景回退',
                    resolvedWorld,
                    safeUpdatedAt(novel.value?.updatedAt),
                  ),
                }
              : {}),
        },
  );

  const activeRules = rules.value.filter((item) => item.isActive && item.content.trim());
  items.push(
    rules.failed
      ? unavailableItem('rules', 'foundation', '正式规则', true, novelPath)
      : {
          key: 'rules',
          group: 'foundation',
          label: '正式规则',
          value: summarizeNames(
            activeRules.map((item) => item.title),
            '未准备',
          ),
          status: activeRules.length > 0 ? 'ready' : 'missing',
          required: true,
          actionPath: novelPath,
          ...(activeRules.length > 0
            ? {
                evidence: await assetEvidence(
                  '正式规则体系',
                  activeRules.map((item) => ({
                    title: item.title,
                    category: item.category,
                    content: item.content,
                    forbiddenRules: item.forbiddenRules,
                    structuredJson: item.structuredJson,
                  })),
                  latestUpdatedAt(activeRules.map((item) => item.updatedAt)),
                ),
              }
            : {}),
        },
  );

  const novelProtagonist = novel.value?.protagonists?.find((item) => item.name.trim());
  const protagonistName = protagonist.value?.name.trim() || novelProtagonist?.name.trim();
  items.push(
    protagonist.failed || novel.failed
      ? unavailableItem('protagonist', 'foundation', '正式主角', true, novelPath)
      : {
          key: 'protagonist',
          group: 'foundation',
          label: '正式主角',
          value: protagonistName || '未准备',
          status: protagonist.value?.name.trim()
            ? 'ready'
            : protagonistName
              ? 'fallback'
              : 'missing',
          required: true,
          actionPath: novelPath,
          ...(protagonist.value?.name.trim()
            ? {
                evidence: await assetEvidence(
                  '正式主角档案',
                  protagonist.value,
                  safeUpdatedAt(protagonist.value.updatedAt),
                ),
              }
            : novelProtagonist
              ? {
                  evidence: await assetEvidence(
                    '作品主角投影',
                    novelProtagonist,
                    safeUpdatedAt(novel.value?.updatedAt),
                  ),
                }
              : {}),
        },
  );

  items.push(
    master.failed
      ? unavailableItem('master_outline', 'structure', '全书大纲', false, outlinePath)
      : {
          key: 'master_outline',
          group: 'structure',
          label: '全书大纲',
          value: master.value?.title || '未准备',
          status: master.value ? 'ready' : 'missing',
          required: false,
          actionPath: outlinePath,
          ...(master.value
            ? {
                evidence: await assetEvidence(
                  '活动全书大纲',
                  {
                    title: master.value.title,
                    content: master.value.content,
                    version: master.value.version,
                  },
                  safeVersion(master.value.version) ?? safeUpdatedAt(master.value.updatedAt),
                ),
              }
            : {}),
        },
  );

  if (volumeId) {
    items.push(
      volume.failed
        ? unavailableItem('volume_outline', 'structure', '分卷大纲', false, outlinePath)
        : {
            key: 'volume_outline',
            group: 'structure',
            label: '分卷大纲',
            value: volume.value?.title || '未准备',
            status: volume.value ? 'ready' : 'missing',
            required: false,
            actionPath: outlinePath,
            ...(volume.value
              ? {
                  evidence: await assetEvidence(
                    '活动分卷大纲',
                    {
                      title: volume.value.title,
                      content: volume.value.content,
                      version: volume.value.version,
                    },
                    safeVersion(volume.value.version) ?? safeUpdatedAt(volume.value.updatedAt),
                  ),
                }
              : {}),
          },
    );
  }

  if (chapterId) {
    items.push(
      chapter.failed
        ? unavailableItem('chapter_outline', 'structure', '章节大纲', true, outlinePath)
        : {
            key: 'chapter_outline',
            group: 'structure',
            label: '章节大纲',
            value: chapter.value?.title || '未准备',
            status: chapter.value ? 'ready' : 'missing',
            required: true,
            actionPath: outlinePath,
            ...(chapter.value
              ? {
                  evidence: await assetEvidence(
                    '活动章节大纲',
                    {
                      title: chapter.value.title,
                      content: chapter.value.content,
                      version: chapter.value.version,
                    },
                    safeVersion(chapter.value.version) ?? safeUpdatedAt(chapter.value.updatedAt),
                  ),
                }
              : {}),
          },
    );
  }

  const style = profiles.value.style;
  items.push(
    profiles.failed
      ? unavailableItem('style_profile', 'controls', '风格方案', false, '/styles')
      : {
          key: 'style_profile',
          group: 'controls',
          label: '风格方案',
          value: style?.name || '未选择',
          status: profileStatus(novelId, style),
          required: false,
          actionPath: '/styles',
          ...(style
            ? {
                evidence: await assetEvidence(
                  style.novelId === novelId ? '作品风格方案' : '系统风格回退',
                  style,
                  safeUpdatedAt(style.updatedAt),
                ),
              }
            : {}),
        },
  );

  const output = profiles.value.output;
  items.push(
    profiles.failed
      ? unavailableItem('output_profile', 'controls', '输出方案', false, '/styles')
      : {
          key: 'output_profile',
          group: 'controls',
          label: '输出方案',
          value: output?.name || '未选择',
          status: profileStatus(novelId, output),
          required: false,
          actionPath: '/styles',
          ...(output
            ? {
                evidence: await assetEvidence(
                  output.novelId === novelId ? '作品输出方案' : '系统输出回退',
                  output,
                  safeUpdatedAt(output.updatedAt),
                ),
              }
            : {}),
        },
  );

  if (chapterId) {
    const chapterCharacters = characters.value;
    items.push(
      characters.failed
        ? unavailableItem('chapter_characters', 'continuity', '本章角色', false, novelPath)
        : {
            key: 'chapter_characters',
            group: 'continuity',
            label: '本章角色',
            value: summarizeNames(
              chapterCharacters.map((item) => item.characterName || ''),
              '未绑定',
            ),
            status: chapterCharacters.length > 0 ? 'ready' : 'missing',
            required: false,
            actionPath: novelPath,
            ...(chapterCharacters.length > 0
              ? {
                  evidence: await assetEvidence(
                    '章节角色绑定',
                    chapterCharacters.map((item) => ({
                      characterId: item.characterId,
                      roleInChapter: item.roleInChapter,
                      mustAppear: item.mustAppear,
                      note: item.note,
                    })),
                    latestUpdatedAt(chapterCharacters.map((item) => item.updatedAt)),
                  ),
                }
              : {}),
          },
    );

    const usableEvents = events.value.filter(
      (item) => item.status !== 'forbidden' && item.status !== 'discarded',
    );
    items.push(
      events.failed
        ? unavailableItem('chapter_events', 'continuity', '本章事件', false)
        : {
            key: 'chapter_events',
            group: 'continuity',
            label: '本章事件',
            value: summarizeNames(
              usableEvents.map((item) => item.title),
              '未选择',
            ),
            status: usableEvents.length > 0 ? 'ready' : 'missing',
            required: false,
            ...(usableEvents.length > 0
              ? {
                  evidence: await assetEvidence(
                    '章节事件',
                    usableEvents.map((item) => ({
                      title: item.title,
                      description: item.description,
                      status: item.status,
                      impact: item.impact,
                      risk: item.risk,
                    })),
                    latestUpdatedAt(usableEvents.map((item) => item.updatedAt)),
                  ),
                }
              : {}),
          },
    );
  }

  const usableReferences = references.value.filter(
    (item) =>
      item.sourceStatus === 'available' &&
      (item.purpose === 'research' || item.purpose === 'inspiration'),
  );
  items.push(
    references.failed
      ? unavailableItem('references', 'continuity', '参考资料', false, `${novelPath}/references`)
      : {
          key: 'references',
          group: 'continuity',
          label: '参考资料',
          value:
            usableReferences.length > 0
              ? `研究 / 灵感 ${usableReferences.length} 项`
              : '本轮无可用资料',
          status: usableReferences.length > 0 ? 'automatic' : 'missing',
          required: false,
          actionPath: `${novelPath}/references`,
          ...(usableReferences.length > 0
            ? {
                evidence: await assetEvidence(
                  '参考资料库',
                  usableReferences.map((item) => ({
                    purpose: item.purpose,
                    activeSourceHash: item.activeSourceHash,
                    revision: item.revision,
                  })),
                  latestUpdatedAt(usableReferences.map((item) => item.updatedAt)),
                ),
              }
            : {}),
        },
  );

  if (chapterId) {
    items.push(
      {
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: '生成前核验正式采用状态',
        status: 'automatic',
        required: false,
      },
      {
        key: 'context_record',
        group: 'continuity',
        label: 'Context',
        value: '按目标章节读取正式记录',
        status: 'automatic',
        required: false,
      },
      {
        key: 'memory_context',
        group: 'continuity',
        label: 'Memory',
        value: '按本轮指令检索',
        status: 'automatic',
        required: false,
      },
      {
        key: 'world_state',
        group: 'continuity',
        label: '世界状态',
        value: '由已采用总结与 Context 投影',
        status: 'automatic',
        required: false,
      },
    );
  }

  return {
    novelId,
    chapterId,
    items,
    requiredMissingCount: items.filter(
      (item) => item.required && (item.status === 'missing' || item.status === 'unavailable'),
    ).length,
    unavailableCount: items.filter((item) => item.status === 'unavailable').length,
  };
}

export const workbenchAssetScopeService = {
  load: loadWorkbenchAssetScope,
};
