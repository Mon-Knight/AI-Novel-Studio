import { resolveChapterWordRange } from '../../src/services/conversation/workbenchChapterWriter.ts';
import type { RealConversationAcceptanceScenario } from './real-conversation-acceptance-profile.ts';

export const PREPARED_ASSETS_MIN_CHAPTER_WORDS = 3_200;
export const PREPARED_ASSETS_MAX_CHAPTER_WORDS = 6_000;

export interface RealAcceptanceChapterWordRange {
  target: number;
  minimum: number;
  maximum: number;
  source: 'prepared-assets-fixture' | 'writer-final-range';
}

export interface RealAcceptanceLengthControlEvidence {
  scenario: RealConversationAcceptanceScenario;
  targetWordCount: number;
  originalWordCount: number;
  finalWordCount: number;
  lengthRepairCount: number;
  integrityRepairCount: number;
}

export function resolveRealAcceptanceChapterWordRange(input: {
  scenario: RealConversationAcceptanceScenario;
  targetWordCount: number | undefined;
}): RealAcceptanceChapterWordRange {
  const writerRange = resolveChapterWordRange(input.targetWordCount);
  if (!writerRange) {
    throw new Error('Real conversation acceptance requires a positive formal chapter target.');
  }

  if (input.scenario === 'prepared-assets') {
    return {
      target: writerRange.target,
      minimum: PREPARED_ASSETS_MIN_CHAPTER_WORDS,
      maximum: PREPARED_ASSETS_MAX_CHAPTER_WORDS,
      source: 'prepared-assets-fixture',
    };
  }

  return {
    target: writerRange.target,
    minimum: writerRange.hardMinimum,
    maximum: writerRange.hardMaximum,
    source: 'writer-final-range',
  };
}

export function isRealAcceptanceLengthControlEvidenceConsistent(
  input: RealAcceptanceLengthControlEvidence,
): boolean {
  const writerRange = resolveChapterWordRange(input.targetWordCount);
  if (
    !writerRange ||
    !Number.isInteger(input.originalWordCount) ||
    input.originalWordCount <= 0 ||
    !Number.isInteger(input.finalWordCount) ||
    input.finalWordCount <= 0 ||
    !Number.isInteger(input.lengthRepairCount) ||
    input.lengthRepairCount < 0 ||
    input.lengthRepairCount > 3 ||
    !Number.isInteger(input.integrityRepairCount) ||
    input.integrityRepairCount < 0 ||
    input.integrityRepairCount > 2
  ) {
    return false;
  }

  const acceptanceRange = resolveRealAcceptanceChapterWordRange(input);
  const originalWasOutOfRange =
    input.originalWordCount < writerRange.hardMinimum ||
    input.originalWordCount > writerRange.hardMaximum;
  const finalIsInWriterRange =
    input.finalWordCount >= writerRange.hardMinimum &&
    input.finalWordCount <= writerRange.hardMaximum;
  const finalIsInAcceptanceRange =
    input.finalWordCount >= acceptanceRange.minimum &&
    input.finalWordCount <= acceptanceRange.maximum;

  if (!finalIsInWriterRange || !finalIsInAcceptanceRange) return false;
  if (input.lengthRepairCount === 0) {
    if (originalWasOutOfRange) return false;
    return input.integrityRepairCount > 0 || input.originalWordCount === input.finalWordCount;
  }
  return originalWasOutOfRange && input.originalWordCount !== input.finalWordCount;
}
