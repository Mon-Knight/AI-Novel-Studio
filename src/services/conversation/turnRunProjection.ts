import type { TaskRun, TaskTurnRunProjection } from '../../types/conversation';
import { dbCall } from '../database/db';
import { modelSnapshotFrom } from './conversationModelSnapshotValidation';
import type { TaskRuntimeEvent } from './taskRuntimeAdapter';
import { readStoredConversationBundle } from './taskConversationService';

export function turnRunProjectionCommand(
  conversationId: string,
  turnId: string,
): {
  command: 'get_task_turn_run_projection';
  args: { conversationId: string; turnId: string };
} | null {
  const conversation = conversationId.trim();
  const turn = turnId.trim();
  if (!conversation || !turn) return null;
  return {
    command: 'get_task_turn_run_projection',
    args: { conversationId: conversation, turnId: turn },
  };
}

/** Keep only the requested turn. A foreign run never becomes this turn's projection. */
export function scopeTurnRunProjection(
  raw: unknown,
  conversationId: string,
  turnId: string,
): TaskTurnRunProjection | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<TaskTurnRunProjection>;
  const turn = item.turn;
  if (!turn || turn.conversationId !== conversationId || turn.turnId !== turnId) return null;
  const runs = (Array.isArray(item.runs) ? item.runs : [])
    .filter((run) => run.conversationId === conversationId && run.turnId === turnId)
    .map(normalizeRun);
  return { turn, runs };
}

export async function getTurnRunProjection(
  conversationId: string,
  turnId: string,
): Promise<TaskTurnRunProjection | null> {
  const query = turnRunProjectionCommand(conversationId, turnId);
  if (!query) return null;
  const raw = await dbCall<unknown | null>(query.command, query.args, () =>
    localTurnProjection(query.args.conversationId, query.args.turnId),
  );
  return scopeTurnRunProjection(raw, query.args.conversationId, query.args.turnId);
}

/** Tests replace this reader. Production calls the turn projection, never the full bundle. */
export const turnRunProjectionReader = {
  read: getTurnRunProjection,
};

export function observeTurnRunProjection(
  conversationId: string,
  turnId: string,
  runId: string,
  onEvent: ((event: TaskRuntimeEvent) => void) | undefined,
): void {
  if (!onEvent) return;
  const run = runId.trim();
  const query = turnRunProjectionCommand(conversationId, turnId);
  if (!query || !run) return;
  void turnRunProjectionReader
    .read(query.args.conversationId, query.args.turnId)
    .then((projection) => {
      const match = projection?.runs.find(
        (item) =>
          item.runId === run &&
          item.conversationId === query.args.conversationId &&
          item.turnId === query.args.turnId,
      );
      if (match) onEvent({ run: match });
    })
    .catch(() => undefined);
}

function localTurnProjection(conversationId: string, turnId: string): TaskTurnRunProjection | null {
  const bundle = readStoredConversationBundle(conversationId);
  const turn = bundle?.turns.find((item) => item.turnId === turnId);
  if (!turn) return null;
  return scopeTurnRunProjection({ turn, runs: bundle?.runs ?? [] }, conversationId, turnId);
}

function normalizeRun(raw: TaskRun): TaskRun {
  const chapterId = typeof raw.chapterId === 'string' ? raw.chapterId.trim() : '';
  return {
    ...raw,
    ...(chapterId ? { chapterId } : {}),
    modelSnapshot: modelSnapshotFrom(raw.modelSnapshot)!,
  };
}
