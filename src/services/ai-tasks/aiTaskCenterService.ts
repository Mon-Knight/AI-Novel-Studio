import type { AiTaskRecord } from '../../types/ai';
import type { AiTaskCenterItem, AiTaskUserStatus } from '../../types/aiTaskCenter';
import { aiTaskStore } from '../../store/aiTaskStore';
import { dbCall, lsGet, lsSet } from '../database/db';
import { describeUnknownError } from '../../utils/errorMessage';
import type { ConstraintValidationResult } from '../../types/chapterConstraintValidation';

const LEGACY_KEYS = ['ai_novel_studio_ai_tasks', 'ai_novel_studio_ai_task_records'];
const ARCHIVED_BROWSER_KEY = 'ai_novel_studio_archived_ai_task_ids';

function legacyStatus(status: AiTaskRecord['status']): AiTaskUserStatus {
  if (status === 'running') return 'working';
  if (status === 'succeeded') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'preparing';
}

function browserFallback(): AiTaskCenterItem[] {
  const byId = new Map<string, AiTaskCenterItem>();
  const archivedIds = new Set(lsGet<string[]>(ARCHIVED_BROWSER_KEY) || []);
  for (const summary of aiTaskStore.list()) {
    if (archivedIds.has(summary.taskId)) continue;
    byId.set(summary.taskId, {
      source: 'unified', id: summary.taskId, taskType: summary.taskType || 'ai_task',
      status: summary.status,
      userStatus: summary.status === 'completed' && summary.taskType !== 'connection_test'
        ? 'awaiting_confirmation'
        : summary.status === 'failed' ? 'failed'
          : summary.status === 'cancelled' ? 'cancelled'
            : summary.status === 'validating' ? 'checking'
              : ['running', 'applying', 'cancel_requested'].includes(summary.status) ? 'working'
                : ['applied', 'completed'].includes(summary.status) ? 'completed' : 'preparing',
      isLegacy: false, novelId: summary.novelId, chapterId: summary.chapterId,
      progressStage: summary.progress, errorMessage: summary.errorSummary,
      createdAt: summary.createdAt || new Date().toISOString(), artifactId: summary.artifactId,
      targetLinkCount: 0, requiresReview: summary.status === 'completed' && summary.taskType !== 'connection_test',
      resultExpired: false,
    });
  }
  for (const key of LEGACY_KEYS) {
    const rows = lsGet<AiTaskRecord[]>(key);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row?.id || byId.has(row.id)) continue;
      byId.set(row.id, {
        source: 'legacy_task', id: row.id, taskType: row.taskType, status: row.status,
        userStatus: legacyStatus(row.status), isLegacy: true,
        novelId: row.novelId, chapterId: row.chapterId, errorMessage: row.errorMessage,
        createdAt: row.createdAt, startedAt: row.startedAt, finishedAt: row.finishedAt,
        providerId: row.provider || row.modelName, inputSummary: row.inputSummary,
        resultSummary: row.resultText, targetLinkCount: 0, requiresReview: false, resultExpired: false,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function hideBrowserTask(item: AiTaskCenterItem): void {
  if (item.source === 'legacy_task') {
    for (const key of LEGACY_KEYS) {
      const rows = lsGet<AiTaskRecord[]>(key);
      if (Array.isArray(rows)) lsSet(key, rows.filter((row) => row.id !== item.id));
    }
    return;
  }
  const archived = new Set(lsGet<string[]>(ARCHIVED_BROWSER_KEY) || []);
  const snapshot = aiTaskStore.getSnapshot().items;
  const relatedIds = item.workflowId
    ? snapshot.filter((entry) => entry.workflowId === item.workflowId).map((entry) => entry.id)
    : [item.id];
  relatedIds.forEach((id) => archived.add(id));
  lsSet(ARCHIVED_BROWSER_KEY, [...archived]);
}

let inFlight: Promise<AiTaskCenterItem[]> | null = null;

export interface TaskArtifactContent {
  artifactId: string;
  taskId: string;
  artifactType: string;
  processingStatus: string;
  content: string;
  rawContent: string;
  baseContent?: string;
  structuredPayload?: unknown;
  constraintValidation?: ConstraintValidationResult;
}

function browserArtifact(artifactId: string): TaskArtifactContent {
  const artifact = lsGet<Record<string, any>>(`ai_novel_studio_result_artifact_${artifactId}`);
  if (!artifact) throw new Error('AI 结果不存在');
  const validations = lsGet<ConstraintValidationResult[]>(
    `ai_novel_studio_chapter_constraint_validation_${artifactId}`,
  ) || [];
  return {
    artifactId,
    taskId: artifact.taskId,
    artifactType: artifact.artifactType,
    processingStatus: artifact.processingStatus,
    content: artifact.displayContent || artifact.rawContent || '',
    rawContent: artifact.rawContent || artifact.displayContent || '',
    structuredPayload: artifact.structuredPayloadJson,
    constraintValidation: validations[validations.length - 1],
  };
}

export const aiTaskCenterService = {
  async list(): Promise<AiTaskCenterItem[]> {
    return dbCall<AiTaskCenterItem[]>('list_ai_task_views', {}, browserFallback);
  },

  async refresh(): Promise<AiTaskCenterItem[]> {
    if (inFlight) return inFlight;
    aiTaskStore.setLoading(true);
    inFlight = aiTaskCenterService.list()
      .then((items) => {
        aiTaskStore.replace(items);
        return items;
      })
      .catch((error: unknown) => {
        const message = describeUnknownError(error, '任务记录读取失败');
        aiTaskStore.setError(message);
        throw error;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  },

  async cancel(taskId: string, workflow = false): Promise<void> {
    await dbCall(workflow ? 'cancel_ai_workflow_task' : 'request_ai_worker_cancel', { taskId });
    await aiTaskCenterService.refresh();
  },

  async retry(taskId: string, workflow = false): Promise<void> {
    await dbCall(workflow ? 'retry_ai_workflow_step' : 'retry_ai_worker_task', { taskId });
    await aiTaskCenterService.refresh();
  },

  async deleteRecord(item: AiTaskCenterItem): Promise<void> {
    if (item.source === 'unified') {
      await dbCall('archive_ai_task_view', { taskId: item.id }, () => hideBrowserTask(item));
    } else if (item.source === 'legacy_task') {
      await dbCall('delete_ai_task_record', { id: item.id }, () => hideBrowserTask(item));
    } else {
      await dbCall('delete_legacy_generation_job_record', { jobId: item.id }, () => hideBrowserTask(item));
    }
    await aiTaskCenterService.refresh();
  },

  async getArtifact(artifactId: string): Promise<TaskArtifactContent> {
    return dbCall<TaskArtifactContent>('get_ai_task_artifact_content', { artifactId }, () => browserArtifact(artifactId));
  },
};
