import type { QualityCheckItem } from '../../types/qualityCheck';
import { passesChapterQualityGate as chapterPassesQualityGate } from '../ai/chapterQualityGateService';
import type { PatchCandidate } from './types';

export function buildPatchCandidates(items: QualityCheckItem[]): PatchCandidate[] {
  return items
    .filter((item) => item.status === 'pending' && item.quote?.trim() && item.suggestion?.trim())
    .map((item) => {
      const quote = item.quote?.trim() || '';
      const suggestion = item.suggestion?.trim() || '';
      const riskLevel: PatchCandidate['riskLevel'] =
        item.severity === 'low' && quote.length <= 120
          ? 'low'
          : item.severity === 'critical' || item.severity === 'high'
            ? 'high'
            : 'medium';
      return {
        issueId: item.id,
        severity: item.severity,
        riskLevel,
        quote,
        replacementText: suggestion,
        rationale: item.title || item.description,
      };
    });
}

export function applyLowRiskPatches(
  content: string,
  patches: PatchCandidate[],
): {
  content: string;
  applied: PatchCandidate[];
  skipped: PatchCandidate[];
} {
  let nextContent = content;
  const applied: PatchCandidate[] = [];
  const skipped: PatchCandidate[] = [];
  for (const patch of patches) {
    if (patch.riskLevel !== 'low' || !patch.quote || !patch.replacementText) {
      skipped.push(patch);
      continue;
    }
    if (!nextContent.includes(patch.quote)) {
      skipped.push(patch);
      continue;
    }
    nextContent = nextContent.replace(patch.quote, patch.replacementText);
    applied.push(patch);
  }
  return { content: nextContent, applied, skipped };
}

export function passesChapterQualityGate(score: number, items: QualityCheckItem[]): boolean {
  return chapterPassesQualityGate(score, items);
}

export function shouldAttemptExternalQualityRepair(input: {
  localChapterModelEnabled: boolean;
  runtimeMode: 'mock' | 'api';
  manualReviewRequired: boolean;
  qualityItems: QualityCheckItem[];
  /**
   * Audit-only. Beat repair happens before the immutable chapter draft exists,
   * so it does not consume that saved draft's one quality-repair round.
   */
  externalBeatRepairUsed: boolean;
}): boolean {
  return (
    input.localChapterModelEnabled &&
    input.runtimeMode === 'api' &&
    input.manualReviewRequired &&
    input.qualityItems.some((item) => item.status === 'pending')
  );
}
