/**
 * AI Novel Studio - 风格方案类型定义（v0.6.0 增强版）
 */

export type StyleSourceType = 'manual' | 'txt_analysis' | 'json_import' | 'system_default' | 'ai_analyzed';

export interface StyleProfile {
  id: string;
  novelId?: string;
  name: string;
  sourceType: StyleSourceType;
  sourceAssetId?: string;
  description?: string;
  targetWordsPerChapter: number;
  rhythmPreference: 'fast' | 'moderate' | 'slow';
  narrativePerspective?: string;
  tone?: string;
  pace?: string;
  sentenceStyle?: string;
  dialogueRatio: number;
  descriptionRatio: number;
  psychologicalRatio?: number;
  battleStyle?: string;
  battleIntensity?: string;
  emotionTendency?: string;
  chapterEnding?: string;
  prohibitedStyles: string[];
  forbiddenStyles?: string[];
  styleSummary?: string;
  rawConfigJson?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStyleProfileInput {
  novelId?: string;
  name: string;
  sourceType: StyleSourceType;
  narrativePerspective?: string;
  tone?: string;
  pace?: string;
  sentenceStyle?: string;
  dialogueRatio?: number;
  descriptionRatio?: number;
  psychologicalRatio?: number;
  battleStyle?: string;
  battleIntensity?: string;
  emotionTendency?: string;
  chapterEnding?: string;
  forbiddenStyles?: string[];
  styleSummary?: string;
}

export interface UpdateStyleProfileInput extends Partial<CreateStyleProfileInput> {
  isActive?: boolean;
}

export interface StyleAnalyzeResult {
  name?: string;
  narrativePerspective?: string;
  tone?: string;
  pace?: string;
  sentenceStyle?: string;
  dialogueRatio?: number;
  descriptionRatio?: number;
  psychologicalRatio?: number;
  battleStyle?: string;
  battleIntensity?: string;
  emotionTendency?: string;
  chapterEnding?: string;
  forbiddenStyles?: string[];
  styleSummary: string;
}
