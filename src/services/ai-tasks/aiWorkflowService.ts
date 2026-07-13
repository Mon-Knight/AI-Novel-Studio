import { aiSettingsService } from '../ai/aiSettingsService';
import { dbCall, isTauri } from '../database/db';
import { aiWorkerClientService } from './aiWorkerClientService';

export interface WorkflowCreated {
  workflowId: string;
  rootTaskId: string;
  childTaskIds: string[];
}

export interface BackgroundWorkflowStep {
  stepKey: string;
  taskType: 'workflow_freeze_chapter' | 'quality_check' | 'quality_fix' | 'quality_recheck'
    | 'workflow_quality_review_bundle' | 'chapter_polish' | 'chapter_summary' | 'volume_summary'
    | 'outline_generate' | 'volume_outline_generate' | 'chapter_outline_generate';
  agentRole: string;
  artifactType: 'chapter_text' | 'quality_report' | 'chapter_summary' | 'volume_summary'
    | 'generic_json' | 'outline_text' | 'volume_outline' | 'chapter_outlines';
  messages: Array<{ role: string; content: string }>;
  dependencies?: string[];
  priority?: number;
  reviewOutput?: boolean;
}

export interface CreateBackgroundWorkflowInput {
  workflowName: string;
  taskType: BackgroundWorkflowStep['taskType'] | 'quality_revision';
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: 'novel' | 'volume' | 'chapter' | 'draft';
  targetHintJson?: Record<string, unknown>;
  inputPayloadJson: Record<string, unknown>;
  inputBody?: string;
  sourceManifestJson: Array<Record<string, unknown>>;
  sourceDraftVersion?: number;
  baseContentHash?: string;
  steps: BackgroundWorkflowStep[];
}

export const aiWorkflowService = {
  async createBackground(input: CreateBackgroundWorkflowInput): Promise<WorkflowCreated> {
    if (!isTauri()) throw new Error('后台 AI 工作流仅在桌面应用中可用。');
    await aiWorkerClientService.configureFromLocalSettings();
    const settings = aiSettingsService.getSettings();
    return dbCall<WorkflowCreated>('create_background_ai_workflow', {
      input: {
        ...input,
        operationId: `background:${input.taskType}:${crypto.randomUUID()}`,
        providerOptionsJson: {
          provider: settings.provider,
          model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          timeoutSeconds: settings.timeoutSeconds,
        },
      },
    });
  },

  async createChapterSummary(input: { novelId: string; chapterId: string; draftId: string; workflowName?: string }): Promise<WorkflowCreated> {
    if (!isTauri()) throw new Error('组合工作流仅在桌面应用中可用。');
    await aiWorkerClientService.configureFromLocalSettings();
    const settings = aiSettingsService.getSettings();
    return dbCall<WorkflowCreated>('create_chapter_summary_workflow', {
      input: {
        ...input,
        providerOptionsJson: {
          provider: settings.provider,
          model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
          temperature: settings.temperature,
          maxTokens: Math.min(settings.maxTokens ?? 4000, 4000),
          timeoutSeconds: settings.timeoutSeconds,
        },
      },
    });
  },
};
