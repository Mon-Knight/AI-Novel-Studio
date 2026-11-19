import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousRunLeaseProof,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerService } from './autonomousSchedulerService';

export type SchedulerService = typeof autonomousSchedulerService;

export const RECOVERY_SWEEP_INTERVAL_MS = 15_000;

export function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function errorCode(reason: unknown): string | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  return typeof (reason as { code?: unknown }).code === 'string'
    ? (reason as { code: string }).code
    : undefined;
}

export function proof(
  grant: Awaited<ReturnType<SchedulerService['acquireLease']>>,
): AutonomousRunLeaseProof {
  return { leaseId: grant.lease.leaseId, epoch: grant.lease.epoch, token: grant.token };
}

export function defaultSnapshot(): AutonomousSchedulerSnapshot {
  return {
    capability: autonomousSchedulerService.capability(),
    run: null,
    attempts: [],
    workerActive: false,
    busy: false,
  };
}

export function estimateChapterReservation(
  plan: AutonomousStoryPlan,
  chapterNumber: number,
): {
  estimatedTokens: number;
  estimatedCostUsd: number;
} {
  const chapter = plan.chapters.find((item) => item.chapterNumber === chapterNumber);
  const targetWords = chapter?.targetWordCount ?? plan.brief.targetWordsPerChapter ?? 2_400;
  const estimatedTokens = Math.max(2_000, Math.min(10_000_000, Math.ceil(targetWords * 3)));
  // Frozen conservative ceiling used only for scheduler reservation; the request ledger remains authoritative.
  const estimatedCostUsd = Math.round((estimatedTokens / 1_000_000) * 30 * 10000) / 10000;
  return { estimatedTokens, estimatedCostUsd };
}
