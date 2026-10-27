/**
 * 结构化产物 `request_apply` 的单一策略源。
 *
 * 前端所有「哪些产物类型可以原子应用、目标是作品还是章节、上下文压缩何时可应用」
 * 的判断都必须经过这里，与 Rust `structured_artifact_apply_service::validate_static_scope`
 * 的白名单和 `expected_target` 规则保持一一对应：
 *
 * - 白名单：`outline / character_candidates / event_candidates / setting_candidates / chapter_summary`
 *   以及结构有效的 `generic_json` + `context_compression`。
 * - 章节作用域：`event_candidates / chapter_summary` 总是以章节为目标；`outline` 仅在带
 *   `sourceChapterId` 时以章节为目标；其余以作品为目标。
 * - `quality_report / style_analysis` 只读，永不可应用。
 * - `chapter_text` 不走结构化应用，走 `ReviewAuthorization` 章节采用链路。
 */
import { isContextCompressionCandidate } from '../context/novelContextCompressionProvider';

export const STRUCTURED_APPLY_TYPES = [
  'outline',
  'character_candidates',
  'event_candidates',
  'setting_candidates',
  'chapter_summary',
] as const;

export const READ_ONLY_REPORT_TYPES = ['quality_report', 'style_analysis'] as const;

export type StructuredApplyType = (typeof STRUCTURED_APPLY_TYPES)[number];

export type DecisionTargetType = 'chapter' | 'asset';

export interface DecisionTarget {
  targetType: DecisionTargetType;
  targetId: string;
  chapterId?: string;
  chapterScoped: boolean;
}

export function isStructuredApplyType(artifactType: string): artifactType is StructuredApplyType {
  return (STRUCTURED_APPLY_TYPES as readonly string[]).includes(artifactType);
}

export function isReadOnlyReportType(artifactType: string): boolean {
  return (READ_ONLY_REPORT_TYPES as readonly string[]).includes(artifactType);
}

/** 结构有效且自检通过的上下文压缩候选，是唯一允许应用的 `generic_json`。 */
export function isApplicableContextCompressionPayload(payload: unknown): boolean {
  return isContextCompressionCandidate(payload) && payload.valid;
}

export function parseJsonPayload(content: string | null | undefined): unknown {
  if (!content) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 章节作用域规则。`chapter_text` 属于章节采用链路，但对目标解析而言同样以章节为目标，
 * 因此在此一并给出，供决定载荷复用。
 */
export function isChapterScopedArtifact(
  artifactType: string,
  chapterId: string | undefined | null,
): boolean {
  return (
    artifactType === 'chapter_text' ||
    artifactType === 'event_candidates' ||
    artifactType === 'chapter_summary' ||
    (artifactType === 'outline' && Boolean(chapterId))
  );
}

/** 一个产物是否支持结构化原子应用（不含处理状态、环境等动态条件）。 */
export function supportsStructuredApply(input: {
  artifactType: string;
  payload?: unknown;
  derivationType?: string | null;
}): boolean {
  if (isStructuredApplyType(input.artifactType)) return true;
  if (input.artifactType !== 'generic_json') return false;
  if (input.derivationType === 'context_compression') return true;
  return isApplicableContextCompressionPayload(input.payload);
}

/**
 * 解析决定目标。`sourceChapterId` 是产物证据里的权威章节；`currentChapterId` 只允许
 * 章节正文候选在缺少权威来源时回退，结构化产物绝不回退到“当前打开的章节”。
 */
export function resolveArtifactDecisionTarget(input: {
  artifactType: string;
  sourceChapterId?: string | null;
  currentChapterId?: string | null;
  novelId: string;
}): DecisionTarget {
  const chapterId =
    (input.artifactType === 'chapter_text'
      ? input.sourceChapterId || input.currentChapterId
      : input.sourceChapterId) || undefined;
  const chapterScoped = isChapterScopedArtifact(input.artifactType, chapterId);
  return {
    targetType: input.artifactType === 'chapter_text' ? 'chapter' : 'asset',
    targetId: chapterScoped && chapterId ? chapterId : input.novelId,
    chapterId,
    chapterScoped,
  };
}

export type StructuredApplyRejection =
  | 'READ_ONLY_REPORT'
  | 'TYPE_UNSUPPORTED'
  | 'NOT_VALIDATED'
  | 'NOVEL_MISMATCH'
  | 'CHAPTER_SOURCE_MISSING'
  | 'TARGET_MISMATCH';

export interface StructuredApplyPlan {
  targetType: 'asset';
  targetId: string;
  chapterId?: string;
}

/**
 * 依据持久化产物元数据推导唯一合法的应用目标，并校验调用方提交的目标是否一致。
 * 返回值即 Rust `apply_structured_artifact` 输入中的 target/chapter 字段。
 */
export function planStructuredApply(input: {
  artifact: {
    artifactType: string;
    processingStatus: string;
    sourceNovelId: string;
    sourceChapterId?: string | null;
  };
  payload: unknown;
  requested: { novelId: string; targetType: string; targetId: string; chapterId?: string | null };
}): { ok: true; plan: StructuredApplyPlan } | { ok: false; reason: StructuredApplyRejection } {
  const { artifact, requested } = input;
  if (isReadOnlyReportType(artifact.artifactType)) return { ok: false, reason: 'READ_ONLY_REPORT' };
  if (!supportsStructuredApply({ artifactType: artifact.artifactType, payload: input.payload })) {
    return { ok: false, reason: 'TYPE_UNSUPPORTED' };
  }
  if (!['valid', 'valid_with_warnings'].includes(artifact.processingStatus)) {
    return { ok: false, reason: 'NOT_VALIDATED' };
  }
  if (artifact.sourceNovelId !== requested.novelId) return { ok: false, reason: 'NOVEL_MISMATCH' };

  const authoritativeChapterId = artifact.sourceChapterId || undefined;
  const chapterScoped = isChapterScopedArtifact(artifact.artifactType, authoritativeChapterId);
  if (chapterScoped && !authoritativeChapterId) {
    return { ok: false, reason: 'CHAPTER_SOURCE_MISSING' };
  }
  const targetId = chapterScoped ? authoritativeChapterId! : artifact.sourceNovelId;
  if (
    requested.targetType !== 'asset' ||
    requested.targetId !== targetId ||
    (requested.chapterId || undefined) !== authoritativeChapterId
  ) {
    return { ok: false, reason: 'TARGET_MISMATCH' };
  }
  return { ok: true, plan: { targetType: 'asset', targetId, chapterId: authoritativeChapterId } };
}

export const STRUCTURED_APPLY_REJECTION_MESSAGES: Record<StructuredApplyRejection, string> = {
  READ_ONLY_REPORT: '质量或风格报告不能应用到小说正式事实。',
  TYPE_UNSUPPORTED: '当前产物类型不支持原子应用',
  NOT_VALIDATED: '产物尚未通过结构校验，不能申请应用。',
  NOVEL_MISMATCH: '产物与当前作品不匹配。',
  CHAPTER_SOURCE_MISSING: '章节级结构化产物缺少权威章节来源。',
  TARGET_MISMATCH: '结构化产物的应用目标与持久化来源不一致。',
};
