import type { AiTaskStatus, AiTaskType } from '../../types/ai';

export const TYPE_FILTERS: (AiTaskType | 'all')[] = [
  'all',
  'connection_test',
  'chapter_generate',
  'character_generate',
  'event_suggest',
  'setting_expand',
  'outline_generate',
  'volume_outline_generate',
  'chapter_outline_generate',
  'context_summarize',
  'style_analyze',
  'quality_check',
  'chapter_polish',
];

export const STATUS_FILTERS: (AiTaskStatus | 'all')[] = [
  'all',
  'succeeded',
  'failed',
  'cancelled',
  'pending',
  'running',
];

export const TASK_PAGE_SIZE = 50;

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  }).format(value);
}

export type ActiveExecutionState = 'active' | 'cancelling' | 'inactive';
