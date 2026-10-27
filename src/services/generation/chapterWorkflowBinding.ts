import protocol from '../../../contracts/chapter-writing-stage/v1.json' with { type: 'json' };
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import type { AiContextSourceInput } from '../../types/aiCompilation';
import {
  isPlainRecord,
  sha256,
  stableCanonicalJson,
  utf8Length,
} from '../ai/compilation/canonical';
import { ChapterWritingWorkflowError } from './chapterWritingState';

export const CHAPTER_WORKFLOW_BINDING_START = protocol.startMarker;
export const CHAPTER_WORKFLOW_BINDING_END = protocol.endMarker;

function invalid(): never {
  throw new ChapterWritingWorkflowError(
    'CHAPTER_WORKFLOW_BINDING_INVALID',
    '阶段来源绑定缺少受支持的版本、稳定身份或完整 SHA-256 哈希。',
  );
}

/** Copy only supported fields; do not carry arbitrary metadata or secrets into model messages. */
export function validateChapterWorkflowBinding(value: unknown): ChapterWorkflowBindingV1 {
  if (!isPlainRecord(value) || protocol.bindingVersion !== 1 || value.schemaVersion !== 1)
    return invalid();
  const expected = new Set(protocol.bindingSchema.required);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  )
    return invalid();
  const identity = (field: unknown): field is string =>
    typeof field === 'string' &&
    !!field.trim() &&
    field === field.trim() &&
    !Array.from(field).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) &&
    !field.includes(CHAPTER_WORKFLOW_BINDING_START) &&
    !field.includes(CHAPTER_WORKFLOW_BINDING_END) &&
    utf8Length(field) <= protocol.maxIdentityUtf8Bytes;
  if (
    !identity(value.workflowId) ||
    !identity(value.stageKey) ||
    typeof value.inputHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.inputHash) ||
    typeof value.planHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.planHash)
  )
    return invalid();
  return {
    schemaVersion: 1,
    workflowId: value.workflowId,
    stageKey: value.stageKey,
    inputHash: value.inputHash,
    planHash: value.planHash,
  };
}

export function renderChapterWorkflowBinding(binding: ChapterWorkflowBindingV1): string {
  const checked = validateChapterWorkflowBinding(binding);
  return `${CHAPTER_WORKFLOW_BINDING_START}\n${stableCanonicalJson(checked)}\n${CHAPTER_WORKFLOW_BINDING_END}`;
}

/** A required full source ensures the binding reaches messages, not merely an InputSnapshot manifest. */
export async function chapterWorkflowBindingSources(
  binding: ChapterWorkflowBindingV1 | undefined,
): Promise<AiContextSourceInput[]> {
  if (binding === undefined) return [];
  const checked = validateChapterWorkflowBinding(binding);
  const content = renderChapterWorkflowBinding(checked);
  return [
    {
      sourceType: 'request_context',
      sourceId: `workflow:${checked.inputHash}`,
      sourceVersion: await sha256(content),
      origin: 'system',
      label: '章节阶段来源绑定（不授予应用权限）',
      content,
      order: 100,
      priority: 100,
      required: true,
      requireFull: true,
      maxTokens: 1024,
    },
  ];
}
