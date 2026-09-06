import type { ConversationArtifactCard } from '../../types/conversation';
import type { ArtifactCandidateReviewDraft } from '../../types/artifactReview';

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
  revisionNotes?: string,
): string {
  const opening = REVISION_DRAFTS[artifactType] ?? '请根据以下要求调整上一版创作产物：\n';
  return revisionNotes?.trim() ? `${opening}${revisionNotes}` : opening;
}

/** Keeps both the existing goal and the exact review text visible before the user sends it. */
export function appendArtifactRevisionDraft(existingDraft: string, revisionDraft: string): string {
  if (!revisionDraft || existingDraft.includes(revisionDraft)) return existingDraft;
  if (!existingDraft) return revisionDraft;
  const separator = existingDraft.endsWith('\n\n')
    ? ''
    : existingDraft.endsWith('\n')
      ? '\n'
      : '\n\n';
  return `${existingDraft}${separator}${revisionDraft}`;
}

/** Review suggestions are prompt text, never edited artifact data or an apply selection. */
export function formatArtifactReviewNotes(
  drafts: Record<string, ArtifactCandidateReviewDraft>,
): string {
  return Object.values(drafts)
    .map((draft) => {
      const suggestions = [
        draft.suggestedTitle.trim() ? `建议标题：${draft.suggestedTitle}` : '',
        draft.suggestedSummary.trim() ? `建议摘要：${draft.suggestedSummary}` : '',
        draft.notes.trim() ? `补充要求：${draft.notes}` : '',
      ].filter(Boolean);
      return suggestions.length ? [`候选：${draft.originalTitle}`, ...suggestions].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n\n');
}
