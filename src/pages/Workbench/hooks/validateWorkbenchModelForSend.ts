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
  return hydrateTaskModelSnapshotRuntime(modelSnapshot);
}
