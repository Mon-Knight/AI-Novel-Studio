import { autonomousPlanPersistence } from './autonomousPersistence';
import { AiAutonomousCreationProvider } from './autonomousProvider';
import { AutonomousStoryService } from './autonomousStoryService';

export const autonomousStoryService = new AutonomousStoryService({
  provider: new AiAutonomousCreationProvider(),
  persistence: autonomousPlanPersistence,
});
