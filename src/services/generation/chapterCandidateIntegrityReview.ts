import type { GenerationRuleCoverage } from '../../types/generationContext';

export const CHAPTER_CANDIDATE_INTEGRITY_ISSUE_CODES = [
  'chapter_opening_rollback',
  'chapter_boundary_sentence_repetition',
  'chapter_boundary_action_replay',
  'chapter_tail_pollution',
  'chapter_meta_reasoning_leakage',
  'chapter_authorial_label_leakage',
  'chapter_source_chain_break',
  'chapter_dialogue_reference_conflict',
  'chapter_temporal_semantics_conflict',
  'chapter_audit_voice_leakage',
] as const;

export type ChapterCandidateIntegrityIssueCode =
  (typeof CHAPTER_CANDIDATE_INTEGRITY_ISSUE_CODES)[number];

export interface ChapterCandidateIntegrityIssue {
  code: ChapterCandidateIntegrityIssueCode;
  summary: string;
  severity: 'error' | 'warning';
}

export interface InspectChapterCandidateIntegrityInput {
  candidateText: string;
  previousChapterText?: string;
}

export interface ChapterCandidateIntegrityReview {
  schemaVersion: 'chapter_candidate_review_v1';
  scope: { novelId: string; chapterId: string; artifactId?: string; candidateHash?: string };
  checks: {
    integrity: 'checked' | 'not_checked';
    previousChapterBoundary: 'checked' | 'not_applicable' | 'not_checked';
    ruleContext: 'complete' | 'context_incomplete' | 'not_checked';
    /** Finite text heuristics cannot prove all authored rules semantically. */
    semanticRules: 'not_checked';
  };
  issues: ChapterCandidateIntegrityIssue[];
  unavailableReasons: string[];
}

export function buildChapterCandidateIntegrityReview(input: {
  scope: ChapterCandidateIntegrityReview['scope'];
  issues?: ChapterCandidateIntegrityIssue[];
  previousChapterBoundary?: ChapterCandidateIntegrityReview['checks']['previousChapterBoundary'];
  ruleCoverage?: GenerationRuleCoverage;
  unavailableReasons?: string[];
}): ChapterCandidateIntegrityReview {
  const coverage = input.ruleCoverage;
  const ruleContext = !coverage
    ? 'not_checked'
    : coverage.status === 'complete' &&
        coverage.novelId === input.scope.novelId &&
        coverage.requiredCount === coverage.includedCount &&
        coverage.includedCount === coverage.sourceIds.length &&
        new Set(coverage.sourceIds).size === coverage.sourceIds.length &&
        /^[a-f0-9]{64}$/i.test(coverage.projectionHash)
      ? 'complete'
      : 'context_incomplete';
  return {
    schemaVersion: 'chapter_candidate_review_v1',
    scope: { ...input.scope },
    checks: {
      integrity: input.issues ? 'checked' : 'not_checked',
      previousChapterBoundary: input.previousChapterBoundary ?? 'not_checked',
      ruleContext,
      semanticRules: 'not_checked',
    },
    issues: input.issues ? input.issues.map((issue) => ({ ...issue })) : [],
    unavailableReasons: [...(input.unavailableReasons ?? [])],
  };
}

/** Same public wording for both Writer paths; a tool success is not a semantic pass. */
export function formatChapterCandidateIntegrityReview(
  review: ChapterCandidateIntegrityReview,
): string {
  const errors = review.issues.filter((issue) => issue.severity === 'error');
  const warnings = review.issues.filter((issue) => issue.severity === 'warning');
  const describe = (issues: ChapterCandidateIntegrityIssue[]) =>
    issues.map((issue) => issue.summary + '（' + issue.code + '）').join('；');
  const lines = [
    '检查范围：作品 ' +
      review.scope.novelId +
      ' / 章节 ' +
      review.scope.chapterId +
      (review.scope.artifactId ? ' / 候选 ' + review.scope.artifactId : '') +
      (review.scope.candidateHash ? ' / 正文 SHA-256 ' + review.scope.candidateHash : ''),
    errors.length
      ? '候选完整性检查发现 ' +
        errors.length +
        ' 项需要处理的问题（error）：' +
        describe(errors) +
        '。建议点击「要求修改」。'
      : review.checks.integrity === 'checked'
        ? '有限完整性检查：未发现 error 级问题。'
        : '完整性复核未检查（not_checked），不能据此判定候选通过。',
    warnings.length
      ? '审阅提醒（warning）' +
        warnings.length +
        ' 项：' +
        describe(warnings) +
        '。提醒不触发自动重写，请结合正文人工判断。'
      : '',
    review.checks.previousChapterBoundary === 'not_checked'
      ? '前章边界未检查：未取得可验证的紧邻前章全文。'
      : review.checks.previousChapterBoundary === 'not_applicable'
        ? '前章边界：首章无前章，不适用。'
        : '已使用紧邻前章全文进行有限边界检查。',
    review.checks.ruleContext === 'complete'
      ? '规则上下文：已取得本次作用域的完整投影；这不是规则语义通过。'
      : review.checks.ruleContext === 'context_incomplete'
        ? '规则上下文不完整（context_incomplete）。'
        : '规则上下文覆盖未复核（not_checked）。',
    '全规则语义检查未执行（semanticRules=not_checked）；结构有效、字数合规和有限文本检查均不代表语义全检通过。',
    ...review.unavailableReasons.map((reason) => '未检查原因：' + reason),
    '候选已保留供审阅；未保存、未采用正式正文。',
  ];
  return lines.filter(Boolean).join('\n');
}
