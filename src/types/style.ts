/**
 * AI Novel Studio - 风格方案类型定义
 */

export interface StyleProfile {
  id: string;
  novelId: string;
  name: string;
  description: string;
  targetWordsPerChapter: number;
  rhythmPreference: 'fast' | 'moderate' | 'slow';
  dialogueRatio: number;
  descriptionRatio: number;
  prohibitedStyles: string[];
  createdAt: string;
  updatedAt: string;
}
