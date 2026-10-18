import type { TaskConflictPeer } from './taskGoalRouting';
import { decodeArtifactRevisionTurn } from './artifactRevisionSourceCodec';
import { stampWindowCards } from './conversationCandidateOrdinal';
import { decodeWorkbenchTurnContent } from './workbenchTurnOrigin';
import type {
  ConversationArtifactCard,
  ConversationTurn,
  ConversationWindow,
  ConversationWindowCursor,
  ConversationWindowPage,
  ConversationWindowQuery,
  RunningTaskTarget,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';

export const CONVERSATION_WINDOW_DEFAULT_LIMIT = 8;
export const CONVERSATION_WINDOW_PAGE_LIMIT = 32;
export const CONVERSATION_WINDOW_REFRESH_LIMIT = 200;

export class ConversationWindowQueryError extends Error {
  readonly code = 'CONVERSATION_WINDOW_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ConversationWindowQueryError';
  }
}

type WindowMode =
  | { kind: 'latest' }
  | { kind: 'before'; sequence: number }
  | { kind: 'min'; sequence: number }
  | { kind: 'anchor'; sequence: number | null };

export function conversationWindowCommand(query: ConversationWindowQuery): {
  command: 'get_task_conversation_window';
  args: { input: Record<string, unknown> };
} {
  return {
    command: 'get_task_conversation_window',
    args: { input: validatedWindowInput(query) },
  };
}

export function runningTaskTargetsCommand(novelId: string): {
  command: 'list_running_task_targets';
  args: { input: { novelId: string } };
} {
  const id = novelId.trim();
  if (!id) throw new ConversationWindowQueryError('小说编号不能为空');
  return { command: 'list_running_task_targets', args: { input: { novelId: id } } };
}

export function sliceConversationWindow(
  bundle: TaskConversationBundle,
  query: ConversationWindowQuery,
): ConversationWindow {
  const input = validatedWindowInput(query);
  if (bundle.conversation.conversationId !== input.conversationId) {
    throw new ConversationWindowQueryError('定位的回合不属于当前任务');
  }
  const turns = [...bundle.turns].sort((left, right) => left.sequence - right.sequence);
  const rounds = userRoundSequences(turns);
  const mode = resolveMode(bundle, turns, rounds, input);
  const selected = selectRounds(rounds, Number(input.limit), mode);
  const hasOlderGap =
    input.minUserSequence != null &&
    (rounds.some((sequence) => sequence < Number(input.minUserSequence)) ||
      (selected[0] != null && selected[0] > Number(input.minUserSequence)));
  if (rounds.length === 0) {
    const selectedTurns = selectedTurnWindow(turns, Number(input.limit));
    return windowForTurns(bundle, selectedTurns, {
      oldestUserSequence: null,
      newestUserSequence: null,
      hasOlder: turns.length > selectedTurns.length,
      hasNewer: false,
      userRoundCount: 0,
    });
  }
  if (selected.length === 0) {
    return {
      bundle: emptyFacts(bundle),
      page: {
        startSequence: null,
        endSequenceExclusive: null,
        oldestUserSequence: null,
        newestUserSequence: null,
        hasOlder: false,
        hasNewer: rounds.length > 0,
        userRoundCount: 0,
      },
    };
  }
  const includesEarliest = selected[0] === rounds[0];
  const nextRound = rounds.find((sequence) => sequence > selected[selected.length - 1]);
  const start = includesEarliest
    ? (turns[0]?.sequence ?? selected[0])
    : selected[0];
  return windowForTurns(
    bundle,
    turns.filter(
      (turn) => turn.sequence >= start && (nextRound == null || turn.sequence < nextRound),
    ),
    {
      oldestUserSequence: selected[0],
      newestUserSequence: selected[selected.length - 1],
      hasOlder: hasOlderGap || !includesEarliest,
      hasNewer: nextRound != null,
      userRoundCount: selected.length,
    },
    { start, end: nextRound },
  );
}

export function mergeConversationWindow(
  previous: TaskConversationBundle | null,
  incoming: TaskConversationBundle,
  page: ConversationWindowPage,
): TaskConversationBundle {
  if (!previous || previous.conversation.conversationId !== incoming.conversation.conversationId) {
    return projectDecisions(incoming);
  }
  if (page.startSequence == null) return { ...previous, conversation: incoming.conversation };
  if (!windowSpansTouch(previous, page)) return projectDecisions(incoming);
  const inSpan = (sequence: number) =>
    sequence >= page.startSequence! &&
    (page.endSequenceExclusive == null || sequence < page.endSequenceExclusive);
  const sequences = new Map<string, number>();
  for (const turn of [...previous.turns, ...incoming.turns]) sequences.set(turn.turnId, turn.sequence);
  const runsById = new Map<string, TaskRun>();
  for (const run of [...previous.runs, ...incoming.runs]) runsById.set(run.runId, run);
  const runInSpan = (run: TaskRun) => {
    const sequence = sequences.get(run.turnId);
    return sequence != null && inSpan(sequence);
  };
  const turns = [
    ...previous.turns.filter((turn) => !inSpan(turn.sequence)),
    ...incoming.turns.filter((turn) => inSpan(turn.sequence)),
  ].sort((left, right) => left.sequence - right.sequence);
  const runs = [
    ...previous.runs.filter((run) => !runInSpan(run)),
    ...incoming.runs.filter((run) => runInSpan(run)),
  ];
  const replacedRunIds = new Set(incoming.runs.filter((run) => runInSpan(run)).map((run) => run.runId));
  const keptRunIds = new Set(runs.map((run) => run.runId));
  const toolEvents = [
    ...previous.toolEvents.filter(
      (event) => keptRunIds.has(event.runId) && !replacedRunIds.has(event.runId),
    ),
    ...incoming.toolEvents.filter((event) => replacedRunIds.has(event.runId)),
  ];
  const openTail = page.endSequenceExclusive == null;
  const previousCards = new Map(previous.artifacts.map((card) => [card.cardId, card]));
  const place = (card: ConversationArtifactCard) => cardPlacement(card, sequences, runsById, inSpan);
  const artifacts = [
    ...previous.artifacts.filter((card) => {
      const placement = place(card);
      return placement === 'out' || (placement === 'unanchored' && !openTail);
    }),
    ...incoming.artifacts
      .filter((card) => {
        const placement = place(card);
        return placement === 'in' || (placement === 'unanchored' && openTail);
      })
      .map((card) => mergeArtifactBody(previousCards.get(card.cardId), card)),
  ];
  const incomingCardIds = new Set(
    incoming.artifacts
      .filter((card) => {
        const placement = place(card);
        return placement === 'in' || (placement === 'unanchored' && openTail);
      })
      .map((card) => card.cardId),
  );
  const keptCardIds = new Set(artifacts.map((card) => card.cardId));
  const decisions = [
    ...(previous.decisions ?? []).filter(
      (decision) => keptCardIds.has(decision.cardId) && !incomingCardIds.has(decision.cardId),
    ),
    ...(incoming.decisions ?? []).filter((decision) => incomingCardIds.has(decision.cardId)),
  ];
  const decisionIds = new Set(decisions.map((decision) => decision.decisionId));
  const incomingDecisionIds = new Set(
    (incoming.decisions ?? [])
      .filter((decision) => incomingCardIds.has(decision.cardId))
      .map((decision) => decision.decisionId),
  );
  const authorizations = [
    ...(previous.authorizations ?? []).filter(
      (authorization) =>
        decisionIds.has(authorization.decisionId) &&
        !incomingDecisionIds.has(authorization.decisionId),
    ),
    ...(incoming.authorizations ?? []).filter((authorization) =>
      incomingDecisionIds.has(authorization.decisionId),
    ),
  ];
  return projectDecisions({
    conversation: incoming.conversation,
    turns,
    runs,
    toolEvents,
    artifacts,
    decisions,
    authorizations,
  });
}

export function cursorAfterWindow(
  conversationId: string,
  merged: TaskConversationBundle,
  page: ConversationWindowPage,
  previous: ConversationWindowCursor | null,
  request: 'refresh' | 'older' | 'focus',
): ConversationWindowCursor {
  const oldestUserSequence = oldestUserRound(merged.turns);
  const sameTask = previous?.conversationId === conversationId;
  let hasOlder = page.hasOlder;
  const hasNewer = sameTask && previous ? previous.hasNewer && page.hasNewer : page.hasNewer;
  if (request === 'older' && page.userRoundCount === 0) hasOlder = false;
  else if (
    oldestUserSequence != null &&
    page.oldestUserSequence != null &&
    page.oldestUserSequence !== oldestUserSequence
  ) {
    hasOlder = sameTask ? previous.hasOlder : true;
  }
  return {
    conversationId,
    oldestUserSequence,
    loadedUserRounds: userRoundSequences(merged.turns).length,
    hasOlder,
    hasNewer,
  };
}
function windowSpansTouch(previous: TaskConversationBundle, page: ConversationWindowPage): boolean {
  const start = page.startSequence;
  if (start == null || previous.turns.length === 0) return true;
  let min = previous.turns[0].sequence;
  let max = min;
  for (const turn of previous.turns) {
    min = Math.min(min, turn.sequence);
    max = Math.max(max, turn.sequence);
  }
  const end = page.endSequenceExclusive ?? Number.POSITIVE_INFINITY;
  return end >= min && start <= max + 1;
}

export function conflictPeersFromRunningTargets(targets: readonly RunningTaskTarget[]): TaskConflictPeer[] {
  return targets.map((target) => {
    const goal = readableRunningGoal(target.latestGoal);
    return {
      conversationId: target.conversationId,
      novelId: target.novelId,
      title: target.title,
      ...(target.chapterId ? { chapterId: target.chapterId } : {}),
      ...(goal ? { latestGoal: goal } : {}),
    };
  });
}

function validatedWindowInput(query: ConversationWindowQuery): Record<string, unknown> {
  const conversationId = query.conversationId.trim();
  if (!conversationId) throw new ConversationWindowQueryError('任务编号不能为空');
  const cursors = [
    query.beforeUserSequence != null,
    query.minUserSequence != null,
    Boolean(query.focusTurnId?.trim()),
    Boolean(query.focusCardId?.trim()),
  ].filter(Boolean);
  if (cursors.length > 1) {
    throw new ConversationWindowQueryError('分页游标、刷新范围和定位不能同时使用');
  }
  if (query.focusTurnId != null && !query.focusTurnId.trim()) {
    throw new ConversationWindowQueryError('定位编号不能为空');
  }
  if (query.focusCardId != null && !query.focusCardId.trim()) {
    throw new ConversationWindowQueryError('定位编号不能为空');
  }
  for (const sequence of [query.beforeUserSequence, query.minUserSequence]) {
    if (sequence != null && (!Number.isInteger(sequence) || sequence < 0)) {
      throw new ConversationWindowQueryError('分页序号不能为负数');
    }
  }
  const refresh = query.minUserSequence != null;
  const limit = query.limit ?? CONVERSATION_WINDOW_DEFAULT_LIMIT;
  const max = refresh ? CONVERSATION_WINDOW_REFRESH_LIMIT : CONVERSATION_WINDOW_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new ConversationWindowQueryError(
      refresh ? '已加载区间一次最多刷新 200 个用户回合' : '单页最多读取 32 个用户回合',
    );
  }
  return {
    conversationId,
    limit,
    ...(query.beforeUserSequence != null ? { beforeUserSequence: query.beforeUserSequence } : {}),
    ...(query.minUserSequence != null ? { minUserSequence: query.minUserSequence } : {}),
    ...(query.focusTurnId?.trim() ? { focusTurnId: query.focusTurnId.trim() } : {}),
    ...(query.focusCardId?.trim() ? { focusCardId: query.focusCardId.trim() } : {}),
  };
}

function isUserRound(turn: ConversationTurn): boolean {
  return turn.role === 'user' && !decodeWorkbenchTurnContent(turn.content).origin;
}

function userRoundSequences(turns: readonly ConversationTurn[]): number[] {
  return turns
    .filter(isUserRound)
    .map((turn) => turn.sequence)
    .sort((left, right) => left - right);
}

function oldestUserRound(turns: readonly ConversationTurn[]): number | null {
  const sequences = userRoundSequences(turns);
  return sequences[0] ?? null;
}

function resolveMode(
  bundle: TaskConversationBundle,
  turns: ConversationTurn[],
  rounds: number[],
  input: Record<string, unknown>,
): WindowMode {
  if (input.beforeUserSequence != null) return { kind: 'before', sequence: Number(input.beforeUserSequence) };
  if (input.minUserSequence != null) return { kind: 'min', sequence: Number(input.minUserSequence) };
  if (typeof input.focusTurnId === 'string' || typeof input.focusCardId === 'string') {
    const sequence = focusSequence(bundle, turns, input);
    const owning = [...rounds].reverse().find((item) => item <= sequence) ?? null;
    return { kind: 'anchor', sequence: owning != null && rounds.includes(owning) ? owning : null };
  }
  return { kind: 'latest' };
}

function focusSequence(
  bundle: TaskConversationBundle,
  turns: ConversationTurn[],
  input: Record<string, unknown>,
): number {
  if (typeof input.focusTurnId === 'string') {
    const turn = turns.find((item) => item.turnId === input.focusTurnId);
    if (!turn || turn.conversationId !== bundle.conversation.conversationId) {
      throw new ConversationWindowQueryError('定位的回合不属于当前任务');
    }
    return turn.sequence;
  }
  const card = bundle.artifacts.find((item) => item.cardId === input.focusCardId);
  if (!card || card.conversationId !== bundle.conversation.conversationId) {
    throw new ConversationWindowQueryError('定位的产物不属于当前任务');
  }
  const turnId =
    card.turnId ?? bundle.runs.find((run) => run.runId === card.runId)?.turnId;
  const turn = turnId ? turns.find((item) => item.turnId === turnId) : undefined;
  if (!turn) throw new ConversationWindowQueryError('定位的产物不属于当前任务');
  return turn.sequence;
}

function selectRounds(rounds: number[], limit: number, mode: WindowMode): number[] {
  if (mode.kind === 'latest') return rounds.slice(Math.max(0, rounds.length - limit));
  if (mode.kind === 'before') {
    if (!rounds.includes(mode.sequence)) {
      throw new ConversationWindowQueryError('分页游标不是当前任务的用户回合');
    }
    const eligible = rounds.filter((sequence) => sequence < mode.sequence);
    return eligible.slice(Math.max(0, eligible.length - limit));
  }
  if (mode.kind === 'min') {
    if (!rounds.includes(mode.sequence)) {
      throw new ConversationWindowQueryError('分页游标不是当前任务的用户回合');
    }
    const eligible = rounds.filter((sequence) => sequence >= mode.sequence);
    if (eligible.length <= limit) return eligible;
    return eligible.slice(eligible.length - limit);
  }
  if (mode.sequence == null) return rounds.slice(0, limit);
  const index = rounds.indexOf(mode.sequence);
  if (index < 0) throw new ConversationWindowQueryError('定位的回合不是当前任务的用户回合');
  const latestStart = Math.max(0, rounds.length - limit);
  if (index >= latestStart) return rounds.slice(latestStart);
  return rounds.slice(index, Math.min(rounds.length, index + limit));
}

function selectedTurnWindow(turns: ConversationTurn[], limit: number): ConversationTurn[] {
  return turns.slice(Math.max(0, turns.length - limit));
}

function emptyFacts(bundle: TaskConversationBundle): TaskConversationBundle {
  return {
    conversation: bundle.conversation,
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: [],
    decisions: [],
    authorizations: [],
  };
}

function windowForTurns(
  bundle: TaskConversationBundle,
  turns: ConversationTurn[],
  facts: Omit<ConversationWindowPage, 'startSequence' | 'endSequenceExclusive'>,
  span?: { start: number; end?: number },
): ConversationWindow {
  const start = span?.start ?? turns[0]?.sequence ?? null;
  const end = span && 'end' in span ? (span.end ?? null) : null;
  const included = new Set(turns.map((turn) => turn.turnId));
  const runs = bundle.runs.filter((run) => included.has(run.turnId));
  const runIds = new Set(runs.map((run) => run.runId));
  const artifacts = stampWindowCards(bundle, included, runIds, end == null);
  const cardIds = new Set(artifacts.map((card) => card.cardId));
  const decisions = (bundle.decisions ?? []).filter((decision) => cardIds.has(decision.cardId));
  const decisionIds = new Set(decisions.map((decision) => decision.decisionId));
  const page: ConversationWindowPage = {
    startSequence: turns.length === 0 ? null : start,
    endSequenceExclusive: turns.length === 0 ? null : end,
    ...facts,
  };
  return {
    bundle: projectDecisions({
      conversation: bundle.conversation,
      turns,
      runs,
      toolEvents: bundle.toolEvents.filter((event) => runIds.has(event.runId)),
      artifacts,
      decisions,
      authorizations: (bundle.authorizations ?? []).filter((authorization) =>
        decisionIds.has(authorization.decisionId),
      ),
    }),
    page,
  };
}

function cardPlacement(
  card: ConversationArtifactCard,
  sequences: Map<string, number>,
  runsById: Map<string, TaskRun>,
  inSpan: (sequence: number) => boolean,
): 'in' | 'out' | 'unanchored' {
  const turnId = card.turnId ?? (card.runId ? runsById.get(card.runId)?.turnId : undefined);
  const sequence = turnId ? sequences.get(turnId) : undefined;
  if (sequence == null) return 'unanchored';
  return inSpan(sequence) ? 'in' : 'out';
}

function mergeArtifactBody(
  previous: ConversationArtifactCard | undefined,
  incoming: ConversationArtifactCard,
): ConversationArtifactCard {
  if (!previous || incoming.artifactEvidence || incoming.content) return incoming;
  if (!previous.artifactEvidence && !previous.content) return incoming;
  return {
    ...incoming,
    content: previous.content,
    artifactEvidence: previous.artifactEvidence,
    contentLoadError: previous.contentLoadError,
  };
}

function projectDecisions(bundle: TaskConversationBundle): TaskConversationBundle {
  const decisions = bundle.decisions ?? [];
  const authorizations = bundle.authorizations ?? [];
  return {
    ...bundle,
    artifacts: bundle.artifacts.map((card) => {
      const related = decisions.filter((decision) => decision.cardId === card.cardId);
      const latestDecision = related[related.length - 1];
      return {
        ...card,
        latestDecision,
        reviewAuthorization: latestDecision
          ? authorizations.find((item) => item.decisionId === latestDecision.decisionId)
          : undefined,
      };
    }),
  };
}

function readableRunningGoal(value: string | undefined): string {
  if (!value?.trim()) return '';
  try {
    const decoded = decodeArtifactRevisionTurn(value);
    const visible = decodeWorkbenchTurnContent(decoded.content);
    return visible.origin ? '' : visible.content.trim();
  } catch {
    return '';
  }
}
