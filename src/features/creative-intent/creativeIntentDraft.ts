import { stableCanonicalStringify } from '../../services/ai-tasks/stage3PrerequisiteService';
import type {
  CreativeIntentRecordV1,
  CreativeIntentStatementInputV1,
  FreezeCreativeIntentCommandInput,
} from '../../types/creativeIntent';

export interface CreativeIntentDraftState {
  serialized: string;
  dirty: boolean;
  confirmedCount: number;
  pendingCount: number;
  pendingInferenceCount: number;
  blockingReasons: string[];
}

function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function serializeCreativeIntentDraft(
  statements: CreativeIntentStatementInputV1[],
): string {
  return stableCanonicalStringify(statements);
}

export function deriveCreativeIntentDraftState(
  statements: CreativeIntentStatementInputV1[],
  baseline: string,
  record: CreativeIntentRecordV1 | null,
  ready: boolean,
): CreativeIntentDraftState {
  const serialized = serializeCreativeIntentDraft(statements);
  const dirty = serialized !== baseline;
  const blockingReasons: string[] = [];
  if (!ready) blockingReasons.push('创作意图尚未成功读取');
  if (statements.length === 0) blockingReasons.push('至少添加一项创作意图');
  if (statements.some((item) => !hasContent(item.value))) {
    blockingReasons.push('所有意图内容都必须填写');
  }
  if (statements.some((item) => (
    item.knowledgeClass === 'author_explicit' && item.confirmation.status !== 'confirmed'
  ))) {
    blockingReasons.push('作者明确输入必须逐项确认');
  }
  if (statements.some((item) => (
    item.knowledgeClass !== 'author_explicit' && item.evidence.length === 0
  ))) {
    blockingReasons.push('推断或待确认信息必须保留判断依据');
  }
  if (!dirty && record) blockingReasons.push('当前内容与最新冻结版本相同');

  return {
    serialized,
    dirty,
    confirmedCount: statements.filter((item) => item.confirmation.status === 'confirmed').length,
    pendingCount: statements.filter((item) => item.confirmation.status === 'pending').length,
    pendingInferenceCount: statements.filter((item) => (
      item.knowledgeClass !== 'author_explicit' && item.confirmation.status === 'pending'
    )).length,
    blockingReasons,
  };
}

export function editCreativeIntentStatement(
  statement: CreativeIntentStatementInputV1,
  patch: Partial<Pick<CreativeIntentStatementInputV1, 'kind' | 'value'>>,
): CreativeIntentStatementInputV1 {
  return {
    ...statement,
    ...patch,
    confirmation: { status: 'pending' },
  };
}

export function buildFreezeCreativeIntentInput(
  novelId: string,
  record: CreativeIntentRecordV1 | null,
  statements: CreativeIntentStatementInputV1[],
): FreezeCreativeIntentCommandInput {
  return {
    novelId,
    expectedRevision: record?.intent.revision ?? 0,
    expectedContentHash: record?.intent.contentHash,
    statements,
  };
}
