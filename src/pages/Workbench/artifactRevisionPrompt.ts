import type { ConversationArtifactCard } from '../../types/conversation';

const REVISION_DRAFTS: Partial<Record<ConversationArtifactCard['artifactType'], string>> = {
  chapter_text: '请根据以下要求修改上一版章节正文候选：\n',
  outline: '请根据以下要求修改上一版大纲候选：\n',
  character_candidates: '请根据以下要求修改上一版人物候选：\n',
  event_candidates: '请根据以下要求修改上一版事件候选：\n',
  setting_candidates: '请根据以下要求修改上一版设定候选：\n',
  chapter_summary: '请根据以下要求修改上一版章节总结候选：\n',
  quality_report: '请根据以下要求重新检查正文并更新质量检查报告：\n',
  style_analysis: '请根据以下要求重新分析风格并更新风格分析报告：\n',
};

/** Builds a revision request that matches the selected artifact's domain semantics. */
export function buildArtifactRevisionDraft(
  artifactType: ConversationArtifactCard['artifactType'],
): string {
  return REVISION_DRAFTS[artifactType] ?? '请根据以下要求调整上一版创作产物：\n';
}
