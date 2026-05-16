/**
 * AI Novel Studio - 质量检查类型定义
 */

export type QualityCheckStatus = 'pending' | 'running' | 'completed' | 'failed';
export type QualityCheckScope = 'current_draft' | 'adopted_draft';

export type QualityIssueType =
  | 'logic' | 'setting_violation' | 'character_behavior'
  | 'continuity' | 'language' | 'pacing' | 'style' | 'other';

export type QualityIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export const QualityIssueTypeLabels: Record<QualityIssueType, string> = {
  logic: '逻辑问题', setting_violation: '设定违背', character_behavior: '角色行为',
  continuity: '前后文割裂', language: '语言表达', pacing: '节奏问题', style: '风格一致性', other: '其他',
};

export const QualityIssueSeverityLabels: Record<QualityIssueSeverity, string> = {
  low: '低', medium: '中', high: '高', critical: '严重',
};

export const QualityIssueSeverityColors: Record<QualityIssueSeverity, string> = {
  low: '#6b7280', medium: '#3b82f6', high: '#f97316', critical: '#ef4444',
};

export interface QualityCheckReport {
  id: string; novelId: string; chapterId: string; draftId: string;
  scope: QualityCheckScope; status: QualityCheckStatus;
  overallScore?: number; summary?: string; aiTaskId?: string;
  createdAt: string; updatedAt: string;
}

export interface QualityCheckItem {
  id: string; reportId: string; novelId: string; chapterId: string; draftId: string;
  issueType: QualityIssueType; severity: QualityIssueSeverity;
  title: string; description: string;
  evidence?: string; suggestion?: string;
  startOffset?: number; endOffset?: number;
  isResolved: boolean;
  createdAt: string; updatedAt: string;
}

export interface QualityCheckResult {
  overallScore: number; summary: string;
  items: Array<{
    issueType: QualityIssueType; severity: QualityIssueSeverity;
    title: string; description: string; evidence?: string; suggestion?: string;
    startOffset?: number; endOffset?: number;
  }>;
}

export interface RunQualityCheckInput {
  novelId: string; chapterId: string; draftId: string;
  draftContent: string; chapterTitle: string; chapterOutline?: string;
  chapterGoal?: string; worldBackground?: string; ruleSystems?: string;
  protagonist?: string; specialAbility?: string; abilityLimits?: string;
  chapterCharacters?: string; chapterEvents?: string; previousContext?: string;
}

export interface CreateQualityReportInput {
  novelId: string; chapterId: string; draftId: string;
  scope?: QualityCheckScope;
}

export interface SaveQualityCheckResultInput {
  reportId: string; novelId: string; chapterId: string; draftId: string;
  result: QualityCheckResult;
}
