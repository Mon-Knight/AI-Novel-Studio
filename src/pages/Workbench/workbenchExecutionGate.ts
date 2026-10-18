import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import {
  startupCoordinator,
  type StartupCoordinator,
} from '../../services/startup/startupCoordinator';

type WorkbenchContextGate = Pick<StartupCoordinator, 'waitForContextMigration'>;

export async function executeWorkbenchTurnAfterContextReady<T>(input: {
  goal: string;
  /** A real model can read context even when the user only greets it. */
  requireContext?: boolean;
  execute: () => Promise<T>;
  coordinator?: WorkbenchContextGate;
}): Promise<T> {
  if (input.requireContext || !isConversationalGoal(input.goal)) {
    await (input.coordinator ?? startupCoordinator).waitForContextMigration();
  }
  return input.execute();
}
