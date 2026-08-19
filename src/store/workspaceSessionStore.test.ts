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

  it('publishes one internally consistent editor activity update', () => {
    let notificationCount = 0;
    const unsubscribe = useWorkspaceSessionStore.subscribe(() => {
      notificationCount += 1;
    });

    useWorkspaceSessionStore.getState().setEditorActivity({
      chapterId: 'chapter-a',
      draftId: 'draft-a',
      draftVersion: 3,
      content: '原子更新后的正文',
      wordCount: 8,
      isDirty: true,
      contentHash: 'editor-activity-hash',
      contentAvailable: true,
    });

    expect(useWorkspaceSessionStore.getState()).toEqual(
      expect.objectContaining({
        draftWordCount: 8,
        isDirty: true,
        editorSnapshot: expect.objectContaining({
          chapterId: 'chapter-a',
          content: '原子更新后的正文',
          wordCount: 8,
          isDirty: true,
        }),
      }),
    );
    expect(notificationCount).toBe(1);
    unsubscribe();
  });
});
