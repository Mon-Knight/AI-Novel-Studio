import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceSessionStore } from './workspaceSessionStore';

describe('workspace session store', () => {
  beforeEach(() => useWorkspaceSessionStore.getState().reset());

  it('resets document ownership when another novel session starts', () => {
    const store = useWorkspaceSessionStore.getState();
    store.startSession('novel-a');
    store.setActiveChapterId('chapter-a');
    store.setDirty(true);
    useWorkspaceSessionStore.getState().startSession('novel-b');

    expect(useWorkspaceSessionStore.getState()).toEqual(
      expect.objectContaining({
        sessionNovelId: 'novel-b',
        activeChapterId: '',
        currentDraft: null,
        isDirty: false,
      }),
    );
  });

  it('supports traceable functional collection updates', () => {
    useWorkspaceSessionStore.getState().setChapters([]);
    useWorkspaceSessionStore.getState().setChapters((chapters) => [...chapters]);
    expect(useWorkspaceSessionStore.getState().chapters).toEqual([]);
  });
});
