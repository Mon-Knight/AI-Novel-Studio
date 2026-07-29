import { generateId, nowISO } from '../database/db';
import { canonicalHash } from '../ai/compilation/canonical';
import type {
  ApplyAutonomousPlanResult,
  AutonomousAgentRun,
  AutonomousAgentType,
  AutonomousChapterPlan,
  AutonomousPlanningBaseline,
  AutonomousPlanningMode,
  AutonomousStoryPlan,
  AutonomousStoryBrief,
  AutonomousVolumePlan,
  AutonomousVolumeStrategy,
  GenerateAutonomousPlanInput,
} from '../../types/autonomousCreation';
import { AUTONOMOUS_PLAN_SCHEMA_VERSION } from '../../types/autonomousCreation';
import type { AutonomousCreationProvider, AutonomousProviderResult } from './autonomousProvider';
import type { AutonomousPlanPersistence } from './autonomousPersistence';
import { AUTONOMOUS_CHAPTER_BATCH_SIZE } from './autonomousChapterBatchPolicy';
import {
  buildChapterBatch,
  buildCharacters,
  buildConflicts,
  buildFoundation,
  buildPacing,
  buildWorldElements,
  derivePlanShape,
  validateCompletePlan,
  validateStoryBrief,
} from './autonomousPlanBuilder';

const AGENTS: AutonomousAgentType[] = [
  'plot_planner',
  'character_evolution',
  'world_builder',
  'conflict_generator',
  'pacing_controller',
  'chapter_batch_planner',
];

const CONTINUITY_ANCHOR_COUNT = 3;

interface ChapterBatchRange {
  chapterStart: number;
  chapterEnd: number;
}

function chapterBatchRanges(volume: AutonomousVolumePlan): ChapterBatchRange[] {
  const ranges: ChapterBatchRange[] = [];
  for (
    let chapterStart = volume.chapterStart;
    chapterStart <= volume.chapterEnd;
    chapterStart += AUTONOMOUS_CHAPTER_BATCH_SIZE
  ) {
    ranges.push({
      chapterStart,
      chapterEnd: Math.min(volume.chapterEnd, chapterStart + AUTONOMOUS_CHAPTER_BATCH_SIZE - 1),
    });
  }
  return ranges;
}

function chaptersInRange(
  chapters: AutonomousChapterPlan[],
  range: ChapterBatchRange,
): AutonomousChapterPlan[] {
  return chapters.filter(
    (chapter) =>
      chapter.chapterNumber >= range.chapterStart && chapter.chapterNumber <= range.chapterEnd,
  );
}

function rangeChapterCount(range: ChapterBatchRange): number {
  return range.chapterEnd - range.chapterStart + 1;
}

/**
 * Partial plans are durable resume checkpoints. Accept only a single contiguous
 * prefix of complete provider batches so a damaged or manually edited plan is
 * never silently filled around ambiguous data.
 */
function assertResumableChapterCheckpoint(plan: AutonomousStoryPlan): void {
  const volumeById = new Map(plan.volumes.map((volume) => [volume.id, volume]));
  const chapterIds = new Set<string>();
  const chapterNumbers = new Set<number>();
  for (const chapter of plan.chapters) {
    if (chapterIds.has(chapter.id)) throw new Error('章节规划检查点包含重复章节 ID。');
    if (chapterNumbers.has(chapter.chapterNumber)) {
      throw new Error(`章节规划检查点包含重复的第 ${chapter.chapterNumber} 章。`);
    }
    const volume = volumeById.get(chapter.volumeId);
    if (
      !volume ||
      chapter.chapterNumber < volume.chapterStart ||
      chapter.chapterNumber > volume.chapterEnd
    ) {
      throw new Error(`第 ${chapter.chapterNumber} 章与所属分卷范围不一致。`);
    }
    chapterIds.add(chapter.id);
    chapterNumbers.add(chapter.chapterNumber);
  }

  const completedVolumeIds = new Set(plan.progress.completedVolumeIds);
  if (
    completedVolumeIds.size !== plan.progress.completedVolumeIds.length ||
    [...completedVolumeIds].some((volumeId) => !volumeById.has(volumeId))
  ) {
    throw new Error('章节规划检查点包含无效的已完成分卷。');
  }

  let reachedMissingRange = false;
  for (const volume of plan.volumes) {
    let volumeComplete = true;
    for (const range of chapterBatchRanges(volume)) {
      const saved = chaptersInRange(plan.chapters, range);
      if (saved.length !== 0 && saved.length !== rangeChapterCount(range)) {
        throw new Error(
          `${volume.title} 第 ${range.chapterStart}-${range.chapterEnd} 章检查点不完整。`,
        );
      }
      if (saved.length === 0) {
        reachedMissingRange = true;
        volumeComplete = false;
      } else if (reachedMissingRange) {
        throw new Error('章节规划检查点不是从全书开头开始的连续完整批次。');
      }
    }
    if (completedVolumeIds.has(volume.id) && !volumeComplete) {
      throw new Error(`${volume.title} 被标记为完成，但章节批次尚未完整保存。`);
    }
  }
}

function lastBaselineChapter(baseline?: AutonomousPlanningBaseline): number {
  return Math.max(0, ...(baseline?.existingChapters ?? []).map((chapter) => chapter.chapterNumber));
}

function hashableBaseline(
  baseline: AutonomousPlanningBaseline,
): Omit<AutonomousPlanningBaseline, 'capturedAt'> {
  return {
    novelId: baseline.novelId,
    structureHash: baseline.structureHash,
    existingVolumes: baseline.existingVolumes,
    existingChapters: baseline.existingChapters,
    existingCharacters: baseline.existingCharacters,
    existingWorldElements: baseline.existingWorldElements,
  };
}

function generationBrief(plan: AutonomousStoryPlan): AutonomousStoryBrief {
  if (plan.planningMode !== 'continuation' || !plan.baseline) return plan.brief;
  return {
    ...plan.brief,
    targetChapterCount: plan.brief.targetChapterCount - lastBaselineChapter(plan.baseline),
  };
}

function promptBaseline(
  baseline?: AutonomousPlanningBaseline,
): AutonomousPlanningBaseline | undefined {
  if (!baseline) return undefined;
  return {
    ...baseline,
    // Keep the full snapshot on the plan for hashing and apply-time drift checks,
    // while sending only the most useful tail to creative agents.
    existingChapters: baseline.existingChapters.slice(-12),
    existingCharacters: baseline.existingCharacters.slice(0, 48),
    existingWorldElements: baseline.existingWorldElements.slice(0, 48),
  };
}

function continuityAnchors(plan: AutonomousStoryPlan, beforeChapter: number) {
  const existing = (plan.baseline?.existingChapters ?? [])
    .filter((chapter) => chapter.chapterNumber < beforeChapter)
    .map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      goal: chapter.goal ?? '',
      endingHook: chapter.summary ?? chapter.outline ?? '',
    }));
  const planned = plan.chapters
    .filter((chapter) => chapter.chapterNumber < beforeChapter)
    .map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      goal: chapter.goal,
      endingHook: chapter.endingHook,
    }));
  return [...existing, ...planned]
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .slice(-CONTINUITY_ANCHOR_COUNT);
}

function applyContinuationCoordinates(plan: AutonomousStoryPlan): AutonomousStoryPlan {
  if (plan.planningMode !== 'continuation' || !plan.baseline) return plan;
  const offset = lastBaselineChapter(plan.baseline);
  const existingVolumes = [...plan.baseline.existingVolumes].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const nextVolumeIndex = Math.max(-1, ...existingVolumes.map((volume) => volume.orderIndex)) + 1;
  const lastVolume = existingVolumes[existingVolumes.length - 1];
  const strategy: AutonomousVolumeStrategy = plan.volumeStrategy ?? 'create_new_volume';
  const coordinatesAlreadyApplied =
    plan.volumes.length > 0 &&
    plan.volumes.every((volume, index) => {
      const appendTarget = strategy === 'append_to_last_volume' && index === 0 && lastVolume;
      return (
        volume.chapterStart > offset &&
        volume.chapterEnd > offset &&
        (appendTarget
          ? volume.id === appendTarget.id && volume.materialization === 'existing'
          : volume.index >= nextVolumeIndex && volume.materialization !== 'existing')
      );
    });
  if (coordinatesAlreadyApplied) return plan;

  const volumeIdMap = new Map<string, string>();
  const volumes = plan.volumes.map((volume, index) => {
    const appendTarget =
      strategy === 'append_to_last_volume' && index === 0 ? lastVolume : undefined;
    const id = appendTarget?.id ?? volume.id;
    volumeIdMap.set(volume.id, id);
    const indexAfterExisting =
      strategy === 'append_to_last_volume'
        ? nextVolumeIndex + Math.max(0, index - 1)
        : nextVolumeIndex + volume.index;
    return {
      ...volume,
      id,
      index: appendTarget?.orderIndex ?? indexAfterExisting,
      chapterStart: volume.chapterStart + offset,
      chapterEnd: volume.chapterEnd + offset,
      materialization: appendTarget ? ('existing' as const) : ('create' as const),
    };
  });
  return {
    ...plan,
    arcs: plan.arcs.map((arc) => ({
      ...arc,
      chapterStart: arc.chapterStart + offset,
      chapterEnd: arc.chapterEnd + offset,
    })),
    volumes,
    characters: plan.characters.map((character) => ({
      ...character,
      beats: character.beats.map((beat) => ({
        ...beat,
        chapterNumber: beat.chapterNumber + offset,
      })),
    })),
    worldElements: plan.worldElements.map((element) => ({
      ...element,
      firstChapter: element.firstChapter + offset,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      ...conflict,
      introducedChapter: conflict.introducedChapter + offset,
      escalationChapters: conflict.escalationChapters.map((chapter) => chapter + offset),
      climaxChapter: conflict.climaxChapter + offset,
      resolutionChapter: conflict.resolutionChapter + offset,
    })),
    pacingPhases: plan.pacingPhases.map((phase) => ({
      ...phase,
      chapterStart: phase.chapterStart + offset,
      chapterEnd: phase.chapterEnd + offset,
    })),
    pacingCurve: plan.pacingCurve.map((point) => ({
      ...point,
      chapterNumber: point.chapterNumber + offset,
    })),
    chapters: plan.chapters.map((chapter) => ({
      ...chapter,
      chapterNumber: chapter.chapterNumber + offset,
      volumeId: volumeIdMap.get(chapter.volumeId) ?? chapter.volumeId,
    })),
  };
}

export interface AutonomousStoryServiceDependencies {
  provider: AutonomousCreationProvider;
  persistence: AutonomousPlanPersistence;
  createId?: () => string;
  now?: () => string;
}

function runTemplate(agent: AutonomousAgentType, now: string): AutonomousAgentRun {
  return {
    agent,
    status: 'pending',
    aiTaskIds: [],
    tokensInput: 0,
    tokensOutput: 0,
    tokensUsed: 0,
    durationMs: 0,
    updatedAt: now,
  };
}

function updateRun(
  plan: AutonomousStoryPlan,
  agent: AutonomousAgentType,
  update: Partial<AutonomousAgentRun>,
  now: string,
): AutonomousStoryPlan {
  return {
    ...plan,
    agentRuns: plan.agentRuns.map((run) =>
      run.agent === agent ? { ...run, ...update, updatedAt: now } : run,
    ),
    updatedAt: now,
  };
}

function addResult(
  plan: AutonomousStoryPlan,
  agent: AutonomousAgentType,
  result: AutonomousProviderResult<unknown>,
  now: string,
): AutonomousStoryPlan {
  const current = plan.agentRuns.find((run) => run.agent === agent) ?? runTemplate(agent, now);
  return updateRun(
    plan,
    agent,
    {
      status: 'succeeded',
      aiTaskIds: [...current.aiTaskIds, result.aiTaskId],
      tokensInput: current.tokensInput + result.tokensInput,
      tokensOutput: current.tokensOutput + result.tokensOutput,
      tokensUsed: current.tokensUsed + result.tokensUsed,
      durationMs: current.durationMs + result.durationMs,
      errorMessage: undefined,
    },
    now,
  );
}

function resetInterruptedRuns(plan: AutonomousStoryPlan, now: string): AutonomousStoryPlan {
  return {
    ...plan,
    agentRuns: plan.agentRuns.map((run) =>
      run.status === 'running' || run.status === 'failed' || run.status === 'cancelled'
        ? { ...run, status: 'pending', errorMessage: undefined, updatedAt: now }
        : run,
    ),
    status: 'running',
    errorMessage: undefined,
    updatedAt: now,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AutonomousStoryService {
  private readonly provider: AutonomousCreationProvider;
  private readonly persistence: AutonomousPlanPersistence;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly inFlight = new Map<string, Promise<AutonomousStoryPlan>>();

  constructor(dependencies: AutonomousStoryServiceDependencies) {
    this.provider = dependencies.provider;
    this.persistence = dependencies.persistence;
    this.createId = dependencies.createId ?? generateId;
    this.now = dependencies.now ?? nowISO;
  }

  async generate(input: GenerateAutonomousPlanInput): Promise<AutonomousStoryPlan> {
    const brief = validateStoryBrief(input.brief);
    const planningMode: AutonomousPlanningMode =
      input.planningMode ??
      (input.baseline &&
      (input.baseline.existingVolumes.length > 0 || input.baseline.existingChapters.length > 0)
        ? 'continuation'
        : 'greenfield');
    const volumeStrategy: AutonomousVolumeStrategy = input.volumeStrategy ?? 'create_new_volume';
    if (planningMode === 'continuation') {
      const baseline = input.baseline;
      if (!baseline || baseline.novelId !== input.novelId) {
        throw new Error('续写计划必须携带目标作品基线。');
      }
      const lastChapter = lastBaselineChapter(baseline);
      if (brief.targetChapterCount <= lastChapter) {
        throw new Error('续写目标章节数必须大于已有最大章节号。');
      }
      if (volumeStrategy === 'append_to_last_volume' && baseline.existingVolumes.length === 0) {
        throw new Error('追加到上一分卷需要已有分卷。');
      }
    }
    const operationId = input.operationId?.trim() || this.createId();
    const requestPayload: Record<string, unknown> = {
      schemaVersion: AUTONOMOUS_PLAN_SCHEMA_VERSION,
      novelId: input.novelId,
      brief,
    };
    if (planningMode === 'continuation') {
      requestPayload.planningMode = planningMode;
      requestPayload.volumeStrategy = volumeStrategy;
      requestPayload.baseline = hashableBaseline(input.baseline!);
    }
    const requestHash = await canonicalHash(requestPayload);
    const active = this.inFlight.get(operationId);
    if (active) return active;

    const promise = this.generateInternal(
      {
        ...input,
        brief,
        operationId,
        planningMode,
        volumeStrategy,
        baseline: planningMode === 'continuation' ? input.baseline : undefined,
      },
      requestHash,
    );
    this.inFlight.set(operationId, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(operationId) === promise) this.inFlight.delete(operationId);
    }
  }

  async resume(
    planId: string,
    signal?: AbortSignal,
    onProgress?: (plan: AutonomousStoryPlan) => void,
  ) {
    const plan = await this.persistence.getPlan(planId);
    if (!plan) throw new Error('自主创作计划不存在。');
    return this.generate({
      novelId: plan.novelId,
      brief: plan.brief,
      operationId: plan.operationId,
      planningMode: plan.planningMode,
      volumeStrategy: plan.volumeStrategy,
      // Preserve the full snapshot for request hashing and idempotent resume.
      // The provider-facing prompt is trimmed later by promptBaseline().
      baseline: plan.baseline,
      signal,
      onProgress,
    });
  }

  getPlan(planId: string) {
    return this.persistence.getPlan(planId);
  }

  listPlansByNovel(novelId: string, limit = 20) {
    return this.persistence.listPlansByNovel(novelId, limit);
  }

  applyPlan(planId: string, expectedRevision: number): Promise<ApplyAutonomousPlanResult> {
    return this.persistence.applyPlan(planId, expectedRevision);
  }

  private async save(plan: AutonomousStoryPlan, onProgress?: (plan: AutonomousStoryPlan) => void) {
    const saved = await this.persistence.savePlan(plan, plan.revision);
    onProgress?.(saved);
    return saved;
  }

  private async generateInternal(
    input: GenerateAutonomousPlanInput & { operationId: string },
    requestHash: string,
  ): Promise<AutonomousStoryPlan> {
    let plan = await this.persistence.getPlanByOperation(input.operationId);
    if (plan) {
      if (plan.novelId !== input.novelId || plan.requestHash !== requestHash) {
        throw new Error('相同 operationId 对应的自主创作请求不一致。');
      }
      if (plan.status === 'ready' || plan.status === 'applied') return plan;
      if (plan.status === 'failed' || plan.status === 'cancelled') {
        plan = await this.save(resetInterruptedRuns(plan, this.now()), input.onProgress);
      }
    } else {
      const createdAt = this.now();
      plan = await this.save(
        {
          schemaVersion: AUTONOMOUS_PLAN_SCHEMA_VERSION,
          planId: this.createId(),
          operationId: input.operationId,
          requestHash,
          novelId: input.novelId,
          ...(input.planningMode === 'continuation'
            ? {
                planningMode: 'continuation' as const,
                volumeStrategy: input.volumeStrategy ?? 'create_new_volume',
                baseline: input.baseline,
              }
            : {}),
          status: 'running',
          stage: 'foundation',
          revision: 0,
          brief: input.brief,
          arcs: [],
          volumes: [],
          characters: [],
          worldElements: [],
          conflicts: [],
          pacingPhases: [],
          pacingCurve: [],
          chapters: [],
          agentRuns: AGENTS.map((agent) => runTemplate(agent, createdAt)),
          chapterRuns: [],
          progress: {
            completedVolumeIds: [],
            currentVolumeIndex: 0,
            adoptedChapterNumbers: [],
            lastCheckpoint: '计划已创建',
          },
          createdAt,
          updatedAt: createdAt,
        },
        input.onProgress,
      );
    }

    try {
      plan = await this.generateFoundation(plan, input);
      plan = await this.generateCharacters(plan, input);
      plan = await this.generateDimensions(plan, input);
      const coordinated = applyContinuationCoordinates(plan);
      if (coordinated !== plan) {
        plan = await this.save(coordinated, input.onProgress);
      }
      plan = await this.generateChapterBatches(plan, input);
      const completedAt = this.now();
      plan = {
        ...plan,
        status: 'ready',
        stage: 'ready',
        chapters: [...plan.chapters].sort(
          (left, right) => left.chapterNumber - right.chapterNumber,
        ),
        progress: { ...plan.progress, lastCheckpoint: '全书计划已完成，等待用户确认应用' },
        errorMessage: undefined,
        updatedAt: completedAt,
        completedAt,
      };
      validateCompletePlan(plan);
      return await this.save(plan, input.onProgress);
    } catch (error) {
      const persisted = await this.persistence.getPlan(plan.planId).catch(() => null);
      if (persisted && persisted.operationId === plan.operationId) plan = persisted;
      const cancelled = Boolean(input.signal?.aborted);
      const failedAt = this.now();
      const activeAgent = plan.agentRuns.find((run) => run.status === 'running')?.agent;
      if (activeAgent) {
        plan = updateRun(
          plan,
          activeAgent,
          {
            status: cancelled ? 'cancelled' : 'failed',
            errorMessage: errorMessage(error),
          },
          failedAt,
        );
      }
      const failedPlan: AutonomousStoryPlan = {
        ...plan,
        status: cancelled ? 'cancelled' : 'failed',
        errorMessage: cancelled ? '用户取消了自主创作计划。' : errorMessage(error),
        progress: {
          ...plan.progress,
          lastCheckpoint: cancelled ? '计划已安全取消' : '计划生成失败，可从当前检查点继续',
        },
        updatedAt: failedAt,
      };
      try {
        await this.save(failedPlan, input.onProgress);
      } catch {
        // Preserve the original provider or validation error when failure persistence also fails.
      }
      throw error;
    }
  }

  private async generateFoundation(
    plan: AutonomousStoryPlan,
    input: GenerateAutonomousPlanInput & { operationId: string },
  ): Promise<AutonomousStoryPlan> {
    if (plan.storyBible && plan.arcs.length > 0 && plan.volumes.length > 0) return plan;
    const brief = generationBrief(plan);
    const startedAt = this.now();
    plan = await this.save(
      updateRun(plan, 'plot_planner', { status: 'running' }, startedAt),
      input.onProgress,
    );
    const result = await this.provider.planFoundation({
      novelId: plan.novelId,
      operationId: plan.operationId,
      brief,
      shape: derivePlanShape(brief.targetChapterCount),
      planningMode: plan.planningMode,
      baseline: promptBaseline(plan.baseline),
      signal: input.signal,
    });
    const foundation = buildFoundation(brief, result.value, this.createId);
    plan = addResult(
      {
        ...plan,
        ...foundation,
        stage: 'creative_dimensions',
        progress: { ...plan.progress, lastCheckpoint: '故事圣经、故事弧与分卷已生成' },
      },
      'plot_planner',
      result,
      this.now(),
    );
    return this.save(plan, input.onProgress);
  }

  private async generateCharacters(
    plan: AutonomousStoryPlan,
    input: GenerateAutonomousPlanInput & { operationId: string },
  ): Promise<AutonomousStoryPlan> {
    if (plan.characters.length > 0) return plan;
    const brief = generationBrief(plan);
    if (!plan.storyBible) throw new Error('人物规划前缺少故事圣经。');
    const storyBible = plan.storyBible;
    plan = await this.save(
      updateRun(plan, 'character_evolution', { status: 'running' }, this.now()),
      input.onProgress,
    );
    const result = await this.provider.planCharacters({
      novelId: plan.novelId,
      operationId: plan.operationId,
      brief,
      storyBible,
      arcs: plan.arcs,
      planningMode: plan.planningMode,
      baseline: promptBaseline(plan.baseline),
      signal: input.signal,
    });
    plan = addResult(
      {
        ...plan,
        characters: buildCharacters(brief.targetChapterCount, result.value, this.createId),
        progress: { ...plan.progress, lastCheckpoint: '人物成长弧线已生成' },
      },
      'character_evolution',
      result,
      this.now(),
    );
    return this.save(plan, input.onProgress);
  }

  private async generateDimensions(
    plan: AutonomousStoryPlan,
    input: GenerateAutonomousPlanInput & { operationId: string },
  ): Promise<AutonomousStoryPlan> {
    if (!plan.storyBible) throw new Error('创作维度规划前缺少故事圣经。');
    const storyBible = plan.storyBible;
    const brief = generationBrief(plan);
    const missing = [
      plan.worldElements.length === 0 ? 'world_builder' : null,
      plan.conflicts.length === 0 ? 'conflict_generator' : null,
      plan.pacingCurve.length === 0 ? 'pacing_controller' : null,
    ].filter((agent): agent is AutonomousAgentType => Boolean(agent));
    if (missing.length === 0) return plan;

    for (const agent of missing) plan = updateRun(plan, agent, { status: 'running' }, this.now());
    plan = await this.save(plan, input.onProgress);

    const jobs: Array<
      Promise<{
        agent: AutonomousAgentType;
        result: AutonomousProviderResult<unknown>;
        value: unknown;
      }>
    > = [];
    if (missing.includes('world_builder')) {
      jobs.push(
        this.provider
          .buildWorld({
            novelId: plan.novelId,
            operationId: plan.operationId,
            brief,
            storyBible,
            arcs: plan.arcs,
            volumes: plan.volumes,
            planningMode: plan.planningMode,
            baseline: promptBaseline(plan.baseline),
            signal: input.signal,
          })
          .then((result) => ({
            agent: 'world_builder',
            result,
            value: buildWorldElements(brief.targetChapterCount, result.value, this.createId),
          })),
      );
    }
    if (missing.includes('conflict_generator')) {
      jobs.push(
        this.provider
          .generateConflicts({
            novelId: plan.novelId,
            operationId: plan.operationId,
            brief,
            storyBible,
            arcs: plan.arcs,
            volumes: plan.volumes,
            characters: plan.characters,
            planningMode: plan.planningMode,
            baseline: promptBaseline(plan.baseline),
            signal: input.signal,
          })
          .then((result) => ({
            agent: 'conflict_generator',
            result,
            value: buildConflicts(brief.targetChapterCount, result.value, this.createId),
          })),
      );
    }
    if (missing.includes('pacing_controller')) {
      jobs.push(
        this.provider
          .controlPacing({
            novelId: plan.novelId,
            operationId: plan.operationId,
            brief,
            storyBible,
            arcs: plan.arcs,
            volumes: plan.volumes,
            planningMode: plan.planningMode,
            baseline: promptBaseline(plan.baseline),
            signal: input.signal,
          })
          .then((result) => ({
            agent: 'pacing_controller',
            result,
            value: buildPacing(plan.arcs, result.value, this.createId),
          })),
      );
    }

    const settled = await Promise.allSettled(jobs);
    let failure: unknown;
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index];
      const agent = missing[index];
      if (item.status === 'rejected') {
        failure ??= item.reason;
        plan = updateRun(
          plan,
          agent,
          { status: 'failed', errorMessage: errorMessage(item.reason) },
          this.now(),
        );
        continue;
      }
      plan = addResult(plan, item.value.agent, item.value.result, this.now());
      if (item.value.agent === 'world_builder')
        plan = { ...plan, worldElements: item.value.value as AutonomousStoryPlan['worldElements'] };
      if (item.value.agent === 'conflict_generator')
        plan = { ...plan, conflicts: item.value.value as AutonomousStoryPlan['conflicts'] };
      if (item.value.agent === 'pacing_controller') {
        const pacing = item.value.value as ReturnType<typeof buildPacing>;
        plan = { ...plan, pacingPhases: pacing.phases, pacingCurve: pacing.curve };
      }
    }
    plan = {
      ...plan,
      progress: {
        ...plan.progress,
        lastCheckpoint: failure
          ? '部分创作 Agent 失败，成功结果已保存'
          : '人物、世界、冲突与节奏计划已完成',
      },
    };
    plan = await this.save(plan, input.onProgress);
    if (failure) throw failure;
    return plan;
  }

  private async generateChapterBatches(
    plan: AutonomousStoryPlan,
    input: GenerateAutonomousPlanInput & { operationId: string },
  ): Promise<AutonomousStoryPlan> {
    if (!plan.storyBible) throw new Error('章节批次规划前缺少故事圣经。');
    const storyBible = plan.storyBible;
    const brief = generationBrief(plan);
    assertResumableChapterCheckpoint(plan);
    for (const volume of plan.volumes) {
      const ranges = chapterBatchRanges(volume);
      const volumeAlreadyComplete = ranges.every(
        (range) => chaptersInRange(plan.chapters, range).length === rangeChapterCount(range),
      );
      if (volumeAlreadyComplete) {
        if (!plan.progress.completedVolumeIds.includes(volume.id)) {
          plan = await this.save(
            {
              ...plan,
              stage: 'chapter_batches',
              progress: {
                ...plan.progress,
                completedVolumeIds: [...plan.progress.completedVolumeIds, volume.id],
                currentVolumeIndex: volume.index + 1,
                lastCheckpoint: `${volume.title} 的全部章节计划已保存`,
              },
            },
            input.onProgress,
          );
        }
        continue;
      }
      if (plan.progress.completedVolumeIds.includes(volume.id)) {
        throw new Error(`${volume.title} 的完成状态与章节检查点不一致。`);
      }

      for (const [rangeIndex, range] of ranges.entries()) {
        const saved = chaptersInRange(plan.chapters, range);
        if (saved.length === rangeChapterCount(range)) continue;

        const batchVolume: AutonomousVolumePlan = {
          ...volume,
          chapterStart: range.chapterStart,
          chapterEnd: range.chapterEnd,
        };
        plan = updateRun(plan, 'chapter_batch_planner', { status: 'running' }, this.now());
        plan = await this.save(
          {
            ...plan,
            stage: 'chapter_batches',
            progress: {
              ...plan.progress,
              currentVolumeIndex: volume.index,
              lastCheckpoint: `正在展开 ${volume.title} 第 ${range.chapterStart}-${range.chapterEnd} 章`,
            },
          },
          input.onProgress,
        );
        const result = await this.provider.planChapterBatch({
          novelId: plan.novelId,
          operationId: plan.operationId,
          brief,
          storyBible,
          volume: batchVolume,
          arcs: plan.arcs.filter((arc) => volume.arcIds.includes(arc.id)),
          characters: plan.characters,
          worldElements: plan.worldElements.filter(
            (item) =>
              item.firstChapter >= range.chapterStart && item.firstChapter <= range.chapterEnd,
          ),
          conflicts: plan.conflicts.filter(
            (item) =>
              item.introducedChapter <= range.chapterEnd &&
              item.resolutionChapter >= range.chapterStart,
          ),
          pacingPoints: plan.pacingCurve.filter(
            (item) =>
              item.chapterNumber >= range.chapterStart && item.chapterNumber <= range.chapterEnd,
          ),
          planningMode: plan.planningMode,
          baseline: promptBaseline(plan.baseline),
          previousChapters: continuityAnchors(plan, range.chapterStart),
          signal: input.signal,
        });
        const chapters = buildChapterBatch({
          brief,
          volume: batchVolume,
          arcs: plan.arcs,
          characters: plan.characters,
          worldElements: plan.worldElements,
          conflicts: plan.conflicts,
          pacingCurve: plan.pacingCurve,
          proposals: result.value,
          createId: this.createId,
        });
        const volumeCompleted = rangeIndex === ranges.length - 1;
        plan = addResult(
          {
            ...plan,
            chapters: [...plan.chapters, ...chapters].sort(
              (left, right) => left.chapterNumber - right.chapterNumber,
            ),
            progress: {
              ...plan.progress,
              completedVolumeIds: volumeCompleted
                ? [...plan.progress.completedVolumeIds, volume.id]
                : plan.progress.completedVolumeIds,
              currentVolumeIndex: volumeCompleted ? volume.index + 1 : volume.index,
              lastCheckpoint: volumeCompleted
                ? `${volume.title} 的全部章节计划已保存`
                : `${volume.title} 第 ${range.chapterStart}-${range.chapterEnd} 章计划已保存`,
            },
          },
          'chapter_batch_planner',
          result,
          this.now(),
        );
        plan = await this.save(plan, input.onProgress);
      }
    }
    return plan;
  }
}
