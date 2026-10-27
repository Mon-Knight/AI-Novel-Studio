import type { ConversationArtifactCard } from '../../types/conversation';

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  chapter_text: '章节正文',
  outline: '大纲',
  character_candidates: '人物候选',
  event_candidates: '事件候选',
  setting_candidates: '设定候选',
  chapter_summary: '章节总结',
  quality_report: '质量检查报告',
  style_analysis: '风格分析',
  generic_json: '结构化数据',
  generic_text: '文本产物',
  generic: '通用产物',
};

export const ARTIFACT_STATUS_LABELS: Record<ConversationArtifactCard['status'], string> = {
  candidate: '待处理',
  confirmed: '已确认',
  rejected: '已拒绝',
};

export function artifactTypeLabel(type: string): string {
  return ARTIFACT_TYPE_LABELS[type] ?? type;
}

/** Scrolls the conversation to a card and lets a short highlight draw attention. */
export function revealArtifactCard(cardId: string, artifactId?: string): boolean {
  const selector = artifactId
    ? `[data-testid="workbench-artifact-card"][data-artifact-id="${artifactId}"]`
    : `[data-testid="workbench-artifact-card"][data-card-id="${cardId}"]`;
  const card = document.querySelector<HTMLElement>(selector);
  if (!card) return false;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('is-side-highlighted');
  window.setTimeout(() => card.classList.remove('is-side-highlighted'), 1400);
  return true;
}
