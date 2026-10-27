/**
 * Read-only projection for the chapter Scene/Beat progress tree.
 *
 * The projection deliberately uses only explicit identity fields from the
 * caller (`stageId`, `sceneId/sceneNo`, `beatId/beatOrder`) and never guesses
 * hierarchy from tool names, timestamps, titles, or arrival order. Recorded
 * stages remain presentation facts only; this module grants no write or
 * adoption authority.
 */

export type ChapterStagePersistence = 'sqlite' | 'browser' | 'none';

export type ChapterStageStatus =
  'not_recorded' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type ChapterStageKind =
  | 'chapter_materials'
  | 'scene_plan'
  | 'scene'
  | 'beat_plan'
  | 'beat_prose'
  | 'scene_state'
  | 'scene_complete'
  | 'chapter_candidate';

export interface ChapterStageAnchor {
  readonly kind: 'run' | 'tool' | 'artifact';
  readonly id: string;
}

/**
 * A narrow, read-only stage DTO. It contains labels and identity only. Full
 * prose, prompts, model reasoning, and hidden tool payloads are not accepted.
 */
export interface ChapterStage {
  readonly stageId: string;
  readonly kind: ChapterStageKind;
  readonly status: ChapterStageStatus;
  readonly sceneId?: string;
  readonly sceneNo?: number;
  readonly beatId?: string;
  readonly beatOrder?: number;
  readonly title?: string;
  readonly attempt?: number;
  readonly revision?: string;
  readonly anchor?: ChapterStageAnchor;
  /** Missing evidence is treated as `none`, never as a completed stage. */
  readonly persistence?: ChapterStagePersistence;
}

/** Explicit scene shell for scenes whose Beats have not been planned yet. */
export interface ChapterFutureScene {
  readonly sceneId: string;
  readonly sceneNo: number;
  readonly title?: string;
}

export type ChapterStagePersistenceSummary = 'sqlite' | 'browser' | 'mixed' | 'none';

/** `partial` means some recorded steps exist but the scene is not complete. */
export type ChapterSceneStatus = ChapterStageStatus | 'partial';

export interface ChapterStageRow {
  readonly stageId: string;
  readonly kind: ChapterStageKind;
  readonly label: string;
  readonly status: ChapterStageStatus;
  readonly attempt?: number;
  readonly revision?: string;
  readonly anchor?: ChapterStageAnchor;
  readonly persistence: ChapterStagePersistence;
}

export interface ChapterBeatProjection {
  readonly beatId: string;
  readonly beatOrder: number;
  readonly status: ChapterStageStatus;
  readonly prose: readonly ChapterStageRow[];
}

export interface ChapterSceneProjection {
  readonly sceneId: string;
  readonly sceneNo?: number;
  readonly title: string;
  readonly future: boolean;
  readonly status: ChapterSceneStatus;
  readonly sceneRows: readonly ChapterStageRow[];
  readonly beatPlanRows: readonly ChapterStageRow[];
  readonly beats: readonly ChapterBeatProjection[];
  readonly stateRows: readonly ChapterStageRow[];
  readonly completionRows: readonly ChapterStageRow[];
  readonly beatsPlanned: boolean;
  readonly anchor?: ChapterStageAnchor;
}

export interface ChapterStageProjection {
  readonly chapterMaterials: readonly ChapterStageRow[];
  readonly scenePlan: readonly ChapterStageRow[];
  readonly scenes: readonly ChapterSceneProjection[];
  readonly chapterCandidate: readonly ChapterStageRow[];
  /** Scene-scoped stages that carry neither sceneId nor sceneNo. */
  readonly unscoped: readonly ChapterStageRow[];
  readonly persistence: ChapterStagePersistenceSummary;
  readonly defaultExpandedSceneIds: readonly string[];
}

const STAGE_LABELS: Record<ChapterStageKind, string> = {
  chapter_materials: '章节资料准备',
  scene_plan: 'Scene 规划',
  scene: 'Scene',
  beat_plan: 'Beat 规划',
  beat_prose: '正文',
  scene_state: '实际状态归纳',
  scene_complete: '场景完成',
  chapter_candidate: '完整章节候选',
};

const SCENE_SCOPED_KINDS: ReadonlySet<ChapterStageKind> = new Set([
  'scene',
  'beat_plan',
  'beat_prose',
  'scene_state',
  'scene_complete',
]);

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function cleanNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function effectivePersistence(stage: ChapterStage): ChapterStagePersistence {
  return stage.persistence ?? 'none';
}

/**
 * A completed label without persistence evidence is downgraded. This prevents
 * a synthetic or browser-only state from being rendered as a durable SQLite
 * completion.
 */
function effectiveStatus(stage: ChapterStage): ChapterStageStatus {
  if (stage.status === 'completed' && effectivePersistence(stage) === 'none') {
    return 'not_recorded';
  }
  return stage.status;
}

function attemptNumber(stage: ChapterStage): number {
  return cleanNumber(stage.attempt) ?? 0;
}

function compareStages(left: ChapterStage, right: ChapterStage): number {
  return attemptNumber(left) - attemptNumber(right) || left.stageId.localeCompare(right.stageId);
}

function stageLabel(stage: ChapterStage): string {
  return cleanText(stage.title) ?? STAGE_LABELS[stage.kind];
}

function toRow(stage: ChapterStage, label = stageLabel(stage)): ChapterStageRow {
  return {
    stageId: stage.stageId,
    kind: stage.kind,
    label,
    status: effectiveStatus(stage),
    ...(cleanNumber(stage.attempt) !== undefined ? { attempt: cleanNumber(stage.attempt) } : {}),
    ...(cleanText(stage.revision) ? { revision: cleanText(stage.revision) } : {}),
    ...(stage.anchor ? { anchor: stage.anchor } : {}),
    persistence: effectivePersistence(stage),
  };
}

function sortedRows(stages: readonly ChapterStage[]): ChapterStageRow[] {
  return [...stages].sort(compareStages).map((stage) => toRow(stage));
}

function latest(stages: readonly ChapterStage[]): ChapterStage | undefined {
  const sorted = [...stages].sort(compareStages);
  return sorted[sorted.length - 1];
}

const AUTO_EXPANDED_STATUSES: ReadonlySet<ChapterSceneStatus> = new Set(['running', 'failed']);

function isAutoExpanded(status: ChapterSceneStatus): boolean {
  return AUTO_EXPANDED_STATUSES.has(status);
}

function sceneStatus(
  sceneStages: readonly ChapterStage[],
  beatPlan: readonly ChapterStage[],
  beatStages: readonly ChapterStage[][],
  stateStages: readonly ChapterStage[],
  completionStages: readonly ChapterStage[],
): ChapterSceneStatus {
  const latestCompletion = latest(completionStages);
  const current = [
    latest(sceneStages),
    latest(beatPlan),
    ...beatStages.map((stages) => latest(stages)),
    latest(stateStages),
    latestCompletion,
  ]
    .filter((stage): stage is ChapterStage => Boolean(stage))
    .map(effectiveStatus);
  if (current.includes('running')) return 'running';
  if (current.includes('failed')) return 'failed';
  if (current.includes('interrupted')) return 'interrupted';
  if (current.includes('cancelled')) return 'cancelled';
  if (latestCompletion && effectiveStatus(latestCompletion) === 'completed') {
    return 'completed';
  }
  if (current.includes('completed')) return 'partial';
  if (current.includes('pending')) return 'pending';
  return 'not_recorded';
}

function beatStatus(stages: readonly ChapterStage[]): ChapterStageStatus {
  const current = latest(stages);
  return current ? effectiveStatus(current) : 'not_recorded';
}

interface SceneBucket {
  key: string;
  sceneId?: string;
  sceneNo?: number;
  title?: string;
  future: boolean;
  stages: ChapterStage[];
}

function findBucket(
  buckets: readonly SceneBucket[],
  sceneId: string | undefined,
  sceneNo: number | undefined,
): SceneBucket | undefined {
  if (sceneId) {
    const byId = buckets.find((bucket) => bucket.sceneId === sceneId);
    if (byId) return byId;
  }
  if (sceneNo !== undefined) {
    return buckets.find((bucket) => bucket.sceneNo === sceneNo && !bucket.sceneId);
  }
  return undefined;
}

function seedSceneBucket(
  buckets: SceneBucket[],
  sceneId: string | undefined,
  sceneNo: number | undefined,
  title: string | undefined,
  future: boolean,
): SceneBucket {
  const existing = findBucket(buckets, sceneId, sceneNo);
  if (existing) {
    if (sceneId) existing.sceneId = sceneId;
    if (sceneNo !== undefined) existing.sceneNo = sceneNo;
    if (!existing.title) existing.title = title;
    if (!future) existing.future = false;
    return existing;
  }
  const bucket: SceneBucket = {
    key: sceneId ? 'scene:' + sceneId : 'scene-no:' + String(sceneNo),
    ...(sceneId ? { sceneId } : {}),
    ...(sceneNo !== undefined ? { sceneNo } : {}),
    ...(title ? { title } : {}),
    future,
    stages: [],
  };
  buckets.push(bucket);
  return bucket;
}

function addSceneStage(buckets: SceneBucket[], stage: ChapterStage): SceneBucket | undefined {
  const sceneId = cleanText(stage.sceneId);
  const sceneNo = cleanNumber(stage.sceneNo);
  if (!sceneId && sceneNo === undefined) return undefined;
  const bucket = seedSceneBucket(buckets, sceneId, sceneNo, undefined, false);
  bucket.future = false;
  bucket.stages.push(stage);
  return bucket;
}

function groupBeats(stages: readonly ChapterStage[]): ChapterBeatProjection[] {
  const buckets = new Map<string, ChapterStage[]>();
  for (const stage of stages) {
    const beatId = cleanText(stage.beatId);
    const beatOrder = cleanNumber(stage.beatOrder);
    const key = beatId ? 'beat:' + beatId : 'beat-order:' + String(beatOrder ?? 0);
    const existing = buckets.get(key) ?? [];
    existing.push(stage);
    buckets.set(key, existing);
  }
  return [...buckets.values()]
    .map((beatStages) => {
      const sorted = [...beatStages].sort(compareStages);
      const representative = sorted[sorted.length - 1];
      return {
        beatId:
          cleanText(representative.beatId) ??
          'beat-order:' + String(cleanNumber(representative.beatOrder) ?? 0),
        beatOrder: cleanNumber(representative.beatOrder) ?? 0,
        status: beatStatus(beatStages),
        prose: sortedRows(beatStages),
      };
    })
    .sort(
      (left, right) => left.beatOrder - right.beatOrder || left.beatId.localeCompare(right.beatId),
    );
}

function persistenceSummary(stages: readonly ChapterStage[]): ChapterStagePersistenceSummary {
  let sqlite = false;
  let browser = false;
  for (const stage of stages) {
    if (stage.persistence === 'sqlite') sqlite = true;
    if (stage.persistence === 'browser') browser = true;
  }
  if (sqlite && browser) return 'mixed';
  if (sqlite) return 'sqlite';
  if (browser) return 'browser';
  return 'none';
}

export function projectChapterStageTree(
  stages: readonly ChapterStage[],
  futureScenes: readonly ChapterFutureScene[] = [],
): ChapterStageProjection {
  const buckets: SceneBucket[] = [];
  const chapterMaterials: ChapterStage[] = [];
  const scenePlan: ChapterStage[] = [];
  const chapterCandidate: ChapterStage[] = [];
  const unscoped: ChapterStage[] = [];

  for (const future of futureScenes) {
    const sceneNo = cleanNumber(future.sceneNo);
    seedSceneBucket(buckets, cleanText(future.sceneId), sceneNo, cleanText(future.title), true);
  }

  for (const stage of stages) {
    if (stage.kind === 'chapter_materials') chapterMaterials.push(stage);
    else if (stage.kind === 'scene_plan') scenePlan.push(stage);
    else if (stage.kind === 'chapter_candidate') chapterCandidate.push(stage);
    else if (SCENE_SCOPED_KINDS.has(stage.kind)) {
      if (!addSceneStage(buckets, stage)) unscoped.push(stage);
    }
  }

  const scenes = buckets
    .map((bucket) => {
      const sceneStages = bucket.stages.filter((stage) => stage.kind === 'scene');
      const beatPlan = bucket.stages.filter((stage) => stage.kind === 'beat_plan');
      const beatStages = new Map<string, ChapterStage[]>();
      for (const stage of bucket.stages.filter((entry) => entry.kind === 'beat_prose')) {
        const key = cleanText(stage.beatId)
          ? 'beat:' + cleanText(stage.beatId)
          : 'beat-order:' + String(cleanNumber(stage.beatOrder) ?? 0);
        beatStages.set(key, [...(beatStages.get(key) ?? []), stage]);
      }
      const stateStages = bucket.stages.filter((stage) => stage.kind === 'scene_state');
      const completionStages = bucket.stages.filter((stage) => stage.kind === 'scene_complete');
      const titleStage = [...sceneStages]
        .sort(compareStages)
        .find((stage) => cleanText(stage.title));
      const title =
        cleanText(titleStage?.title) ??
        bucket.title ??
        (bucket.sceneNo !== undefined ? `Scene ${bucket.sceneNo}` : 'Scene');
      const status = bucket.future
        ? 'pending'
        : sceneStatus(
            sceneStages,
            beatPlan,
            [...beatStages.values()],
            stateStages,
            completionStages,
          );
      const anchor =
        [...sceneStages]
          .sort(compareStages)
          .map((stage) => stage.anchor)
          .find((value): value is ChapterStageAnchor => Boolean(value)) ?? undefined;
      return {
        sceneId: bucket.sceneId ?? bucket.key,
        ...(bucket.sceneNo !== undefined ? { sceneNo: bucket.sceneNo } : {}),
        title,
        future: bucket.future,
        status,
        sceneRows: sortedRows(sceneStages),
        beatPlanRows: sortedRows(beatPlan),
        beats: groupBeats(bucket.stages.filter((stage) => stage.kind === 'beat_prose')),
        stateRows: sortedRows(stateStages),
        completionRows: sortedRows(completionStages),
        beatsPlanned: beatPlan.length > 0 || beatStages.size > 0,
        ...(anchor ? { anchor } : {}),
      } satisfies ChapterSceneProjection;
    })
    .sort(
      (left, right) =>
        (left.sceneNo ?? Number.MAX_SAFE_INTEGER) - (right.sceneNo ?? Number.MAX_SAFE_INTEGER) ||
        left.sceneId.localeCompare(right.sceneId),
    );

  return {
    chapterMaterials: sortedRows(chapterMaterials),
    scenePlan: sortedRows(scenePlan),
    scenes,
    chapterCandidate: sortedRows(chapterCandidate),
    unscoped: sortedRows(unscoped),
    persistence: persistenceSummary(stages),
    defaultExpandedSceneIds: scenes
      .filter((scene) => isAutoExpanded(scene.status))
      .map((scene) => scene.sceneId),
  };
}
