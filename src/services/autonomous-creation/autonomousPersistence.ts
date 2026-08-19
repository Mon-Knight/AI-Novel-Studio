import { dbCall, lsGet, lsSet, nowISO } from '../database/db';
import type {
  ApplyAutonomousPlanResult,
  AutonomousChapterPlan,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import { validateCompletePlan } from './autonomousPlanBuilder';
import { getAutonomousPlanningBaseline } from './autonomousPlanningBaselineService';

const PLAN_KEY = 'ai_novel_studio_autonomous_story_plans';
const VOLUME_KEY = 'ai_novel_studio_volumes';
const CHAPTER_KEY = 'ai_novel_studio_chapters';
const CHARACTER_KEY = 'ai_novel_studio_characters';
const WORLD_KEY = 'ai_novel_studio_world_settings';
const CHAPTER_CHARACTER_KEY = 'ai_novel_studio_chapter_characters';
const CHAPTER_EVENT_KEY = 'ai_novel_studio_chapter_events';

const APPLY_KEYS = [
  PLAN_KEY,
  VOLUME_KEY,
  CHAPTER_KEY,
  CHARACTER_KEY,
  WORLD_KEY,
  CHAPTER_CHARACTER_KEY,
  CHAPTER_EVENT_KEY,
] as const;

export interface AutonomousPlanPersistence {
  savePlan(plan: AutonomousStoryPlan, expectedRevision: number): Promise<AutonomousStoryPlan>;
  getPlan(planId: string): Promise<AutonomousStoryPlan | null>;
  getPlanByOperation(operationId: string): Promise<AutonomousStoryPlan | null>;
  listPlansByNovel(novelId: string, limit?: number): Promise<AutonomousStoryPlan[]>;
  applyPlan(planId: string, expectedRevision: number): Promise<ApplyAutonomousPlanResult>;
}

function isPlan(value: unknown): value is AutonomousStoryPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Partial<AutonomousStoryPlan>;
  return (
    typeof plan.planId === 'string' &&
    typeof plan.operationId === 'string' &&
    typeof plan.novelId === 'string' &&
    typeof plan.revision === 'number' &&
    Array.isArray(plan.chapters) &&
    Array.isArray(plan.volumes)
  );
}

function localPlans(): AutonomousStoryPlan[] {
  const raw = lsGet<unknown>(PLAN_KEY);
  return Array.isArray(raw) ? raw.filter(isPlan) : [];
}

function sameIdentity(left: AutonomousStoryPlan, right: AutonomousStoryPlan): boolean {
  return (
    left.planId === right.planId &&
    left.operationId === right.operationId &&
    left.novelId === right.novelId &&
    left.requestHash === right.requestHash &&
    left.schemaVersion === right.schemaVersion
  );
}

function allowedTransition(
  from: AutonomousStoryPlan['status'],
  to: AutonomousStoryPlan['status'],
): boolean {
  if (from === to) return true;
  if (from === 'running') return ['ready', 'failed', 'cancelled'].includes(to);
  if (from === 'failed' || from === 'cancelled') return to === 'running';
  if (from === 'ready') return to === 'applied';
  return false;
}

function saveLocalPlan(plan: AutonomousStoryPlan, expectedRevision: number): AutonomousStoryPlan {
  const plans = localPlans();
  const operationIndex = plans.findIndex((item) => item.operationId === plan.operationId);
  const planIndex = plans.findIndex((item) => item.planId === plan.planId);
  if (operationIndex >= 0 && operationIndex !== planIndex) {
    throw new Error('相同 operationId 已绑定另一份自主创作计划。');
  }

  if (planIndex < 0) {
    if (expectedRevision !== 0 || plan.revision !== 0)
      throw new Error('自主创作计划初始 revision 必须为 0。');
    const inserted = { ...plan, revision: 1 };
    plans.unshift(inserted);
    lsSet(PLAN_KEY, plans);
    return inserted;
  }

  const existing = plans[planIndex];
  if (!sameIdentity(existing, plan)) throw new Error('自主创作计划身份不可变。');
  if (existing.revision !== expectedRevision || plan.revision !== expectedRevision) {
    throw new Error('自主创作计划 revision 已变化。');
  }
  if (!allowedTransition(existing.status, plan.status))
    throw new Error('自主创作计划状态转换无效。');
  const updated = { ...plan, revision: expectedRevision + 1 };
  plans[planIndex] = updated;
  lsSet(PLAN_KEY, plans);
  return updated;
}

function rawArray(key: string): unknown[] {
  const value = lsGet<unknown>(key);
  return Array.isArray(value) ? value : [];
}

function belongsToNovel(value: unknown, novelId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.novelId === novelId || record.novel_id === novelId;
}

function chapterOutline(chapter: AutonomousChapterPlan): string {
  return [
    chapter.outline,
    `【自主节奏】${chapter.pacingMode}，张力 ${chapter.tension}/100`,
    `【章节钩子】${chapter.endingHook}`,
  ].join('\n\n');
}

function restoreLocalSnapshot(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

function writeLocalApplyBundle(
  values: ReadonlyMap<string, unknown>,
  snapshots: ReadonlyMap<string, string | null>,
): void {
  try {
    for (const [key, value] of values) lsSet(key, value);
  } catch (error) {
    const rollbackErrors: Array<{ key: string; error: unknown }> = [];
    for (const key of APPLY_KEYS) {
      try {
        restoreLocalSnapshot(key, snapshots.get(key) ?? null);
      } catch (rollbackError) {
        rollbackErrors.push({ key, error: rollbackError });
      }
    }
    if (rollbackErrors.length > 0) {
      const rollbackFailure = new Error('自主创作计划本地应用失败，且补偿回滚未完全成功。');
      Object.assign(rollbackFailure, { cause: error, rollbackErrors });
      throw rollbackFailure;
    }
    throw error;
  }
}

async function applyLocalPlan(
  planId: string,
  expectedRevision: number,
): Promise<ApplyAutonomousPlanResult> {
  const plans = localPlans();
  const index = plans.findIndex((item) => item.planId === planId);
  if (index < 0) throw new Error('自主创作计划不存在。');
  const plan = plans[index];
  if (plan.status === 'applied') {
    return {
      plan,
      createdVolumes: plan.volumes.filter((volume) => volume.materialization !== 'existing').length,
      createdChapters: plan.chapters.length,
      createdCharacters: plan.characters.length,
      createdWorldElements: plan.worldElements.length,
      createdChapterEvents: plan.chapters.reduce(
        (sum, item) => sum + item.conflictThreadIds.length,
        0,
      ),
      createdChapterCharacters: plan.chapters.reduce(
        (sum, item) => sum + item.characterIds.length,
        0,
      ),
    };
  }
  if (plan.revision !== expectedRevision) throw new Error('自主创作计划 revision 已变化。');
  validateCompletePlan(plan);

  const volumes = rawArray(VOLUME_KEY);
  const chapters = rawArray(CHAPTER_KEY);
  if (
    plan.planningMode !== 'continuation' &&
    (volumes.some((item) => belongsToNovel(item, plan.novelId)) ||
      chapters.some((item) => belongsToNovel(item, plan.novelId)))
  ) {
    throw new Error('目标作品已有分卷或章节，不能覆盖式应用自主创作计划。');
  }

  const existingVolumes = volumes.filter((item) => belongsToNovel(item, plan.novelId));
  const existingChapters = chapters.filter((item) => belongsToNovel(item, plan.novelId));
  if (plan.planningMode === 'continuation') {
    const baseline = plan.baseline;
    const live = await getAutonomousPlanningBaseline(plan.novelId);
    if (!baseline || live.structureHash !== baseline.structureHash) {
      throw new Error('规划完成后作品结构已变化，请刷新基线并重新生成计划。');
    }
    const existingVolumeIds = new Set(
      existingVolumes.map((item) => String((item as Record<string, unknown>).id ?? '')),
    );
    const baselineVolumeOrder = new Map(
      baseline.existingVolumes.map((volume) => [volume.id, volume.orderIndex]),
    );
    const existingChapterIds = new Set(
      existingChapters.map((item) => String((item as Record<string, unknown>).id ?? '')),
    );
    const nextVolumeIndex =
      Math.max(
        -1,
        ...existingVolumes.map((item) =>
          Number(
            (item as Record<string, unknown>).orderIndex ??
              (item as Record<string, unknown>).order_index ??
              -1,
          ),
        ),
      ) + 1;
    const maxChapter = Math.max(
      0,
      ...existingChapters.map((item) =>
        Number(
          (item as Record<string, unknown>).chapterNumber ??
            (item as Record<string, unknown>).orderIndex ??
            0,
        ),
      ),
    );
    const newVolumeIds = new Set<string>();
    const volumeIndexes = new Set<number>();
    for (const volume of plan.volumes) {
      if (!volumeIndexes.add(volume.index)) {
        throw new Error('续写计划包含重复的分卷序号。');
      }
      if (volume.materialization === 'existing') {
        if (!existingVolumeIds.has(volume.id)) {
          throw new Error('续写计划引用的既有分卷已不存在。');
        }
        if (baselineVolumeOrder.get(volume.id) !== volume.index) {
          throw new Error('续写计划修改了既有分卷的位置。');
        }
      } else {
        if (existingVolumeIds.has(volume.id) || !newVolumeIds.add(volume.id)) {
          throw new Error('续写计划包含与既有分卷冲突的 ID。');
        }
        if (volume.index < nextVolumeIndex) {
          throw new Error('新增分卷必须排列在全部既有分卷之后。');
        }
      }
    }
    const chapterNumbers = new Set<number>();
    for (const chapter of plan.chapters) {
      if (existingChapterIds.has(chapter.id) || chapter.chapterNumber <= maxChapter) {
        throw new Error('续写计划只能追加新章节。');
      }
      if (!chapterNumbers.add(chapter.chapterNumber)) {
        throw new Error('续写计划包含重复的章节编号。');
      }
      if (!newVolumeIds.has(chapter.volumeId) && !existingVolumeIds.has(chapter.volumeId)) {
        throw new Error('续写章节引用的分卷不存在。');
      }
    }
  }

  const now = nowISO();
  const createdVolumes = plan.volumes
    .filter((volume) => volume.materialization !== 'existing')
    .map((volume) => ({
      id: volume.id,
      novelId: plan.novelId,
      title: volume.title,
      summary: volume.summary,
      goal: volume.goal,
      mainConflict: volume.mainConflict,
      orderIndex: volume.index,
      volumeNumber: volume.index + 1,
      sortOrder: volume.index,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
    }));
  const createdChapters = plan.chapters.map((chapter) => ({
    id: chapter.id,
    novelId: plan.novelId,
    volumeId: chapter.volumeId,
    title: chapter.title,
    outline: chapterOutline(chapter),
    goal: chapter.goal,
    chapterNumber: chapter.chapterNumber,
    orderIndex: chapter.chapterNumber - 1,
    sortOrder: chapter.chapterNumber - 1,
    status: 'outline_ready',
    wordCount: 0,
    currentWords: 0,
    targetWordCount: chapter.targetWordCount,
    targetWords: chapter.targetWordCount,
    drafts: [],
    createdAt: now,
    updatedAt: now,
  }));
  const createdCharacters = plan.characters.map((character) => ({
    id: character.id,
    novelId: plan.novelId,
    name: character.name,
    roleType: character.role,
    identity: character.identity,
    faction: character.faction,
    relationToProtagonist: character.relationToProtagonist,
    goal: character.coreNeed,
    personality: character.personality,
    behaviorLimits: character.behaviorLimits.join('\n'),
    forbiddenBehaviors: character.forbiddenBehaviors.join('\n'),
    currentState: character.initialState,
    source: 'ai_generated',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const createdWorld = plan.worldElements.map((element) => ({
    id: element.id,
    novelId: plan.novelId,
    title: element.name,
    content: element.summary,
    structuredJson: JSON.stringify({
      autonomousPlanId: plan.planId,
      type: element.type,
      firstChapter: element.firstChapter,
      dependencies: element.dependencies,
      constraints: element.constraints,
    }),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const characterById = new Map(plan.characters.map((item) => [item.id, item]));
  const conflictById = new Map(plan.conflicts.map((item) => [item.id, item]));
  const createdChapterCharacters = plan.chapters.flatMap((chapter) =>
    chapter.characterIds.map((characterId) => {
      const character = characterById.get(characterId);
      return {
        id: `${chapter.id}:${characterId}`,
        novelId: plan.novelId,
        chapterId: chapter.id,
        characterId,
        characterName: character?.name,
        roleInChapter: character?.role === 'protagonist' ? 'main' : 'supporting',
        mustAppear: true,
        note: '由自主创作计划准备',
        createdAt: now,
        updatedAt: now,
      };
    }),
  );
  const createdEvents = plan.chapters.flatMap((chapter) =>
    chapter.conflictThreadIds.map((conflictId) => {
      const conflict = conflictById.get(conflictId);
      return {
        id: `${chapter.id}:${conflictId}`,
        novelId: plan.novelId,
        chapterId: chapter.id,
        title: conflict?.title ?? '自主冲突节点',
        description: `${conflict?.summary ?? chapter.goal}\n本章目标：${chapter.goal}`,
        involvedCharacterIds: chapter.characterIds,
        impact: conflict?.stakes,
        risk: chapter.endingHook,
        status: 'required',
        source: 'ai_suggested',
        createdAt: now,
        updatedAt: now,
      };
    }),
  );

  const appliedPlan: AutonomousStoryPlan = {
    ...plan,
    status: 'applied',
    stage: 'applied',
    revision: plan.revision + 1,
    chapters: plan.chapters.map((chapter) => ({ ...chapter, status: 'materialized' })),
    updatedAt: now,
    appliedAt: now,
  };
  plans[index] = appliedPlan;

  const snapshots = new Map<string, string | null>();
  for (const key of APPLY_KEYS) snapshots.set(key, localStorage.getItem(key));
  writeLocalApplyBundle(
    new Map<string, unknown>([
      [VOLUME_KEY, [...volumes, ...createdVolumes]],
      [CHAPTER_KEY, [...chapters, ...createdChapters]],
      [CHARACTER_KEY, [...rawArray(CHARACTER_KEY), ...createdCharacters]],
      [WORLD_KEY, [...rawArray(WORLD_KEY), ...createdWorld]],
      [CHAPTER_CHARACTER_KEY, [...rawArray(CHAPTER_CHARACTER_KEY), ...createdChapterCharacters]],
      [CHAPTER_EVENT_KEY, [...rawArray(CHAPTER_EVENT_KEY), ...createdEvents]],
      [PLAN_KEY, plans],
    ]),
    snapshots,
  );

  return {
    plan: appliedPlan,
    createdVolumes: createdVolumes.length,
    createdChapters: createdChapters.length,
    createdCharacters: createdCharacters.length,
    createdWorldElements: createdWorld.length,
    createdChapterEvents: createdEvents.length,
    createdChapterCharacters: createdChapterCharacters.length,
  };
}

export const autonomousPlanPersistence: AutonomousPlanPersistence = {
  async savePlan(plan, expectedRevision) {
    const value = await dbCall<unknown>(
      'save_autonomous_story_plan',
      { input: { plan, expectedRevision } },
      () => saveLocalPlan(plan, expectedRevision),
    );
    if (!isPlan(value)) throw new Error('自主创作计划保存返回格式无效。');
    return value;
  },

  async getPlan(planId) {
    const value = await dbCall<unknown | null>(
      'get_autonomous_story_plan',
      { input: { planId } },
      () => localPlans().find((item) => item.planId === planId) ?? null,
    );
    if (value === null) return null;
    if (!isPlan(value)) throw new Error('自主创作计划读取格式无效。');
    return value;
  },

  async getPlanByOperation(operationId) {
    const value = await dbCall<unknown | null>(
      'get_autonomous_story_plan_by_operation',
      { input: { operationId } },
      () => localPlans().find((item) => item.operationId === operationId) ?? null,
    );
    if (value === null) return null;
    if (!isPlan(value)) throw new Error('自主创作计划重放格式无效。');
    return value;
  },

  async listPlansByNovel(novelId, limit = 20) {
    const value = await dbCall<unknown[]>(
      'list_autonomous_story_plans_by_novel',
      { input: { novelId, limit } },
      () =>
        localPlans()
          .filter((item) => item.novelId === novelId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, limit),
    );
    if (!Array.isArray(value)) throw new Error('自主创作计划列表格式无效。');
    return value.filter(isPlan);
  },

  async applyPlan(planId, expectedRevision) {
    const value = await dbCall<ApplyAutonomousPlanResult>(
      'apply_autonomous_story_plan',
      { input: { planId, expectedRevision } },
      () => applyLocalPlan(planId, expectedRevision),
    );
    if (!value || !isPlan(value.plan)) throw new Error('自主创作计划应用返回格式无效。');
    return value;
  },
};
