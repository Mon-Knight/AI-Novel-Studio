/**
 * Autonomous Generation Orchestrator
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 *
 * 核心编排器：自主生成 → 质量检查 → 自动采纳/修正 闭环
 * 基于 Chapter Readiness Planner (v2.5.0) 和 Quality Check 体系 (v2.3.0)
 */

import { autonomousJobService } from './autonomousJobService';
import { autoQualityCheckService } from './autoQualityCheckService';
import { autoPolishService } from './autoPolishService';
import { autoSummaryService } from './autoSummaryService';
import { continuitySentinelService } from './continuitySentinelService';
import { expertAgentSystem } from './expertAgentSystem';
import type { ExpertType } from './expertAgentSystem';
import { agentPlanPersistenceService } from '../agent-planner/agentPlanPersistenceService';
import { agentPlanRuntimeService } from '../agent-planner/agentPlanRuntimeService';
import { tokenAggregationService } from './tokenAggregationService';
import { runAutonomousProvider } from './autonomousProvider';
import { buildFreshChapterGenerationContext } from '../prompt/contextBuilder';
import { buildGenerateRequest } from '../prompt/promptOrchestrator';
import { draftVersionService } from '../database/draftVersionService';
import type {
  AutonomousGenerationJob,
  AutonomousActionType,
  QualityThresholds,
} from '../../types/autonomous';
import type { AgentPlanBundle } from '../../types/agentPlan';

// Tool Registry hash — must match productionToolRegistry.ts
// Imported inline to avoid circular dependency
const CHAPTER_READINESS_REGISTRY_HASH =
  '846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871';

// ==================== Types ====================

export interface ChapterGenerationPlan {
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
}

export interface AutoGenContext {
  job: AutonomousGenerationJob;
  thresholds: QualityThresholds;
  currentChapter: ChapterGenerationPlan;
  attemptNumber: number;
}

export interface AutoGenResult {
  success: boolean;
  adopted: boolean;
  qualityScore: number | null;
  qualityReportId: string | null;
  errorMessage: string | null;
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
}

// ==================== Orchestrator ====================

export const autonomousOrchestrator = {
  /**
   * Phase 5: Multi-Agent 协作生成
   *
   * 由多个专家 Agent 协商评审，达成共识后采纳
   */
  async generateChapterWithExperts(
    ctx: AutoGenContext,
    experts: ExpertType[] = ['character', 'setting', 'logic', 'quality'],
    signal?: AbortSignal,
  ): Promise<AutoGenResult> {
    return autonomousOrchestrator.generateChapterAutonomously(ctx, experts, signal);
  },

  /**
   * Phase 3: 多章并发生成
   *
   * 并发生成多个章节（最多 N 个并发），动态调度
   */
  async runConcurrentChapterGeneration(
    jobId: string,
    maxConcurrency: number = 3,
    signal?: AbortSignal,
  ): Promise<void> {
    let job = await autonomousJobService.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const thresholds = await autonomousJobService.getThresholds(job.novelId);
    job = await autonomousOrchestrator._recoverAdoptedSummaries(job, signal);
    if (job.status !== 'running') return;
    const chapters = await autonomousOrchestrator._getTargetChapters(job);

    const queue = [...chapters];
    const running = new Map<string, Promise<void>>();
    let completedCount = job.completedChapters;
    let firstFailure: { chapterId: string; message: string } | null = null;

    while (queue.length > 0 || running.size > 0) {
      if (signal?.aborted) break;
      // 检查任务状态（可能被用户暂停/取消）
      const currentJob = await autonomousJobService.get(jobId);
      if (!currentJob || currentJob.status === 'paused' || currentJob.status === 'cancelled') {
        // 等待所有运行中的任务完成
        await Promise.all(running.values());
        break;
      }

      // 启动新任务（不超过并发上限）
      while (running.size < maxConcurrency && queue.length > 0) {
        const chapter = queue.shift()!;

        // 启动章节生成（异步）
        const task = autonomousOrchestrator
          ._runSingleChapterWithRetry(jobId, chapter, thresholds, signal)
          .then(async result => {
            if (result.success) {
              // 生成章节总结
              const summary = await autoSummaryService.generateChapterSummary({
                novelId: job.novelId,
                chapterId: chapter.chapterId,
                draftId: result.draftId ?? '',
                signal,
              });
              if (!summary.success) {
                if (!firstFailure) {
                  firstFailure = {
                    chapterId: chapter.chapterId,
                    message: summary.errorMessage ?? '章节总结失败',
                  };
                }
                const latest = await autonomousJobService.get(jobId);
                if (latest?.status === 'running') {
                  await autonomousJobService.pause({
                    jobId,
                    chapterId: chapter.chapterId,
                    reason: `章节 ${chapter.chapterOrder} 已采纳，但总结失败：${firstFailure.message}`,
                  });
                }
                return;
              }
              completedCount += 1;

              // 更新完成进度
              const latest = await autonomousJobService.get(jobId);
              const tokenInput = result.tokenInput + summary.tokenInput;
              const tokenOutput = result.tokenOutput + summary.tokenOutput;
              await autonomousJobService.updateProgress({
                jobId,
                completedChapters: completedCount,
                currentChapterId: chapter.chapterId,
                currentChapterAttempt: 1,
                tokensInput: tokenInput,
                tokensOutput: tokenOutput,
                estimatedCostUsd: (latest?.estimatedCostUsd ?? 0)
                  + tokenAggregationService.estimateCostUsd(tokenInput, tokenOutput),
              });
            } else if (result.tokenInput > 0 || result.tokenOutput > 0) {
              const latest = await autonomousJobService.get(jobId);
              await autonomousJobService.updateProgress({
                jobId,
                completedChapters: latest?.completedChapters ?? completedCount,
                currentChapterId: chapter.chapterId,
                currentChapterAttempt: 1,
                tokensInput: result.tokenInput,
                tokensOutput: result.tokenOutput,
                estimatedCostUsd: (latest?.estimatedCostUsd ?? 0)
                  + tokenAggregationService.estimateCostUsd(result.tokenInput, result.tokenOutput),
              });
            }
            if (!result.success && !firstFailure) {
              firstFailure = {
                chapterId: chapter.chapterId,
                message: result.errorMessage ?? '章节生成失败',
              };
              const latest = await autonomousJobService.get(jobId);
              if (latest?.status === 'running') {
                await autonomousJobService.pause({
                  jobId,
                  chapterId: chapter.chapterId,
                  reason: `章节 ${chapter.chapterOrder} 生成失败：${firstFailure.message}`,
                });
              }
            }
          })
          .catch(error => {
            console.error(`Chapter ${chapter.chapterId} generation failed:`, error);
          })
          .finally(async () => {
            running.delete(chapter.chapterId);
          });

        running.set(chapter.chapterId, task);
      }

      // 等待任意一个任务完成（如果有运行中的任务）
      if (running.size > 0) {
        await Promise.race(running.values());
      } else {
        // 队列中还有章节，但都获取锁失败，等待一会儿再试
        if (queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // 检查是否全部完成
    const finalJob = await autonomousJobService.get(jobId);
    if (finalJob && finalJob.completedChapters === finalJob.totalChapters) {
      await autonomousJobService.complete(jobId);
    }
  },

  /**
   * Phase 2: 多章顺序生成主循环
   *
   * 按章节顺序自动生成多章，每章完成后自动进入下一章
   * 支持中断恢复（从失败章节继续）
   */
  async runMultiChapterGeneration(jobId: string, signal?: AbortSignal): Promise<void> {
    // 获取任务信息
    let job = await autonomousJobService.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // 获取质量阈值
    const thresholds = await autonomousJobService.getThresholds(job.novelId);
    job = await autonomousOrchestrator._recoverAdoptedSummaries(job, signal);
    if (job.status !== 'running') return;

    // 获取目标章节列表（按顺序）
    const chapters = await autonomousOrchestrator._getTargetChapters(job);

    for (const chapter of chapters) {
      if (signal?.aborted) break;
      // 检查任务状态（可能被用户暂停/取消）
      const currentJob = await autonomousJobService.get(jobId);
      if (!currentJob) break;

      if (currentJob.status === 'paused') {
        await autonomousOrchestrator._logAction(
          { job: currentJob, currentChapter: chapter, thresholds, attemptNumber: 1 },
          'auto_pause',
          { success: true, reason: '任务已被用户暂停' }
        );
        break;
      }

      if (currentJob.status === 'cancelled') {
        await autonomousOrchestrator._logAction(
          { job: currentJob, currentChapter: chapter, thresholds, attemptNumber: 1 },
          'auto_pause',
          { success: true, reason: '任务已被用户取消' }
        );
        break;
      }

      // 更新当前章节
      // 更新当前章节
      await autonomousJobService.updateProgress({
        jobId,
        currentChapterId: chapter.chapterId,
        completedChapters: currentJob.completedChapters,
        currentChapterAttempt: 1,
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCostUsd: currentJob.estimatedCostUsd,
      });

      // 执行单章生成（带重试）
      const result = await autonomousOrchestrator._runSingleChapterWithRetry(
        jobId,
        chapter,
        thresholds,
        signal,
      );

      const usageJob = await autonomousJobService.get(jobId);
      if (usageJob && (result.tokenInput > 0 || result.tokenOutput > 0)) {
        await autonomousJobService.updateProgress({
          jobId,
          completedChapters: usageJob.completedChapters,
          currentChapterId: chapter.chapterId,
          currentChapterAttempt: result.attempts,
          tokensInput: result.tokenInput,
          tokensOutput: result.tokenOutput,
          estimatedCostUsd: usageJob.estimatedCostUsd
            + tokenAggregationService.estimateCostUsd(result.tokenInput, result.tokenOutput),
        });
      }

      if (!result.success) {
        const statusAfterFailure = await autonomousJobService.get(jobId);
        if (statusAfterFailure?.status === 'paused' || statusAfterFailure?.status === 'cancelled') {
          break;
        }
        // 任一章节在重试耗尽后失败都必须进入可恢复的暂停终态，不能留下
        // “running 但没有 worker”或越过上下文缺口继续生成后文。
        if (statusAfterFailure?.status === 'running') {
          await autonomousJobService.pause({
            jobId,
            chapterId: chapter.chapterId,
            reason: `章节 ${chapter.chapterOrder} 生成失败：${result.errorMessage ?? 'unknown'}`,
          });
        }
        await autonomousOrchestrator._logAction(
          { job: statusAfterFailure ?? currentJob, currentChapter: chapter, thresholds, attemptNumber: result.attempts },
          'auto_pause',
          { success: false, reason: `章节生成失败并暂停：${result.errorMessage ?? 'unknown'}` },
        );
        break;
      }

      // 成功：生成章节总结（Phase 2）
      const summaryResult = await autoSummaryService.generateChapterSummary({
        novelId: job.novelId,
        chapterId: chapter.chapterId,
        draftId: result.draftId ?? '',
        signal,
      });
      await autonomousOrchestrator._logAction(
        {
          job: (await autonomousJobService.get(jobId)) ?? currentJob,
          currentChapter: chapter,
          thresholds,
          attemptNumber: result.attempts,
        },
        'auto_summary',
        {
          success: summaryResult.success,
          reason: summaryResult.success
            ? '章节总结已生成并保存'
            : `章节总结生成失败：${summaryResult.errorMessage ?? 'unknown'}`,
          errorMessage: summaryResult.errorMessage,
          tokensUsed: summaryResult.tokensUsed,
        },
      );

      if (!summaryResult.success) {
        const latest = await autonomousJobService.get(jobId);
        if (latest?.status === 'running') {
          await autonomousJobService.pause({
            jobId,
            chapterId: chapter.chapterId,
            reason: `章节 ${chapter.chapterOrder} 已采纳，但总结失败：${summaryResult.errorMessage ?? 'unknown'}`,
          });
        }
        break;
      }

      // 更新完成进度
      const updatedJob = await autonomousJobService.get(jobId);
      if (updatedJob) {
        const completedCount = Math.min(updatedJob.totalChapters, updatedJob.completedChapters + 1);
        await autonomousJobService.updateProgress({
          jobId,
          completedChapters: completedCount,
          currentChapterId: chapter.chapterId,
          currentChapterAttempt: result.attempts,
          tokensInput: summaryResult.tokenInput,
          tokensOutput: summaryResult.tokenOutput,
          estimatedCostUsd: updatedJob.estimatedCostUsd
            + tokenAggregationService.estimateCostUsd(
              summaryResult.tokenInput,
              summaryResult.tokenOutput,
            ),
        });
      }
    }

    // 检查是否全部完成
    const finalJob = await autonomousJobService.get(jobId);
    if (finalJob && finalJob.completedChapters === finalJob.totalChapters) {
      await autonomousJobService.complete(jobId);
    }
  },

  /**
   * 单章生成（带重试）
   */
  async _runSingleChapterWithRetry(
    jobId: string,
    chapter: { chapterId: string; chapterOrder: number; chapterTitle: string },
    thresholds: QualityThresholds,
    signal?: AbortSignal,
  ): Promise<{
    success: boolean;
    draftId: string | null;
    errorMessage: string | null;
    tokenInput: number;
    tokenOutput: number;
    attempts: number;
  }> {
    if (!await autonomousJobService.get(jobId)) {
      return {
        success: false,
        draftId: null,
        errorMessage: 'Job not found',
        tokenInput: 0,
        tokenOutput: 0,
        attempts: 0,
      };
    }

    let attemptNumber = 1;
    let lastError: string | null = null;
    let tokenInput = 0;
    let tokenOutput = 0;

    while (attemptNumber <= thresholds.maxRetryAttempts) {
      if (signal?.aborted) {
        return {
          success: false,
          draftId: null,
          errorMessage: 'Autonomous execution cancelled',
          tokenInput,
          tokenOutput,
          attempts: attemptNumber - 1,
        };
      }
      const job = await autonomousJobService.get(jobId);
      if (!job || job.status !== 'running') {
        return {
          success: false,
          draftId: null,
          errorMessage: job ? `Job is ${job.status}` : 'Job not found',
          tokenInput,
          tokenOutput,
          attempts: attemptNumber - 1,
        };
      }
      const ctx: AutoGenContext = {
        job,
        currentChapter: chapter,
        thresholds,
        attemptNumber,
      };

      const result = await autonomousOrchestrator.generateChapterAutonomously(ctx, undefined, signal);
      tokenInput += result.tokenInput;
      tokenOutput += result.tokenOutput;

      if (result.success && result.adopted) {
        const adoptedChapter = await import('../database/db').then(({ dbCall }) =>
          dbCall('get_chapter_by_id', { id: chapter.chapterId })
        ) as { adoptedDraftId?: string | null } | null;
        return {
          success: true,
          draftId: adoptedChapter?.adoptedDraftId ?? null,
          errorMessage: null,
          tokenInput,
          tokenOutput,
          attempts: attemptNumber,
        };
      }

      lastError = result.errorMessage;
      attemptNumber++;
    }

    // 重试耗尽
    return {
      success: false,
      draftId: null,
      errorMessage: lastError,
      tokenInput,
      tokenOutput,
      attempts: Math.max(0, attemptNumber - 1),
    };
  },

  /**
   * Phase 0: 单章自主生成流程
   *
   * 流程：
   * 1. 锁定章节
   * 2. 启动 Chapter Readiness Planner（6步DAG）
   * 3. 等待 Planner 完成（生成正文并存为草稿）
   * 4. 自动质量检查
   * 5. 判断：通过 → 自动采纳；不通过 → 重试或暂停
   * 6. 释放锁定，记录审计日志
   */
  async generateChapterAutonomously(
    ctx: AutoGenContext,
    experts: ExpertType[] = ['character', 'setting', 'logic', 'quality'],
    signal?: AbortSignal,
  ): Promise<AutoGenResult> {
    const startTime = Date.now();
    let tokenInput = 0;
    let tokenOutput = 0;
    let qualityReportId: string | null = null;
    let qualityScore: number | null = null;
    let lockAcquired = false;
    const lockOwner = `orchestrator:${ctx.job.operationId}:${ctx.attemptNumber}`;

    const addUsage = (input: number, output: number): void => {
      tokenInput += Math.max(0, input);
      tokenOutput += Math.max(0, output);
    };

    const rejectCandidate = async (reason: string): Promise<AutoGenResult> => {
      const exhausted = ctx.attemptNumber >= ctx.thresholds.maxRetryAttempts;
      if (exhausted) {
        const current = await autonomousJobService.get(ctx.job.id).catch(() => null);
        if (current?.status === 'running') {
          await autonomousJobService.pause({
            jobId: ctx.job.id,
            reason: `章节 ${ctx.currentChapter.chapterOrder} 未通过自动门禁，已达最大重试次数（${ctx.thresholds.maxRetryAttempts}）`,
            chapterId: ctx.currentChapter.chapterId,
          });
        }
      }
      await autonomousOrchestrator._logAction(ctx, exhausted ? 'auto_pause' : 'auto_retry', {
        success: false,
        reason: exhausted ? `${reason}；任务已暂停` : `${reason}；准备下一次重试`,
        qualityScore,
        qualityReportId,
      });
      return {
        success: false,
        adopted: false,
        qualityScore,
        qualityReportId,
        errorMessage: exhausted ? `${reason}，已暂停任务` : `${reason}，将重试`,
        tokensUsed: tokenInput + tokenOutput,
        tokenInput,
        tokenOutput,
        durationMs: Date.now() - startTime,
      };
    };

    try {
      await autonomousOrchestrator._assertJobRunning(ctx.job.id);

      // Step 1: 锁定章节（TTL 30分钟）
      lockAcquired = await autonomousJobService.acquireChapterLock({
        chapterId: ctx.currentChapter.chapterId,
        jobId: ctx.job.id,
        lockedBy: lockOwner,
        ttlSeconds: 1800,
      });

      if (!lockAcquired) {
        await autonomousOrchestrator._logAction(ctx, 'auto_pause', {
          success: false,
          reason: '章节已被其他任务锁定',
        });
        throw new Error('CHAPTER_LOCKED');
      }

      await autonomousOrchestrator._logAction(ctx, 'auto_generate', {
        success: true,
        reason: `开始生成章节 "${ctx.currentChapter.chapterTitle}"（第 ${ctx.attemptNumber} 次尝试）`,
      });

      // Step 2: 创建 Chapter Readiness Plan
      const plan = await autonomousOrchestrator._createReadinessPlan(ctx);

      // Step 3: 执行 Plan（6步DAG，跨重启续跑）
      const planResult = await autonomousOrchestrator._executePlan(plan, ctx, signal);
      addUsage(planResult.tokenInput, planResult.tokenOutput);

      if (!planResult.success || !planResult.draftId) {
        throw new Error(`章节生成失败: ${planResult.errorMessage}`);
      }

      await autonomousOrchestrator._logAction(ctx, 'auto_generate', {
        success: true,
        reason: `章节生成完成，Token 消耗: ${planResult.tokenInput + planResult.tokenOutput}`,
        tokensUsed: planResult.tokensUsed,
      });

      await autonomousOrchestrator._assertJobRunning(ctx.job.id);
      let candidateDraftId = planResult.draftId;

      // Step 4: 对精确草稿执行质量检查。
      let qualityCheckResult = await autoQualityCheckService.runAutoQualityCheck({
        novelId: ctx.job.novelId,
        chapterId: ctx.currentChapter.chapterId,
        draftId: candidateDraftId,
        thresholds: ctx.thresholds,
        signal,
      });

      addUsage(qualityCheckResult.tokenInput, qualityCheckResult.tokenOutput);
      qualityReportId = qualityCheckResult.reportId;
      qualityScore = qualityCheckResult.totalScore;

      await autonomousOrchestrator._logAction(ctx, 'auto_quality_check', {
        success: true,
        reason: `质量检查完成，总分: ${qualityScore}/100`,
        qualityScore,
        qualityReportId,
        tokensUsed: qualityCheckResult.tokensUsed,
      });

      // Step 5: 仅语言问题可自动润色；润色产物必须重新质检。
      if (
        qualityCheckResult.evaluation.decision === 'fix_only'
        && qualityCheckResult.evaluation.autoFixableIssues.length > 0
      ) {
        await autonomousOrchestrator._logAction(ctx, 'auto_fix', {
          success: true,
          reason: `检测到 ${qualityCheckResult.evaluation.autoFixableIssues.length} 个可修复语言问题，开始自动润色`,
          qualityScore,
          qualityReportId,
        });

        const polishResult = await autoPolishService.autoPolish({
          novelId: ctx.job.novelId,
          chapterId: ctx.currentChapter.chapterId,
          draftId: candidateDraftId,
          issues: qualityCheckResult.evaluation.autoFixableIssues,
          signal,
        });
        addUsage(polishResult.tokenInput, polishResult.tokenOutput);
        if (!polishResult.success || !polishResult.newDraftId) {
          await autonomousOrchestrator._logAction(ctx, 'auto_fix', {
            success: false,
            reason: `自动润色失败: ${polishResult.errorMessage ?? 'unknown'}`,
            errorMessage: polishResult.errorMessage,
          });
          return rejectCandidate('自动润色失败');
        }

        candidateDraftId = polishResult.newDraftId;
        await autonomousOrchestrator._assertJobRunning(ctx.job.id);
        qualityCheckResult = await autoQualityCheckService.runAutoQualityCheck({
          novelId: ctx.job.novelId,
          chapterId: ctx.currentChapter.chapterId,
          draftId: candidateDraftId,
          thresholds: ctx.thresholds,
          signal,
        });
        addUsage(qualityCheckResult.tokenInput, qualityCheckResult.tokenOutput);
        qualityReportId = qualityCheckResult.reportId;
        qualityScore = qualityCheckResult.totalScore;
        await autonomousOrchestrator._logAction(ctx, 'auto_quality_check', {
          success: qualityCheckResult.evaluation.decision === 'adopt',
          reason: `润色后复检完成，总分: ${qualityScore}/100，决策: ${qualityCheckResult.evaluation.decision}`,
          qualityScore,
          qualityReportId,
          tokensUsed: qualityCheckResult.tokensUsed,
        });
      }

      if (qualityCheckResult.evaluation.decision !== 'adopt') {
        return rejectCandidate(`质量门禁拒绝采纳：${qualityCheckResult.evaluation.decisionReason}`);
      }

      // Step 6: 专家并行评审；如产生新草稿，新草稿再次经过同一质量门禁。
      const reviewResult = await expertAgentSystem.collaborativeReview({
        novelId: ctx.job.novelId,
        chapterId: ctx.currentChapter.chapterId,
        draftId: candidateDraftId,
        experts,
        operationId: `${ctx.job.operationId}:chapter:${ctx.currentChapter.chapterOrder}:attempt:${ctx.attemptNumber}:experts`,
        signal,
      });
      addUsage(reviewResult.tokenInput, reviewResult.tokenOutput);
      const consensus = reviewResult.rounds[reviewResult.rounds.length - 1]?.consensus;
      await autonomousOrchestrator._logAction(ctx, 'expert_review', {
        success: reviewResult.success,
        reason: reviewResult.success
          ? `专家评审通过：${reviewResult.rounds.length} 轮，平均分 ${consensus?.averageScore ?? 0}`
          : reviewResult.errorMessage ?? '专家评审未达成共识',
        tokensUsed: reviewResult.tokensUsed,
        errorMessage: reviewResult.errorMessage,
      });
      if (!reviewResult.success || !reviewResult.finalDraftId) {
        return rejectCandidate(reviewResult.errorMessage ?? '专家评审未通过');
      }

      if (reviewResult.finalDraftId !== candidateDraftId) {
        candidateDraftId = reviewResult.finalDraftId;
        await autonomousOrchestrator._assertJobRunning(ctx.job.id);
        qualityCheckResult = await autoQualityCheckService.runAutoQualityCheck({
          novelId: ctx.job.novelId,
          chapterId: ctx.currentChapter.chapterId,
          draftId: candidateDraftId,
          thresholds: ctx.thresholds,
          signal,
        });
        addUsage(qualityCheckResult.tokenInput, qualityCheckResult.tokenOutput);
        qualityReportId = qualityCheckResult.reportId;
        qualityScore = qualityCheckResult.totalScore;
        if (qualityCheckResult.evaluation.decision !== 'adopt') {
          return rejectCandidate(`专家修订稿复检未通过：${qualityCheckResult.evaluation.decisionReason}`);
        }
      }

      // Step 7: 连续性检查必须在采纳前针对候选草稿执行。
      if (ctx.currentChapter.chapterOrder > 1) {
        const previousChapters = await autonomousOrchestrator._getPreviousChapters(
          ctx.currentChapter.chapterId,
          3,
        );
        const continuityResult = await continuitySentinelService.checkContinuity({
          novelId: ctx.job.novelId,
          chapterId: ctx.currentChapter.chapterId,
          draftId: candidateDraftId,
          previousChapterIds: previousChapters.map((chapter) => chapter.id),
          operationId: `${ctx.job.operationId}:chapter:${ctx.currentChapter.chapterOrder}:attempt:${ctx.attemptNumber}:continuity`,
          signal,
        });
        addUsage(continuityResult.tokenInput, continuityResult.tokenOutput);
        const criticalIssues = continuityResult.issues.filter((issue) => issue.severity === 'critical');
        const continuityPassed = continuityResult.success
          && continuityResult.score >= ctx.thresholds.minContinuityScore
          && criticalIssues.length <= ctx.thresholds.maxCriticalIssues;
        await autonomousOrchestrator._logAction(ctx, 'continuity_check', {
          success: continuityPassed,
          reason: `连续性检查 ${continuityResult.score}/100，状态 ${continuityResult.status}`,
          tokensUsed: continuityResult.tokensUsed,
          errorMessage: continuityResult.errorMessage,
        });
        if (!continuityPassed) {
          await autonomousOrchestrator._logAction(ctx, 'continuity_warning', {
            success: false,
            reason: criticalIssues.length > 0
              ? `检测到 ${criticalIssues.length} 个严重连续性问题`
              : `连续性得分低于阈值 ${ctx.thresholds.minContinuityScore}`,
          });
          return rejectCandidate('连续性门禁未通过');
        }
      }

      // Step 8: 最后一次检查 Job 状态后才允许正式采纳。
      await autonomousOrchestrator._assertJobRunning(ctx.job.id);
      const stillOwnsLock = await autonomousJobService.acquireChapterLock({
        chapterId: ctx.currentChapter.chapterId,
        jobId: ctx.job.id,
        lockedBy: lockOwner,
        ttlSeconds: 1800,
      });
      if (!stillOwnsLock) return rejectCandidate('章节执行锁已失效');
      await autonomousOrchestrator._adoptChapter(
        ctx,
        candidateDraftId,
        lockOwner,
        qualityReportId,
      );
      await autonomousOrchestrator._logAction(ctx, 'auto_adopt', {
        success: true,
        reason: `质量、专家与连续性门禁通过，自动采纳草稿 ${candidateDraftId}`,
        qualityScore,
        qualityReportId,
      });

      return {
        success: true,
        adopted: true,
        qualityScore,
        qualityReportId,
        errorMessage: null,
        tokensUsed: tokenInput + tokenOutput,
        tokenInput,
        tokenOutput,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await autonomousOrchestrator._logAction(ctx, 'auto_generate', {
        success: false,
        reason: `生成失败: ${errorMessage}`,
        errorMessage,
      });

      return {
        success: false,
        adopted: false,
        qualityScore,
        qualityReportId,
        errorMessage,
        tokensUsed: tokenInput + tokenOutput,
        tokenInput,
        tokenOutput,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // 释放锁定
      if (lockAcquired) {
        await autonomousJobService.releaseChapterLock({
          chapterId: ctx.currentChapter.chapterId,
          jobId: ctx.job.id,
          lockedBy: lockOwner,
        }).catch(() => false);
      }
    }
  },

  // ==================== Private Helpers ====================

  async _recoverAdoptedSummaries(
    job: AutonomousGenerationJob,
    signal?: AbortSignal,
  ): Promise<AutonomousGenerationJob> {
    const actions = await autonomousJobService.listActions(job.id);
    const targetChapterIds = [...new Set(
      actions
        .filter((action) => action.actionType === 'auto_generate' || action.actionType === 'auto_adopt')
        .map((action) => action.chapterId),
    )];
    if (targetChapterIds.length === 0) return job;

    let completedWithSummary = 0;
    let tokenInput = 0;
    let tokenOutput = 0;
    let lastChapterId: string | null = job.currentChapterId;

    for (const chapterId of targetChapterIds) {
      if (signal?.aborted) return (await autonomousJobService.get(job.id)) ?? job;
      const current = await autonomousJobService.get(job.id);
      if (!current || current.status !== 'running') return current ?? job;
      const chapter = await import('../database/db').then(({ dbCall }) =>
        dbCall('get_chapter_by_id', { id: chapterId })
      ) as {
        adoptedDraftId?: string | null;
        adopted_draft_id?: string | null;
      } | null;
      const adoptedDraftId = chapter?.adoptedDraftId ?? chapter?.adopted_draft_id ?? null;
      if (!adoptedDraftId) continue;
      lastChapterId = chapterId;

      const summary = await import('../database/db').then(({ dbCall }) =>
        dbCall('get_chapter_summary', { chapterId })
      ) as {
        adoptedDraftId?: string;
        adopted_draft_id?: string;
        isExpired?: boolean;
        is_expired?: boolean;
        enabled?: boolean;
      } | null;
      const summaryDraftId = summary?.adoptedDraftId ?? summary?.adopted_draft_id;
      const summaryCurrent = summaryDraftId === adoptedDraftId
        && !(summary?.isExpired ?? summary?.is_expired ?? false)
        && summary?.enabled !== false;
      if (!summaryCurrent) {
        const generated = await autoSummaryService.generateChapterSummary({
          novelId: job.novelId,
          chapterId,
          draftId: adoptedDraftId,
          signal,
        });
        tokenInput += generated.tokenInput;
        tokenOutput += generated.tokenOutput;
        await autonomousJobService.logAction({
          jobId: job.id,
          novelId: job.novelId,
          chapterId,
          actionType: 'auto_summary',
          decisionReason: generated.success
            ? '恢复已采纳章节的缺失总结'
            : `恢复章节总结失败：${generated.errorMessage ?? 'unknown'}`,
          success: generated.success,
          errorMessage: generated.errorMessage ?? null,
          tokensUsed: generated.tokensUsed,
          durationMs: generated.durationMs,
        });
        if (!generated.success) {
          return autonomousJobService.pause({
            jobId: job.id,
            chapterId,
            reason: `已采纳章节的总结恢复失败：${generated.errorMessage ?? 'unknown'}`,
          });
        }
      }
      completedWithSummary += 1;
    }

    const latest = (await autonomousJobService.get(job.id)) ?? job;
    const reconciled = Math.min(
      latest.totalChapters,
      Math.max(latest.completedChapters, completedWithSummary),
    );
    if (
      latest.status === 'running'
      && (reconciled > latest.completedChapters || tokenInput > 0 || tokenOutput > 0)
    ) {
      return autonomousJobService.updateProgress({
        jobId: latest.id,
        completedChapters: reconciled,
        currentChapterId: lastChapterId,
        currentChapterAttempt: latest.currentChapterAttempt,
        tokensInput: tokenInput,
        tokensOutput: tokenOutput,
        estimatedCostUsd: latest.estimatedCostUsd
          + tokenAggregationService.estimateCostUsd(tokenInput, tokenOutput),
      });
    }
    return latest;
  },

  async _getTargetChapters(
    job: AutonomousGenerationJob
  ): Promise<Array<{ chapterId: string; chapterOrder: number; chapterTitle: string }>> {
    // 获取小说所有章节（按顺序）
    const chapters = await import('../database/db').then(({ dbCall }) =>
      dbCall('get_chapters_by_novel_id', { novelId: job.novelId })
    );

    const remainingLimit = Math.max(0, job.totalChapters - job.completedChapters);
    return (chapters as Array<{
      id: string;
      orderIndex?: number;
      chapterOrder?: number;
      title: string;
      status?: string;
      adoptedDraftId?: string | null;
      adopted_draft_id?: string | null;
    }>)
      .filter((chapter) => !(chapter.adoptedDraftId ?? chapter.adopted_draft_id))
      .sort((left, right) => (
        (left.orderIndex ?? left.chapterOrder ?? 0) - (right.orderIndex ?? right.chapterOrder ?? 0)
      ))
      .slice(0, remainingLimit)
      .map((chapter) => ({
        chapterId: chapter.id,
        chapterOrder: chapter.orderIndex ?? chapter.chapterOrder ?? 0,
        chapterTitle: chapter.title,
      }));
  },

  async _getPreviousChapters(
    chapterId: string,
    count: number = 3
  ): Promise<Array<{ id: string; order: number }>> {
    // 获取当前章节
    const currentChapter = await import('../database/db').then(({ dbCall }) =>
      dbCall('get_chapter_by_id', { id: chapterId })
    ) as { id: string; orderIndex?: number; chapterOrder?: number; novelId: string };

    // 获取同一小说的所有章节
    const allChapters = await import('../database/db').then(({ dbCall }) =>
      dbCall('get_chapters_by_novel_id', { novelId: currentChapter.novelId })
    ) as Array<{ id: string; orderIndex?: number; chapterOrder?: number }>;

    const currentOrder = currentChapter.orderIndex ?? currentChapter.chapterOrder ?? 0;

    // 过滤出前 N 章
    return allChapters
      .map(c => ({ id: c.id, order: c.orderIndex ?? c.chapterOrder ?? 0 }))
      .filter(c => c.order < currentOrder)
      .sort((a, b) => b.order - a.order)
      .slice(0, count)
      ;
  },

  async _createReadinessPlan(ctx: AutoGenContext): Promise<AgentPlanBundle> {
    const operationId = `${ctx.job.operationId}:chapter:${ctx.currentChapter.chapterOrder}:attempt:${ctx.attemptNumber}:readiness`;

    return agentPlanPersistenceService.create({
      novelId: ctx.job.novelId,
      chapterId: ctx.currentChapter.chapterId,
      registryHash: CHAPTER_READINESS_REGISTRY_HASH,
      operationId,
    });
  },

  async _executePlan(
    plan: AgentPlanBundle,
    ctx: AutoGenContext,
    signal?: AbortSignal,
  ): Promise<{
    success: boolean;
    draftId: string | null;
    tokensUsed: number;
    tokenInput: number;
    tokenOutput: number;
    errorMessage: string | null;
  }> {
    try {
      const result = await agentPlanRuntimeService.runExisting(plan.plan.planId);
      if (result.plan.status !== 'completed') {
        return {
          success: false,
          draftId: null,
          tokensUsed: 0,
          tokenInput: 0,
          tokenOutput: 0,
          errorMessage: result.plan.errorJson?.message ?? `Readiness Plan ended as ${result.plan.status}`,
        };
      }

      const readinessStep = result.steps.find((step) => step.stepKey === 'check_readiness');
      const readinessData = readinessStep?.outputJson?.data as Record<string, unknown> | undefined;
      if (readinessStep?.status !== 'completed' || readinessData?.ready !== true) {
        const summary = typeof readinessData?.summary === 'string'
          ? readinessData.summary
          : '章节生成所需上下文尚未准备完成';
        return {
          success: false,
          draftId: null,
          tokensUsed: 0,
          tokenInput: 0,
          tokenOutput: 0,
          errorMessage: `CHAPTER_NOT_READY: ${summary}`,
        };
      }

      await autonomousOrchestrator._assertJobRunning(ctx.job.id);
      const generationContext = await buildFreshChapterGenerationContext({
        novelId: ctx.job.novelId,
        chapterId: ctx.currentChapter.chapterId,
      });
      const request = await buildGenerateRequest(generationContext);
      const operationId = `${ctx.job.operationId}:chapter:${ctx.currentChapter.chapterOrder}:attempt:${ctx.attemptNumber}:generate`;
      const generated = await runAutonomousProvider({
        taskType: 'chapter_generate',
        novelId: ctx.job.novelId,
        chapterId: ctx.currentChapter.chapterId,
        operationId,
        inputSummary: `自主生成第 ${ctx.currentChapter.chapterOrder} 章（第 ${ctx.attemptNumber} 次尝试）`,
        request,
        signal,
      });
      await autonomousOrchestrator._assertJobRunning(ctx.job.id);
      const content = autonomousOrchestrator._normalizeGeneratedChapterText(generated.text);
      if (!content) throw new Error('Provider returned empty chapter content');
      const draft = await draftVersionService.create({
        novelId: ctx.job.novelId,
        chapterId: ctx.currentChapter.chapterId,
        content,
        source: ctx.attemptNumber === 1 ? 'ai_generated' : 'ai_regenerated',
        operationId,
        aiTaskId: generated.taskId,
        note: `Autonomous job ${ctx.job.id}, attempt ${ctx.attemptNumber}`,
      });
      return {
        success: true,
        draftId: draft.id,
        tokensUsed: generated.tokenTotal,
        tokenInput: generated.tokenInput,
        tokenOutput: generated.tokenOutput,
        errorMessage: null,
      };
    } catch (error) {
      return {
        success: false,
        draftId: null,
        tokensUsed: 0,
        tokenInput: 0,
        tokenOutput: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async _assertJobRunning(jobId: string): Promise<AutonomousGenerationJob> {
    const job = await autonomousJobService.get(jobId);
    if (!job) throw new Error('AUTONOMOUS_JOB_NOT_FOUND');
    if (job.status !== 'running') {
      throw new Error(`AUTONOMOUS_JOB_${job.status.toUpperCase()}`);
    }
    return job;
  },

  _normalizeGeneratedChapterText(text: string): string {
    return text
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^以下(?:是|为)[^\n]{0,30}(?:正文|章节)[：:]?\s*/i, '')
      .trim();
  },

  async _adoptChapter(
    ctx: AutoGenContext,
    draftId: string | null,
    lockedBy: string,
    qualityReportId: string | null,
  ): Promise<void> {
    if (!draftId) {
      throw new Error('无可采纳的草稿ID');
    }
    if (!qualityReportId) {
      throw new Error('无可验证的质量报告ID');
    }

    // Job 状态、锁 owner、质量报告与草稿正文 hash 在同一 SQLite
    // transaction 内复核，避免 Pause/Cancel 与最终采纳之间的竞态。
    await import('../database/db').then(({ dbCall }) =>
      dbCall('adopt_autonomous_chapter_draft', {
        input: {
          jobId: ctx.job.id,
          novelId: ctx.job.novelId,
          chapterId: ctx.currentChapter.chapterId,
          draftId,
          qualityReportId,
          lockedBy,
        },
      })
    );
  },

  async _logAction(
    ctx: AutoGenContext,
    actionType: AutonomousActionType,
    meta: {
      success: boolean;
      reason: string;
      qualityScore?: number | null;
      qualityReportId?: string | null;
      tokensUsed?: number;
      errorMessage?: string;
    }
  ): Promise<void> {
    await autonomousJobService.logAction({
      jobId: ctx.job.id,
      novelId: ctx.job.novelId,
      chapterId: ctx.currentChapter.chapterId,
      actionType,
      qualityScore: meta.qualityScore ?? null,
      qualityReportId: meta.qualityReportId ?? null,
      decisionReason: meta.reason,
      success: meta.success,
      errorMessage: meta.errorMessage ?? null,
      tokensUsed: meta.tokensUsed ?? null,
      durationMs: null,
    });
  },
};
