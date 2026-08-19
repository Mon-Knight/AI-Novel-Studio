import type { AiGenerateOptions, ChapterDraft } from '../../types/ai';
import type { QualityCheckItem, QualityCheckReport } from '../../types/qualityCheck';
import { countTextWords, hashTextContent } from '../../utils/contentHash';
import { describeUnknownError } from '../../utils/errorMessage';
import { draftVersionService } from '../database/draftVersionService';
import { nowISO } from '../database/db';
import { qualityCheckService } from '../quality/qualityCheckService';
import { qualityCheckAiService } from './qualityCheckAiService';
import { isAiRequestCancelled } from './aiCancellation';
import { fixRunStore } from './fixRunStore';
import {
  qualityFixService,
  qualityFixSourceHashMatches,
  restorePersistedQualityFixResult,
  validateQualityFixScope,
  type FixResult,
  type QualityFixRun,
} from './qualityFixService';

export interface ChapterQualityGateSource {
  novelId: string;
  chapterId: string;
  volumeId?: string;
  chapterTitle: string;
  chapterOutline?: string;
  chapterGoal?: string;
  chapterContext?: string;
  volumeContext?: string;
  styleSummary?: string;
  draft: ChapterDraft;
  report: QualityCheckReport;
  items: QualityCheckItem[];
}

export interface ChapterQualityGateRunOptions extends AiGenerateOptions {
  requestIdPrefix?: string;
  trackRequest?: <T>(request: Promise<T>) => Promise<T>;
}

export interface ChapterQualityGateResult {
  sourceDraft: ChapterDraft;
  finalDraft: ChapterDraft;
  sourceReport: QualityCheckReport;
  finalReport: QualityCheckReport;
  finalItems: QualityCheckItem[];
  initialScore: number;
  finalScore: number;
  qualityGatePassed: boolean;
  repairAttempted: boolean;
  repairResumed: boolean;
  repairApplied: boolean;
  repairRun?: QualityFixRun;
  scopeValidation?: import('./qualityFixService').FixScopeValidation;
  targetDraftCreated: boolean;
}

export function passesChapterQualityGate(score: number, items: QualityCheckItem[]): boolean {
  return (
    score >= 80 &&
    !items.some(
      (item) =>
        item.status === 'pending' && (item.severity === 'critical' || item.severity === 'high'),
    )
  );
}

function assertQualitySource(source: ChapterQualityGateSource): number {
  if (
    source.draft.novelId !== source.novelId ||
    source.draft.chapterId !== source.chapterId ||
    source.report.novelId !== source.novelId ||
    source.report.chapterId !== source.chapterId ||
    source.report.draftId !== source.draft.id ||
    source.report.status !== 'completed'
  ) {
    throw new Error('质量闭环源草稿、初评报告或章节归属不一致。');
  }
  if (!source.draft.content.trim()) throw new Error('质量闭环源草稿正文为空。');
  const contentHash = hashTextContent(source.draft.content);
  if (source.report.contentHash && source.report.contentHash !== contentHash) {
    throw new Error('质量闭环初评报告已过期，源草稿正文哈希不一致。');
  }
  if (
    source.items.some(
      (item) =>
        item.reportId !== source.report.id ||
        item.chapterId !== source.chapterId ||
        item.draftId !== source.draft.id,
    )
  ) {
    throw new Error('质量闭环问题列表与初评报告不一致。');
  }
  if (typeof source.report.overallScore !== 'number') {
    throw new Error('质量闭环初评报告缺少有效评分。');
  }
  return source.report.overallScore;
}

function matchingRepairRun(runs: QualityFixRun[], source: ChapterQualityGateSource) {
  const matching = runs.filter((run) => run.sourceDraftId === source.draft.id);
  if (matching.length > 1) {
    throw new Error('同一源草稿存在多条外部质量修稿记录，已停止自动恢复。');
  }
  const run = matching[0];
  if (!run) return undefined;
  if (
    run.novelId !== source.novelId ||
    run.chapterId !== source.chapterId ||
    run.sourceDraftVersion !== source.draft.versionNo ||
    !qualityFixSourceHashMatches(run.sourceContentHash, source.draft.content)
  ) {
    throw new Error('已保存的外部质量修稿与当前源草稿身份不一致。');
  }
  return run;
}

async function loadCompletedRepair(
  source: ChapterQualityGateSource,
  run: QualityFixRun,
): Promise<ChapterQualityGateResult | null> {
  if (!run.targetDraftId || !run.afterReportId) return null;
  const [targetDraft, after] = await Promise.all([
    draftVersionService.getById(source.chapterId, run.targetDraftId),
    qualityCheckService.getReportSnapshot(run.afterReportId),
  ]);
  if (
    !targetDraft ||
    !after.report ||
    after.report.status !== 'completed' ||
    after.report.draftId !== targetDraft.id ||
    targetDraft.novelId !== source.novelId ||
    targetDraft.chapterId !== source.chapterId
  ) {
    throw new Error('已完成的质量修稿恢复记录不完整或归属不一致。');
  }
  const finalHash = hashTextContent(targetDraft.content);
  if (
    (run.targetContentHash &&
      !qualityFixSourceHashMatches(run.targetContentHash, targetDraft.content)) ||
    (after.report.contentHash && after.report.contentHash !== finalHash)
  ) {
    throw new Error('已完成的质量修稿目标正文哈希不一致。');
  }
  const finalScore = after.report.overallScore;
  if (typeof finalScore !== 'number') throw new Error('质量修稿复评报告缺少有效评分。');
  return {
    sourceDraft: source.draft,
    finalDraft: targetDraft,
    sourceReport: source.report,
    finalReport: after.report,
    finalItems: after.items,
    initialScore: source.report.overallScore as number,
    finalScore,
    qualityGatePassed: passesChapterQualityGate(finalScore, after.items),
    repairAttempted: true,
    repairResumed: true,
    repairApplied: true,
    repairRun: run,
    targetDraftCreated: false,
  };
}

export const chapterQualityGateService = {
  async resolveSource(input: {
    novelId: string;
    chapterId: string;
    volumeId?: string;
    chapterTitle: string;
    chapterOutline?: string;
    chapterGoal?: string;
    draftId?: string;
    reportId?: string;
  }): Promise<ChapterQualityGateSource> {
    const latest = await qualityCheckService.getChapterIssues(input.chapterId);
    const selected =
      input.reportId && latest.report?.id !== input.reportId
        ? await qualityCheckService.getReportSnapshot(input.reportId)
        : latest;
    if (!selected.report) throw new Error('当前章节没有可恢复的完整质量报告。');
    if (input.draftId && selected.report.draftId !== input.draftId) {
      throw new Error('指定草稿与质量报告不匹配。');
    }
    const draft = await draftVersionService.getById(input.chapterId, selected.report.draftId);
    if (!draft) throw new Error('质量报告对应的源草稿不存在。');
    const source: ChapterQualityGateSource = {
      ...input,
      draft,
      report: selected.report,
      items: selected.items,
    };
    assertQualitySource(source);
    return source;
  },

  async runRepairAndRecheck(
    source: ChapterQualityGateSource,
    options: ChapterQualityGateRunOptions = {},
  ): Promise<ChapterQualityGateResult> {
    const initialScore = assertQualitySource(source);
    if (passesChapterQualityGate(initialScore, source.items)) {
      return {
        sourceDraft: source.draft,
        finalDraft: source.draft,
        sourceReport: source.report,
        finalReport: source.report,
        finalItems: source.items,
        initialScore,
        finalScore: initialScore,
        qualityGatePassed: true,
        repairAttempted: false,
        repairResumed: false,
        repairApplied: false,
        targetDraftCreated: false,
      };
    }
    const pendingIssues = source.items.filter((item) => item.status === 'pending');
    if (pendingIssues.length === 0) {
      throw new Error('评分未达 80，但报告没有可绑定的待处理问题，无法执行定点修稿。');
    }

    const track = options.trackRequest ?? (async <T>(request: Promise<T>) => request);
    const runs = await fixRunStore.getByChapterId(source.chapterId);
    let repairRun = matchingRepairRun(runs, source);
    if (repairRun) {
      const completed = await loadCompletedRepair(source, repairRun);
      if (completed) return completed;
    }

    let fixResult: FixResult;
    let repairAiTaskId: string | undefined;
    let repairResumed = false;
    if (repairRun) {
      if (
        repairRun.status === 'failed' ||
        repairRun.status === 'cancelled' ||
        repairRun.status === 'reverted'
      ) {
        throw new Error('该源草稿的唯一外部修稿轮次已失败或取消，不能再次调用。');
      }
      if (repairRun.targetDraftId) {
        const targetDraft = await draftVersionService.getById(
          source.chapterId,
          repairRun.targetDraftId,
        );
        if (!targetDraft) throw new Error('质量修稿目标草稿不存在。');
        fixResult = {
          mode: 'targeted_fix',
          applicationMode: 'deterministic_ranges',
          fixedIssueKeys: [],
          revisionSummary: repairRun.revisionSummary || '恢复质量修稿候选。',
          changedRanges: [],
          revisedContent: targetDraft.content,
        };
      } else {
        fixResult = restorePersistedQualityFixResult({
          fixRun: repairRun,
          sourceDraft: source.draft,
          pendingIssues,
        });
      }
      repairResumed = true;
    } else {
      const repair = await track(
        qualityFixService.runFix(
          {
            novelId: source.novelId,
            chapterId: source.chapterId,
            chapterTitle: source.chapterTitle,
            chapterOutline: source.chapterOutline,
            currentDraft: source.draft,
            pendingIssues,
            ignoredIssues: source.items.filter((item) => item.status === 'ignored'),
            beforeReportId: source.report.id,
            beforeScore: initialScore,
            beforePendingCount: pendingIssues.length,
            beforeSeriousCount: pendingIssues.filter(
              (item) => item.severity === 'critical' || item.severity === 'high',
            ).length,
            chapterContext: source.chapterContext,
            volumeContext: source.volumeContext,
            styleSummary: source.styleSummary,
          },
          {
            signal: options.signal,
            requestId: `${options.requestIdPrefix || source.chapterId}:quality-repair`,
            cancel: options.cancel,
          },
        ),
      );
      if (!repair.scopeValidation.passed) {
        throw new Error(repair.scopeValidation.rejectReason || '外部 AI 修稿超出精准修稿范围。');
      }
      repairRun = repair.fixRun;
      fixResult = repair.fixResult;
      repairAiTaskId = repair.aiTaskId;
      repairRun.warnings = repair.scopeValidation.warnings.length
        ? JSON.stringify(repair.scopeValidation.warnings)
        : repairRun.warnings;
    }

    if (!repairRun) throw new Error('质量修稿没有返回持久运行记录。');
    if (fixResult.revisedContent.trim() === source.draft.content.trim()) {
      throw new Error('外部 AI 没有生成可应用的质量修稿。');
    }
    const scope = validateQualityFixScope(
      source.draft.content,
      fixResult.revisedContent,
      fixResult.changedRanges,
      fixResult.fixedIssueKeys,
      fixResult.applicationMode === 'deterministic_ranges',
    );
    if (!scope.passed) throw new Error(scope.rejectReason || '质量修稿范围校验未通过。');

    let targetDraft: ChapterDraft;
    let targetDraftCreated = false;
    if (repairRun.targetDraftId) {
      const existing = await draftVersionService.getById(source.chapterId, repairRun.targetDraftId);
      if (!existing) throw new Error('质量修稿目标草稿不存在。');
      if (
        existing.novelId !== source.novelId ||
        existing.chapterId !== source.chapterId ||
        existing.content !== fixResult.revisedContent
      ) {
        throw new Error('质量修稿目标草稿与已保存补丁结果不一致。');
      }
      targetDraft = existing;
    } else {
      try {
        targetDraft = await draftVersionService.create({
          operationId: `quality-fix-draft:${repairRun.id}`,
          novelId: source.novelId,
          chapterId: source.chapterId,
          title: `${source.chapterTitle} - 外部 AI 质量修稿`,
          content: fixResult.revisedContent,
          source: 'ai_regenerated',
          aiTaskId: repairAiTaskId,
          note: `quality fix run ${repairRun.id}; issue-bound external repair`,
        });
        targetDraftCreated = true;
      } catch (error) {
        repairRun.status = 'success';
        repairRun.failureReason = `候选草稿保存失败，可从已保存补丁恢复：${describeUnknownError(error)}`;
        await fixRunStore.save(repairRun);
        throw error;
      }
      repairRun.targetDraftId = targetDraft.id;
      repairRun.targetDraftVersion = targetDraft.versionNo;
      repairRun.targetContentHash = hashTextContent(targetDraft.content);
      repairRun.status = 'running';
      repairRun.failureReason = undefined;
      await fixRunStore.save(repairRun);
    }

    try {
      const contentHash = hashTextContent(targetDraft.content);
      const checkedAt = nowISO();
      const recheck = await track(
        qualityCheckAiService.runCheck(
          {
            novelId: source.novelId,
            chapterId: source.chapterId,
            draftId: targetDraft.id,
            volumeId: source.volumeId,
            draftContent: targetDraft.content,
            chapterTitle: source.chapterTitle,
            chapterOutline: source.chapterOutline,
            chapterGoal: source.chapterGoal,
            contentHash,
            wordCount: countTextWords(targetDraft.content),
          },
          {
            signal: options.signal,
            requestId: `${options.requestIdPrefix || source.chapterId}:quality-recheck`,
            cancel: options.cancel,
          },
        ),
      );
      const report = await qualityCheckService.createReport({
        novelId: source.novelId,
        chapterId: source.chapterId,
        draftId: targetDraft.id,
        scope: 'current_draft',
        contentHash,
        contentLength: targetDraft.content.length,
        checkedAt,
      });
      const saved = await qualityCheckService.saveResult({
        reportId: report.id,
        novelId: source.novelId,
        chapterId: source.chapterId,
        draftId: targetDraft.id,
        result: recheck,
        draftVersion: targetDraft.versionNo,
        model: recheck.model || repairRun.model || source.report.model,
        contentHash,
        contentLength: targetDraft.content.length,
        checkedAt,
        aiTaskId: recheck.aiTaskId,
      });
      if (!saved.report || typeof saved.report.overallScore !== 'number') {
        throw new Error('质量修稿复评结果未完整保存。');
      }
      repairRun.targetDraftId = targetDraft.id;
      repairRun.targetDraftVersion = targetDraft.versionNo;
      repairRun.targetContentHash = contentHash;
      repairRun.afterReportId = saved.report.id;
      repairRun.afterScore = saved.report.overallScore;
      repairRun.afterPendingCount = saved.statistics.pending;
      repairRun.afterSeriousCount = saved.items.filter(
        (item) =>
          item.status === 'pending' && (item.severity === 'critical' || item.severity === 'high'),
      ).length;
      repairRun.newIssueIds = saved.items.map((item) => item.issueKey);
      repairRun.status = 'success';
      repairRun.failureReason = undefined;
      await fixRunStore.save(repairRun);

      return {
        sourceDraft: source.draft,
        finalDraft: targetDraft,
        sourceReport: source.report,
        finalReport: saved.report,
        finalItems: saved.items,
        initialScore,
        finalScore: saved.report.overallScore,
        qualityGatePassed: passesChapterQualityGate(saved.report.overallScore, saved.items),
        repairAttempted: true,
        repairResumed,
        repairApplied: true,
        repairRun,
        scopeValidation: scope,
        targetDraftCreated,
      };
    } catch (error) {
      const cancelled = options.signal?.aborted || isAiRequestCancelled(error);
      // Once the issue-bound candidate is durable, a scoring transport failure
      // must not erase the successful external repair or consume it again.
      // Keep the run resumable so the next action only rechecks targetDraftId.
      repairRun.status = cancelled ? 'cancelled' : repairRun.targetDraftId ? 'running' : 'failed';
      repairRun.failureReason = cancelled
        ? undefined
        : `质量复评失败：${describeUnknownError(error)}`;
      await fixRunStore.save(repairRun).catch(() => undefined);
      throw error;
    }
  },
};
