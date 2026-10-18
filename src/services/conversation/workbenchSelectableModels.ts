import { getAiSettings } from '../ai/aiSettingsStore';
import type { AiSettings } from '../../types/ai';
import type { CurrentPluginProjection } from './currentPluginService';
import {
  listAvailableWorkbenchModels,
  type WorkbenchModelOption,
} from './workbenchModelAvailability';

/** Configured models can be used directly; directory entries describe loaded plugins. */
export function listSelectableWorkbenchModels(
  plugins: CurrentPluginProjection[],
  settings?: AiSettings,
): WorkbenchModelOption[] {
  const choices = new Map(
    listAvailableWorkbenchModels(plugins).map((option) => [option.key, option]),
  );
  if (!settings) {
    if (typeof localStorage === 'undefined') return [...choices.values()];
    settings = getAiSettings();
  }
  const add = (provider: string, model: string, baseUrl: string, label = model) => {
    const providerId = provider.trim() === 'deepseek' ? 'deepseek-official' : provider.trim();
    const modelId = model.trim();
    if (!providerId || providerId === 'mock' || !modelId || !baseUrl.trim()) return;
    const key = `${providerId}:${modelId}`;
    if (!choices.has(key))
      choices.set(key, {
        key,
        providerId,
        modelId,
        name: label || modelId,
        pluginId: `settings:${key}`,
        source: 'saved-model-settings',
      });
  };
  if (settings.runtimeMode === 'api') add(settings.provider, settings.modelName, settings.baseUrl);
  for (const profile of settings.savedApiModels ?? []) {
    add(profile.provider, profile.modelName, profile.baseUrl, profile.label);
  }
  // Dedicated gateway/local profiles use separate credential scopes, not Workbench provider API.
  return [...choices.values()];
}
