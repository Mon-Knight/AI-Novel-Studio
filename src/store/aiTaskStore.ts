import type { UnifiedAiTaskStatus } from '../types/ai-task';
import type { AiTaskCenterItem, AiTaskUserStatus } from '../types/aiTaskCenter';

export interface AiTaskSummary {
  taskId: string;
  taskType?: string;
  novelId?: string;
  chapterId?: string;
  status: UnifiedAiTaskStatus;
  progress?: string;
  errorSummary?: string;
  artifactId?: string;
  createdAt?: string;
}

export interface AiTaskStoreSnapshot {
  items: AiTaskCenterItem[];
  loading: boolean;
  initialized: boolean;
  error?: string;
  updatedAt?: string;
}

type Listener = () => void;

let state: AiTaskStoreSnapshot = {
  items: [],
  loading: false,
  initialized: false,
};
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function deriveUserStatus(status: UnifiedAiTaskStatus, taskType?: string, previous?: AiTaskCenterItem): AiTaskUserStatus {
  if (['created', 'preparing_context', 'ready', 'queued'].includes(status)) return 'preparing';
  if (status === 'running' || status === 'applying' || status === 'cancel_requested') return 'working';
  if (status === 'validating') return 'checking';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed' && previous?.workflowId
    && previous.stepKey !== 'workflow_root') return 'completed';
  if (status === 'completed' && taskType !== 'connection_test') return 'awaiting_confirmation';
  return 'completed';
}

function summaryToItem(summary: AiTaskSummary, previous?: AiTaskCenterItem): AiTaskCenterItem {
  return {
    source: 'unified',
    id: summary.taskId,
    taskType: summary.taskType || previous?.taskType || 'ai_task',
    status: summary.status,
    userStatus: deriveUserStatus(summary.status, summary.taskType || previous?.taskType, previous),
    isLegacy: false,
    novelId: summary.novelId || previous?.novelId,
    novelTitle: previous?.novelTitle,
    chapterId: summary.chapterId || previous?.chapterId,
    chapterTitle: previous?.chapterTitle,
    progressStage: summary.progress,
    errorMessage: summary.errorSummary,
    createdAt: summary.createdAt || previous?.createdAt || new Date().toISOString(),
    artifactId: summary.artifactId || previous?.artifactId,
    artifactType: previous?.artifactType,
    artifactStatus: previous?.artifactStatus,
    targetLinkCount: previous?.targetLinkCount ?? 0,
    requiresReview: summary.status === 'completed' && (summary.taskType || previous?.taskType) !== 'connection_test',
    resultExpired: previous?.resultExpired ?? false,
    latestAttemptId: previous?.latestAttemptId,
    latestAttemptNumber: previous?.latestAttemptNumber,
    latestAttemptStatus: previous?.latestAttemptStatus,
    providerId: previous?.providerId,
    proposalId: previous?.proposalId,
    applyPlanId: previous?.applyPlanId,
    applyPlanStatus: previous?.applyPlanStatus,
    workflowId: previous?.workflowId,
    workflowName: previous?.workflowName,
    rootTaskId: previous?.rootTaskId,
    parentTaskId: previous?.parentTaskId,
    agentRole: previous?.agentRole,
    stepKey: previous?.stepKey,
    priority: previous?.priority,
    concurrencyGroup: previous?.concurrencyGroup,
    requiredForParent: previous?.requiredForParent,
    dependencyCount: previous?.dependencyCount,
    completedDependencyCount: previous?.completedDependencyCount,
    childCount: previous?.childCount,
    completedChildCount: previous?.completedChildCount,
    failedChildCount: previous?.failedChildCount,
    staleChildCount: previous?.staleChildCount,
    staleReason: previous?.staleReason,
    staleSourceTaskId: previous?.staleSourceTaskId,
  };
}

export const aiTaskStore = {
  upsert(summary: AiTaskSummary): void {
    const existing = state.items.find((item) => item.id === summary.taskId);
    const next = summaryToItem(summary, existing);
    state = {
      ...state,
      initialized: true,
      items: [next, ...state.items.filter((item) => item.id !== summary.taskId)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      updatedAt: new Date().toISOString(),
    };
    emit();
  },

  replace(items: AiTaskCenterItem[]): void {
    state = {
      ...state,
      items: [...items],
      loading: false,
      initialized: true,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    emit();
  },

  setLoading(loading: boolean): void {
    state = { ...state, loading };
    emit();
  },

  setError(error: string): void {
    state = { ...state, loading: false, initialized: true, error };
    emit();
  },

  get(taskId: string): AiTaskSummary | undefined {
    const item = state.items.find((entry) => entry.id === taskId);
    if (!item || item.source !== 'unified') return undefined;
    return {
      taskId: item.id,
      taskType: item.taskType,
      novelId: item.novelId,
      chapterId: item.chapterId,
      status: item.status as UnifiedAiTaskStatus,
      progress: item.progressStage,
      errorSummary: item.errorMessage,
      artifactId: item.artifactId,
      createdAt: item.createdAt,
    };
  },

  list(): AiTaskSummary[] {
    return state.items
      .filter((item) => item.source === 'unified')
      .map((item) => ({
        taskId: item.id,
        taskType: item.taskType,
        novelId: item.novelId,
        chapterId: item.chapterId,
        status: item.status as UnifiedAiTaskStatus,
        progress: item.progressStage,
        errorSummary: item.errorMessage,
        artifactId: item.artifactId,
        createdAt: item.createdAt,
      }));
  },

  getSnapshot(): AiTaskStoreSnapshot {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
