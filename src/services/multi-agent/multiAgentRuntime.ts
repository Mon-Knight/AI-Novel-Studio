import { generateId, nowISO } from '../database/db';
import { draftVersionService } from '../database/draftVersionService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { AiMultiAgentProvider } from './multiAgentProvider';
import { multiAgentPersistence } from './multiAgentPersistence';
import { MultiAgentService } from './multiAgentService';
import { aiSettingsService } from '../ai/aiSettingsService';

export const multiAgentService = new MultiAgentService({
  provider: new AiMultiAgentProvider(),
  persistence: multiAgentPersistence,
  drafts: draftVersionService,
  generateId,
  now: nowISO,
  hashContent: computeContentSha256,
  maxConcurrentProviderCalls: () =>
    Math.max(1, aiSettingsService.getSettings().maxConcurrentAiRequests ?? 2),
});
