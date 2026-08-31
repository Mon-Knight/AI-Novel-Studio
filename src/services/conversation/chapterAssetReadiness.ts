import { assertRequiredCoreAssets } from '../generation/generationContextCompiler';
import { buildFreshChapterGenerationContext } from '../prompt/contextBuilder';
import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import type { TaskModelSnapshot } from '../../types/conversation';
import { orderPlannedChapters } from './workbenchChapterTarget';

export type ChapterCoreAsset =
  'story_plan' | 'chapter_outline' | 'world_setting' | 'rule_system' | 'protagonist';

export interface ChapterCoreAssetDescriptor {
  key: ChapterCoreAsset;
  label: string;
  reason: string;
  generateLabel: string;
  editLabel: string;
}

export interface ChapterAssetReadinessResult {
  ready: boolean;
  missingAssets: ChapterCoreAsset[];
  chapterId?: string;
}

export type ChapterAssetOrchestrationPhase =
  'queued' | 'generating' | 'awaiting_apply' | 'failed' | 'resuming';

export interface ChapterAssetOrchestration {
  phase: ChapterAssetOrchestrationPhase;
  asset?: ChapterCoreAsset;
  preparationTurnId?: string;
  preparationRunId?: string;
  candidateArtifactId?: string;
  errorCode?: string;
  error?: string;
  updatedAt: string;
}

export interface ChapterAssetRecovery {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  originalGoal: string;
  missingAssets: ChapterCoreAsset[];
  sourceTurnId?: string;
  modelSnapshot?: TaskModelSnapshot;
  orchestration: ChapterAssetOrchestration;
  createdAt: string;
  checkedAt: string;
}

interface ChapterAssetReadinessDependencies {
  buildContext?: typeof buildFreshChapterGenerationContext;
  listChapters?: typeof chapterRepository.getByNovelId;
  listVolumes?: typeof volumeRepository.getByNovelId;
  getWorldSettings?: typeof settingRepository.getWorldSettings;
  getRuleSystems?: typeof settingRepository.getRuleSystems;
  getProtagonist?: typeof protagonistRepository.getByNovelId;
  getNovel?: typeof novelRepository.getById;
}

const STORAGE_KEY = 'ai_novel_studio_workbench_asset_recovery_v1';
const ASSET_ORDER: ChapterCoreAsset[] = [
  'world_setting',
  'rule_system',
  'protagonist',
  'story_plan',
  'chapter_outline',
];
const ASSET_SET = new Set<ChapterCoreAsset>(ASSET_ORDER);
const CREATIVE_BRIEF_MARKER = '\n\n[[ANS_CREATIVE_BRIEF:v1]]\n';

export const CHAPTER_CORE_ASSET_DESCRIPTORS: Record<ChapterCoreAsset, ChapterCoreAssetDescriptor> =
  {
    story_plan: {
      key: 'story_plan',
      label: '全书规划',
      reason: '需要先建立总纲、分卷和连续章节，才能从短创意稳定推进长篇正文。',
      generateLabel: '生成规划候选',
      editLabel: '手动建立结构',
    },
    world_setting: {
      key: 'world_setting',
      label: '世界与规则设定',
      reason: '需要明确故事发生的环境、运行规则与不可违背的边界。',
      generateLabel: '生成设定候选',
      editLabel: '手动补充设定',
    },
    rule_system: {
      key: 'rule_system',
      label: '规则体系',
      reason: '已有世界背景仍需要明确可执行的运行规则、限制条件与不可违背的边界。',
      generateLabel: '生成规则候选',
      editLabel: '手动补充规则',
    },
    protagonist: {
      key: 'protagonist',
      label: '主角设定',
      reason: '需要一个可持续追踪的核心人物。',
      generateLabel: '生成主角候选',
      editLabel: '手动补充主角',
    },
    chapter_outline: {
      key: 'chapter_outline',
      label: '章节大纲',
      reason: '当前章节需要可执行的剧情锚点。',
      generateLabel: '生成大纲候选',
      editLabel: '手动补充大纲',
    },
  };

function normalizeMissingAssets(values: readonly ChapterCoreAsset[]): ChapterCoreAsset[] {
  const selected = new Set(values.filter((value) => ASSET_SET.has(value)));
  // Automatic world-setting recovery creates one bundled world-and-rules candidate.
  if (selected.has('world_setting')) selected.delete('rule_system');
  return ASSET_ORDER.filter((value) => selected.has(value));
}

function isOrchestrationPhase(value: unknown): value is ChapterAssetOrchestrationPhase {
  return (
    value === 'queued' ||
    value === 'generating' ||
    value === 'awaiting_apply' ||
    value === 'failed' ||
    value === 'resuming'
  );
}

export function reconcileChapterAssetOrchestration(
  previous: ChapterAssetOrchestration | undefined,
  missingAssets: readonly ChapterCoreAsset[],
  updatedAt: string,
): ChapterAssetOrchestration {
  const currentAsset = normalizeMissingAssets(missingAssets)[0];
  if (!currentAsset) return { phase: 'resuming', updatedAt };
  if (previous?.asset === currentAsset && previous.phase !== 'resuming') return previous;
  return { phase: 'queued', asset: currentAsset, updatedAt };
}

function isCoreAssetsMissingError(
  error: unknown,
): error is Error & { code: 'GENERATION_CORE_ASSETS_MISSING'; missingAssets: ChapterCoreAsset[] } {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; missingAssets?: unknown };
  return (
    candidate.code === 'GENERATION_CORE_ASSETS_MISSING' && Array.isArray(candidate.missingAssets)
  );
}

export async function inspectChapterAssetReadiness(
  input: { novelId: string; chapterId?: string; userInstruction?: string },
  deps: ChapterAssetReadinessDependencies = {},
): Promise<ChapterAssetReadinessResult> {
  const buildContext = deps.buildContext ?? buildFreshChapterGenerationContext;
  let chapterId = input.chapterId?.trim();
  if (!chapterId) {
    const listChapters = deps.listChapters ?? chapterRepository.getByNovelId;
    const listVolumes = deps.listVolumes ?? volumeRepository.getByNovelId;
    const [chapters, volumes] = await Promise.all([
      listChapters(input.novelId),
      listVolumes(input.novelId),
    ]);
    chapterId = orderPlannedChapters(chapters, volumes)[0]?.id;
    if (!chapterId) {
      const getWorldSettings = deps.getWorldSettings ?? settingRepository.getWorldSettings;
      const getRuleSystems = deps.getRuleSystems ?? settingRepository.getRuleSystems;
      const getProtagonist = deps.getProtagonist ?? protagonistRepository.getByNovelId;
      const getNovel = deps.getNovel ?? novelRepository.getById;
      const [worldSettings, ruleSystems, protagonist, novel] = await Promise.all([
        getWorldSettings(input.novelId),
        getRuleSystems(input.novelId),
        getProtagonist(input.novelId),
        getNovel(input.novelId),
      ]);
      const hasWorldSetting = worldSettings.some(
        (setting) => setting.isActive && setting.content.trim(),
      );
      const hasRuleSystem = ruleSystems.some(
        (ruleSystem) => ruleSystem.isActive && ruleSystem.content.trim(),
      );
      const hasProtagonist = Boolean(
        protagonist?.name.trim() || novel?.protagonists.some((profile) => profile.name.trim()),
      );
      const missingAssets = normalizeMissingAssets([
        ...(!hasWorldSetting ? (['world_setting'] as const) : []),
        ...(!hasRuleSystem ? (['rule_system'] as const) : []),
        ...(!hasProtagonist ? (['protagonist'] as const) : []),
      ]);
      return {
        ready: false,
        missingAssets: missingAssets.length > 0 ? missingAssets : ['story_plan'],
      };
    }
  }
  const context = await buildContext({
    novelId: input.novelId,
    chapterId,
    userInstruction: input.userInstruction,
  });
  try {
    assertRequiredCoreAssets(context);
    const result = { ready: true, missingAssets: [] as ChapterCoreAsset[] };
    return input.chapterId ? result : { ...result, chapterId };
  } catch (error) {
    if (!isCoreAssetsMissingError(error)) throw error;
    const missingAssets = normalizeMissingAssets(error.missingAssets);
    const result = { ready: missingAssets.length === 0, missingAssets };
    return input.chapterId ? result : { ...result, chapterId };
  }
}

function coreAssetGenerationInstruction(asset: ChapterCoreAsset): string {
  return asset === 'story_plan'
    ? '生成全书规划候选'
    : asset === 'world_setting'
      ? '生成世界与规则设定候选'
      : asset === 'rule_system'
        ? '生成规则设定候选'
        : asset === 'protagonist'
          ? '生成主角候选'
          : '生成本章大纲候选';
}

function buildCreativeBrief(originalGoal?: string): string {
  const content = (originalGoal ?? '').replace(/\r\n?/g, '\n').trim();
  if (!content) return '';
  return JSON.stringify({
    schema: 'ans_core_asset_creative_brief_v1',
    source: 'original_user_goal',
    content,
  });
}

export function buildCoreAssetGenerationGoal(
  asset: ChapterCoreAsset,
  originalGoal?: string,
): string {
  const instruction = coreAssetGenerationInstruction(asset);
  const creativeBrief = buildCreativeBrief(originalGoal);
  // Automatic preparation turns are origin-tagged and projected as compact UI status text.
  return creativeBrief ? `${instruction}。${CREATIVE_BRIEF_MARKER}${creativeBrief}` : instruction;
}

export function isCoreAssetGenerationGoal(goal: string, asset: ChapterCoreAsset): boolean {
  const instruction = coreAssetGenerationInstruction(asset);
  const normalized = goal.trim();
  return (
    normalized === instruction ||
    normalized.startsWith(`${instruction}。创意依据：`) ||
    normalized.startsWith(`${instruction}。${CREATIVE_BRIEF_MARKER}`)
  );
}

export function resolveCoreAssetGenerationChapterId(
  asset: ChapterCoreAsset,
  chapterId?: string,
): string | undefined {
  return asset === 'chapter_outline' ? chapterId : undefined;
}

export function buildCoreAssetEditPath(recovery: ChapterAssetRecovery, asset: ChapterCoreAsset) {
  const query = new URLSearchParams({ focus: asset, returnTo: 'workbench' });
  if (recovery.chapterId) query.set('chapterId', recovery.chapterId);
  return `/novels/${encodeURIComponent(recovery.novelId)}?${query.toString()}`;
}

function sessionStore(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isModelSnapshot(value: unknown): value is TaskModelSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<TaskModelSnapshot>;
  return (
    typeof snapshot.providerId === 'string' &&
    typeof snapshot.modelId === 'string' &&
    (snapshot.runtimeMode === 'mock' || snapshot.runtimeMode === 'api') &&
    Array.isArray(snapshot.capabilities) &&
    !!snapshot.options &&
    typeof snapshot.options === 'object' &&
    typeof snapshot.capturedAt === 'string'
  );
}

function parseOrchestration(
  value: unknown,
  missingAssets: readonly ChapterCoreAsset[],
  checkedAt: string,
): ChapterAssetOrchestration {
  const currentAsset = normalizeMissingAssets(missingAssets)[0];
  if (!value || typeof value !== 'object') {
    return currentAsset
      ? {
          phase: 'failed',
          asset: currentAsset,
          error: '已恢复旧版准备状态，请确认后重试当前候选。',
          updatedAt: checkedAt,
        }
      : { phase: 'resuming', updatedAt: checkedAt };
  }
  const item = value as Partial<ChapterAssetOrchestration>;
  if (!isOrchestrationPhase(item.phase) || typeof item.updatedAt !== 'string') {
    return currentAsset
      ? {
          phase: 'failed',
          asset: currentAsset,
          error: '准备状态不完整，请重试当前候选。',
          updatedAt: checkedAt,
        }
      : { phase: 'resuming', updatedAt: checkedAt };
  }
  if (!currentAsset) {
    return item.phase === 'failed'
      ? {
          phase: 'failed',
          ...(typeof item.errorCode === 'string' && item.errorCode.trim()
            ? { errorCode: item.errorCode.trim() }
            : {}),
          error: typeof item.error === 'string' ? item.error : undefined,
          updatedAt: item.updatedAt,
        }
      : { phase: 'resuming', updatedAt: item.updatedAt };
  }
  if (item.asset !== currentAsset || item.phase === 'resuming') {
    return { phase: 'queued', asset: currentAsset, updatedAt: checkedAt };
  }
  return {
    phase: item.phase,
    asset: currentAsset,
    preparationTurnId:
      typeof item.preparationTurnId === 'string' ? item.preparationTurnId : undefined,
    preparationRunId: typeof item.preparationRunId === 'string' ? item.preparationRunId : undefined,
    candidateArtifactId:
      typeof item.candidateArtifactId === 'string' ? item.candidateArtifactId : undefined,
    ...(typeof item.errorCode === 'string' && item.errorCode.trim()
      ? { errorCode: item.errorCode.trim() }
      : {}),
    error: typeof item.error === 'string' ? item.error : undefined,
    updatedAt: item.updatedAt,
  };
}

function parseRecovery(value: unknown): ChapterAssetRecovery | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ChapterAssetRecovery>;
  if (
    typeof item.conversationId !== 'string' ||
    typeof item.novelId !== 'string' ||
    typeof item.originalGoal !== 'string' ||
    !item.conversationId.trim() ||
    !item.novelId.trim() ||
    !item.originalGoal.trim() ||
    !Array.isArray(item.missingAssets) ||
    typeof item.createdAt !== 'string' ||
    typeof item.checkedAt !== 'string'
  ) {
    return null;
  }
  const missingAssets = normalizeMissingAssets(item.missingAssets as ChapterCoreAsset[]);
  return {
    conversationId: item.conversationId,
    novelId: item.novelId,
    chapterId:
      typeof item.chapterId === 'string' && item.chapterId.trim()
        ? item.chapterId.trim()
        : undefined,
    originalGoal: item.originalGoal,
    missingAssets,
    sourceTurnId: typeof item.sourceTurnId === 'string' ? item.sourceTurnId : undefined,
    modelSnapshot: isModelSnapshot(item.modelSnapshot) ? item.modelSnapshot : undefined,
    orchestration: parseOrchestration(item.orchestration, missingAssets, item.checkedAt),
    createdAt: item.createdAt,
    checkedAt: item.checkedAt,
  };
}

function readAllRecoveries(): Record<string, ChapterAssetRecovery> {
  const storage = sessionStore();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as {
      version?: unknown;
      recoveries?: unknown;
    };
    if (parsed.version !== 1 || !parsed.recoveries || typeof parsed.recoveries !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed.recoveries as Record<string, unknown>).flatMap(([key, value]) => {
        const recovery = parseRecovery(value);
        return recovery && recovery.conversationId === key ? [[key, recovery]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeAllRecoveries(recoveries: Record<string, ChapterAssetRecovery>): void {
  const storage = sessionStore();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, recoveries }));
  } catch {
    // Session persistence is a convenience; the in-memory recovery remains usable.
  }
}

export const chapterAssetRecoveryStore = {
  get(conversationId: string): ChapterAssetRecovery | null {
    return readAllRecoveries()[conversationId] ?? null;
  },

  set(recovery: ChapterAssetRecovery): void {
    writeAllRecoveries({ ...readAllRecoveries(), [recovery.conversationId]: recovery });
  },

  update(
    conversationId: string,
    update: (recovery: ChapterAssetRecovery) => ChapterAssetRecovery,
  ): ChapterAssetRecovery | null {
    const recoveries = readAllRecoveries();
    const current = recoveries[conversationId];
    if (!current) return null;
    const next = update(current);
    writeAllRecoveries({ ...recoveries, [conversationId]: next });
    return next;
  },

  remove(conversationId: string): void {
    const recoveries = readAllRecoveries();
    if (!recoveries[conversationId]) return;
    delete recoveries[conversationId];
    writeAllRecoveries(recoveries);
  },
};

export const chapterAssetReadinessService = {
  inspect: inspectChapterAssetReadiness,
};
