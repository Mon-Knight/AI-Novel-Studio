import type {
  ConversationArtifactCard,
  ConversationTurn,
  TaskConversationBundle,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';
import type { ChapterAssetRecovery } from '../../services/conversation/chapterAssetReadiness';
import { decodeWorkbenchTurnContent } from '../../services/conversation/workbenchTurnOrigin';

export const WORKBENCH_HISTORY_PAGE_SIZE = 8;

export interface WorkbenchCompressionPresentation {
  conversationId: string;
  actionId: string;
  createdAt: string;
}

export interface WorkbenchArtifactFocusRequest {
  conversationId: string;
  cardId: string;
  requestId: string;
}

interface PublicEventIdentity {
  id: string;
  conversationId: string;
  turnId?: string;
  runId?: string;
  attempt?: number;
  at: number;
  turnSequence: number;
  sequence: number;
}

export type WorkbenchPublicEvent = PublicEventIdentity &
  (
    | { kind: 'turn'; turn: ConversationTurn }
    | { kind: 'run'; run: TaskRun; attemptCount: number }
    | { kind: 'tool'; event: ToolCallEvent }
    | { kind: 'error'; error: string; eventId?: string }
    | { kind: 'run_end'; run: TaskRun; latestAttempt: boolean }
    | { kind: 'artifact'; artifact: ConversationArtifactCard }
    | { kind: 'compression' }
    | { kind: 'asset_recovery' }
  );

export interface WorkbenchPresentationRound {
  id: string;
  events: WorkbenchPublicEvent[];
}

export type { WorkbenchDisplaySegment } from './workbenchPresentationGrouping';
export {
  completedReadDisclosureKey,
  groupWorkbenchDisplaySegments,
} from './workbenchPresentationGrouping';

/** Author-facing names only. IDs never become the candidate header. */
export interface WorkbenchPresentationContext {
  novelId: string;
  novelTitle: string;
  chapters: Array<{ id: string; title: string }>;
}

/** Stable across pagination and replay; never derived from the visible window index. */
export function workbenchCandidateNumbers(
  events: readonly WorkbenchPublicEvent[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  let number = 0;
  for (const entry of events) {
    if (entry.kind !== 'artifact') continue;
    number += 1;
    numbers.set(entry.artifact.cardId, number);
  }
  return numbers;
}

export function presentationTime(value: string | undefined, fallback = 0): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : fallback;
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Only duplicate snapshots need a tie break; normal payloads are never serialized here. */
function uniqueFacts<T>(
  items: readonly T[],
  identity: (item: T) => string,
  revision: (item: T) => number,
): T[] {
  const facts = new Map<string, T>();
  for (const item of items) {
    const id = identity(item);
    const previous = facts.get(id);
    if (
      !previous ||
      revision(item) > revision(previous) ||
      (revision(item) === revision(previous) &&
        compareId(JSON.stringify(item), JSON.stringify(previous)) > 0)
    ) {
      facts.set(id, item);
    }
  }
  return [...facts.values()];
}

const EVENT_ORDER: Record<WorkbenchPublicEvent['kind'], number> = {
  turn: 2,
  run: 1,
  tool: 3,
  error: 4,
  artifact: 5,
  run_end: 6,
  compression: 7,
  asset_recovery: 8,
};

/** Separate persisted sequences are not a shared runtime clock. Equal timestamps use an
 * explicit stable tie break, never arrival order, updatedAt, hydration, or hidden reasoning. */
export function comparePublicEvents(
  left: WorkbenchPublicEvent,
  right: WorkbenchPublicEvent,
): number {
  return (
    left.at - right.at ||
    left.turnSequence - right.turnSequence ||
    (left.kind === 'turn' && left.turn.role === 'user' && !left.runId
      ? 0
      : EVENT_ORDER[left.kind]) -
      (right.kind === 'turn' && right.turn.role === 'user' && !right.runId
        ? 0
        : EVENT_ORDER[right.kind]) ||
    left.sequence - right.sequence ||
    compareId(left.id, right.id)
  );
}

export function projectWorkbenchEvents(
  bundle: TaskConversationBundle,
  extra: {
    compression?: WorkbenchCompressionPresentation | null;
    recovery?: ChapterAssetRecovery | null;
  } = {},
): WorkbenchPublicEvent[] {
  const { conversationId, novelId } = bundle.conversation;
  const fallback = presentationTime(bundle.conversation.createdAt);
  const turns = uniqueFacts(
    bundle.turns.filter((turn) => turn.conversationId === conversationId),
    (turn) => turn.turnId,
    (turn) => turn.content?.length ?? 0,
  );
  const turnsById = new Map(turns.map((turn) => [turn.turnId, turn]));
  const runs = uniqueFacts(
    bundle.runs.filter((run) => run.conversationId === conversationId),
    (run) => run.runId,
    (run) => presentationTime(run.updatedAt),
  ).sort(
    (a, b) =>
      presentationTime(a.createdAt) - presentationTime(b.createdAt) || compareId(a.runId, b.runId),
  );
  const runsById = new Map(runs.map((run) => [run.runId, run]));
  const attempts = new Map<string, TaskRun[]>();
  for (const run of runs) {
    const siblings = attempts.get(run.turnId) ?? [];
    siblings.push(run);
    attempts.set(run.turnId, siblings);
  }
  const base = (
    id: string,
    createdAt: string,
    turnId?: string,
    runId?: string,
    sequence = 0,
  ): PublicEventIdentity => {
    const run = runId ? runsById.get(runId) : undefined;
    const owner = turnsById.get(run?.turnId ?? turnId ?? '');
    return {
      id,
      conversationId,
      turnId: turnId ?? run?.turnId,
      runId,
      attempt: run ? (attempts.get(run.turnId)?.indexOf(run) ?? 0) + 1 : undefined,
      at: presentationTime(createdAt, presentationTime(run?.createdAt, fallback)),
      turnSequence: owner?.sequence ?? Number.MAX_SAFE_INTEGER,
      sequence,
    };
  };
  const result: WorkbenchPublicEvent[] = turns.map((turn) => ({
    ...base('turn:' + turn.turnId, turn.createdAt, turn.turnId, turn.runId, turn.sequence),
    kind: 'turn',
    turn,
  }));
  const events = uniqueFacts(
    bundle.toolEvents.filter((event) => runsById.has(event.runId)),
    (event) => event.eventId,
    (event) => presentationTime(event.finishedAt, presentationTime(event.createdAt)),
  );
  for (const event of events) {
    result.push({
      ...base('tool:' + event.eventId, event.createdAt, undefined, event.runId, event.sequence),
      kind: 'tool',
      event,
    });
    if (event.error)
      result.push({
        ...base(
          'tool-error:' + event.eventId,
          event.finishedAt ?? event.createdAt,
          undefined,
          event.runId,
          event.sequence,
        ),
        kind: 'error',
        error: event.error,
        eventId: event.eventId,
      });
  }
  for (const run of runs) {
    const siblings = attempts.get(run.turnId) ?? [];
    result.push({
      ...base('run:' + run.runId, run.createdAt, run.turnId, run.runId),
      kind: 'run',
      run,
      attemptCount: siblings.length,
    });
    // Tool failures already have one public error at the tool's completion timestamp.
    if (
      run.error &&
      !events.some((event) => event.runId === run.runId && event.error === run.error)
    ) {
      result.push({
        ...base('run-error:' + run.runId, run.finishedAt ?? run.updatedAt, run.turnId, run.runId),
        kind: 'error',
        error: run.error,
      });
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status))
      result.push({
        ...base('run-end:' + run.runId, run.finishedAt ?? run.updatedAt, run.turnId, run.runId),
        kind: 'run_end',
        run,
        latestAttempt: siblings[siblings.length - 1]?.runId === run.runId,
      });
  }
  for (const artifact of uniqueFacts(
    bundle.artifacts.filter(
      (card) =>
        card.conversationId === conversationId &&
        (!card.artifactEvidence?.sourceNovelId || card.artifactEvidence.sourceNovelId === novelId),
    ),
    (card) => card.cardId,
    (card) => presentationTime(card.latestDecision?.createdAt, presentationTime(card.createdAt)),
  )) {
    result.push({
      ...base('artifact:' + artifact.cardId, artifact.createdAt, artifact.turnId, artifact.runId),
      kind: 'artifact',
      artifact,
    });
  }
  if (extra.compression?.conversationId === conversationId)
    result.push({
      ...base('compression:' + extra.compression.actionId, extra.compression.createdAt),
      kind: 'compression',
    });
  if (extra.recovery?.conversationId === conversationId && extra.recovery.novelId === novelId)
    result.push({
      ...base(
        'asset-recovery:' + extra.recovery.createdAt,
        extra.recovery.createdAt,
        extra.recovery.sourceTurnId,
      ),
      kind: 'asset_recovery',
    });
  return result.sort(comparePublicEvents);
}

/** An assistant reply or automatic preparation step never consumes a user-round page slot. */
export function groupWorkbenchRounds(
  events: readonly WorkbenchPublicEvent[],
): WorkbenchPresentationRound[] {
  const rounds: WorkbenchPresentationRound[] = [];
  let hasUserRound = false;
  for (const event of events) {
    const startsRound =
      event.kind === 'turn' &&
      event.turn.role === 'user' &&
      !decodeWorkbenchTurnContent(event.turn.content).origin;
    if (startsRound && !hasUserRound && rounds.length === 1) {
      // A leading welcome/system message is part of the first full user exchange.
      rounds[0].id = event.id;
    } else if (startsRound || rounds.length === 0) rounds.push({ id: event.id, events: [] });
    if (startsRound) hasUserRound = true;
    rounds[rounds.length - 1].events.push(event);
  }
  return rounds;
}

export function presentationWindowStart(
  rounds: readonly WorkbenchPresentationRound[],
  firstRoundId: string | null,
  visibleRoundCount: number,
): number {
  const savedIndex = firstRoundId ? rounds.findIndex((round) => round.id === firstRoundId) : -1;
  return savedIndex >= 0 ? savedIndex : Math.max(0, rounds.length - visibleRoundCount);
}

/** Navigation only: this list never grants a decision, review authorization, or write. */
export function presentationArtifactsNeedingAttention(
  events: readonly WorkbenchPublicEvent[],
): ConversationArtifactCard[] {
  return events.flatMap((event) => {
    if (event.kind !== 'artifact') return [];
    const card = event.artifact;
    const decision = card.latestDecision;
    if (
      card.status === 'rejected' ||
      decision?.applyTransactionId ||
      decision?.decision === 'reject' ||
      decision?.decision === 'request_revision'
    )
      return [];
    if (
      decision?.decision === 'confirm' &&
      (card.artifactType !== 'chapter_text' || card.reviewAuthorization?.status === 'consumed')
    )
      return [];
    return card.status === 'candidate' || Boolean(decision) ? [card] : [];
  });
}

/** A preparation link must name the exact persisted candidate, not the latest matching type. */
export function resolvePreparationCandidate(
  bundle: TaskConversationBundle,
  recovery: ChapterAssetRecovery | null,
): ConversationArtifactCard | null {
  if (
    !recovery ||
    recovery.conversationId !== bundle.conversation.conversationId ||
    recovery.novelId !== bundle.conversation.novelId ||
    !recovery.orchestration.candidateArtifactId
  )
    return null;
  const { preparationRunId, preparationTurnId, candidateArtifactId } = recovery.orchestration;
  const candidates = bundle.artifacts.filter((card) => {
    if (
      card.conversationId !== recovery.conversationId ||
      card.artifactId !== candidateArtifactId ||
      (preparationRunId && card.runId !== preparationRunId) ||
      (card.artifactEvidence?.sourceNovelId &&
        card.artifactEvidence.sourceNovelId !== recovery.novelId) ||
      (recovery.chapterId &&
        card.artifactEvidence?.sourceChapterId &&
        card.artifactEvidence.sourceChapterId !== recovery.chapterId)
    )
      return false;
    const run = bundle.runs.find((item) => item.runId === card.runId);
    if (
      run &&
      (run.conversationId !== recovery.conversationId ||
        (recovery.chapterId && run.chapterId && run.chapterId !== recovery.chapterId))
    )
      return false;
    return !preparationTurnId || (card.turnId ?? run?.turnId) === preparationTurnId;
  });
  const ids = new Set(candidates.map((card) => card.cardId));
  return ids.size === 1 ? candidates[0] : null;
}
