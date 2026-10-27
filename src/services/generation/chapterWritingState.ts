import type {
  ActualBeatState,
  BeatStateEvidence,
  GroundedBeatStateFact,
} from '../../types/chapterWritingWorkflow';
import { isPlainRecord, sha256 } from '../ai/compilation/canonical';

export class ChapterWritingWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ChapterWritingWorkflowError';
  }
}

function invalid(message: string): never {
  throw new ChapterWritingWorkflowError('CHAPTER_BEAT_STATE_INVALID', message);
}

function boundedText(value: unknown, label: string, maxLength = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    return invalid(`${label} 必须是非空、有界文本。`);
  }
  return value.trim();
}

function evidence(value: unknown, text: string): BeatStateEvidence {
  if (!isPlainRecord(value)) return invalid('状态依据格式无效。');
  const { start, end, quote } = value;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    typeof quote !== 'string' ||
    !quote.trim() ||
    quote.length > 4000 ||
    text.slice(start, end) !== quote
  ) {
    return invalid('状态依据必须逐字匹配本 Beat 正文及其 UTF-16 位置。');
  }
  return { start, end, quote };
}

function fact(value: unknown, text: string): GroundedBeatStateFact {
  if (!isPlainRecord(value)) return invalid('状态事实格式无效。');
  if (value.epistemic !== 'explicit' && value.epistemic !== 'uncertain') {
    return invalid('状态事实必须区分原文明确内容和不确定内容。');
  }
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 8) {
    return invalid('每项状态事实必须提供 1–8 条本 Beat 原文依据。');
  }
  return {
    text: boundedText(value.text, '状态事实'),
    epistemic: value.epistemic,
    evidence: value.evidence.map((item) => evidence(item, text)),
  };
}

/** Validate source integrity only. Matching excerpts cannot establish semantic truth. */
export async function validateActualBeatState(
  value: unknown,
  prose: string,
): Promise<ActualBeatState> {
  if (!prose.trim()) return invalid('空正文不能生成实际状态。');
  if (!isPlainRecord(value) || value.schemaVersion !== 1) {
    return invalid('缺少受支持的实际状态版本。');
  }
  const sourceTextHash = await sha256(prose);
  if (value.sourceTextHash !== sourceTextHash) return invalid('状态来源正文哈希不匹配。');
  if (value.semanticValidation !== 'not_checked') {
    return invalid('原文依据校验不能声明已完成语义证明。');
  }
  if (!Array.isArray(value.actualStateChange) || value.actualStateChange.length > 32) {
    return invalid('实际变化必须是有界数组，不能用计划变化填补缺失结果。');
  }
  if (!Array.isArray(value.unknowns) || value.unknowns.length > 32) {
    return invalid('必须明确提供无法确认的事项数组。');
  }
  const unknowns = value.unknowns.map((item) => boundedText(item, '未确认事项'));
  const endState = value.endState === null ? null : fact(value.endState, prose);
  if (endState === null && unknowns.length === 0) {
    return invalid('无法确认结束状态时必须说明未知项，不得从预期结果补值。');
  }
  return {
    schemaVersion: 1,
    sourceTextHash,
    actualStateChange: value.actualStateChange.map((item) => fact(item, prose)),
    endState,
    unknowns,
    semanticValidation: 'not_checked',
  };
}

export function renderActualBeatState(state: ActualBeatState | undefined): string {
  if (!state) return '尚无本次候选的实际状态记录；不得以计划结果代替。';
  const renderFact = (item: GroundedBeatStateFact) =>
    `${item.epistemic === 'uncertain' ? '未确认：' : '原文记录：'}${item.text}`;
  return [
    '以下仅为本次未采用候选的原文归纳，不是正式世界或人物事实：',
    ...state.actualStateChange.map(renderFact),
    state.endState ? `本 Beat 结束：${renderFact(state.endState)}` : '本 Beat 结束状态未确认。',
    ...state.unknowns.map((item) => `仍未知：${item}`),
    '原文位置已核对；语义一致性未自动证明。',
  ].join('\n');
}
