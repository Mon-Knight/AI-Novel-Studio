import { hydrateTaskModelSnapshotRuntime } from '../../../services/conversation/taskModelSnapshot';
import type { TaskModelSnapshot } from '../../../types/conversation';
import type { CurrentPluginProjection } from '../../../services/conversation/currentPluginService';
import type { WorkbenchPluginRefreshSource } from './useWorkbenchPlugins';

export type WorkbenchPluginRefresh = (
  conversationId?: string,
  allowProbe?: boolean,
  modelSnapshot?: TaskModelSnapshot,
  source?: WorkbenchPluginRefreshSource,
) => Promise<CurrentPluginProjection[]>;

/** Hydrate the selected identity without a model capability or connectivity probe.
 * Actual execution owns exact credential resolution and dialogue Run errors.
 */
export async function validateWorkbenchModelForSend(
  modelSnapshot: TaskModelSnapshot,
  _refreshPlugins: WorkbenchPluginRefresh,
  _options: { allowLocalFallback?: boolean } = {},
): Promise<TaskModelSnapshot> {
  const hydrated = hydrateTaskModelSnapshotRuntime(modelSnapshot);
  if (
    hydrated.runtimeMode === 'api' &&
    (!hydrated.providerId.trim() || !hydrated.modelId.trim() || !hydrated.baseUrl?.trim())
  ) {
    throw new Error('当前模型快照缺少 Provider、模型或 Endpoint，已停止启动任务。');
  }
  // Runtime directory state is descriptive.  The native task command remains
  // the final route/credential authority, so a stale or still-initializing
  // health snapshot does not permanently block a valid frozen model.
  return hydrated;
}
