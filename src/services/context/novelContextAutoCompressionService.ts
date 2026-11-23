import { evaluateSummaryApplicationPolicy } from '../ai/summaryApplicationPolicy';
import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { appLogger } from '../observability/appLogger';
import { chapterSummaryService } from './chapterSummaryService';
import { contextRecordService, isContextCompressionRecord } from './contextRecordService';
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  novelContextCompressionProvider,
  type NovelContextCompressionCandidate,
} from './novelContextCompressionProvider';

export type NovelContextAutoCompressionTrigger =
  | 'chapter_adopted'
  | 'chapter_summary_confirmed'
  | 'volume_confirmed'
  | 'volume_summary_confirmed'
  | 'outline_confirmed'
  | 'preauthorized_write';

export type NovelContextAutoCompressionResult =
  | {
      status: 'applied';
      novelId: string;
      recordId: string;
      sourceRevision: string;
      tokenUsed: number;
      tokenBudget: number;
      trigger: NovelContextAutoCompressionTrigger;
    }
  | {
      status: 'up_to_date';
      novelId: string;
      recordId: string;
      sourceRevision: string;
      trigger: NovelContextAutoCompressionTrigger;
    }
  | {
      status: 'skipped';
      novelId: string;
      reason:
        | 'invalid_novel_id'
        | 'novel_not_found'
        | 'awaiting_confirmed_milestone'
        | 'coverage_validation_failed';
      sourceRevision?: string;
      trigger: NovelContextAutoCompressionTrigger;
    };

type AutoCompressionListener = (event: {
  novelId: string;
  result: NovelContextAutoCompressionResult;
}) => void;

const AUTO_COMPRESSION_BUDGET_LADDER = [DEFAULT_CONTEXT_TOKEN_BUDGET, 6000, 8000, 12000] as const;

const inFlightByNovel = new Map<string, Promise<NovelContextAutoCompressionResult>>();
const pendingTriggerByNovel = new Map<string, NovelContextAutoCompressionTrigger>();
const listeners = new Set<AutoCompressionListener>();

function matchesSourceRevision(
  record: { title: string; contentHash?: string },
  sourceRevision: string,
): boolean {
  return record.contentHash === sourceRevision || record.title.endsWith(` ${sourceRevision}`);
}

async function selectValidCandidate(novelId: string): Promise<NovelContextCompressionCandidate> {
  let latest: NovelContextCompressionCandidate | undefined;
  for (const budget of AUTO_COMPRESSION_BUDGET_LADDER) {
    const candidate = await novelContextCompressionProvider.propose(novelId, budget);
    latest = candidate;
    if (candidate.valid) return candidate;
  }
  return latest!;
}

async function runSingleAnalysis(
  novelId: string,
  trigger: NovelContextAutoCompressionTrigger,
): Promise<NovelContextAutoCompressionResult> {
  const normalizedNovelId = novelId.trim();
  if (!normalizedNovelId) {
    return { status: 'skipped', novelId, reason: 'invalid_novel_id', trigger };
  }

  const novel = await novelRepository.getById(normalizedNovelId);
  if (!novel) {
    return { status: 'skipped', novelId: normalizedNovelId, reason: 'novel_not_found', trigger };
  }

  const [chapters, volumes, records, summaries] = await Promise.all([
    chapterRepository.getByNovelId(normalizedNovelId),
    volumeRepository.getByNovelId(normalizedNovelId),
    contextRecordService.getByNovelId(normalizedNovelId),
    chapterSummaryService.getByNovelId(normalizedNovelId),
  ]);

  const hasConfirmedChapter =
    chapters.some((chapter) => Boolean(chapter.adoptedDraftId) || chapter.status === 'adopted') ||
    summaries.some(
      (summary) =>
        summary.enabled &&
        !summary.isExpired &&
        evaluateSummaryApplicationPolicy(summary.validationResult, summary.validationStatus)
          .eligible,
    );
  const hasConfirmedVolume =
    volumes.some((volume) => volume.status === 'completed') ||
    records.some(
      (record) => record.contextType === 'volume_summary' && record.isActive && !record.isExpired,
    );
  const activeCompressed = records
    .filter((record) => record.isActive && !record.isExpired && isContextCompressionRecord(record))
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );

  if (!hasConfirmedChapter && !hasConfirmedVolume && activeCompressed.length === 0) {
    return {
      status: 'skipped',
      novelId: normalizedNovelId,
      reason: 'awaiting_confirmed_milestone',
      trigger,
    };
  }

  const candidate = await selectValidCandidate(normalizedNovelId);
  if (
    activeCompressed.length === 1 &&
    (matchesSourceRevision(activeCompressed[0], candidate.sourceRevision) ||
      activeCompressed[0].content === candidate.compressedText)
  ) {
    return {
      status: 'up_to_date',
      novelId: normalizedNovelId,
      recordId: activeCompressed[0].id,
      sourceRevision: candidate.sourceRevision,
      trigger,
    };
  }

  if (!candidate.valid) {
    return {
      status: 'skipped',
      novelId: normalizedNovelId,
      reason: 'coverage_validation_failed',
      sourceRevision: candidate.sourceRevision,
      trigger,
    };
  }

  const applied = await novelContextCompressionProvider.apply(candidate);
  for (const stale of activeCompressed) {
    if (stale.id !== applied.recordId) {
      await contextRecordService.setActive(stale.id, false);
    }
  }
  const result: NovelContextAutoCompressionResult = {
    status: 'applied',
    novelId: normalizedNovelId,
    recordId: applied.recordId,
    sourceRevision: applied.sourceRevision,
    tokenUsed: candidate.coverage.tokens.used,
    tokenBudget: candidate.coverage.tokens.budget,
    trigger,
  };
  for (const listener of listeners) {
    try {
      listener({ novelId: normalizedNovelId, result });
    } catch {
      // Listener errors must never affect persistence results.
    }
  }
  return result;
}

export const novelContextAutoCompressionService = {
  analyzeAndCompress: runSingleAnalysis,

  async syncAfterConfirmation(
    novelId: string,
    trigger: NovelContextAutoCompressionTrigger,
  ): Promise<NovelContextAutoCompressionResult> {
    const key = novelId.trim();
    if (!key) {
      return { status: 'skipped', novelId, reason: 'invalid_novel_id', trigger };
    }
    const existing = inFlightByNovel.get(key);
    if (existing) {
      pendingTriggerByNovel.set(key, trigger);
      return existing;
    }

    const runner = (async () => {
      let currentTrigger: NovelContextAutoCompressionTrigger | undefined = trigger;
      let latestResult!: NovelContextAutoCompressionResult;
      try {
        while (currentTrigger) {
          const nextTrigger = currentTrigger;
          pendingTriggerByNovel.delete(key);
          latestResult = await runSingleAnalysis(key, nextTrigger);
          currentTrigger = pendingTriggerByNovel.get(key);
        }
        return latestResult;
      } finally {
        pendingTriggerByNovel.delete(key);
        inFlightByNovel.delete(key);
      }
    })();

    inFlightByNovel.set(key, runner);
    return runner;
  },

  async triggerAfterConfirmation(
    novelId: string | undefined,
    trigger: NovelContextAutoCompressionTrigger,
  ): Promise<NovelContextAutoCompressionResult | null> {
    if (!novelId?.trim()) return null;
    try {
      return await this.syncAfterConfirmation(novelId, trigger);
    } catch (error) {
      appLogger.warn('[ContextAutoCompression] 自动压缩小说上下文失败', {
        novelId,
        trigger,
        error,
      });
      return null;
    }
  },

  subscribe(listener: AutoCompressionListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
