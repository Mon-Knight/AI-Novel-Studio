import type { AiSettings } from '../../../types/ai';
import type { AiTaskType } from '../../../types/ai-task';
import type { CreativeRole, RouteDecision, RouteRequest } from '../../../types/modelRuntime';
import {
  allowCloudWriterFallback,
  cloudModelRef,
  isCloudEndpointAvailable,
  isRemoteEndpointAvailable,
  localModelRef,
  mockModelRef,
  remoteModelRef,
} from './modelCatalog';
import { modelLifecycleManager } from './modelLifecycle';
import { decideModelRoute, roleForTaskType } from './routeDecision';

export function buildRouteRequest(
  settings: AiSettings,
  taskType: AiTaskType,
  options: { role?: CreativeRole; compiledContextTokens?: number } = {},
): RouteRequest {
  const local = settings.localChapterModel;
  const localRef = local ? localModelRef(local) : undefined;
  const remote = settings.remoteWriter;
  const remoteRef = remote ? remoteModelRef(remote) : undefined;
  return {
    role: options.role ?? roleForTaskType(taskType),
    taskType,
    compiledContextTokens: options.compiledContextTokens,
    localEnabled: local?.enabled === true,
    localLifecycle: localRef
      ? modelLifecycleManager.getLifecycle(localRef.endpointId, local?.enabled === true)
      : 'DISABLED',
    localHealth: localRef ? modelLifecycleManager.getHealth(localRef.endpointId) : 'unknown',
    localContextTokens: local?.contextTokens,
    localMaxOutputTokens: local?.maxTokens,
    remoteEnabled: remote?.enabled === true,
    remoteAvailable: isRemoteEndpointAvailable(remote),
    remoteContextTokens: remote?.contextTokens,
    remoteMaxOutputTokens: remote?.maxTokens,
    cloudAvailable: isCloudEndpointAvailable(settings),
    runtimeMode: settings.runtimeMode,
    allowCloudWriterFallback: allowCloudWriterFallback(local),
    mockRef: mockModelRef(),
    cloudRef: cloudModelRef(settings),
    localRef,
    remoteRef,
  };
}

export function routeCreativeTask(
  settings: AiSettings,
  taskType: AiTaskType,
  options: { role?: CreativeRole; compiledContextTokens?: number } = {},
): RouteDecision {
  return decideModelRoute(buildRouteRequest(settings, taskType, options));
}
