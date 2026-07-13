import { AiTaskTypeLabels, type AiTaskType } from '../types/ai';

const AI_TASK_DISPLAY_LABELS: Record<string, string> = {
  chapter_summary_workflow: '章节摘要审查工作流',
  workflow_prepare_materials: '准备章节资料',
  workflow_generate_summary: '生成章节摘要候选',
  workflow_check_summary: '摘要一致性检查',
  workflow_review_bundle: '汇总待审查结果',
  quality_fix_workflow: '质量修复与复检',
  quality_revision: '章节质量审查与修订候选',
  quality_revision_workflow: '章节质量审查与修订候选',
  workflow_freeze_chapter: '冻结章节快照',
  quality_check: '质量检查',
  quality_fix: '质量修复候选',
  quality_recheck: '修复结果复检',
  workflow_quality_review_bundle: '汇总审查包',
  chapter_polish_workflow: '正文润色',
  chapter_summary: '章节摘要候选',
  volume_summary: '卷摘要候选',
  outline_generate: '作品总纲候选',
  volume_outline_generate: '分卷大纲候选',
  chapter_outline_generate: '章节大纲候选',
  creative_intent_freeze: '冻结创作意图',
};

export function getAiTaskDisplayLabel(taskType: string): string {
  return AI_TASK_DISPLAY_LABELS[taskType]
    || AiTaskTypeLabels[taskType as AiTaskType]
    || 'AI 创作任务';
}
