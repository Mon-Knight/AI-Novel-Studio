import type {
  ArtifactDecision,
  ConversationArtifactCard,
  ConversationTurn,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';
import {
  chapterAssetReadinessService,
  isCoreAssetGenerationGoal,
  type ChapterAssetOrchestration,
  type ChapterAssetReadinessResult,
  type ChapterAssetRecovery,
  type ChapterCoreAsset,
} from './chapterAssetReadiness';
import { taskConversationService } from './taskConversationService';
import { classifyTaskIntent } from './taskGoalRouting';
import { decodeWorkbenchTurnContent } from './workbenchTurnOrigin';

const CORE_ASSET_ORDER: ChapterCoreAsset[] = [
  'world_setting',
  'rule_system',
  'protagonist',
  'story_plan',
  'chapter_outline',
];

const CORE_ASSET_ARTIFACT_TYPE: Record<ChapterCoreAsset, string> = {
  story_plan: 'outline',
  world_setting: 'setting_candidates',
  rule_system: 'setting_candidates',
  protagonist: 'character_candidates',
  chapter_outline: 'outline',
};

interface RecoveryPersistenceDependencies {
  getConversation?: typeof taskConversationService.get;
  appendTurn?: typeof taskConversationService.appendTurn;
  inspectReadiness?: typeof chapterAssetReadinessService.inspect;
  now?: () => string;
}

interface RecoverPersistedChapterAssetInput {
  conversationId: string;
  preferredChapterId?: string;
}

interface EnsurePersistedChapterGoalTurnInput {
  conversationId: string;
  goal: string;
}

interface ResolvePreflightAssetPreparationRetryTurnInput {
  conversationId: string;
  asset: ChapterCoreAsset;
  goal: string;
  orchestration: Pick<ChapterAssetOrchestration, 'errorCode' | 'preparationTurnId'>;
}

export class PreflightAssetPreparationTurnError extends Error {
  readonly code = 'MODEL_TOOL_CALLING_NOT_VERIFIED';

  constructor(message: string) {
    super(message);
    this.name = 'PreflightAssetPreparationTurnError';
  }
}

function orderedTurns(bundle: TaskConversationBundle): ConversationTurn[] {
  return bundle.turns
    .map((turn, index) => ({ turn, index }))
    .sort((left, right) => left.turn.sequence - right.turn.sequence || left.index - right.index)
    .map(({ turn }) => turn);
}

function latestByCreatedAt<T>(items: T[], readCreatedAt: (item: T) => string): T | undefined {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        readCreatedAt(left.item).localeCompare(readCreatedAt(right.item)) ||
        left.index - right.index,
    );
  return ordered[ordered.length - 1]?.item;
}

function humanGoal(turn: ConversationTurn): string | null {
  if (turn.role !== 'user') return null;
  const decoded = decodeWorkbenchTurnContent(turn.content);
  if (decoded.origin) return null;
  const goal = decoded.content.trim();
  return goal || null;
}

function hasRun(bundle: TaskConversationBundle, turn: ConversationTurn): boolean {
  return Boolean(turn.runId || bundle.runs.some((run) => run.turnId === turn.turnId));
}

export async function resolvePreflightAssetPreparationRetryTurn(
  input: ResolvePreflightAssetPreparationRetryTurnInput,
  deps: RecoveryPersistenceDependencies = {},
): Promise<ConversationTurn | undefined> {
  const preparationTurnId = input.orchestration.preparationTurnId?.trim();
  if (input.orchestration.errorCode !== 'MODEL_TOOL_CALLING_NOT_VERIFIED') {
    return undefined;
  }
  if (!preparationTurnId) {
    throw new PreflightAssetPreparationTurnError(
      '无法复用自动准备回合：预检失败记录缺少原准备回合身份。',
    );
  }

  const getConversation = deps.getConversation ?? taskConversationService.get;
  const bundle = await getConversation(input.conversationId);
  if (!bundle || bundle.conversation.conversationId !== input.conversationId) {
    throw new PreflightAssetPreparationTurnError('无法复用自动准备回合：任务对话身份不匹配。');
  }
  const matchingTurns = bundle.turns.filter((turn) => turn.turnId === preparationTurnId);
  if (matchingTurns.length !== 1) {
    throw new PreflightAssetPreparationTurnError(
      '无法复用自动准备回合：原准备回合不存在或身份不唯一。',
    );
  }

  const turn = matchingTurns[0];
  const decoded = decodeWorkbenchTurnContent(turn.content);
  if (
    turn.conversationId !== input.conversationId ||
    turn.role !== 'user' ||
    decoded.origin !== 'workbench_asset_preparation'
  ) {
    throw new PreflightAssetPreparationTurnError('无法复用自动准备回合：原准备回合身份不匹配。');
  }

  const expectedGoal = input.goal.trim();
  if (
    !expectedGoal ||
    decoded.content.trim() !== expectedGoal ||
    resolvePreparationAsset(turn) !== input.asset
  ) {
    throw new PreflightAssetPreparationTurnError(
      '无法复用自动准备回合：准备资产或创作目标不匹配。',
    );
  }
  if (hasRun(bundle, turn)) {
    throw new PreflightAssetPreparationTurnError('无法复用自动准备回合：该回合已经存在运行记录。');
  }
  return turn;
}

export function findLatestRecoverableChapterGoal(
  bundle: TaskConversationBundle,
): { turn: ConversationTurn; goal: string } | null {
  const humanTurns = orderedTurns(bundle)
    .map((turn) => ({ turn, goal: humanGoal(turn) }))
    .filter((item): item is { turn: ConversationTurn; goal: string } => Boolean(item.goal));
  const latestHumanTurn = humanTurns[humanTurns.length - 1];
  if (
    !latestHumanTurn ||
    hasRun(bundle, latestHumanTurn.turn) ||
    classifyTaskIntent(latestHumanTurn.goal) !== 'chapter_write'
  ) {
    return null;
  }
  return latestHumanTurn;
}

function resolvePreparationAsset(turn: ConversationTurn): ChapterCoreAsset | undefined {
  const decoded = decodeWorkbenchTurnContent(turn.content);
  if (decoded.origin !== 'workbench_asset_preparation') return undefined;
  const goal = decoded.content.trim();
  return CORE_ASSET_ORDER.find((asset) => isCoreAssetGenerationGoal(goal, asset));
}

function latestPreparationTurn(
  bundle: TaskConversationBundle,
  sourceTurn: ConversationTurn,
  asset: ChapterCoreAsset,
): ConversationTurn | undefined {
  const turns = orderedTurns(bundle).filter(
    (turn) => turn.sequence > sourceTurn.sequence && resolvePreparationAsset(turn) === asset,
  );
  return turns[turns.length - 1];
}

function latestRunForTurn(bundle: TaskConversationBundle, turnId: string): TaskRun | undefined {
  return latestByCreatedAt(
    bundle.runs.filter((run) => run.turnId === turnId),
    (run) => run.createdAt,
  );
}

function latestCandidateForRun(
  bundle: TaskConversationBundle,
  run: TaskRun,
  asset: ChapterCoreAsset,
): ConversationArtifactCard | undefined {
  return latestByCreatedAt(
    bundle.artifacts.filter(
      (artifact) =>
        (artifact.runId === run.runId || artifact.turnId === run.turnId) &&
        artifact.artifactType === CORE_ASSET_ARTIFACT_TYPE[asset],
    ),
    (artifact) => artifact.createdAt,
  );
}

function latestDecisionForCandidate(
  bundle: TaskConversationBundle,
  candidate: ConversationArtifactCard,
): ArtifactDecision | undefined {
  const persisted = latestByCreatedAt(
    (bundle.decisions ?? []).filter(
      (decision) =>
        decision.conversationId === bundle.conversation.conversationId &&
        (decision.artifactId === candidate.artifactId || decision.cardId === candidate.cardId),
    ),
    (decision) => decision.createdAt,
  );
  return persisted ?? candidate.latestDecision;
}

function failedOrchestration(
  asset: ChapterCoreAsset,
  updatedAt: string,
  error: string,
  input: {
    preparationTurnId?: string;
    preparationRunId?: string;
    candidateArtifactId?: string;
  } = {},
): ChapterAssetOrchestration {
  return {
    phase: 'failed',
    asset,
    ...input,
    error,
    updatedAt,
  };
}

function rebuildOrchestration(input: {
  bundle: TaskConversationBundle;
  sourceTurn: ConversationTurn;
  missingAssets: ChapterCoreAsset[];
  checkedAt: string;
}): ChapterAssetOrchestration {
  const asset = input.missingAssets[0];
  if (!asset) return { phase: 'resuming', updatedAt: input.checkedAt };

  const turn = latestPreparationTurn(input.bundle, input.sourceTurn, asset);
  if (!turn) return { phase: 'queued', asset, updatedAt: input.checkedAt };

  const run = latestRunForTurn(input.bundle, turn.turnId);
  if (!run) {
    return failedOrchestration(
      asset,
      turn.createdAt,
      '上次候选生成在创建运行前中断，请显式重试当前项。',
      { preparationTurnId: turn.turnId },
    );
  }
  const identifiers = { preparationTurnId: turn.turnId, preparationRunId: run.runId };
  if (['queued', 'running', 'cancel_requested'].includes(run.status)) {
    return {
      phase: 'generating',
      asset,
      ...identifiers,
      updatedAt: run.updatedAt,
    };
  }
  if (run.status !== 'completed') {
    return failedOrchestration(
      asset,
      run.updatedAt,
      run.error || '上次候选生成未完成，请显式重试当前项。',
      identifiers,
    );
  }

  const candidate = latestCandidateForRun(input.bundle, run, asset);
  if (!candidate?.artifactId) {
    return failedOrchestration(
      asset,
      run.updatedAt,
      '上次运行没有形成可应用的结构化候选，请显式重试当前项。',
      identifiers,
    );
  }
  const candidateIdentifiers = {
    ...identifiers,
    candidateArtifactId: candidate.artifactId,
  };
  const decision = latestDecisionForCandidate(input.bundle, candidate);
  if (!decision) {
    return {
      phase: 'awaiting_apply',
      asset,
      ...candidateIdentifiers,
      updatedAt: candidate.createdAt,
    };
  }
  if (decision.decision === 'reject') {
    return failedOrchestration(
      asset,
      decision.createdAt,
      '候选已拒绝；需要时请显式重试当前项。',
      candidateIdentifiers,
    );
  }
  if (decision.decision === 'request_revision') {
    return failedOrchestration(
      asset,
      decision.createdAt,
      '候选已转为修改要求；调整方向后请显式重试当前项。',
      candidateIdentifiers,
    );
  }
  if (decision.decision === 'request_apply') {
    const error = decision.conflictCode
      ? '候选未能应用到作品，请处理冲突后显式重试当前项。'
      : decision.applyTransactionId
        ? '候选已经应用，但正式资产检查仍显示缺失，请重新生成并审阅。'
        : '候选应用结果不完整，请显式重试当前项。';
    return failedOrchestration(asset, decision.createdAt, error, candidateIdentifiers);
  }
  return failedOrchestration(
    asset,
    decision.createdAt,
    '候选尚未应用到作品，请显式重试当前项。',
    candidateIdentifiers,
  );
}

function latestPreparationChapterId(
  bundle: TaskConversationBundle,
  sourceTurn: ConversationTurn,
): string | undefined {
  const preparationTurnIds = new Set(
    orderedTurns(bundle)
      .filter(
        (turn) =>
          turn.sequence > sourceTurn.sequence && resolvePreparationAsset(turn) !== undefined,
      )
      .map((turn) => turn.turnId),
  );
  return latestByCreatedAt(
    bundle.runs.filter((run) => preparationTurnIds.has(run.turnId) && Boolean(run.chapterId)),
    (run) => run.createdAt,
  )?.chapterId;
}

export function rebuildChapterAssetRecoveryFromBundle(input: {
  bundle: TaskConversationBundle;
  source: { turn: ConversationTurn; goal: string };
  readiness: ChapterAssetReadinessResult;
  preferredChapterId?: string;
  checkedAt: string;
}): ChapterAssetRecovery {
  const latestPreparationRun = latestByCreatedAt(
    input.bundle.runs.filter((run) => {
      const turn = input.bundle.turns.find((candidate) => candidate.turnId === run.turnId);
      return Boolean(turn && resolvePreparationAsset(turn));
    }),
    (run) => run.createdAt,
  );
  return {
    conversationId: input.bundle.conversation.conversationId,
    novelId: input.bundle.conversation.novelId,
    chapterId:
      input.readiness.chapterId ??
      input.preferredChapterId ??
      latestPreparationChapterId(input.bundle, input.source.turn),
    originalGoal: input.source.goal,
    missingAssets: input.readiness.missingAssets,
    sourceTurnId: input.source.turn.turnId,
    modelSnapshot: input.bundle.conversation.defaultModel ?? latestPreparationRun?.modelSnapshot,
    orchestration: rebuildOrchestration({
      bundle: input.bundle,
      sourceTurn: input.source.turn,
      missingAssets: input.readiness.missingAssets,
      checkedAt: input.checkedAt,
    }),
    createdAt: input.source.turn.createdAt,
    checkedAt: input.checkedAt,
  };
}

export async function recoverPersistedChapterAssetRecovery(
  input: RecoverPersistedChapterAssetInput,
  deps: RecoveryPersistenceDependencies = {},
): Promise<ChapterAssetRecovery | null> {
  const getConversation = deps.getConversation ?? taskConversationService.get;
  const bundle = await getConversation(input.conversationId);
  if (!bundle || bundle.conversation.archivedAt || bundle.conversation.status === 'archived') {
    return null;
  }
  const source = findLatestRecoverableChapterGoal(bundle);
  if (!source) return null;

  const persistedChapterId = latestPreparationChapterId(bundle, source.turn);
  const inspectReadiness = deps.inspectReadiness ?? chapterAssetReadinessService.inspect;
  const readiness = await inspectReadiness({
    novelId: bundle.conversation.novelId,
    chapterId: input.preferredChapterId ?? persistedChapterId,
    userInstruction: source.goal,
  });
  const checkedAt = (deps.now ?? (() => new Date().toISOString()))();
  return rebuildChapterAssetRecoveryFromBundle({
    bundle,
    source,
    readiness,
    preferredChapterId: input.preferredChapterId ?? persistedChapterId,
    checkedAt,
  });
}

export async function ensurePersistedChapterGoalTurn(
  input: EnsurePersistedChapterGoalTurnInput,
  deps: RecoveryPersistenceDependencies = {},
): Promise<ConversationTurn> {
  const goal = input.goal.trim();
  if (!goal) throw new Error('创作目标不能为空');
  const getConversation = deps.getConversation ?? taskConversationService.get;
  const bundle = await getConversation(input.conversationId);
  if (!bundle) throw new Error('任务对话不存在');
  const recoverable = findLatestRecoverableChapterGoal(bundle);
  if (recoverable?.goal === goal) return recoverable.turn;

  const appendTurn = deps.appendTurn ?? taskConversationService.appendTurn;
  return appendTurn(input.conversationId, 'user', goal);
}
