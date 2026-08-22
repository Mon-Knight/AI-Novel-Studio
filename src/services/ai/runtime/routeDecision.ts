import type { AiTaskType } from '../../../types/ai-task';
import type {
  CreativeRole,
  ModelLifecycle,
  RouteDecision,
  RouteReason,
  RouteRequest,
} from '../../../types/modelRuntime';

const DIRECTOR_ROLES = new Set<CreativeRole>([
  'director.world',
  'director.character',
  'director.plot',
  'director.scene_plan',
  'director.repair',
  'critic.quality',
  'planner.prepare',
]);

export class ModelRouteError extends Error {
  readonly code = 'MODEL_ROUTE_UNAVAILABLE';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'ModelRouteError';
  }
}

export function roleForTaskType(taskType: AiTaskType): CreativeRole {
  switch (taskType) {
    case 'chapter_scene_generate':
      return 'writer.beat_prose';
    case 'chapter_generate':
    case 'chapter_rewrite':
      return 'writer.chapter_fallback';
    case 'chapter_scene_plan_generate':
      return 'director.scene_plan';
    case 'chapter_beat_repair':
    case 'quality_fix':
      return 'director.repair';
    case 'quality_check':
      return 'critic.quality';
    case 'autonomous_world_build':
    case 'setting_expand':
      return 'director.world';
    case 'autonomous_character_evolution':
    case 'character_generate':
      return 'director.character';
    case 'autonomous_plot_plan':
    case 'autonomous_chapter_batch':
    case 'autonomous_conflict_generate':
    case 'autonomous_pacing_control':
      return 'director.plot';
    default:
      return 'director.plot';
  }
}

export function lifecycleRouteReason(lifecycle: ModelLifecycle): RouteReason | undefined {
  if (lifecycle === 'TRAINING') return 'local_training';
  if (lifecycle === 'TESTING') return 'local_testing';
  if (lifecycle === 'FAILED') return 'local_failed';
  if (lifecycle === 'DISABLED') return 'local_disabled';
  return undefined;
}

function decideWriterBeat(input: RouteRequest, decidedAt: string): RouteDecision {
  const cloudFallback = input.cloudAvailable ? input.cloudRef : undefined;
  const remoteFitsContext =
    input.compiledContextTokens === undefined ||
    input.remoteContextTokens === undefined ||
    input.remoteMaxOutputTokens === undefined ||
    input.compiledContextTokens <= input.remoteContextTokens - input.remoteMaxOutputTokens;
  const canUseRemote =
    input.remoteEnabled === true &&
    Boolean(input.remoteRef) &&
    input.remoteAvailable === true &&
    remoteFitsContext;
  const fallback = canUseRemote ? input.remoteRef : cloudFallback;

  // A dedicated local writer is an optional optimization, not a prerequisite.
  // When it is disabled or not configured:
  // - If remote writer is enabled and valid, remote writer is the primary Beat writer.
  // - Otherwise, the governed cloud endpoint is the primary Beat writer.
  if (!input.localEnabled || !input.localRef) {
    if (canUseRemote && input.remoteRef) {
      return {
        schemaVersion: 1,
        role: input.role,
        taskType: input.taskType,
        primary: input.remoteRef,
        fallback: cloudFallback,
        selected: input.remoteRef,
        reason: 'remote_writer_primary',
        fallbackUsed: false,
        decidedAt,
      };
    }
    if (!cloudFallback) {
      throw new ModelRouteError('正文模型不可用。');
    }
    return {
      schemaVersion: 1,
      role: input.role,
      taskType: input.taskType,
      primary: cloudFallback,
      selected: cloudFallback,
      reason: 'cloud_writer_primary',
      fallbackUsed: false,
      decidedAt,
    };
  }

  const localFitsContext =
    input.compiledContextTokens === undefined ||
    input.localContextTokens === undefined ||
    input.localMaxOutputTokens === undefined ||
    input.compiledContextTokens <= input.localContextTokens - input.localMaxOutputTokens;

  const lifecycleReason = lifecycleRouteReason(input.localLifecycle);
  const canUseLocal =
    input.localEnabled &&
    Boolean(input.localRef) &&
    input.localLifecycle === 'AVAILABLE' &&
    input.localHealth !== 'down' &&
    localFitsContext;

  if (canUseLocal && input.localRef) {
    return {
      schemaVersion: 1,
      role: input.role,
      taskType: input.taskType,
      primary: input.localRef,
      fallback,
      selected: input.localRef,
      reason: 'local_available',
      fallbackUsed: false,
      decidedAt,
    };
  }

  const reason: RouteReason =
    lifecycleReason && input.localLifecycle !== 'AVAILABLE'
      ? lifecycleReason
      : input.localHealth === 'down'
        ? 'local_unhealthy'
        : !localFitsContext
          ? 'context_too_large_for_local'
          : canUseRemote
            ? 'remote_writer_fallback'
            : 'cloud_writer_fallback';

  if (!input.allowCloudWriterFallback || !fallback) {
    throw new ModelRouteError(
      reason === 'context_too_large_for_local'
        ? '本地作家上下文不足，且未允许云端代写同一 Beat。'
        : '本地作家不可用，且未允许云端代写同一 Beat。',
    );
  }

  return {
    schemaVersion: 1,
    role: input.role,
    taskType: input.taskType,
    primary: input.localRef ?? fallback,
    fallback,
    selected: fallback,
    reason,
    fallbackUsed: true,
    decidedAt,
  };
}

export function decideModelRoute(
  input: RouteRequest,
  now = () => new Date().toISOString(),
): RouteDecision {
  const decidedAt = now();
  if (input.runtimeMode === 'mock') {
    return {
      schemaVersion: 1,
      role: input.role,
      taskType: input.taskType,
      primary: input.mockRef,
      selected: input.mockRef,
      reason: 'mock',
      fallbackUsed: false,
      decidedAt,
    };
  }

  if (DIRECTOR_ROLES.has(input.role) || input.role === 'writer.chapter_fallback') {
    if (!input.cloudAvailable) {
      throw new ModelRouteError('云端导演/评论模型不可用。');
    }
    return {
      schemaVersion: 1,
      role: input.role,
      taskType: input.taskType,
      primary: input.cloudRef,
      selected: input.cloudRef,
      reason: 'role_default',
      fallbackUsed: false,
      decidedAt,
    };
  }

  return decideWriterBeat(input, decidedAt);
}
