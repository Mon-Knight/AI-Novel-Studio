export type AiTaskViewSource = 'unified' | 'legacy_task' | 'legacy_generation';

export type AiTaskUserStatus =
  | 'preparing'
  | 'working'
  | 'checking'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface AiTaskCenterItem {
  source: AiTaskViewSource;
  id: string;
  taskType: string;
  status: string;
  userStatus: AiTaskUserStatus;
  isLegacy: boolean;
  novelId?: string;
  novelTitle?: string;
  chapterId?: string;
  chapterTitle?: string;
  progressPercent?: number;
  progressStage?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  latestAttemptId?: string;
  latestAttemptNumber?: number;
  latestAttemptStatus?: string;
  providerId?: string;
  responseMetadataJson?: string;
  artifactId?: string;
  artifactType?: string;
  artifactStatus?: string;
  artifactContentHash?: string;
  artifactContentLength?: number;
  artifactIssue?: string;
  proposalId?: string;
  applyPlanId?: string;
  applyPlanStatus?: string;
  targetLinkCount: number;
  requiresReview: boolean;
  resultExpired: boolean;
  traceId?: string;
  operationId?: string;
  requestHash?: string;
  inputSummary?: string;
  resultSummary?: string;
  workflowId?: string;
  workflowName?: string;
  rootTaskId?: string;
  parentTaskId?: string;
  agentRole?: string;
  stepKey?: string;
  priority?: number;
  concurrencyGroup?: string;
  requiredForParent?: boolean;
  dependencyCount?: number;
  completedDependencyCount?: number;
  childCount?: number;
  completedChildCount?: number;
  failedChildCount?: number;
  staleChildCount?: number;
  staleReason?: string;
  staleSourceTaskId?: string;
}

export const AI_TASK_USER_STATUS_LABELS: Record<AiTaskUserStatus, string> = {
  preparing: '准备中',
  working: '工作中',
  checking: '检查结果',
  awaiting_confirmation: '等待确认',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
  expired: '结果已过期',
};
