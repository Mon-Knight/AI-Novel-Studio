import type { ConversationArtifactCard, TaskConversationBundle } from '../../types/conversation';
import { resolveArtifactDecisionTarget as resolveStructuredDecisionTarget } from '../../services/conversation/structuredApplyPolicy';

/** Relative activity label for task rows ("刚刚", "3分钟前", "2天前", then a short date). */
export function formatRecentActivity(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return '刚刚';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function nonEmptyChapterId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Restores a task's latest chapter scope from persisted run evidence. */
export function resolveConversationTargetChapter(
  bundle: TaskConversationBundle,
): string | undefined {
  const runs = [...bundle.runs].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  for (const run of runs) {
    const events = bundle.toolEvents
      .filter((event) => event.runId === run.runId)
      .sort((left, right) => right.sequence - left.sequence);
    for (const event of events) {
      const chapterId = nonEmptyChapterId(event.argumentsSummary.chapterId);
      if (chapterId) return chapterId;
    }
  }

  const artifacts = [...bundle.artifacts].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  for (const artifact of artifacts) {
    const chapterId = nonEmptyChapterId(artifact.artifactEvidence?.sourceChapterId);
    if (chapterId) return chapterId;
  }

  const authorizations = [...(bundle.authorizations ?? [])].sort((left, right) =>
    right.issuedAt.localeCompare(left.issuedAt),
  );
  return authorizations.map((item) => nonEmptyChapterId(item.chapterId)).find(Boolean);
}

/** Target resolution is owned by the structured-apply policy; kept here as the workbench entry point. */
export function resolveArtifactDecisionTarget(input: {
  artifactType: ConversationArtifactCard['artifactType'];
  sourceChapterId?: string;
  currentChapterId?: string;
  novelId: string;
}): {
  targetType: 'chapter' | 'asset';
  targetId: string;
  chapterId?: string;
} {
  const { targetType, targetId, chapterId } = resolveStructuredDecisionTarget(input);
  return { targetType, targetId, chapterId };
}

export function statusLabel(status: string): string {
  return (
    {
      queued: '排队中',
      planning: '规划中',
      running: '执行中',
      executing: '执行中',
      evaluating: '检查中',
      checking: '审查中',
      cancel_requested: '取消中',
      cancelled: '已取消',
      completed: '已完成',
      succeeded: '已完成',
      failed: '失败',
      idle: '待命',
      pending: '准备中',
      skipped: '已跳过',
      waiting_user: '等待处理',
      archived: '已归档',
    }[status] ?? status
  );
}

export function formatWorkbenchTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function markWorkbenchOnce(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export const TOOL_LABELS: Record<string, string> = {
  'novel.read_context': '读取小说上下文',
  'chapter.read_outline': '读取章节大纲',
  get_character_states: '读取人物状态',
  search_memory: '检索长期记忆',
  generate_chapter: '生成章节候选',
  generate_outline: '生成大纲候选',
  generate_characters: '生成角色候选',
  suggest_events: '生成事件候选',
  expand_settings: '扩展设定候选',
  polish_chapter: '润色章节候选',
  check_quality: '质量检查报告',
  summarize_chapter: '章节总结候选',
  query_world_state: '查询世界状态',
  query_character_state: '查询人物状态',
  query_chapter_info: '查询章节信息',
  generate_scene_plan: '生成分镜规划',
  generate_prose: '生成正文段落',
  evaluate_prose: '评估正文质量',
};
