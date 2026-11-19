// Shared finite integrity rules; no model calls, side effects or semantic proof.
import {
  hasOpeningRollback,
  hasBoundarySentenceRepetition,
  hasBoundaryActionReplay,
} from './chapter-integrity-boundary.mjs';
import {
  AUTHORIAL_CHAPTER_LABEL,
  hasTailPollution,
  hasMetaReasoningLeakage,
  hasSourceChainBreak,
  hasCharacterReferenceBreak,
  hasNarrowTimeLabelConflict,
  hasClusteredAuditVoiceLeakage,
} from './chapter-integrity-narrative.mjs';
const SEMANTIC_REVIEW_WARNINGS = new Set([
  'chapter_boundary_action_replay',
  'chapter_source_chain_break',
  'chapter_dialogue_reference_conflict',
  'chapter_temporal_semantics_conflict',
  'chapter_audit_voice_leakage',
]);
export function inspectChapterCandidateIntegrity(input) {
  const issues = [];
  if (
    input.previousChapterText?.trim() &&
    hasOpeningRollback(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_opening_rollback',
      summary: '章首与上一章非尾部正文重复，疑似回卷或替代分支。',
    });
  }
  if (
    input.previousChapterText?.trim() &&
    hasBoundarySentenceRepetition(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_boundary_sentence_repetition',
      summary: '本章开篇复制了上一章边界的完整句，连续性停留在文字复写。',
    });
  }
  if (
    input.previousChapterText?.trim() &&
    !issues.some((issue) => issue.code === 'chapter_boundary_sentence_repetition') &&
    hasBoundaryActionReplay(input.candidateText, input.previousChapterText)
  ) {
    issues.push({
      code: 'chapter_boundary_action_replay',
      summary: '上一章结尾已完成的动作在本章开篇被再次执行。',
    });
  }
  if (hasTailPollution(input.candidateText)) {
    issues.push({
      code: 'chapter_tail_pollution',
      summary: '完整故事句之后存在短残片或非正文尾缀。',
    });
  }
  if (hasMetaReasoningLeakage(input.candidateText)) {
    issues.push({
      code: 'chapter_meta_reasoning_leakage',
      summary: '章节正文混入模型自我修订、内部约束或隐藏推理。',
    });
  }
  if (
    !issues.some((issue) => issue.code === 'chapter_meta_reasoning_leakage') &&
    AUTHORIAL_CHAPTER_LABEL.test(input.candidateText)
  ) {
    issues.push({
      code: 'chapter_authorial_label_leakage',
      summary: '故事人物或叙述引用了作者侧章节编号。',
    });
  }
  if (hasSourceChainBreak(input.candidateText)) {
    issues.push({
      code: 'chapter_source_chain_break',
      summary: '正文使用了尚未取得或已断开来源中的目录、标签或附件影像细节。',
    });
  }
  if (hasCharacterReferenceBreak(input.candidateText)) {
    issues.push({
      code: 'chapter_dialogue_reference_conflict',
      summary: '近邻对话中的人物关系指代发生切换，无法确定所指对象。',
    });
  }
  if (hasNarrowTimeLabelConflict(input.candidateText)) {
    issues.push({
      code: 'chapter_temporal_semantics_conflict',
      summary: '同一事件被标为凌晨，同时又落在二十三时这一冲突时段。',
    });
  }
  if (hasClusteredAuditVoiceLeakage(input.candidateText)) {
    issues.push({
      code: 'chapter_audit_voice_leakage',
      summary: '章节正文密集泄漏核实状态与内部审校结论，未转化为故事呈现。',
    });
  }
  return issues.map((issue) => ({
    ...issue,
    severity: SEMANTIC_REVIEW_WARNINGS.has(issue.code) ? 'warning' : 'error',
  }));
}
