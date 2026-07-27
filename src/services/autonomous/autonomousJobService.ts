/**
 * Autonomous Generation Job Service
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 *
 * Manages autonomous generation jobs, quality thresholds, and action audit logs.
 * Desktop-only (Tauri + SQLite). Browser mode is not supported.
 */

import { dbCall, generateId, isTauri } from '../database/db';
import type {
  AcquireChapterLockParams,
  AutonomousAction,
  AutonomousActionType,
  AutonomousGenerationJob,
  AutonomousJobStatus,
  CreateAutonomousJobParams,
  LogAutonomousActionParams,
  PauseAutonomousJobParams,
  QualityThresholds,
  ReleaseChapterLockParams,
  SaveQualityThresholdsParams,
  UpdateAutonomousJobProgressParams,
} from '../../types/autonomous';

// ==================== Default Thresholds ====================

export const DEFAULT_QUALITY_THRESHOLDS: Omit<QualityThresholds, 'novelId' | 'createdAt' | 'updatedAt'> = {
  minTotalScore: 70,
  minLogicScore: 60,
  minSettingScore: 60,
  minCharacterScore: 60,
  minContinuityScore: 70,
  minLanguageScore: 50,
  minPacingScore: 50,
  maxRetryAttempts: 3,
  maxCriticalIssues: 0,
};

// ==================== Desktop Guard ====================

export class AutonomousDesktopRequiredError extends Error {
  readonly code = 'AUTONOMOUS_DESKTOP_REQUIRED';
  readonly retryable = false;

  constructor() {
    super('自主生成功能仅在桌面端（Tauri + SQLite）运行，浏览器模式不支持。');
    this.name = 'AutonomousDesktopRequiredError';
  }
}

function requireDesktop(): void {
  if (!isTauri()) throw new AutonomousDesktopRequiredError();
}

// ==================== Job Service ====================

export const autonomousJobService = {
  isAvailable(): boolean {
    return isTauri();
  },

  newOperationId(novelId: string): string {
    return `auto_gen:${novelId}:${generateId()}`;
  },

  async create(params: CreateAutonomousJobParams): Promise<AutonomousGenerationJob> {
    requireDesktop();
    const operationId = autonomousJobService.newOperationId(params.novelId);
    return dbCall('create_autonomous_job', {
      input: {
        novelId: params.novelId,
        operationId,
        totalChapters: params.totalChapters,
      },
    });
  },

  async get(jobId: string): Promise<AutonomousGenerationJob | null> {
    requireDesktop();
    return dbCall('get_autonomous_job', { input: { jobId } });
  },

  async listByNovel(novelId: string): Promise<AutonomousGenerationJob[]> {
    requireDesktop();
    return dbCall('list_autonomous_jobs_by_novel', { input: { novelId } });
  },

  async start(jobId: string): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('update_autonomous_job_status', {
      input: { jobId, status: 'running' as AutonomousJobStatus },
    });
  },

  async updateProgress(params: UpdateAutonomousJobProgressParams): Promise<AutonomousGenerationJob> {
    requireDesktop();
    // Rust accepts token deltas (`tokensInput`/`tokensOutput`); keep the
    // cumulative TypeScript names at this facade boundary.
    return dbCall('update_autonomous_job_progress', {
      input: {
        jobId: params.jobId,
        completedChapters: params.completedChapters,
        currentChapterId: params.currentChapterId,
        currentChapterAttempt: params.currentChapterAttempt,
        tokensInput: params.tokensInput,
        tokensOutput: params.tokensOutput,
        estimatedCostUsd: params.estimatedCostUsd,
      },
    });
  },

  async pause(params: PauseAutonomousJobParams): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('pause_autonomous_job', { input: params });
  },

  async resume(jobId: string): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('resume_autonomous_job', { input: { jobId } });
  },

  async complete(jobId: string): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('update_autonomous_job_status', {
      input: { jobId, status: 'completed' as AutonomousJobStatus },
    });
  },

  async fail(jobId: string): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('update_autonomous_job_status', {
      input: { jobId, status: 'failed' as AutonomousJobStatus },
    });
  },

  async cancel(jobId: string): Promise<AutonomousGenerationJob> {
    requireDesktop();
    return dbCall('cancel_autonomous_job', { input: { jobId } });
  },

  // ==================== Quality Thresholds ====================

  async getThresholds(novelId: string): Promise<QualityThresholds> {
    return this.getQualityThresholds(novelId);
  },

  async getQualityThresholds(novelId: string): Promise<QualityThresholds> {
    requireDesktop();
    const stored: QualityThresholds | null = await dbCall('get_quality_thresholds', { input: { novelId } });
    if (stored) return stored;

    // 返回默认阈值（未持久化）
    const now = new Date().toISOString();
    return {
      novelId,
      ...DEFAULT_QUALITY_THRESHOLDS,
      createdAt: now,
      updatedAt: now,
    };
  },

  async saveQualityThresholds(params: SaveQualityThresholdsParams): Promise<QualityThresholds> {
    requireDesktop();

    // 合并默认值
    const existing = await autonomousJobService.getQualityThresholds(params.novelId).catch(() => null);
    const base = existing ?? { novelId: params.novelId, ...DEFAULT_QUALITY_THRESHOLDS };

    return dbCall('save_quality_thresholds', {
      input: {
        novelId: params.novelId,
        minTotalScore: params.minTotalScore ?? base.minTotalScore,
        minLogicScore: params.minLogicScore ?? base.minLogicScore,
        minSettingScore: params.minSettingScore ?? base.minSettingScore,
        minCharacterScore: params.minCharacterScore ?? base.minCharacterScore,
        minContinuityScore: params.minContinuityScore ?? base.minContinuityScore,
        minLanguageScore: params.minLanguageScore ?? base.minLanguageScore,
        minPacingScore: params.minPacingScore ?? base.minPacingScore,
        maxRetryAttempts: params.maxRetryAttempts ?? base.maxRetryAttempts,
        maxCriticalIssues: params.maxCriticalIssues ?? base.maxCriticalIssues,
      },
    });
  },

  // ==================== Audit Log ====================

  async logAction(params: LogAutonomousActionParams): Promise<AutonomousAction> {
    requireDesktop();
    // Migration 023's current schema accepts the complete Phase 0-5 action
    // vocabulary. Keep the semantic type intact for filtering and replay.
    const supported = new Set<AutonomousActionType>([
      'auto_generate', 'auto_quality_check', 'auto_adopt', 'auto_fix',
      'auto_retry', 'auto_pause', 'auto_summary', 'continuity_check',
      'continuity_warning', 'expert_review', 'skip_chapter',
    ]);
    const persistedType = supported.has(params.actionType)
      ? params.actionType
      : 'auto_quality_check';
    return dbCall('log_autonomous_action', {
      input: {
        ...params,
        actionType: persistedType,
        decisionReason: params.actionType === persistedType
          ? params.decisionReason
          : `[${params.actionType}] ${params.decisionReason}`,
      },
    });
  },

  async listActions(jobId: string): Promise<AutonomousAction[]> {
    requireDesktop();
    return dbCall('list_autonomous_actions', { input: { jobId } });
  },

  // ==================== Chapter Lock ====================

  async acquireChapterLock(params: AcquireChapterLockParams): Promise<boolean> {
    requireDesktop();
    return dbCall('acquire_chapter_lock', {
      input: {
        chapterId: params.chapterId,
        jobId: params.jobId,
        lockedBy: params.lockedBy,
        lockDurationSeconds: params.ttlSeconds,
      },
    });
  },

  async releaseChapterLock(params: ReleaseChapterLockParams): Promise<boolean> {
    requireDesktop();
    return dbCall('release_chapter_lock', { input: params });
  },

  async cleanupExpiredLocks(): Promise<number> {
    requireDesktop();
    return dbCall('cleanup_expired_locks', {});
  },
};
