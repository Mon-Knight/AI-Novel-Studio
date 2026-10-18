import type { TaskConversationBundle, TaskRun } from '../../types/conversation';

const CANDIDATE_TOOLS = new Set([
  'generate_chapter',
  'polish_chapter',
  'generate_outline',
  'generate_characters',
  'suggest_events',
  'expand_settings',
  'check_quality',
  'summarize_chapter',
]);

/** A completed planner is not a completed writing stage. Unknown success stays blocking. */
export function isCompletedPlanningRun(bundle: TaskConversationBundle, run: TaskRun): boolean {
  const events = bundle.toolEvents.filter((event) => event.runId === run.runId);
  return (
    run.status === 'completed' &&
    events.filter(
      (event) => event.toolName === 'creative.plan_action' && event.status === 'succeeded',
    ).length === 1 &&
    !events.some((event) => CANDIDATE_TOOLS.has(event.toolName)) &&
    !bundle.artifacts.some((card) => card.runId === run.runId)
  );
}

/** UI hint only. The click handler and native retry resolver re-read durable facts. */
export function recoverableTurnRun(
  bundle: TaskConversationBundle,
  turnId: string,
): TaskRun | undefined {
  const runs = bundle.runs
    .filter(
      (run) => run.conversationId === bundle.conversation.conversationId && run.turnId === turnId,
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId),
    );
  if (bundle.runs.some((run) => ['queued', 'running', 'cancel_requested'].includes(run.status)))
    return undefined;
  const ids = new Set(runs.map((run) => run.runId));
  if (
    bundle.artifacts.some((card) => card.turnId === turnId || (card.runId && ids.has(card.runId)))
  )
    return undefined;
  const latest = [...runs].reverse().find((run) => !isCompletedPlanningRun(bundle, run));
  return latest && ['failed', 'cancelled'].includes(latest.status) ? latest : undefined;
}

export function assertRecoverableRun(bundle: TaskConversationBundle, sourceRunId: string): TaskRun {
  const source = bundle.runs.find((run) => run.runId === sourceRunId);
  if (!source || recoverableTurnRun(bundle, source.turnId)?.runId !== sourceRunId) {
    throw new Error('该阶段已有活动运行、成功候选或更新结果，无法重试旧运行。');
  }
  return source;
}
