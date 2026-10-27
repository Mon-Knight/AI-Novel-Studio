/**
 * Pure mapping from validated native chapter-workflow stage facts to the
 * read-only `ChapterStage` tree DTO.
 *
 * Hierarchy is never inferred from `stageKey`, titles, timestamps, or arrival
 * order. `sceneNo` / `beatOrder` are looked up only in an explicit Scene/Beat
 * plan mapping built by `buildChapterStagePlanMapping`; stages whose Scene or
 * Beat identity is not proven by that mapping are emitted without hierarchy and
 * therefore land in the tree's `unscoped` section.
 *
 * Native `chapter_assemble` success is not a chapter candidate. A completed
 * `chapter_candidate` node exists only when a valid `chapter_text` artifact in
 * the current scope is supplied as evidence, and only that real artifact id is
 * used as its locate anchor. `resultDocumentId` is a large-text document id,
 * never an Artifact id.
 */
import type {
  ChapterWorkflowStageKind,
  ChapterWorkflowStageView,
} from '../../types/chapterWorkflowStage';
import type {
  ChapterStage,
  ChapterStageAnchor,
  ChapterStageKind,
  ChapterStageStatus,
} from './chapterStageProjection';

const INTERRUPTED_ERROR_CODE = 'WORKFLOW_INTERRUPTED';

export interface ChapterStagePlanScene {
  readonly sceneId: string;
  readonly sceneNo: number;
  readonly title?: string;
}

export interface ChapterStagePlanBeat {
  readonly sceneId: string;
  readonly beatId: string;
  readonly beatOrder: number;
}

export interface ChapterStagePlanMapping {
  readonly scenes: readonly ChapterStagePlanScene[];
  readonly beats: readonly ChapterStagePlanBeat[];
}

/** Structural shape of a Scene-only plan item; extra fields are ignored. */
export interface ScenePlanMappingSource {
  readonly id: string;
  readonly sceneNo: number;
  readonly title?: string;
  readonly beats?: readonly { readonly id: string; readonly order: number }[];
}

/** Structural shape of one Scene's generated Beat plan. */
export interface BeatPlanMappingSource {
  readonly sceneId: string;
  readonly beats: readonly { readonly id: string; readonly order: number }[];
}

export interface ChapterStageTreeMappingScope {
  readonly novelId: string;
  readonly chapterId: string;
  readonly conversationId?: string;
  readonly workflowId?: string;
  readonly runId?: string;
}

export interface ChapterCandidateEvidence {
  /** Existing conversation artifact card id used by Workbench locate; never the raw artifactId. */
  readonly cardId: string;
  readonly conversationId: string;
  /** Card turn id; for this workflow it equals the workflow id. */
  readonly turnId: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly artifactType: 'chapter_text';
  readonly processingStatus: 'valid' | 'valid_with_warnings';
  readonly novelId: string;
  readonly chapterId: string;
}

/** Structural subset of `ConversationArtifactCard`; no UI type is imported. */
export interface ChapterCandidateArtifactCardInput {
  readonly cardId?: string;
  readonly artifactId?: string;
  readonly artifactType: string;
  readonly conversationId?: string;
  readonly turnId?: string;
  readonly runId?: string;
  readonly artifactEvidence?: {
    readonly sourceNovelId?: string;
    readonly sourceChapterId?: string;
    readonly processingStatus?: string;
  };
}

export interface ChapterStageTreeMappingOptions {
  readonly scope: ChapterStageTreeMappingScope;
  /** Explicit validated Scene/Beat id mapping; without it scoped stages stay unscoped. */
  readonly plan?: ChapterStagePlanMapping;
  /** Valid chapter_text artifact cards from the current conversation/chapter. */
  readonly candidateEvidence?: readonly ChapterCandidateEvidence[];
}

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function positiveInteger(value: number): number | undefined {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function sourceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空标识`);
  }
  return value.trim();
}

function sourcePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} 必须是正整数`);
  }
  return value;
}

/**
 * Builds the explicit, validated Scene/Beat id mapping. Duplicate scene ids,
 * duplicate scene numbers, duplicate beat ids/orders, or beats referencing an
 * unknown scene fail closed instead of silently picking one row.
 */
export function buildChapterStagePlanMapping(
  scenes: readonly ScenePlanMappingSource[],
  beatPlans: readonly BeatPlanMappingSource[] = [],
): ChapterStagePlanMapping {
  const mappedScenes: ChapterStagePlanScene[] = [];
  const sceneById = new Map<string, ChapterStagePlanScene>();
  const sceneNoOwner = new Map<number, string>();
  const pendingBeats: Array<{
    sceneId: string;
    beats: readonly { readonly id: string; readonly order: number }[];
  }> = [];

  for (const source of scenes) {
    const sceneId = sourceId(source?.id, 'Scene id');
    if (sceneById.has(sceneId)) throw new Error(`Scene ID 重复：${sceneId}`);
    const sceneNo = sourcePositiveInteger(source.sceneNo, `Scene ${sceneId} 的 sceneNo`);
    const owner = sceneNoOwner.get(sceneNo);
    if (owner) throw new Error(`Scene 序号 ${sceneNo} 同时属于 ${owner} 与 ${sceneId}`);
    const title = cleanText(source.title);
    const scene: ChapterStagePlanScene = {
      sceneId,
      sceneNo,
      ...(title ? { title } : {}),
    };
    sceneById.set(sceneId, scene);
    sceneNoOwner.set(sceneNo, sceneId);
    mappedScenes.push(scene);
    pendingBeats.push({ sceneId, beats: source.beats ?? [] });
  }

  const mappedBeats: ChapterStagePlanBeat[] = [];
  const beatKeys = new Set<string>();
  const beatOrderOwners = new Map<string, Map<number, string>>();
  const addBeats = (
    sceneId: string,
    beats: readonly { readonly id: string; readonly order: number }[],
  ): void => {
    let orders = beatOrderOwners.get(sceneId);
    if (!orders) {
      orders = new Map<number, string>();
      beatOrderOwners.set(sceneId, orders);
    }
    for (const beat of beats) {
      const beatId = sourceId(beat?.id, `Scene ${sceneId} 的 Beat id`);
      const beatOrder = sourcePositiveInteger(beat.order, `Beat ${beatId} 的 order`);
      const key = `${sceneId}\u0000${beatId}`;
      if (beatKeys.has(key)) throw new Error(`Scene ${sceneId} 的 Beat ID 重复：${beatId}`);
      const orderOwner = orders.get(beatOrder);
      if (orderOwner) {
        throw new Error(
          `Scene ${sceneId} 的 Beat 序号 ${beatOrder} 同时属于 ${orderOwner} 与 ${beatId}`,
        );
      }
      beatKeys.add(key);
      orders.set(beatOrder, beatId);
      mappedBeats.push({ sceneId, beatId, beatOrder });
    }
  };

  for (const entry of pendingBeats) addBeats(entry.sceneId, entry.beats);
  for (const source of beatPlans) {
    const sceneId = sourceId(source?.sceneId, 'Beat plan 的 sceneId');
    if (!sceneById.has(sceneId)) throw new Error(`Beat plan 引用了未知 Scene：${sceneId}`);
    addBeats(sceneId, source.beats ?? []);
  }

  return { scenes: mappedScenes, beats: mappedBeats };
}

/** Extracts tree evidence only from fully-scoped valid `chapter_text` artifact cards. */
export function chapterCandidateEvidenceFromCards(
  cards: readonly ChapterCandidateArtifactCardInput[],
): ChapterCandidateEvidence[] {
  const result: ChapterCandidateEvidence[] = [];
  for (const card of cards) {
    const item = chapterCandidateEvidenceFromCard(card);
    if (item) result.push(item);
  }
  return result;
}

/**
 * Extracts tree evidence only from a fully-scoped valid `chapter_text` artifact
 * card. A card without cardId/conversation/turn/run identity is not evidence.
 */
export function chapterCandidateEvidenceFromCard(
  card: ChapterCandidateArtifactCardInput,
): ChapterCandidateEvidence | undefined {
  const cardId = cleanText(card.cardId);
  const artifactId = cleanText(card.artifactId);
  const conversationId = cleanText(card.conversationId);
  const turnId = cleanText(card.turnId);
  const runId = cleanText(card.runId);
  const evidence = card.artifactEvidence;
  if (
    !cardId ||
    !artifactId ||
    !conversationId ||
    !turnId ||
    !runId ||
    card.artifactType !== 'chapter_text' ||
    !evidence
  ) {
    return undefined;
  }
  const novelId = cleanText(evidence.sourceNovelId);
  const chapterId = cleanText(evidence.sourceChapterId);
  const processingStatus = evidence.processingStatus;
  if (!novelId || !chapterId) return undefined;
  if (processingStatus !== 'valid' && processingStatus !== 'valid_with_warnings') return undefined;
  return {
    cardId,
    conversationId,
    turnId,
    runId,
    artifactId,
    artifactType: 'chapter_text',
    processingStatus,
    novelId,
    chapterId,
  };
}

const TREE_KIND: Readonly<
  Record<Exclude<ChapterWorkflowStageKind, 'chapter_assemble'>, ChapterStageKind>
> = {
  scene_plan: 'scene_plan',
  beat_plan: 'beat_plan',
  beat_write: 'beat_prose',
  beat_state: 'scene_state',
  scene_close: 'scene_complete',
};

function mappedStatus(stage: ChapterWorkflowStageView): ChapterStageStatus {
  switch (stage.status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return stage.errorCode === INTERRUPTED_ERROR_CODE ? 'interrupted' : 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/**
 * Workbench locate targets an existing artifact card id, not an artifact id.
 * Intermediate verified artifacts usually have no card, so they fall back to
 * their run. `resultDocumentId` is never consulted here.
 */
function mappedAnchor(
  stage: ChapterWorkflowStageView,
  cardIdByArtifactId: ReadonlyMap<string, string>,
): ChapterStageAnchor | undefined {
  const verifiedArtifactId = cleanText(stage.verifiedArtifactId);
  const cardId = verifiedArtifactId ? cardIdByArtifactId.get(verifiedArtifactId) : undefined;
  if (cardId) return { kind: 'artifact', id: cardId };
  const runId = cleanText(stage.runId);
  return runId ? { kind: 'run', id: runId } : undefined;
}

function baseRow(
  stage: ChapterWorkflowStageView,
  kind: ChapterStageKind,
  cardIdByArtifactId: ReadonlyMap<string, string>,
): ChapterStage {
  const anchor = mappedAnchor(stage, cardIdByArtifactId);
  return {
    stageId: stage.stageId,
    kind,
    status: mappedStatus(stage),
    ...(positiveInteger(stage.attempt) ? { attempt: stage.attempt } : {}),
    ...(anchor ? { anchor } : {}),
    persistence: 'sqlite',
  };
}

interface PlanLookup {
  readonly scenes: ReadonlyMap<string, ChapterStagePlanScene>;
  readonly beats: ReadonlyMap<string, ChapterStagePlanBeat>;
}

function planLookup(plan: ChapterStagePlanMapping | undefined): PlanLookup {
  const scenes = new Map<string, ChapterStagePlanScene>();
  const beats = new Map<string, ChapterStagePlanBeat>();
  for (const scene of plan?.scenes ?? []) {
    const sceneId = cleanText(scene.sceneId);
    const sceneNo = positiveInteger(scene.sceneNo);
    if (!sceneId || sceneNo === undefined || scenes.has(sceneId)) continue;
    const title = cleanText(scene.title);
    scenes.set(sceneId, { sceneId, sceneNo, ...(title ? { title } : {}) });
  }
  for (const beat of plan?.beats ?? []) {
    const sceneId = cleanText(beat.sceneId);
    const beatId = cleanText(beat.beatId);
    const beatOrder = positiveInteger(beat.beatOrder);
    if (!sceneId || !beatId || beatOrder === undefined || !scenes.has(sceneId)) continue;
    const key = `${sceneId}\u0000${beatId}`;
    if (!beats.has(key)) beats.set(key, { sceneId, beatId, beatOrder });
  }
  return { scenes, beats };
}

function sceneRow(
  stage: ChapterWorkflowStageView,
  kind: ChapterStageKind,
  lookup: PlanLookup,
  cardIdByArtifactId: ReadonlyMap<string, string>,
): ChapterStage | undefined {
  const sceneId = cleanText(stage.sceneId);
  const scene = sceneId ? lookup.scenes.get(sceneId) : undefined;
  if (!scene) return undefined;
  return {
    ...baseRow(stage, kind, cardIdByArtifactId),
    sceneId: scene.sceneId,
    sceneNo: scene.sceneNo,
  };
}

function beatRow(
  stage: ChapterWorkflowStageView,
  kind: ChapterStageKind,
  lookup: PlanLookup,
  cardIdByArtifactId: ReadonlyMap<string, string>,
): ChapterStage | undefined {
  const sceneId = cleanText(stage.sceneId);
  const beatId = cleanText(stage.beatId);
  if (!sceneId || !beatId) return undefined;
  const scene = lookup.scenes.get(sceneId);
  const beat = lookup.beats.get(`${sceneId}\u0000${beatId}`);
  if (!scene || !beat) return undefined;
  return {
    ...baseRow(stage, kind, cardIdByArtifactId),
    sceneId: scene.sceneId,
    sceneNo: scene.sceneNo,
    beatId: beat.beatId,
    beatOrder: beat.beatOrder,
  };
}

/**
 * Evidence is only trusted when it proves the full current scope: conversation,
 * user turn/workflow (and the optional run filter). A valid chapter card from
 * another task or turn can never complete this tree.
 */
function evidenceMatchesScope(
  evidence: ChapterCandidateEvidence,
  scope: ChapterStageTreeMappingScope,
): boolean {
  if (!scope.conversationId || !scope.workflowId) return false;
  const cardId = cleanText(evidence.cardId);
  const novelId = cleanText(evidence.novelId);
  const chapterId = cleanText(evidence.chapterId);
  const conversationId = cleanText(evidence.conversationId);
  const turnId = cleanText(evidence.turnId);
  const runId = cleanText(evidence.runId);
  const artifactId = cleanText(evidence.artifactId);
  if (!cardId || !novelId || !chapterId || !conversationId || !turnId || !runId || !artifactId) {
    return false;
  }
  if (novelId !== scope.novelId || chapterId !== scope.chapterId) return false;
  if (conversationId !== scope.conversationId || turnId !== scope.workflowId) return false;
  if (scope.runId && runId !== scope.runId) return false;
  if (evidence.artifactType !== 'chapter_text') return false;
  if (
    evidence.processingStatus !== 'valid' &&
    evidence.processingStatus !== 'valid_with_warnings'
  ) {
    return false;
  }
  return true;
}

function candidateRows(evidence: readonly ChapterCandidateEvidence[]): ChapterStage[] {
  const rows: ChapterStage[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    const cardId = cleanText(item.cardId);
    const artifactId = cleanText(item.artifactId);
    if (!cardId || !artifactId || seen.has(cardId)) continue;
    seen.add(cardId);
    rows.push({
      stageId: `chapter-candidate:${cardId}`,
      kind: 'chapter_candidate',
      status: 'completed',
      anchor: { kind: 'artifact', id: cardId },
      persistence: 'sqlite',
    });
  }
  return rows;
}

/**
 * Converts validated native facts to tree rows. Rows missing a proven Scene or
 * Beat mapping intentionally carry no hierarchy and are rendered under
 * `unscoped`. `chapter_assemble` rows are never converted into candidates.
 */
export function mapChapterWorkflowStagesToTree(
  stages: readonly ChapterWorkflowStageView[],
  options: ChapterStageTreeMappingOptions,
): ChapterStage[] {
  const lookup = planLookup(options.plan);
  const evidence = (options.candidateEvidence ?? []).filter((item) =>
    evidenceMatchesScope(item, options.scope),
  );
  const cardIdByArtifactId = new Map<string, string>();
  for (const item of evidence) {
    const artifactId = cleanText(item.artifactId);
    const cardId = cleanText(item.cardId);
    if (artifactId && cardId && !cardIdByArtifactId.has(artifactId)) {
      cardIdByArtifactId.set(artifactId, cardId);
    }
  }
  const rows: ChapterStage[] = [];
  for (const stage of stages) {
    if (stage.stageKind === 'chapter_assemble') continue;
    if (stage.stageKind === 'scene_plan') {
      rows.push(baseRow(stage, TREE_KIND.scene_plan, cardIdByArtifactId));
      continue;
    }
    if (stage.stageKind === 'beat_plan') {
      rows.push(
        sceneRow(stage, TREE_KIND.beat_plan, lookup, cardIdByArtifactId) ??
          baseRow(stage, TREE_KIND.beat_plan, cardIdByArtifactId),
      );
      continue;
    }
    if (stage.stageKind === 'beat_write') {
      rows.push(
        beatRow(stage, TREE_KIND.beat_write, lookup, cardIdByArtifactId) ??
          baseRow(stage, TREE_KIND.beat_write, cardIdByArtifactId),
      );
      continue;
    }
    if (stage.stageKind === 'beat_state') {
      rows.push(
        beatRow(stage, TREE_KIND.beat_state, lookup, cardIdByArtifactId) ??
          baseRow(stage, TREE_KIND.beat_state, cardIdByArtifactId),
      );
      continue;
    }
    rows.push(
      sceneRow(stage, TREE_KIND.scene_close, lookup, cardIdByArtifactId) ??
        baseRow(stage, TREE_KIND.scene_close, cardIdByArtifactId),
    );
  }
  rows.push(...candidateRows(evidence));
  return rows;
}
