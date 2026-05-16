/**
 * AI Novel Studio - 输出控制方案类型定义
 */

export interface OutputProfile {
  id: string;
  novelId: string;
  name: string;
  description: string;
  chapterWordRange: {
    min: number;
    max: number;
    default: number;
  };
  paragraphLength: 'short' | 'medium' | 'long';
  povType: 'first_person' | 'third_person_limited' | 'third_person_omniscient';
  tenseType: 'past' | 'present';
  createdAt: string;
  updatedAt: string;
}
