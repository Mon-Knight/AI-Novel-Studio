import type {
  ConversationStatus,
  TaskConversation,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';
import { statusLabel, TOOL_LABELS } from './workbenchHelpers';

const ACTIVE_RUN_STATUSES = new Set<TaskRun['status']>(['queued', 'running', 'cancel_requested']);
const ACTIVE_TOOL_STATUSES = new Set<ToolCallEvent['status']>(['pending', 'queued', 'running']);

export const RUN_PROGRESS_VISIBLE_AFTER_MS = 10_000;

export interface WorkbenchRunProgress {
  active: boolean;
  stage: string;
  elapsedMs: number;
  lastActivityAtMs: number;
}

export function resolveWorkbenchConversationStatus(input: {
  runtimeActive: boolean;
  bundleConversation?: TaskConversation;
  listedConversation?: TaskConversation;
}): ConversationStatus {
  if (input.runtimeActive) return 'running';
  const { bundleConversation, listedConversation } = input;
  if (!bundleConversation) return listedConversation?.status ?? 'idle';
  if (!listedConversation) return bundleConversation.status;
  return listedConversation.updatedAt >= bundleConversation.updatedAt
    ? listedConversation.status
    : bundleConversation.status;
}

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isActiveWorkbenchRun(run: TaskRun): boolean {
  return ACTIVE_RUN_STATUSES.has(run.status);
}

export function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, '0')}分`;
  if (minutes > 0) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

export function formatRunActivityAge(lastActivityAtMs: number, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - lastActivityAtMs);
  return ageMs < 3_000 ? '刚刚' : `${formatRunDuration(ageMs)}前`;
}

export function resolveWorkbenchRunProgress(
  run: TaskRun,
  events: ToolCallEvent[],
  nowMs: number,
): WorkbenchRunProgress {
  const active = isActiveWorkbenchRun(run);
  const orderedEvents = [...events].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  const latestEvent = orderedEvents[orderedEvents.length - 1];
  const activeEvent = [...orderedEvents]
    .reverse()
    .find((event) => ACTIVE_TOOL_STATUSES.has(event.status));
  let stage: string;
  if (run.status === 'cancel_requested') stage = '正在停止';
  else if (activeEvent) {
    const name = TOOL_LABELS[activeEvent.toolName] ?? '运行时步骤';
    stage = activeEvent.status === 'running' ? name : `等待${name}`;
  } else if (run.status === 'queued') stage = '等待调度';
  else if (run.status === 'running') stage = latestEvent ? '整理运行结果' : '准备运行';
  else stage = statusLabel(run.status);

  const startedAtMs = timestampMs(run.startedAt) ?? timestampMs(run.createdAt) ?? nowMs;
  const finishedAtMs = active
    ? nowMs
    : (timestampMs(run.finishedAt) ?? timestampMs(run.updatedAt) ?? startedAtMs);
  const activityCandidates = [
    timestampMs(run.updatedAt),
    timestampMs(run.startedAt),
    timestampMs(run.createdAt),
    ...orderedEvents.flatMap((event) => [
      timestampMs(event.finishedAt),
      timestampMs(event.createdAt),
    ]),
  ].filter((value): value is number => value !== undefined);

  return {
    active,
    stage,
    elapsedMs: Math.max(0, finishedAtMs - startedAtMs),
    lastActivityAtMs: Math.max(startedAtMs, ...activityCandidates),
  };
}
