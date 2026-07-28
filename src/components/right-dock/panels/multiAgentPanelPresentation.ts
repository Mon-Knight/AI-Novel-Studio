import type { MultiAgentSessionRecord } from '../../../types/multiAgent';

export const ACTION_LABELS = {
  accept: '通过',
  revise: '修订',
  regenerate: '重写',
} as const;

export const STATUS_LABELS: Record<MultiAgentSessionRecord['status'], string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function sessionTitle(session: MultiAgentSessionRecord): string {
  const stamp = new Date(session.createdAt);
  const time = Number.isNaN(stamp.getTime())
    ? session.createdAt
    : stamp.toLocaleString('zh-CN', { hour12: false });
  return `${time} · ${STATUS_LABELS[session.status]}`;
}

export function metric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
