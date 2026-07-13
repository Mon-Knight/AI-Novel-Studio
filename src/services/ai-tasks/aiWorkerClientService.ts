import { aiSettingsService } from '../ai/aiSettingsService';
import { dbCall, isTauri } from '../database/db';

export const aiWorkerClientService = {
  async configureFromLocalSettings(): Promise<void> {
    if (!isTauri()) return;
    const settings = aiSettingsService.getSettings();
    await dbCall<void>('configure_ai_worker_provider', {
      input: {
        runtimeMode: settings.runtimeMode,
        providerId: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        timeoutSeconds: settings.timeoutSeconds,
      },
    });
  },
};

