/**
 * AI Novel Studio - 质量检查类型定义
 * v1.7.12: 引入问题处理闭环状态系统
 */

export type QualityCheckStatus = 'pending' | 'running' | 'completed' | 'failed';
export type QualityCheckScope = 'current_draft' | 'adopted_draft';

export type QualityIssueType =
  | 'logic' | 'setting_violation' | 'character_behavior'
  | 'continuity' | 'language' | 'pacing' | 'style' | 'other';

export type QualityIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/** 问题处理状态：pending=待处理, resolved=已处理, ignored=已忽略 */
export type QualityIssueStatus = 'pending' | 'resolved' | 'ignored';

/** 问题筛选视图 */
export type QualityIssueFilter = 'all' | 'pending' | 'resolved' | 'ignored';

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

export const QualityIssueStatusLabels: Record<QualityIssueStatus, string> = {
  pending: '待处理', resolved: '已处理', ignored: '已忽略',
};

export const QualityIssueFilterLabels: Record<QualityIssueFilter, string> = {
  all: '全部', pending: '待处理', resolved: '已处理', ignored: '已忽略',
};

/** 质量检查问题统计 */
export interface QualityCheckStatistics {
  total: number;
  pending: number;
  resolved: number;
  ignored: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface QualityCheckReport {
  id: string; novelId: string; chapterId: string; draftId: string;
  scope: QualityCheckScope; status: QualityCheckStatus;
  overallScore?: number; summary?: string; aiTaskId?: string;
  draftVersion?: number; model?: string;
  createdAt: string; updatedAt: string;
}

export interface QualityCheckItem {
  id: string; reportId: string; novelId: string; chapterId: string; draftId: string;
  issueType: QualityIssueType; severity: QualityIssueSeverity;
  title: string; description: string;
  /** AI 返回的原问题类别（中文），如「设定违背」「逻辑漏洞」 */
  category?: string;
  evidence?: string; suggestion?: string;
  /** 引用原文片段 */
  quote?: string;
  startOffset?: number; endOffset?: number;
  /** 段落索引 */
  paragraphIndex?: number;
  /** 问题稳定标识，用于重新检测时去重 */
  issueKey: string;
  /** 问题处理状态 */
  status: QualityIssueStatus;
  /** 处理备注 */
  resolutionNote?: string;
  /** 处理时间 */
  resolvedAt?: string;
  createdAt: string; updatedAt: string;
}

export interface QualityCheckResult {
  overallScore: number; summary: string;
  items: Array<{
    issueType?: QualityIssueType; severity: QualityIssueSeverity;
    /** AI 返回的类别（中文） */
    category?: string;
    title: string; description: string; evidence?: string; suggestion?: string;
    /** 引用原文片段 */
    quote?: string;
    startOffset?: number; endOffset?: number;
    paragraphIndex?: number;
  }>;
}

export interface RunQualityCheckInput {
  novelId: string; chapterId: string; draftId: string;
  /** v1.7.15 卷ID，用于上下文读取 */
  volumeId?: string;
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
  draftVersion?: number;
  model?: string;
}

/** 获取质量检查结果返回 */
export interface GetQualityCheckIssuesResult {
  report: QualityCheckReport | null;
  items: QualityCheckItem[];
  statistics: QualityCheckStatistics;
}

