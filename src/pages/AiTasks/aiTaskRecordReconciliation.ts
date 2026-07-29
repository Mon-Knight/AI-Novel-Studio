import type { AiTaskRecord } from '../../types/ai';

function recordsEqual(left: AiTaskRecord, right: AiTaskRecord): boolean {
  const leftKeys = Object.keys(left) as (keyof AiTaskRecord)[];
  const rightKeys = Object.keys(right) as (keyof AiTaskRecord)[];
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
}

/** Keeps stable object identities so polling only re-renders cards whose persisted facts changed. */
export function reconcileAiTaskRecords(
  previous: readonly AiTaskRecord[],
  incoming: readonly AiTaskRecord[],
): AiTaskRecord[] {
  const previousById = new Map(previous.map((task) => [task.id, task]));
  return incoming.map((task) => {
    const existing = previousById.get(task.id);
    return existing && recordsEqual(existing, task) ? existing : task;
  });
}
