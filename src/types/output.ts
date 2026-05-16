/**
 * AI Novel Studio - 输出控制方案类型定义（v0.6.0 增强版）
 */

export interface OutputProfile {
  id: string;
  novelId?: string;
  name: string;
  description?: string;
  chapterWordRange: { min: number; max: number; default: number };
  targetWordCount?: number;
  minWordCount?: number;
  maxWordCount?: number;
  paragraphLength: 'short' | 'medium' | 'long';
  povType: 'first_person' | 'third_person_limited' | 'third_person_omniscient';
  tenseType: 'past' | 'present';
  paceLevel?: 'slow' | 'medium' | 'fast';
  dialogueRatio?: number;
  descriptionRatio?: number;
  battleIntensity?: 'low' | 'medium' | 'high';
  emotionTendency?: string;
  endingHookRequired: boolean;
  extraRequirements?: string;
  forbiddenItems?: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOutputProfileInput {
  novelId?: string;
  name: string;
  targetWordCount?: number;
  minWordCount?: number;
  maxWordCount?: number;
  paceLevel?: 'slow' | 'medium' | 'fast';
  dialogueRatio?: number;
  descriptionRatio?: number;
  battleIntensity?: 'low' | 'medium' | 'high';
  emotionTendency?: string;
  endingHookRequired?: boolean;
  extraRequirements?: string;
  forbiddenItems?: string[];
  isDefault?: boolean;
}

export interface UpdateOutputProfileInput extends Partial<CreateOutputProfileInput> {}
