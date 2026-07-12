import { checkOutlineCompliance } from '../ai/outlineComplianceChecker';
import type { OutlineKeyPoint } from '../../types/ai';
import type { ChapterGenerationConstraintKind } from '../../types/chapterGenerationCompilation';
import type {
  ChapterConstraintValidationInput,
  ConstraintItemStatus,
  ConstraintValidationItem,
  ConstraintValidationResult,
  FrozenChapterConstraint,
} from '../../types/chapterConstraintValidation';

export const CHAPTER_CONSTRAINT_VALIDATOR_VERSION = 'chapter-constraint-validator-v1';
const MINIMUM_CHAPTER_CHARACTERS = 50;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function frozenConstraints(value: unknown, kind: ChapterGenerationConstraintKind): FrozenChapterConstraint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = object(entry);
    const id = text(row?.id);
    const rowKind = text(row?.kind);
    const constraintText = text(row?.text);
    return id && rowKind === kind && constraintText
      ? [{ id, kind, text: constraintText }]
      : [];
  });
}

function createItem(
  constraintId: string,
  severity: ChapterGenerationConstraintKind,
  code: string,
  status: ConstraintItemStatus,
  message: string,
  evidenceSummary?: string,
): ConstraintValidationItem {
  return { constraintId, severity, code, status, message, evidenceSummary };
}

function hasInternalContentLeak(body: string): boolean {
  return /(?:api[_ -]?key\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|system\s+prompt|ignore\s+(?:all\s+)?previous\s+instructions|```(?:json|markdown)?)/i.test(body)
    || /(?:系统提示词|忽略之前指令|以下是章节正文|内部 JSON)/.test(body);
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[。！？.!?"'”》）)]+$/u, '');
}

function matchesRequirement(body: string, requirement: string): boolean {
  const normalized = trimTerminalPunctuation(requirement);
  if (normalized.length < 2) return false;
  const point: OutlineKeyPoint = { id: 'frozen', text: normalized, type: 'other', required: true };
  return checkOutlineCompliance(body, [point]).coveredPoints.length === 1;
}

function validateMust(constraint: FrozenChapterConstraint, body: string): ConstraintValidationItem {
  const textValue = constraint.text;
  const outline = textValue.match(/^必须覆盖章节大纲关键点：(.+)$/u)?.[1];
  if (outline) {
    const passed = matchesRequirement(body, outline);
    return createItem(constraint.id, 'must', 'CONSTRAINT_OUTLINE_MISSING', passed ? 'passed' : 'failed',
      passed ? 'Outline key point is covered.' : 'A required outline key point is missing.');
  }
  const chapterGoal = textValue.match(/^必须完成本章目标：(.+)$/u)?.[1];
  if (chapterGoal) {
    const passed = matchesRequirement(body, chapterGoal);
    return createItem(constraint.id, 'must', 'CONSTRAINT_MUST_MISSING', passed ? 'passed' : 'failed',
      passed ? 'Chapter goal is covered.' : 'The required chapter goal is missing.');
  }
  const character = textValue.match(/^必须让角色[“"](.+?)[”"].+$/u)?.[1];
  if (character) {
    const passed = body.includes(character);
    return createItem(constraint.id, 'must', 'CONSTRAINT_CHARACTER_MISSING', passed ? 'passed' : 'failed',
      passed ? 'Required character is present.' : 'A required character is missing.');
  }
  const event = textValue.match(/^必须发生(?:工程)?事件：(.+?)(?:。|$)/u)?.[1];
  if (event) {
    const passed = matchesRequirement(body, event);
    return createItem(constraint.id, 'must', 'CONSTRAINT_MUST_MISSING', passed ? 'passed' : 'failed',
      passed ? 'Required event is covered.' : 'A required event is missing.');
  }
  const targetLength = textValue.match(/^正文目标字数约为\s*(\d+)\s*字。?$/u)?.[1];
  if (targetLength) {
    const target = Number(targetLength);
    const passed = body.length >= Math.min(target, MINIMUM_CHAPTER_CHARACTERS) && body.length >= Math.floor(target * 0.2);
    return createItem(constraint.id, 'must', 'CONSTRAINT_OUTPUT_TRUNCATED', passed ? 'passed' : 'failed',
      passed ? 'Minimum target length is satisfied.' : 'Output is materially shorter than the required target.');
  }
  const location = textValue.match(/^地点约束：(.+)$/u)?.[1];
  if (location) {
    const passed = body.includes(trimTerminalPunctuation(location));
    return createItem(constraint.id, 'must', 'CONSTRAINT_LOCATION_CONFLICT', passed ? 'passed' : 'failed',
      passed ? 'Location constraint is present.' : 'Location constraint is not satisfied.');
  }
  const viewpoint = textValue.match(/^叙事视角应围绕：(.+)$/u)?.[1];
  if (viewpoint) {
    const passed = body.includes(trimTerminalPunctuation(viewpoint));
    return createItem(constraint.id, 'must', 'CONSTRAINT_POV_CONFLICT', passed ? 'passed' : 'failed',
      passed ? 'Viewpoint subject is present.' : 'Viewpoint constraint is not satisfied.');
  }
  const person = textValue.match(/^叙事人称：(.+)$/u)?.[1];
  if (person) {
    const firstPerson = /第一人称|first person/i.test(person);
    const thirdPerson = /第三人称|third person/i.test(person);
    const passed = firstPerson ? body.includes('我') : thirdPerson ? !body.startsWith('我') : false;
    return createItem(constraint.id, 'must', 'CONSTRAINT_POV_CONFLICT', passed ? 'passed' : 'failed',
      passed ? 'Narrative person is satisfied.' : 'Narrative person is not satisfied.');
  }
  return createItem(constraint.id, 'must', 'CONSTRAINT_MUST_UNKNOWN', 'unknown',
    'This hard constraint has no deterministic validator.');
}

function validateForbid(constraint: FrozenChapterConstraint, body: string): ConstraintValidationItem {
  const value = constraint.text;
  if (value.startsWith('不得覆盖、修改、采用或写入其他章节')) {
    return createItem(constraint.id, 'forbid', 'CONSTRAINT_CROSS_CHAPTER_CONTENT', 'passed',
      'Candidate has no authoritative write operation.');
  }
  const match = value.match(/^(?:不得发生(?:工程)?事件|不得违反世界规则|不得改变|不得新增|不得提前发生|不得提前揭示|不得使用写法|角色[“"].+?[”"]不得|不得重现待解决质量问题)[：:]\s*(.+)$/u);
  if (!match) {
    return createItem(constraint.id, 'forbid', 'CONSTRAINT_FORBID_MATCHED', 'unknown',
      'This forbidden constraint has no deterministic matcher.');
  }
  const forbidden = trimTerminalPunctuation(match[1]);
  const matched = forbidden.length >= 2 && body.includes(forbidden);
  return createItem(constraint.id, 'forbid', matched ? 'CONSTRAINT_FORBID_MATCHED' : 'CONSTRAINT_FORBID_MATCHED',
    matched ? 'failed' : 'passed', matched ? 'A forbidden constraint matched the candidate.' : 'Forbidden constraint did not match.');
}

function validateShould(constraint: FrozenChapterConstraint, body: string): ConstraintValidationItem {
  const tooShort = body.length < MINIMUM_CHAPTER_CHARACTERS;
  return createItem(constraint.id, 'should', 'CONSTRAINT_SHOULD_WARNING', tooShort ? 'failed' : 'unknown',
    tooShort ? 'Candidate is too short to assess this recommendation.' : 'Recommendation needs editorial review.');
}

function validateFrozenIdentity(input: ChapterConstraintValidationInput): ConstraintValidationItem[] {
  const inputSnapshot = input.inputSnapshot;
  const manifest = object(input.contextSnapshot.sourceManifestJson);
  const sourceDraft = object(manifest?.sourceDraft);
  const targetChapter = text(object(input.constraintSnapshot.payloadJson)?.targetChapterId);
  const equal = inputSnapshot.sourceDraftId === input.sourceDraftId
    && inputSnapshot.sourceDraftVersion === input.sourceDraftVersion
    && inputSnapshot.baseContentHash === input.baseContentHash
    && sourceDraft && text(sourceDraft.id) === input.sourceDraftId
    && number(sourceDraft.versionNo) === input.sourceDraftVersion
    && text(sourceDraft.contentHash) === input.baseContentHash
    && text(manifest?.novelId) === input.novelId
    && text(manifest?.chapterId) === input.chapterId
    && (!targetChapter || targetChapter === input.chapterId);
  return [createItem('frozen-identity', 'must', 'CONSTRAINT_SNAPSHOT_MISMATCH', equal ? 'passed' : 'failed',
    equal ? 'Frozen task, context, and constraint identities agree.' : 'Frozen Snapshot identities do not agree.')];
}

function builtInItems(body: string): { must: ConstraintValidationItem[]; forbid: ConstraintValidationItem[] } {
  const must: ConstraintValidationItem[] = [];
  const forbid: ConstraintValidationItem[] = [];
  must.push(createItem('output-not-empty', 'must', 'CONSTRAINT_OUTPUT_EMPTY', body.trim() ? 'passed' : 'failed',
    body.trim() ? 'Candidate contains chapter text.' : 'Candidate output is empty.'));
  must.push(createItem('output-minimum-length', 'must', 'CONSTRAINT_OUTPUT_TRUNCATED', body.length >= MINIMUM_CHAPTER_CHARACTERS ? 'passed' : 'failed',
    body.length >= MINIMUM_CHAPTER_CHARACTERS ? 'Candidate meets the minimum safety length.' : 'Candidate is too short for a complete chapter.'));
  const truncated = /(?:\.\.\.|…|\[truncated\]|未完待续)\s*$/iu.test(body);
  must.push(createItem('output-complete', 'must', 'CONSTRAINT_OUTPUT_TRUNCATED', truncated ? 'failed' : 'passed',
    truncated ? 'Candidate appears truncated.' : 'Candidate does not have a truncation marker.'));
  forbid.push(createItem('internal-content', 'forbid', 'CONSTRAINT_INTERNAL_CONTENT_LEAK', hasInternalContentLeak(body) ? 'failed' : 'passed',
    hasInternalContentLeak(body) ? 'Candidate contains internal or credential-like content.' : 'No internal or credential-like content was detected.'));
  return { must, forbid };
}

export function validateChapterArtifactConstraints(input: ChapterConstraintValidationInput): ConstraintValidationResult {
  const payload = object(input.constraintSnapshot.payloadJson);
  const must = [
    ...validateFrozenIdentity(input),
    ...builtInItems(input.artifactBody).must,
    ...frozenConstraints(payload?.must, 'must').map((constraint) => validateMust(constraint, input.artifactBody)),
  ];
  const should = frozenConstraints(payload?.should, 'should')
    .map((constraint) => validateShould(constraint, input.artifactBody));
  const forbid = [
    ...builtInItems(input.artifactBody).forbid,
    ...frozenConstraints(payload?.forbid, 'forbid').map((constraint) => validateForbid(constraint, input.artifactBody)),
  ];
  const blockingCount = [...must, ...forbid].filter((item) => item.status !== 'passed').length;
  const warningCount = should.filter((item) => item.status !== 'passed').length;
  return {
    artifactId: input.artifactId,
    taskId: input.taskId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    sourceDraftId: input.sourceDraftId,
    sourceDraftVersion: input.sourceDraftVersion,
    baseContentHash: input.baseContentHash,
    validationRunId: input.validationRunId || crypto.randomUUID(),
    status: blockingCount > 0 ? 'blocked' : warningCount > 0 ? 'passed_with_warnings' : 'passed',
    must,
    should,
    forbid,
    blockingCount,
    warningCount,
    validatorVersion: CHAPTER_CONSTRAINT_VALIDATOR_VERSION,
    validatedAt: input.validatedAt || new Date().toISOString(),
  };
}
