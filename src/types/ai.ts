/**
 * AI Novel Studio - AI 任务类型定义
 */

export type AiTaskType =
  | 'setting_structure'
  | 'rule_structure'
  | 'protagonist_structure'
  | 'volume_outline_expand'
  | 'chapter_outline_generate'
  | 'style_analyze'
  | 'character_generate'
  | 'event_suggest'
  | 'chapter_generate'
  | 'chapter_rewrite'
  | 'chapter_polish'
  | 'quality_check'
  | 'chapter_summarize'
  | 'context_update';

export type AiTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AiTaskRecord {
  id: string;
  novelId: string;
  chapterId?: string;
  taskType: AiTaskType;
  status: AiTaskStatus;
  modelName: string;
  inputSummary: string;
  promptTemplateName: string;
  outputResult?: string;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
}

export const AiTaskTypeLabels: Record<AiTaskType, string> = {
  setting_structure: '设定整理',
  rule_structure: '规则整理',
  protagonist_structure: '主角设定',
  volume_outline_expand: '分卷大纲扩展',
  chapter_outline_generate: '章节大纲生成',
  style_analyze: '风格分析',
  character_generate: '角色生成',
  event_suggest: '事件推荐',
  chapter_generate: '章节生成',
  chapter_rewrite: '章节重写',
  chapter_polish: '章节润色',
  quality_check: '质量检查',
  chapter_summarize: '章节总结',
  context_update: '上下文更新',
};
