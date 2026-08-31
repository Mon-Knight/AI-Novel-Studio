export interface ContinuousTaskSurfaceState {
  workbenchVisible: boolean;
  conflictingSurfaceVisible: boolean;
  conversationId: string;
}

export interface ContinuousTaskSurfaceController {
  readState: () => Promise<ContinuousTaskSurfaceState>;
  openWorkbench: () => Promise<void>;
  selectProject: (novelId: string) => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
}

export async function restoreContinuousTaskSurface(input: {
  novelId: string;
  conversationId: string;
  controller: ContinuousTaskSurfaceController;
}): Promise<{ restored: boolean }> {
  const current = await input.controller.readState();
  if (
    current.workbenchVisible &&
    !current.conflictingSurfaceVisible &&
    current.conversationId === input.conversationId
  ) {
    return { restored: false };
  }

  await input.controller.openWorkbench();
  await input.controller.selectProject(input.novelId);
  await input.controller.selectConversation(input.conversationId);

  const restored = await input.controller.readState();
  if (
    !restored.workbenchVisible ||
    restored.conflictingSurfaceVisible ||
    restored.conversationId !== input.conversationId
  ) {
    throw new Error('The real-model run did not restore its original continuous task surface.');
  }
  return { restored: true };
}
