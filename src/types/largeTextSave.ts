/**
 * AI Novel Studio - 大文本保存类型定义
 */

/** 保存目标类型 */
export type LargeTextTargetType =
  | 'chapter'
  | 'draft'
  | 'style_profile'
  | 'output_profile'
  | 'context_summary'
  | 'context_record'
  | 'world_setting'
  | 'rule_system'
  | 'outline'
  | 'character_state'
  | 'imported_text'
  | 'quality_check'
  | 'generic';

/** 保存进度阶段 */
export type LargeTextSaveStage =
  | 'creating'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'aborted';

/** 保存进度信息 */
export interface LargeTextSaveProgress {
  stage: LargeTextSaveStage;
  currentChunk?: number;
  totalChunks?: number;
  percent?: number;
  message?: string;
  error?: string;
}

/** 创建会话的输入 */
export interface CreateLargeTextSessionOptions {
  targetType: LargeTextTargetType;
  targetId?: string;
  fieldName: string;
  title?: string;
  content: string;
  chunkSize?: number;
  onProgress?: (progress: LargeTextSaveProgress) => void;
  signal?: AbortSignal;
}

/** 保存结果 */
export interface LargeTextSaveResult {
  success: boolean;
  documentId?: string;
  totalChars?: number;
  totalBytes?: number;
  chunkCount?: number;
  error?: string;
  aborted?: boolean;
}

/** 默认分片大小：64KB */
export const DEFAULT_CHUNK_SIZE = 64 * 1024;

/** 大文本阈值：超过此大小使用分片保存 */
export const LARGE_TEXT_THRESHOLD = 100 * 1024;

/** 判断文本是否需要使用大文本保存 */
export function shouldUseLargeTextSave(content: string): boolean {
  return new Blob([content]).size > LARGE_TEXT_THRESHOLD;
}
