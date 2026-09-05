import {
  captureTaskModelSnapshot,
  hydrateTaskModelSnapshotRuntime,
} from '../../../services/conversation/taskModelSnapshot';
import {
  assertWorkbenchModelAvailable,
  isLocalLikeWorkbenchModel,
  WorkbenchModelCredentialUnavailableError,
} from '../../../services/conversation/workbenchModelAvailability';
import { hasUsableDshTaskCredentialAsync } from '../../../services/dsh/taskRuntimeService';
import type { TaskModelSnapshot } from '../../../types/conversation';
import type { CurrentPluginProjection } from '../../../services/conversation/currentPluginService';
import type { WorkbenchPluginRefreshSource } from './useWorkbenchPlugins';

export type WorkbenchPluginRefresh = (
  conversationId?: string,
  allowProbe?: boolean,
  modelSnapshot?: TaskModelSnapshot,
  source?: WorkbenchPluginRefreshSource,
) => Promise<CurrentPluginProjection[]>;

/**
 * Hydrate a frozen snapshot, fail closed without a remote session credential,
 * then refresh the Runtime directory in the background so the task-creator
 * foreground catalog is not overwritten.
 */
export async function validateWorkbenchModelForSend(
  modelSnapshot: TaskModelSnapshot,
  refreshPlugins: WorkbenchPluginRefresh,
  options: { allowLocalFallback?: boolean } = {},
): Promise<TaskModelSnapshot> {
  const resolvedModel = hydrateTaskModelSnapshotRuntime(modelSnapshot);
  try {
    if (
      resolvedModel.runtimeMode === 'api' &&
      !(await hasUsableDshTaskCredentialAsync(resolvedModel))
    ) {
      throw new WorkbenchModelCredentialUnavailableError(resolvedModel);
    }
    const currentPlugins = await refreshPlugins(undefined, true, resolvedModel, 'background');
    assertWorkbenchModelAvailable(currentPlugins, resolvedModel);
    return resolvedModel;
  } catch (error) {
    if (!options.allowLocalFallback || !isLocalLikeWorkbenchModel(resolvedModel)) throw error;
    const fallback = hydrateTaskModelSnapshotRuntime(captureTaskModelSnapshot());
    if (fallback.runtimeMode !== 'api' || !(await hasUsableDshTaskCredentialAsync(fallback))) {
      throw error;
    }
    const fallbackPlugins = await refreshPlugins(undefined, true, fallback, 'background');
    assertWorkbenchModelAvailable(fallbackPlugins, fallback);
    return fallback;
  }
}
