import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ContextRecord } from '../../types/context';
import type { ChapterDraft } from '../../types/ai';
import type { MemoryDocumentPage } from '../../types/memory';
import type { Novel } from '../../types/novel';
import type { Protagonist } from '../../types/protagonist';
import type { ReferenceWork } from '../../types/reference';
import type { RuleSystem, WorldSetting } from '../../types/setting';
import type { StyleProfile } from '../../types/style';
import type { OutputProfile } from '../../types/output';
import type { ChapterCharacter } from '../../types/character';
import type { ChapterEvent } from '../../types/chapterEvent';
import type { ChapterOutline, MasterOutline, VolumeOutline } from '../../types/outline';
import type { Volume } from '../../types/volume';
import { chapterCharacterService } from '../characters/chapterCharacterService';
import { chapterEventService } from '../characters/chapterEventService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { contextRecordService, isContextCompressionRecord } from '../context/contextRecordService';
import { buildPersistedWorldStateTimeline } from '../context/worldStateTimeline';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import { memoryService } from '../memory/memoryService';
import {
  chapterOutlineService,
  masterOutlineService,
  volumeOutlineService,
} from '../outlines/outlineService';
import {
  resolveWorldBackgroundForWriter,
  selectPrimaryWorldSettingForWriter,
} from '../prompt/contextBuilder';
import { referenceLibraryService } from '../references/referenceLibraryService';
import {
  resolveGenerationProfiles,
  type ResolvedGenerationProfiles,
} from '../styles/generationProfileResolver';
import { outputProfileService } from '../styles/outputProfileService';
import { styleProfileService } from '../styles/styleProfileService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { findPreviousChapterForContinuity } from './workbenchChapterWriter';

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
  getChapters: (novelId: string) => Promise<Chapter[]>;
  getVolumes: (novelId: string) => Promise<Volume[]>;
  getAdoptedDraftByChapterId: (chapterId: string) => Promise<ChapterDraft | null>;
  getContextRecords: (novelId: string) => Promise<ContextRecord[]>;
  getChapterSummaries: (novelId: string) => Promise<ChapterSummary[]>;
  getMemoryDocuments: (novelId: string) => Promise<MemoryDocumentPage>;
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
  getChapters: (novelId) => chapterRepository.getByNovelId(novelId),
  getVolumes: (novelId) => volumeRepository.getByNovelId(novelId),
  getAdoptedDraftByChapterId: (chapterId) => draftVersionService.getAdoptedByChapterId(chapterId),
  getContextRecords: (novelId) => contextRecordService.getByNovelId(novelId),
  getChapterSummaries: (novelId) => chapterSummaryService.getByNovelId(novelId),
  getMemoryDocuments: (novelId) =>
    memoryService.listDocuments({ novelId, status: 'active', limit: 50 }),
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

function formatCount(value: number): string {
  return value.toLocaleString('zh-CN');
}

function orderChaptersForContextPreview(chapters: Chapter[], volumes: Volume[]): Chapter[] {
  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.orderIndex]));
  return [...chapters].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      left.orderIndex - right.orderIndex ||
      left.chapterNumber - right.chapterNumber ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function selectContextPreview(input: {
  targetChapterId: string;
  chapters: Chapter[];
  volumes: Volume[];
  records: ContextRecord[];
  summaries: ChapterSummary[];
}): { chapterSummaries: ChapterSummary[]; contextRecords: ContextRecord[] } {
  const orderedChapters = orderChaptersForContextPreview(input.chapters, input.volumes);
  const targetIndex = orderedChapters.findIndex((chapter) => chapter.id === input.targetChapterId);
  if (targetIndex < 0) return { chapterSummaries: [], contextRecords: [] };

  const previousChapter = targetIndex > 0 ? orderedChapters[targetIndex - 1] : undefined;
  const previousSummary = previousChapter
    ? input.summaries
        .filter(
          (summary) =>
            summary.chapterId === previousChapter.id && summary.enabled && !summary.isExpired,
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
        )[0]
    : undefined;

  const priorChapterIds = new Set(
    orderedChapters.slice(0, Math.max(0, targetIndex)).map((chapter) => chapter.id),
  );
  const orderedVolumes = [...input.volumes].sort(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      left.volumeNumber - right.volumeNumber ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const targetChapter = orderedChapters[targetIndex];
  const targetVolumeIndex = targetChapter.volumeId
    ? orderedVolumes.findIndex((volume) => volume.id === targetChapter.volumeId)
    : -1;
  const previousVolumeId =
    targetVolumeIndex > 0 ? orderedVolumes[targetVolumeIndex - 1]?.id : undefined;

  const volumeContexts = previousVolumeId
    ? input.records.filter(
        (record) =>
          record.contextType === 'volume_summary' &&
          record.volumeId === previousVolumeId &&
          record.isActive &&
          !record.isExpired,
      )
    : [];
  const eligibleManual = input.records.filter(
    (record) =>
      record.isActive &&
      !record.isExpired &&
      record.contextType !== 'chapter_summary' &&
      record.contextType !== 'volume_summary' &&
      (!record.chapterId || priorChapterIds.has(record.chapterId)),
  );
  const compression = eligibleManual
    .filter(isContextCompressionRecord)
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )[0];
  const manualContexts = (
    compression
      ? [
          compression,
          ...eligibleManual.filter(
            (record) =>
              !isContextCompressionRecord(record) &&
              record.updatedAt.localeCompare(compression.createdAt) > 0,
          ),
        ]
      : eligibleManual
  ).slice(0, 10);

  const seen = new Set<string>();
  const contextRecords = [...volumeContexts, ...manualContexts].filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
  return {
    chapterSummaries: previousSummary ? [previousSummary] : [],
    contextRecords,
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
    chapters,
    volumes,
    contextRecords,
    chapterSummaries,
    memoryDocuments,
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
    chapterId
      ? capture(dependencies.getChapters(novelId), [])
      : Promise.resolve({ value: [], failed: false }),
    chapterId
      ? capture(dependencies.getVolumes(novelId), [])
      : Promise.resolve({ value: [], failed: false }),
    chapterId
      ? capture(dependencies.getContextRecords(novelId), [])
      : Promise.resolve({ value: [], failed: false }),
    chapterId
      ? capture(dependencies.getChapterSummaries(novelId), [])
      : Promise.resolve({ value: [], failed: false }),
    chapterId
      ? capture(dependencies.getMemoryDocuments(novelId), {
          total: 0,
          offset: 0,
          limit: 50,
          items: [],
        })
      : Promise.resolve({
          value: { total: 0, offset: 0, limit: 50, items: [] },
          failed: false,
        }),
  ]);

  const items: WorkbenchAssetScopeItem[] = [];
  const activeWorld = selectPrimaryWorldSettingForWriter(worlds.value);
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
    const continuityStructureFailed = chapters.failed || volumes.failed;
    const targetChapter = chapters.value.find((item) => item.id === chapterId);
    const previousChapter = continuityStructureFailed
      ? undefined
      : findPreviousChapterForContinuity(chapters.value, volumes.value, chapterId);
    const adoptedDraft = previousChapter
      ? await capture(dependencies.getAdoptedDraftByChapterId(previousChapter.id), null)
      : { value: null, failed: false };

    let adoptedChapterItem: WorkbenchAssetScopeItem;
    if (continuityStructureFailed || adoptedDraft.failed) {
      adoptedChapterItem = unavailableItem('adopted_chapter', 'continuity', '前章采用稿', false);
    } else if (!targetChapter) {
      adoptedChapterItem = {
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: '目标章节不在正式卷章结构中',
        status: 'missing',
        required: false,
        evidence: await assetEvidence(
          '正式卷章顺序',
          { targetChapterId: chapterId },
          '目标章未找到',
        ),
      };
    } else if (!previousChapter) {
      adoptedChapterItem = {
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: '首章，无前章采用稿',
        status: 'automatic',
        required: false,
        evidence: await assetEvidence(
          '正式卷章顺序',
          { targetChapterId: chapterId, orderIndex: targetChapter.orderIndex },
          '首章，无前序来源',
        ),
      };
    } else if (!adoptedDraft.value?.isAdopted) {
      adoptedChapterItem = {
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: `《${previousChapter.title}》尚无正式采用稿`,
        status: 'missing',
        required: false,
        evidence: await assetEvidence(
          '紧邻前章正式采用状态',
          {
            chapterId: previousChapter.id,
            adoptedDraftId: previousChapter.adoptedDraftId,
            status: previousChapter.status,
          },
          `未采用${safeUpdatedAt(previousChapter.updatedAt) ? ` · ${safeUpdatedAt(previousChapter.updatedAt)}` : ''}`,
        ),
      };
    } else {
      const draft = adoptedDraft.value;
      const contentFingerprint =
        draft.contentState?.status === 'ready'
          ? compactSha256(draft.contentState.contentHash)
          : draft.content.trim()
            ? compactSha256(await computeContentSha256(draft.content))
            : await fingerprint({
                draftId: draft.id,
                versionNo: draft.versionNo,
                wordCount: draft.wordCount,
                updatedAt: draft.updatedAt,
              });
      adoptedChapterItem = {
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: `《${previousChapter.title}》· v${draft.versionNo} · ${formatCount(draft.wordCount)} 字`,
        status: 'ready',
        required: false,
        evidence: {
          source: '紧邻前章正式采用稿',
          revision: [safeVersion(draft.versionNo), safeUpdatedAt(draft.updatedAt)]
            .filter(Boolean)
            .join(' · '),
          ...(contentFingerprint ? { fingerprint: contentFingerprint } : {}),
        },
      };
    }

    const contextPreview =
      continuityStructureFailed || contextRecords.failed || chapterSummaries.failed
        ? undefined
        : selectContextPreview({
            targetChapterId: chapterId,
            chapters: chapters.value,
            volumes: volumes.value,
            records: contextRecords.value,
            summaries: chapterSummaries.value,
          });
    const contextCount = contextPreview
      ? contextPreview.chapterSummaries.length + contextPreview.contextRecords.length
      : 0;
    const contextItem: WorkbenchAssetScopeItem = !contextPreview
      ? unavailableItem('context_record', 'continuity', 'Context', false)
      : {
          key: 'context_record',
          group: 'continuity',
          label: 'Context',
          value:
            contextCount > 0
              ? `前章总结 ${formatCount(contextPreview.chapterSummaries.length)} 条 · 正式记录 ${formatCount(contextPreview.contextRecords.length)} 条`
              : '目标章前无可用正式 Context',
          status: contextCount > 0 ? 'ready' : 'missing',
          required: false,
          evidence: await assetEvidence(
            '章节总结 + 正式 ContextRecord',
            {
              summaryIds: contextPreview.chapterSummaries.map((summary) => summary.id),
              contextRecords: contextPreview.contextRecords.map((record) => ({
                id: record.id,
                contentHash: record.contentHash,
                draftVersion: record.draftVersion,
              })),
            },
            [
              `${formatCount(contextCount)} 条候选来源`,
              latestUpdatedAt([
                ...contextPreview.chapterSummaries.map((summary) => summary.updatedAt),
                ...contextPreview.contextRecords.map((record) => record.updatedAt),
              ]),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        };

    const memoryItem: WorkbenchAssetScopeItem = memoryDocuments.failed
      ? unavailableItem('memory_context', 'continuity', 'Memory', false)
      : {
          key: 'memory_context',
          group: 'continuity',
          label: 'Memory',
          value:
            memoryDocuments.value.total > 0
              ? `活动文档 ${formatCount(memoryDocuments.value.total)} 条 · 本轮按指令检索`
              : 'SQLite Memory 暂无活动文档',
          status: memoryDocuments.value.total > 0 ? 'ready' : 'missing',
          required: false,
          evidence: await assetEvidence(
            'SQLite Memory 活动文档索引',
            {
              total: memoryDocuments.value.total,
              documents: memoryDocuments.value.items.map((document) => ({
                id: document.id,
                sourceType: document.sourceType,
                sourceId: document.sourceId,
                sourceVersion: document.sourceVersion,
                sourceHash: document.sourceHash,
              })),
            },
            [
              `${formatCount(memoryDocuments.value.total)} 条活动文档`,
              latestUpdatedAt(memoryDocuments.value.items.map((document) => document.updatedAt)),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        };

    const orderedChapters = orderChaptersForContextPreview(chapters.value, volumes.value);
    const targetChapterIndex = orderedChapters.findIndex((item) => item.id === chapterId);
    const worldStateTimeline =
      continuityStructureFailed || contextRecords.failed || chapterSummaries.failed
        ? undefined
        : buildPersistedWorldStateTimeline({
            orderedChapters,
            volumes: volumes.value,
            targetChapterId: chapterId,
            summaries: chapterSummaries.value,
            contextRecords: contextRecords.value,
          });
    const worldStateReadFailed =
      continuityStructureFailed || contextRecords.failed || chapterSummaries.failed;
    const sourceSummaryIds = new Set(worldStateTimeline?.sourceSummaryIds ?? []);
    const sourceContextRecordIds = new Set(worldStateTimeline?.sourceContextRecordIds ?? []);
    const worldStateItem: WorkbenchAssetScopeItem = worldStateReadFailed
      ? unavailableItem('world_state', 'continuity', '世界状态', false)
      : worldStateTimeline
        ? {
            key: 'world_state',
            group: 'continuity',
            label: '世界状态',
            value: `覆盖前序 ${formatCount(worldStateTimeline.chapterCount)} 章 · 总结 ${formatCount(worldStateTimeline.sourceSummaryIds.length)} / Context ${formatCount(worldStateTimeline.sourceContextRecordIds.length)}`,
            status: 'ready',
            required: false,
            evidence: await assetEvidence(
              '已采用章节总结 + 正式 ContextRecord 投影',
              {
                latestChapterId: worldStateTimeline.latestChapterId,
                sourceSummaryIds: worldStateTimeline.sourceSummaryIds,
                sourceContextRecordIds: worldStateTimeline.sourceContextRecordIds,
              },
              [
                `最近章节 ${worldStateTimeline.latestChapterId}`,
                latestUpdatedAt([
                  ...chapterSummaries.value
                    .filter((summary) => sourceSummaryIds.has(summary.id))
                    .map((summary) => summary.updatedAt),
                  ...contextRecords.value
                    .filter((record) => sourceContextRecordIds.has(record.id))
                    .map((record) => record.updatedAt),
                ]),
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          }
        : {
            key: 'world_state',
            group: 'continuity',
            label: '世界状态',
            value:
              targetChapterIndex === 0
                ? '首章，无前序世界状态'
                : targetChapterIndex < 0
                  ? '目标章节不在正式卷章结构中'
                  : '前序章节尚无可投影的正式状态',
            status: targetChapterIndex === 0 ? 'automatic' : 'missing',
            required: false,
            evidence: await assetEvidence(
              '已采用章节总结 + 正式 ContextRecord 投影',
              { targetChapterId: chapterId, targetChapterIndex },
              targetChapterIndex === 0 ? '首章，无前序来源' : '0 个状态来源',
            ),
          };

    items.push(adoptedChapterItem, contextItem, memoryItem, worldStateItem);
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
