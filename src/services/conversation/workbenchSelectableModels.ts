import { getAiSettings } from '../ai/aiSettingsStore';
import type { AiSettings } from '../../types/ai';
import type { CurrentPluginProjection } from './currentPluginService';
import {
  listAvailableWorkbenchModels,
  type WorkbenchModelOption,
} from './workbenchModelAvailability';
import { canonicalModelProviderId, normalizeModelBaseUrl, normalizeModelId } from './modelIdentity';

/** Configured models can be used directly; directory entries describe loaded plugins. */
export function listSelectableWorkbenchModels(
  plugins: CurrentPluginProjection[],
  settings?: AiSettings,
): WorkbenchModelOption[] {
  const loaded = listAvailableWorkbenchModels(plugins);
  if (!settings) {
    if (
      typeof localStorage === 'undefined' ||
      localStorage.getItem('ai_novel_studio_ai_settings') === null
    ) {
      return loaded;
    }
    settings = getAiSettings();
  }

  const configuredApiKeys = new Set<string>();
  const optionalKeys = new Set<string>();
  const validRouteKey = (provider: string, model: string, baseUrl: string): string | undefined => {
    const providerId = canonicalModelProviderId(provider);
    const modelId = normalizeModelId(model);
    if (!providerId || providerId === 'mock' || !modelId || !normalizeModelBaseUrl(baseUrl)) {
      return undefined;
    }
    return `${providerId}:${modelId}`;
  };
  const registerKey = (target: Set<string>, provider: string, model: string, baseUrl: string) => {
    const key = validRouteKey(provider, model, baseUrl);
    if (key) target.add(key);
  };

  if (settings.runtimeMode === 'api') {
    registerKey(configuredApiKeys, settings.provider, settings.modelName, settings.baseUrl);
  }
  for (const profile of settings.savedApiModels ?? []) {
    registerKey(configuredApiKeys, profile.provider, profile.modelName, profile.baseUrl);
  }
  const gateway = settings.gateway ?? settings.remoteWriter;
  if (gateway) registerKey(optionalKeys, gateway.providerId, gateway.modelName, gateway.baseUrl);
  if (settings.localChapterModel) {
    registerKey(
      optionalKeys,
      settings.localChapterModel.providerId,
      settings.localChapterModel.modelName,
      settings.localChapterModel.baseUrl,
    );
  }
  for (const profile of settings.savedGatewayModels ?? []) {
    registerKey(optionalKeys, profile.providerId, profile.modelName, profile.baseUrl);
  }
  for (const profile of settings.savedLocalModels ?? []) {
    registerKey(optionalKeys, profile.providerId, profile.modelName, profile.baseUrl);
  }

  const choices = new Map<string, WorkbenchModelOption>();
  for (const option of loaded) {
    if (
      option.source === 'e2e-deterministic-runtime' ||
      (option.source === 'browser-fallback' && settings.runtimeMode === 'mock') ||
      configuredApiKeys.has(option.key) ||
      optionalKeys.has(option.key)
    ) {
      choices.set(option.key, option);
    }
  }
  const add = (provider: string, model: string, baseUrl: string, label = model) => {
    const providerId = canonicalModelProviderId(provider);
    const modelId = normalizeModelId(model);
    const key = validRouteKey(provider, model, baseUrl);
    if (!key || !providerId || !modelId || choices.has(key)) return;
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
