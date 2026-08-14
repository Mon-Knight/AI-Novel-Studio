// Rust 权威校验器的 TS 镜像（src-tauri/src/services/dsh/proposal_validator.rs）。
// 规则：顶层键精确、schemaVersion=1、planner 枚举归一（唯一近邻 ≤2，写入
// metrics.plannerCoerced，绝不静默）、baseline 原样回显、evidence revision 严格
// 一致、recommendedActions 仅 read_tool/ask_user、字段长度上限。

import type {
  ChapterBaselineRevision,
  ChapterPreparationInput,
  PlannerCoercion,
} from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';

const PLANNERS = ['current_chapter_readiness_v1', 'dsh_spike_v0'] as const;
const ACTION_TYPES = ['read_tool', 'ask_user'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;
const PROPOSAL_KEYS = [
  'schemaVersion',
  'planner',
  'targetChapter',
  'baselineRevisions',
  'retrievedEvidence',
  'chapterGoals',
  'scenePlan',
  'characterConstraints',
  'continuityRisks',
  'unresolvedQuestions',
  'recommendedActions',
  'producedAt',
  'metrics',
] as const;
const COERCION_MAX_DISTANCE = 2;
const FIELD_MAX_CHARS = 12_000;
const MAX_PROPOSAL_BYTES = 2 * 1024 * 1024;

export interface ProposalValidationReport {
  valid: boolean;
  errors: string[];
  /** 归一动作记录（若发生）。 */
  coerced?: PlannerCoercion;
}

function levenshtein(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current.push(
        Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

/** 归一 planner 枚举：精确命中或唯一近邻（≤2，无并列）。null = 交由校验拒绝。 */
export function coercePlanner(raw: unknown): { planner: string; coerced?: PlannerCoercion } | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if ((PLANNERS as readonly string[]).includes(value)) return { planner: value };
  const lower = value.toLowerCase();
  const scored = PLANNERS.map((planner) => ({
    planner,
    distance: levenshtein(lower, planner.toLowerCase()),
  })).sort((left, right) => left.distance - right.distance);
  if (scored[0].distance > COERCION_MAX_DISTANCE) return null;
  if (scored.length > 1 && scored[1].distance === scored[0].distance) return null;
  return {
    planner: scored[0].planner,
    coerced: { original: value, distance: scored[0].distance },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fieldLenOk(value: unknown): boolean {
  return typeof value !== 'string' || value.length <= FIELD_MAX_CHARS;
}

interface ExpectedShape {
  revisions: Map<string, number>;
}

function hasKeys(
  object: unknown,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return false;
  const actual = Object.keys(object);
  if (!actual.every((key) => allowed.includes(key))) return false;
  return required.every((key) => actual.includes(key));
}

function revisionMap(revisions: ChapterBaselineRevision[]): Map<string, number> {
  return new Map(revisions.map((entry) => [entry.source, entry.revision]));
}

/**
 * 校验并归一化提案对象（会原地修改 planner 与 metrics.plannerCoerced）。
 * Rust 侧为权威实现；本镜像供前端即时反馈与单测使用。
 */
export function validateProposal(
  proposal: unknown,
  input: ChapterPreparationInput,
): ProposalValidationReport {
  const errors: string[] = [];
  let coerced: PlannerCoercion | undefined;

  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return { valid: false, errors: ['proposal is not an object'], coerced: undefined };
  }
  const record = proposal as Record<string, unknown>;

  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== PROPOSAL_KEYS.length ||
    !PROPOSAL_KEYS.every((key) => actualKeys.includes(key))
  ) {
    errors.push('top-level keys must be exactly: ' + PROPOSAL_KEYS.join(', '));
  }
  try {
    if (JSON.stringify(proposal).length > MAX_PROPOSAL_BYTES) {
      errors.push('proposal exceeds 2 MiB cap');
    }
  } catch {
    // stringify failure surfaces through other checks
  }
  if (record.schemaVersion !== 1) errors.push('schemaVersion must be 1');

  const plannerFix = coercePlanner(record.planner);
  if (plannerFix) {
    record.planner = plannerFix.planner;
    if (plannerFix.coerced) {
      coerced = plannerFix.coerced;
      const metrics = record.metrics as Record<string, unknown> | undefined;
      if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
        metrics.plannerCoerced = plannerFix.coerced;
      }
    }
  } else {
    errors.push('planner must be one of ' + PLANNERS.join('|'));
  }

  const target = record.targetChapter as Record<string, unknown> | undefined;
  if (target?.novelId === input.novelId && target?.chapterId === input.chapterId) {
    // matches
  } else {
    errors.push('targetChapter must match the input novel/chapter ids');
  }

  const expected: ExpectedShape = { revisions: revisionMap(input.baselineRevisions) };
  const baseline = record.baselineRevisions as ChapterBaselineRevision[] | undefined;
  if (Array.isArray(baseline) && baseline.length === CHAPTER_PREPARATION_SOURCES.length) {
    for (const source of CHAPTER_PREPARATION_SOURCES) {
      const entry = baseline.find((item) => item?.source === source);
      if (!entry) errors.push('baselineRevisions missing source ' + source);
      else if (entry.revision !== expected.revisions.get(source)) {
        errors.push('baselineRevisions ' + source + ' revision mismatch');
      }
    }
  } else {
    errors.push(
      'baselineRevisions must list all ' + CHAPTER_PREPARATION_SOURCES.length + ' sources',
    );
  }

  const evidence = record.retrievedEvidence as Record<string, unknown>[] | undefined;
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (
        !hasKeys(
          item,
          ['source', 'revision', 'summary', 'detailRef'],
          ['source', 'revision', 'summary'],
        )
      ) {
        errors.push('retrievedEvidence item keys invalid');
        continue;
      }
      const source = item.source as string;
      if (!(CHAPTER_PREPARATION_SOURCES as readonly string[]).includes(source)) {
        errors.push('retrievedEvidence source invalid: ' + source);
      } else if (item.revision !== expected.revisions.get(source)) {
        errors.push('retrievedEvidence ' + source + ' revision mismatch');
      }
      if (!isNonEmptyString(item.summary))
        errors.push('retrievedEvidence summary must be non-empty');
    }
  } else {
    errors.push('retrievedEvidence must be an array');
  }

  const goals = record.chapterGoals;
  if (!Array.isArray(goals) || goals.length === 0 || !goals.every(isNonEmptyString)) {
    errors.push('chapterGoals must be a non-empty array of non-empty strings');
  }

  const scenes = record.scenePlan as Record<string, unknown>[] | undefined;
  const scenesOk =
    Array.isArray(scenes) &&
    scenes.every(
      (item) =>
        hasKeys(item, ['title', 'purpose', 'conflicts'], ['title', 'purpose']) &&
        isNonEmptyString(item.title) &&
        fieldLenOk(item.title) &&
        isNonEmptyString(item.purpose) &&
        fieldLenOk(item.purpose),
    );
  if (!scenesOk) errors.push('scenePlan items must be {title, purpose, conflicts?}');

  const constraints = record.characterConstraints as Record<string, unknown>[] | undefined;
  const constraintsOk =
    Array.isArray(constraints) &&
    constraints.every(
      (item) =>
        hasKeys(item, ['characterId', 'constraint'], ['characterId', 'constraint']) &&
        isNonEmptyString(item.characterId) &&
        isNonEmptyString(item.constraint),
    );
  if (!constraintsOk) errors.push('characterConstraints items must be {characterId, constraint}');

  const risks = record.continuityRisks as Record<string, unknown>[] | undefined;
  const risksOk =
    Array.isArray(risks) &&
    risks.every(
      (item) =>
        hasKeys(item, ['kind', 'description', 'severity'], ['kind', 'description', 'severity']) &&
        isNonEmptyString(item.kind) &&
        isNonEmptyString(item.description) &&
        typeof item.severity === 'string' &&
        (SEVERITIES as readonly string[]).includes(item.severity),
    );
  if (!risksOk)
    errors.push('continuityRisks items must be {kind, description, severity in low|medium|high}');

  const questions = record.unresolvedQuestions;
  if (!Array.isArray(questions) || !questions.every(isNonEmptyString)) {
    errors.push('unresolvedQuestions must be an array of non-empty strings');
  }

  const actions = record.recommendedActions as Record<string, unknown>[] | undefined;
  if (Array.isArray(actions) && actions.length > 0) {
    for (const action of actions) {
      if (!hasKeys(action, ['type', 'target', 'description'], ['type', 'description'])) {
        errors.push('recommendedActions item keys invalid');
        continue;
      }
      if (!(ACTION_TYPES as readonly string[]).includes(action.type as string)) {
        errors.push(
          'recommendedActions type must be read_tool|ask_user, got ' + String(action.type),
        );
      }
      if (!isNonEmptyString(action.description))
        errors.push('recommendedActions description must be non-empty');
      if (action.target !== undefined && !isNonEmptyString(action.target)) {
        errors.push('recommendedActions target must be a string when present');
      }
    }
  } else {
    errors.push('recommendedActions must be a non-empty array');
  }

  if (!isNonEmptyString(record.producedAt)) errors.push('producedAt must be a non-empty string');
  if (
    record.metrics === null ||
    typeof record.metrics !== 'object' ||
    Array.isArray(record.metrics)
  ) {
    errors.push('metrics must be an object');
  }

  return { valid: errors.length === 0, errors, coerced };
}
