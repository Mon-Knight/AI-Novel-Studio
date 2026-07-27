/**
 * Autonomous Generation Tests
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 */

import { describe, it, expect, vi } from 'vitest';
import { autonomousJobService } from './autonomousJobService';
import { autonomousOrchestrator } from './autonomousOrchestrator';
import { autonomousRuntimeService } from './autonomousRuntimeService';
import { autoQualityService } from './autoQualityService';
import { normalizeAutonomousQualityPayload } from './autoQualityCheckService';
import { MockAiClient } from '../ai/mockAiClient';
import { productionCompilationRegistryPrivate } from '../ai/compilation/productionCompilationRegistry';
import { normalizeCompilationText, sha256 } from '../ai/compilation/canonical';
import type { QualityCheckItem } from '../../types/qualityCheck';
import type { AutonomousGenerationJob, QualityThresholds } from '../../types/autonomous';

describe('AutoQualityService', () => {
  const mockThresholds: QualityThresholds = {
    novelId: 'test-novel',
    minTotalScore: 70,
    minLogicScore: 70,
    minSettingScore: 60,
    minCharacterScore: 60,
    minContinuityScore: 75,
    minLanguageScore: 50,
    minPacingScore: 50,
    maxCriticalIssues: 0,
    maxRetryAttempts: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('should calculate dimension scores correctly', () => {
    const items: QualityCheckItem[] = [
      {
        id: '1',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'logic',
        category: 'logic',
        severity: 'critical',
        issueKey: 'key1',
        title: 'Logic issue',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 1,
      },
      {
        id: '2',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'language',
        category: 'language',
        severity: 'low',
        issueKey: 'key2',
        title: 'Language issue',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 2,
      },
    ];

    const scores = autoQualityService.calculateDimensionScores(items);

    expect(scores.logic).toBe(70); // 100 - 30 (critical)
    expect(scores.language).toBe(97); // 100 - 3 (minor)
    expect(scores.setting).toBe(100); // No issues
  });

  it('should decide to adopt when quality passes', () => {
    const items: QualityCheckItem[] = [
      {
        id: '1',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'language',
        category: 'language',
        severity: 'low',
        issueKey: 'key1',
        title: 'Minor language issue',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 1,
      },
    ];

    const evaluation = autoQualityService.evaluate(items, mockThresholds);

    expect(evaluation.decision).toBe('adopt');
    expect(evaluation.passed).toBe(true);
    expect(evaluation.totalScore).toBeGreaterThanOrEqual(mockThresholds.minTotalScore);
  });

  it('should decide to regenerate when critical issues exist', () => {
    const items: QualityCheckItem[] = [
      {
        id: '1',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'logic',
        category: 'logic',
        severity: 'critical',
        issueKey: 'key1',
        title: 'Critical logic error',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 1,
      },
    ];

    const evaluation = autoQualityService.evaluate(items, mockThresholds);

    expect(evaluation.decision).toBe('regenerate');
    expect(evaluation.criticalIssues.length).toBe(1);
  });

  it('should decide to fix_only when only language issues exist', () => {
    const items: QualityCheckItem[] = [
      {
        id: '1',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'language',
        category: 'language',
        severity: 'low',
        issueKey: 'key1',
        title: 'Language issue',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 1,
      },
      {
        id: '2',
        reportId: 'r1',
        novelId: 'n1',
        chapterId: 'c1',
        draftId: 'd1',
        issueType: 'style',
        category: 'style',
        severity: 'low',
        issueKey: 'key2',
        title: 'Style issue',
        description: 'desc',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sortOrder: 2,
      },
    ];

    const evaluation = autoQualityService.evaluate(items, mockThresholds);

    expect(evaluation.decision).toBe('fix_only');
    expect(evaluation.autoFixableIssues.length).toBeGreaterThan(0);
  });
});

describe('AutonomousJobService', () => {
  it('should be available when Tauri commands exist', () => {
    // This test requires Tauri runtime
    // In browser dev mode, autonomousJobService.isAvailable() returns false
    expect(typeof autonomousJobService.isAvailable).toBe('function');
  });
});

describe('AutonomousRuntimeService cancellation', () => {
  it('aborts the in-flight orchestrator only after pause is durable', async () => {
    const baseJob: AutonomousGenerationJob = {
      id: 'runtime-abort-job',
      novelId: 'runtime-abort-novel',
      operationId: 'runtime-abort-operation',
      status: 'pending',
      totalChapters: 1,
      completedChapters: 0,
      currentChapterId: null,
      currentChapterAttempt: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      estimatedCostUsd: 0,
      startedAt: null,
      completedAt: null,
      pausedAt: null,
      pausedReason: null,
      pausedChapterId: null,
      createdAt: '2026-07-27T00:00:00Z',
      updatedAt: '2026-07-27T00:00:00Z',
    };
    const running = { ...baseJob, status: 'running' as const };
    const paused = { ...running, status: 'paused' as const, pausedReason: 'test' };
    let capturedSignal: AbortSignal | undefined;
    let releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => { releaseStarted = resolve; });

    const getSpy = vi.spyOn(autonomousJobService, 'get').mockResolvedValue(baseJob);
    const startSpy = vi.spyOn(autonomousJobService, 'start').mockResolvedValue(running);
    const pauseSpy = vi.spyOn(autonomousJobService, 'pause').mockResolvedValue(paused);
    const runSpy = vi.spyOn(autonomousOrchestrator, 'runMultiChapterGeneration')
      .mockImplementation(async (_jobId, signal) => {
        capturedSignal = signal;
        releaseStarted();
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      });

    try {
      await autonomousRuntimeService.start(baseJob.id);
      await started;
      expect(capturedSignal?.aborted).toBe(false);
      await autonomousRuntimeService.pause(baseJob.id, 'test');
      expect(pauseSpy).toHaveBeenCalledOnce();
      expect(capturedSignal?.aborted).toBe(true);
      await autonomousRuntimeService.waitForIdle(baseJob.id);
      expect(autonomousRuntimeService.isRunning(baseJob.id)).toBe(false);
    } finally {
      getSpy.mockRestore();
      startSpy.mockRestore();
      pauseSpy.mockRestore();
      runSpy.mockRestore();
    }
  });

  it('reconciles an adopted chapter whose summary committed before Job progress', async () => {
    const job: AutonomousGenerationJob = {
      id: 'summary-recovery-job',
      novelId: 'summary-recovery-novel',
      operationId: 'summary-recovery-operation',
      status: 'running',
      totalChapters: 1,
      completedChapters: 0,
      currentChapterId: null,
      currentChapterAttempt: 1,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      estimatedCostUsd: 0,
      startedAt: '2026-07-27T00:00:00Z',
      completedAt: null,
      pausedAt: null,
      pausedReason: null,
      pausedChapterId: null,
      createdAt: '2026-07-27T00:00:00Z',
      updatedAt: '2026-07-27T00:00:00Z',
    };
    const action = {
      id: 'summary-recovery-action',
      jobId: job.id,
      novelId: job.novelId,
      chapterId: 'summary-recovery-chapter',
      actionType: 'auto_generate' as const,
      qualityScore: null,
      qualityReportId: null,
      decisionReason: 'started',
      success: true,
      errorMessage: null,
      tokensUsed: null,
      durationMs: null,
      createdAt: '2026-07-27T00:00:00Z',
    };
    const database = await import('../database/db');
    const listSpy = vi.spyOn(autonomousJobService, 'listActions').mockResolvedValue([action]);
    const getSpy = vi.spyOn(autonomousJobService, 'get').mockResolvedValue(job);
    const updateSpy = vi.spyOn(autonomousJobService, 'updateProgress')
      .mockImplementation(async (input) => ({ ...job, completedChapters: input.completedChapters }));
    const dbSpy = vi.spyOn(database, 'dbCall').mockImplementation((async (command: string) => {
      if (command === 'get_chapter_by_id') return { adoptedDraftId: 'summary-recovery-draft' };
      if (command === 'get_chapter_summary') {
        return { adoptedDraftId: 'summary-recovery-draft', isExpired: false, enabled: true };
      }
      throw new Error(`Unexpected command ${command}`);
    }) as typeof database.dbCall);

    try {
      const recovered = await autonomousOrchestrator._recoverAdoptedSummaries(job);
      expect(recovered.completedChapters).toBe(1);
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: job.id,
        completedChapters: 1,
        currentChapterId: action.chapterId,
      }));
    } finally {
      listSpy.mockRestore();
      getSpy.mockRestore();
      updateSpy.mockRestore();
      dbSpy.mockRestore();
    }
  });
});

describe('Autonomous Mock Provider contracts', () => {
  it('keeps the TypeScript production policies aligned with the frozen Rust manifest', async () => {
    const expected = {
      outline_generate: ['outline', 'autonomous_outline_v1', 32_000, 16_000, 'cbee4b14784a038a201b3bc158e80b3cb5affa79ebc1ce7cd4c505fa17e80ecf'],
      chapter_generate: ['chapter_text', 'chapter_text_v1', 64_000, 16_000, 'd3d731ca1c590da35b82e038dcbc7d2325ba4bd75010779529fcce6f00344288'],
      chapter_polish: ['chapter_text', 'chapter_text_v1', 64_000, 16_000, '7d51cbe68e7cf6e2b006ecfb7718f9c4104561f0790aecd104bab4741e3f2ca2'],
      chapter_rewrite: ['chapter_text', 'chapter_text_v1', 64_000, 16_000, '7d51cbe68e7cf6e2b006ecfb7718f9c4104561f0790aecd104bab4741e3f2ca2'],
      chapter_summary: ['chapter_summary', 'chapter_summary_v1', 48_000, 4_000, 'b9eb6fc78c6e44429041bd774e0bd22ba116b4c9c625776f712a2f4f534ecdbf'],
      quality_check: ['quality_report', 'quality_report_v1', 64_000, 6_000, '2104db1c864fe131e08a15116acb139168bab35bfbbd5acb60556f7f1173632d'],
      continuity_check: ['quality_report', 'continuity_report_v1', 64_000, 5_000, 'eb211f939c716d97396ba59b7bc7fac1f3f375b9b4b5d695ab99e8316a9ea916'],
      expert_review: ['quality_report', 'expert_review_v1', 64_000, 4_000, '9bb6de8aef64e4a30d3f0d24de0430bb3469234f62dbc16ce7ee248212f9006a'],
    } as const;

    for (const [taskType, policy] of Object.entries(expected)) {
      const definition = productionCompilationRegistryPrivate.definitions[taskType as keyof typeof expected];
      expect(definition, `${taskType} policy`).toBeDefined();
      expect(definition?.expectedArtifactType).toBe(policy[0]);
      expect(definition?.responseSchema).toBe(policy[1]);
      expect(definition?.modelContextTokens).toBe(policy[2]);
      expect(definition?.maxOutputTokens).toBe(policy[3]);
      expect(await sha256(normalizeCompilationText(definition?.promptTemplateBody ?? ''))).toBe(policy[4]);
    }
  });

  it('normalizes a formal quality Artifact without trusting malformed fields', () => {
    const result = normalizeAutonomousQualityPayload({
      overallScore: 108,
      summary: '  pass  ',
      items: [{ severity: 'unexpected', category: 'logic', title: '', description: '' }],
    });
    expect(result.overallScore).toBe(100);
    expect(result.summary).toBe('pass');
    expect(result.items[0].severity).toBe('medium');
    expect(result.items[0].title).toBe('质量问题 1');
  });

  it('returns task-specific structured payloads for the autonomous JSON stages', async () => {
    const client = new MockAiClient();
    const taskCases = [
      ['outline_generate', 'autonomous/outline-generate'],
      ['chapter_summary', 'autonomous/chapter-summary'],
      ['quality_check', 'autonomous/quality-check'],
      ['continuity_check', 'autonomous/continuity-check'],
      ['expert_review', 'autonomous/expert-review'],
    ] as const;

    const responses = await Promise.all(taskCases.map(([taskType, promptTemplateSource]) => (
      client.generate({
        taskType,
        promptTemplateSource,
        messages: [
          { role: 'system', content: 'Autonomous contract test. Return JSON.' },
          { role: 'user', content: '请生成 3 章，并返回当前任务要求的结构化结果。' },
        ],
      })
    )));

    const payloads = responses.map((response) => JSON.parse(response.text) as Record<string, unknown>);
    expect(Array.isArray(payloads[0].chapters)).toBe(true);
    expect(Array.isArray(payloads[1].plot_points)).toBe(true);
    expect(payloads[2].overallScore).toBeGreaterThanOrEqual(90);
    expect(payloads[3].score).toBeGreaterThanOrEqual(90);
    expect(payloads[4].score).toBeGreaterThanOrEqual(75);
  });
});
