import { ChapterWritingWorkflowError } from '../generation/chapterWritingState';

export const CHAPTER_BEAT_PLAN_MAX_OUTPUT_TOKENS = 3_072;
export const CHAPTER_BEAT_PLAN_TEMPERATURE = 0.45;
export const CHAPTER_BEAT_STATE_EXTRACT_MAX_OUTPUT_TOKENS = 2_048;
export const CHAPTER_BEAT_STATE_EXTRACT_TEMPERATURE = 0.15;
export const DEFAULT_MAX_BEATS_PER_SCENE = 6;

/**
 * The single-write envelope is supplied by the caller. Planning must remain
 * useful for different writer models instead of baking a fixed 500–900
 * assumption into the Scene model.
 */
export interface SceneBeatPlanningPolicy {
  targetCharactersPerBeat?: number;
  minBeatCharacters?: number;
  maxBeatCharacters?: number;
  minBeatsPerScene?: number;
  maxBeatsPerScene?: number;
}

export interface ResolvedSceneBeatPlanningPolicy {
  targetCharactersPerBeat: number;
  minBeatCharacters: number;
  maxBeatCharacters: number;
  minBeatsPerScene: number;
  maxBeatsPerScene: number;
}

function invalid(message: string): never {
  throw new ChapterWritingWorkflowError('CHAPTER_BEAT_POLICY_INVALID', message);
}

function positiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return invalid(`${label} 必须是正整数。`);
  }
  return value;
}

export function resolveSceneBeatPlanningPolicy(
  policy: SceneBeatPlanningPolicy = {},
): ResolvedSceneBeatPlanningPolicy {
  const resolved: ResolvedSceneBeatPlanningPolicy = {
    targetCharactersPerBeat: positiveInteger(
      policy.targetCharactersPerBeat,
      'targetCharactersPerBeat',
      650,
    ),
    minBeatCharacters: positiveInteger(policy.minBeatCharacters, 'minBeatCharacters', 500),
    maxBeatCharacters: positiveInteger(policy.maxBeatCharacters, 'maxBeatCharacters', 900),
    minBeatsPerScene: positiveInteger(policy.minBeatsPerScene, 'minBeatsPerScene', 1),
    maxBeatsPerScene: positiveInteger(
      policy.maxBeatsPerScene,
      'maxBeatsPerScene',
      DEFAULT_MAX_BEATS_PER_SCENE,
    ),
  };
  if (resolved.maxBeatCharacters < resolved.minBeatCharacters) {
    invalid('maxBeatCharacters 不能小于 minBeatCharacters。');
  }
  if (
    resolved.targetCharactersPerBeat < resolved.minBeatCharacters ||
    resolved.targetCharactersPerBeat > resolved.maxBeatCharacters
  ) {
    invalid('targetCharactersPerBeat 必须落在单次写作包络内。');
  }
  if (resolved.maxBeatsPerScene < resolved.minBeatsPerScene) {
    invalid('maxBeatsPerScene 不能小于 minBeatsPerScene。');
  }
  if (resolved.maxBeatsPerScene > 12) {
    invalid('单个 Scene 的 maxBeatsPerScene 不能超过 12。');
  }
  return resolved;
}

interface BeatCountRange {
  lower: number;
  upper: number;
}

/**
 * A Scene is feasible only when its target can be distributed across whole
 * Beats inside the writer envelope. When it cannot, planning fails instead of
 * silently under-writing the Scene.
 */
export function sceneBeatCountRange(
  sceneTargetCharacters: number,
  policy: ResolvedSceneBeatPlanningPolicy,
): BeatCountRange {
  if (
    typeof sceneTargetCharacters !== 'number' ||
    !Number.isSafeInteger(sceneTargetCharacters) ||
    sceneTargetCharacters <= 0
  ) {
    return invalid('Scene 目标字数必须是正整数。');
  }
  if (sceneTargetCharacters < policy.minBeatCharacters) {
    return invalid(
      `Scene 目标 ${sceneTargetCharacters} 字小于单 Beat 最小包络 ${policy.minBeatCharacters} 字，无法在不超写的情况下形成可行计划。`,
    );
  }
  const lower = Math.max(
    policy.minBeatsPerScene,
    Math.ceil(sceneTargetCharacters / policy.maxBeatCharacters),
  );
  const upper = Math.min(
    policy.maxBeatsPerScene,
    Math.max(1, Math.floor(sceneTargetCharacters / policy.minBeatCharacters)),
  );
  if (lower > upper) {
    return invalid(
      `Scene 目标 ${sceneTargetCharacters} 字无法在 ${policy.minBeatCharacters}–${policy.maxBeatCharacters} 字的单 Beat 包络与每 Scene ${policy.minBeatsPerScene}–${policy.maxBeatsPerScene} 个 Beat 内完成。`,
    );
  }
  return { lower, upper };
}

export function expectedSceneBeatCount(
  sceneTargetCharacters: number,
  policyInput: SceneBeatPlanningPolicy | ResolvedSceneBeatPlanningPolicy = {},
  remainingCalls?: number,
): number {
  const policy = resolveSceneBeatPlanningPolicy(policyInput);
  const { lower, upper } = sceneBeatCountRange(sceneTargetCharacters, policy);
  if (remainingCalls !== undefined) {
    if (!Number.isSafeInteger(remainingCalls) || remainingCalls < 0) {
      return invalid('remainingCalls 必须是非负整数。');
    }
    if (remainingCalls < lower) {
      throw new ChapterWritingWorkflowError(
        'CHAPTER_BEAT_PLAN_CALL_BUDGET_INSUFFICIENT',
        `剩余调用 ${remainingCalls} 次不足以在单 Beat 包络内完成 ${sceneTargetCharacters} 字（至少需要 ${lower} 个 Beat）。`,
      );
    }
  }
  const desired = Math.round(sceneTargetCharacters / policy.targetCharactersPerBeat);
  const bounded = Math.min(upper, Math.max(lower, desired));
  return remainingCalls === undefined ? bounded : Math.min(bounded, remainingCalls);
}

/**
 * Distributes the Scene target across whole Beats without leaving a remainder
 * outside the envelope. The sum always equals `sceneTargetCharacters`.
 */
export function distributeSceneBeatTargetCharacters(
  sceneTargetCharacters: number,
  beatCount: number,
  policyInput: SceneBeatPlanningPolicy | ResolvedSceneBeatPlanningPolicy = {},
): number[] {
  const policy = resolveSceneBeatPlanningPolicy(policyInput);
  const { lower, upper } = sceneBeatCountRange(sceneTargetCharacters, policy);
  if (!Number.isSafeInteger(beatCount) || beatCount < lower || beatCount > upper) {
    return invalid(
      `Beat 数 ${beatCount} 不在该 Scene 的可行区间 ${lower}–${upper} 内，不能静默少写或多写。`,
    );
  }
  const targets: number[] = [];
  let remaining = sceneTargetCharacters;
  for (let index = 0; index < beatCount; index += 1) {
    const slots = beatCount - index;
    const ideal = Math.round(remaining / slots);
    const lowerBound = Math.max(
      policy.minBeatCharacters,
      remaining - (slots - 1) * policy.maxBeatCharacters,
    );
    const upperBound = Math.min(
      policy.maxBeatCharacters,
      remaining - (slots - 1) * policy.minBeatCharacters,
    );
    const value = Math.min(upperBound, Math.max(lowerBound, ideal));
    targets.push(value);
    remaining -= value;
  }
  if (remaining !== 0) {
    return invalid('Beat 字数分配未能精确覆盖 Scene 目标。');
  }
  if (
    targets.some((target) => target < policy.minBeatCharacters || target > policy.maxBeatCharacters)
  ) {
    return invalid('Beat 字数分配越出单次写作包络。');
  }
  return targets;
}
