import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import {
  startupCoordinator,
  type StartupCoordinator,
} from '../../services/startup/startupCoordinator';

type WorkbenchContextGate = Pick<StartupCoordinator, 'waitForContextMigration'>;

export async function executeWorkbenchTurnAfterContextReady<T>(input: {
  goal: string;
  execute: () => Promise<T>;
  coordinator?: WorkbenchContextGate;
}): Promise<T> {
  if (!isConversationalGoal(input.goal)) {
    await (input.coordinator ?? startupCoordinator).waitForContextMigration();
  }
  return input.execute();
}
