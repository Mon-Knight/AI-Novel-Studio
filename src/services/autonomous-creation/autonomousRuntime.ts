import { autonomousPlanPersistence } from './autonomousPersistence';
import { AiAutonomousCreationProvider } from './autonomousProvider';
import { AutonomousStoryService } from './autonomousStoryService';
import { aiSettingsService } from '../ai/aiSettingsService';

export const autonomousStoryService = new AutonomousStoryService({
  provider: new AiAutonomousCreationProvider(),
  persistence: autonomousPlanPersistence,
  maxConcurrentProviderCalls: () =>
    Math.max(1, aiSettingsService.getSettings().maxConcurrentAiRequests ?? 2),
});
