import { forwardRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WritingWorkspaceView from '../../pages/WritingWorkspace/WritingWorkspaceView';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import * as nativeDialog from '../../utils/nativeDialog';

const mocks = vi.hoisted(() => ({
  childCalls: vi.fn(),
}));

vi.mock('../../components/common/BackButton', () => ({
  default: (props: Record<string, unknown>) => <span>{String(props.label)}</span>,
}));

vi.mock('../../components/workspace/VolumeTree', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-volume-tree">
      <button
        type="button"
        onClick={() => (props.onSelectChapter as (id: string) => void)('chapter-2')}
      >
        tree-select
      </button>
      <button
        type="button"
        onClick={() => void (props.onCreateVolume as (title: string) => Promise<void>)('新卷')}
      >
        tree-volume
      </button>
      <button
        type="button"
        onClick={() =>
          void (props.onCreateChapter as (id: string, title: string) => Promise<void>)(
            'volume-1',
            '新章',
          )
        }
      >
        tree-chapter
      </button>
      <button
        type="button"
        onClick={() =>
          void (props.onCreateFirstChapter as (title: string) => Promise<void>)('第一章')
        }
      >
        tree-first
      </button>
    </div>
  ),
}));

vi.mock('../../components/workspace/EditorArea', () => ({
  default: forwardRef<HTMLDivElement, Record<string, unknown>>((props, _ref) => (
    <div data-testid="mock-editor">
      <button
        type="button"
        onClick={() => (props.onDraftChange as (count: number, dirty: boolean) => void)(100, true)}
      >
        editor-draft
      </button>
      <button
        type="button"
        onClick={() =>
          (props.onEditorContentChange as (value: Record<string, unknown>) => void)({
            content: '正文',
          })
        }
      >
        editor-content
      </button>
      <button
        type="button"
        onClick={() => (props.onDraftSaved as (value: ChapterDraft) => void)(fixtureDraft)}
      >
        editor-save
      </button>
      <button type="button" onClick={() => (props.onApplyTextConsumed as () => void)()}>
        editor-consume
      </button>
      <button type="button" onClick={() => (props.onApplyTextRejected as () => void)()}>
        editor-reject
      </button>
      <button
        type="button"
        onClick={() => void (props.onChapterUpdated as (id: string) => Promise<void>)('chapter-1')}
      >
        editor-outline
      </button>
      <button type="button" onClick={() => (props.onLocateDone as () => void)()}>
        editor-locate
      </button>
      <button type="button" onClick={() => (props.onRetryContent as () => void)()}>
        editor-retry
      </button>
      <button type="button" onClick={() => (props.onOpenDraftHistory as () => void)()}>
        editor-history
      </button>
      <button type="button" onClick={() => (props.onBackToChapters as () => void)()}>
        editor-back
      </button>
    </div>
  )),
}));

vi.mock('../../components/workspace/StatusBar', () => ({
  default: () => <div data-testid="mock-status" />,
}));
vi.mock('../../components/workspace/GlobalAiTaskModal', () => ({
  default: () => <div data-testid="mock-ai-modal" />,
}));

vi.mock('../../components/right-dock/RightToolbar', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-toolbar">
      <button
        type="button"
        onClick={() => void (props.onTogglePanel as (panel: string) => Promise<void>)('check')}
      >
        toolbar-toggle
      </button>
      <button
        type="button"
        onClick={() => (props.onRunCommand as (command: string) => void)('undo')}
      >
        toolbar-command
      </button>
    </div>
  ),
}));

vi.mock('../../components/right-dock/panels/DraftHistoryPanel', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-history">
      <button
        type="button"
        onClick={() => void (props.onBeforeDocumentChange as () => Promise<boolean>)()}
      >
        history-before
      </button>
      <button
        type="button"
        onClick={() => (props.onLoadDraft as (draft: ChapterDraft) => void)(fixtureDraft)}
      >
        history-load
      </button>
      <button
        type="button"
        onClick={() => (props.onDraftAdopted as (draft: ChapterDraft) => void)(fixtureDraft)}
      >
        history-adopt
      </button>
      <button type="button" onClick={() => void (props.onClose as () => Promise<void>)()}>
        history-close
      </button>
    </div>
  ),
}));

vi.mock('../../components/right-dock/RightPanel', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-right-panel">
      <button type="button" onClick={() => void (props.onClose as () => Promise<void>)()}>
        right-close
      </button>
      <button
        type="button"
        onClick={() => (props.onGenerated as (draft: ChapterDraft) => void)(fixtureDraft)}
      >
        right-generated
      </button>
      <button type="button" onClick={() => (props.onAdopted as () => void)()}>
        right-adopted
      </button>
      <button
        type="button"
        onClick={() => void (props.onBeforeDocumentChange as () => Promise<boolean>)()}
      >
        right-before
      </button>
      <button
        type="button"
        onClick={() =>
          void (props.onChapterOutlineApplied as (id: string) => Promise<void>)('chapter-1')
        }
      >
        right-outline
      </button>
      <button
        type="button"
        onClick={() => (props.onChapterGoalDirtyChange as (dirty: boolean) => void)(true)}
      >
        right-goal
      </button>
      <button type="button" onClick={() => (props.onChapterCharactersChanged as () => void)()}>
        right-characters
      </button>
      <button
        type="button"
        onClick={() => (props.onLocateText as (a: number, b: number) => void)(1, 2)}
      >
        right-locate
      </button>
      <button
        type="button"
        onClick={() => (props.onQcChange as (report: null, items: []) => void)(null, [])}
      >
        right-quality
      </button>
      <button type="button" onClick={() => (props.showAiModal as (title: string) => void)('标题')}>
        right-show-modal
      </button>
      <button
        type="button"
        onClick={() => (props.updateAiModal as (stage: string, value: number) => void)('阶段', 50)}
      >
        right-update-modal
      </button>
      <button type="button" onClick={() => (props.hideAiModal as () => void)()}>
        right-hide-modal
      </button>
      <button
        type="button"
        onClick={() =>
          (props.onUpdateToolState as (key: string, patch: Record<string, unknown>) => void)(
            'check',
            { loading: true },
          )
        }
      >
        right-tool-state
      </button>
      <button
        type="button"
        onClick={() =>
          void (props.onApplyAiText as (value: Record<string, unknown>) => Promise<boolean>)({
            text: '候选',
          })
        }
      >
        right-apply-text
      </button>
    </div>
  ),
}));

vi.mock('../../components/chapter-summary/ChapterSummaryDialog', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-summary-dialog">
      <button type="button" onClick={() => (props.onClose as () => void)()}>
        summary-close
      </button>
      <button type="button" onClick={() => (props.onConfirm as () => void)()}>
        summary-confirm
      </button>
      <button type="button" onClick={() => (props.onRegenerate as () => void)()}>
        summary-regenerate
      </button>
    </div>
  ),
}));

vi.mock('../../components/workspace/RecoveryDialog', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-recovery">
      <button type="button" onClick={() => void (props.onRestore as () => Promise<void>)()}>
        recovery-restore
      </button>
      <button type="button" onClick={() => void (props.onDiscard as () => Promise<void>)()}>
        recovery-discard
      </button>
      <button type="button" onClick={() => (props.onLater as () => void)()}>
        recovery-later
      </button>
      <button type="button" onClick={() => void (props.onSaveAsDraft as () => Promise<void>)()}>
        recovery-save
      </button>
    </div>
  ),
}));

const timestamp = '2026-07-28T00:00:00.000Z';
const fixtureChapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 100,
  currentWords: 100,
  targetWords: 2_400,
  drafts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const fixtureDraft: ChapterDraft = {
  id: 'draft-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  content: '编辑器正文',
  source: 'user_edited',
  versionNo: 1,
  wordCount: 100,
  isAdopted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function baseProps(): React.ComponentProps<typeof WritingWorkspaceView> {
  const calls = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, property) =>
        vi.fn((...args: unknown[]) => mocks.childCalls(String(property), ...args)),
    },
  );
  return {
    novelId: 'novel-1',
    navigate: calls.navigate,
    session: {
      novel: { id: 'novel-1', title: '遗忘之城' },
      volumes: [{ id: 'volume-1', title: '第一卷' }],
      chapters: [fixtureChapter],
      activeChapterId: fixtureChapter.id,
      currentDraft: fixtureDraft,
      editorSnapshot: {
        chapterId: fixtureChapter.id,
        content: fixtureDraft.content,
        wordCount: 100,
        isDirty: false,
        contentHash: 'content-hash',
        contentAvailable: true,
      },
      draftWordCount: 100,
      isDirty: false,
      qcReport: {
        id: 'report-1',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        draftId: 'draft-1',
        scope: 'current_draft',
        status: 'completed',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      qcItems: [],
      aiModal: { running: false, title: '', stage: '', progress: 0 },
    },
    sidebarState: {
      activeTool: 'draft-history',
      collapsed: false,
      lastActiveTool: 'check',
      toolStates: {},
    },
    chapterLoader: {
      pageLoading: false,
      pageError: '',
      loadState: 'ready',
      chapterDocumentLoad: { status: 'ready' },
      isChapterDocumentBlocked: false,
      retryChapterDraftLoad: calls.retryChapterDraftLoad,
      retryActiveChapterContent: calls.retryActiveChapterContent,
      retryingContent: false,
      loadChapterDraft: calls.loadChapterDraft,
      contentLoadError: null,
    },
    draftApplication: {
      applyTextRequest: null,
      editorCommandRequest: null,
      handleDraftApplied: calls.handleDraftApplied,
      handlePersistentDraftSaved: calls.handlePersistentDraftSaved,
      applyAiTextToEditor: calls.applyAiTextToEditor,
      handleApplyTextConsumed: calls.handleApplyTextConsumed,
      handleApplyTextRejected: calls.handleApplyTextRejected,
      runEditorCommand: calls.runEditorCommand,
    },
    creationActions: {
      handleCreateVolume: calls.handleCreateVolume,
      handleCreateChapter: calls.handleCreateChapter,
      handleCreateFirstChapter: calls.handleCreateFirstChapter,
    },
    recoveryActions: {
      busy: false,
      restore: calls.restore,
      discard: calls.discard,
      saveAsDraft: calls.saveAsDraft,
    },
    summary: {
      exists: true,
      dialogOpen: false,
      result: null,
      loading: false,
      error: '',
      setDialogOpen: calls.setDialogOpen,
      setResult: calls.setResult,
      setError: calls.setError,
      save: calls.save,
      regenerate: calls.regenerate,
      stop: calls.stop,
    },
    recoveryPrompt: { status: 'none' },
    recoverySaveStatus: 'saved',
    refs: {
      editor: { current: null },
      activeChapterId: { current: 'chapter-1' },
      editorSnapshot: {
        current: {
          chapterId: 'chapter-1',
          content: fixtureDraft.content,
          wordCount: 100,
          isDirty: false,
          contentHash: 'content-hash',
          contentAvailable: true,
        },
      },
    },
    actions: {
      selectChapter: calls.selectChapter,
      togglePanel: calls.togglePanel,
      closePanel: calls.closePanel,
      editorClick: calls.editorClick,
      draftChange: calls.draftChange,
      editorContentChange: calls.editorContentChange,
      chapterOutlineApplied: calls.chapterOutlineApplied,
      confirmEditorLeave: calls.confirmEditorLeave,
      openSidebarTool: calls.openSidebarTool,
      closeSidebar: calls.closeSidebar,
      setChapterGoalDirty: calls.setChapterGoalDirty,
      bumpContextVersion: calls.bumpContextVersion,
      locateText: calls.locateText,
      locateDone: calls.locateDone,
      setQuality: calls.setQuality,
      showAiModal: calls.showAiModal,
      updateAiModal: calls.updateAiModal,
      hideAiModal: calls.hideAiModal,
      updateSidebarTool: calls.updateSidebarTool,
      dismissRecoveryPrompt: calls.dismissRecoveryPrompt,
    },
    contextVersion: 1,
    locateTarget: { startOffset: 1, endOffset: 2, quote: '引用', paragraphIndex: 0 },
    writingContext: {
      fullText: fixtureDraft.content,
      selectedText: '',
      cursorStart: 0,
      cursorEnd: 0,
      chapterId: 'chapter-1',
      draftId: 'draft-1',
      draftVersion: 1,
      projectId: 'novel-1',
      worldId: 'novel-1',
      contextPackageId: 'novel-1',
      contentHash: 'content-hash',
      wordCount: 100,
      isDirty: false,
    },
    leaveGuardDialog: <div data-testid="leave-guard-dialog" />,
  } as unknown as React.ComponentProps<typeof WritingWorkspaceView>;
}

beforeEach(() => {
  vi.spyOn(nativeDialog, 'showInfo').mockResolvedValue();
});

describe('WritingWorkspaceView', () => {
  it('wires editor, tree, history, toolbar and right-panel callbacks', () => {
    const props = baseProps();
    render(<WritingWorkspaceView {...props} />);
    [
      'tree-select',
      'tree-volume',
      'tree-chapter',
      'tree-first',
      'editor-draft',
      'editor-content',
      'editor-save',
      'editor-consume',
      'editor-reject',
      'editor-outline',
      'editor-locate',
      'editor-retry',
      'editor-history',
      'editor-back',
      'toolbar-toggle',
      'toolbar-command',
      'history-before',
      'history-load',
      'history-adopt',
      'history-close',
      'right-close',
      'right-generated',
      'right-adopted',
      'right-before',
      'right-outline',
      'right-goal',
      'right-characters',
      'right-locate',
      'right-quality',
      'right-show-modal',
      'right-update-modal',
      'right-hide-modal',
      'right-tool-state',
      'right-apply-text',
    ].forEach((name) => fireEvent.click(screen.getByRole('button', { name })));
    fireEvent.click(document.querySelector('.workspace-editor') as HTMLElement);
    expect(mocks.childCalls).toHaveBeenCalled();
  });

  it('renders loading, failures, empty works, blocked content and summary/recovery states', () => {
    const props = baseProps();
    const view = render(
      <WritingWorkspaceView
        {...props}
        chapterLoader={{ ...props.chapterLoader, pageLoading: true }}
      />,
    );
    expect(screen.getByText('正在加载写作工作台...')).not.toBeNull();

    view.rerender(
      <WritingWorkspaceView
        {...props}
        chapterLoader={{
          ...props.chapterLoader,
          pageLoading: false,
          pageError: '工作台加载失败',
          loadState: 'novel_not_found',
        }}
      />,
    );
    screen.getAllByRole('button', { name: /返回/ }).forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole('button', { name: /修复本地数据/ }));

    view.rerender(
      <WritingWorkspaceView
        {...props}
        session={{ ...props.session, chapters: [], activeChapterId: '', currentDraft: null }}
      />,
    );
    expect(screen.getByTestId('workspace-empty-state')).not.toBeNull();

    view.rerender(
      <WritingWorkspaceView
        {...props}
        chapterLoader={{
          ...props.chapterLoader,
          chapterDocumentLoad: { status: 'error', chapterId: 'chapter-1', message: '正文读取失败' },
          contentLoadError: {
            status: 'unavailable',
            errorCode: 'CONTENT_UNAVAILABLE',
            retryable: true,
          },
          isChapterDocumentBlocked: true,
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('chapter-load-retry'));
    expect(screen.queryByTestId('mock-right-panel')).toBeNull();

    const snapshot = {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      recoveryContent: '恢复正文',
      recoveryContentHash: 'recovery-hash',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    view.rerender(
      <WritingWorkspaceView
        {...props}
        sidebarState={{ ...props.sidebarState, activeTool: 'check' }}
        summary={{
          ...props.summary,
          dialogOpen: true,
          result: {
            summary: '章节总结',
            keyEvents: [],
            characterChanges: [],
            relationshipChanges: [],
            newForeshadows: [],
            resolvedForeshadows: [],
            nextChapterHints: '',
            contextRecords: [],
          },
        }}
        recoveryPrompt={{ status: 'available', snapshot, conflict: false }}
      />,
    );
    [
      'summary-close',
      'summary-confirm',
      'summary-regenerate',
      'recovery-restore',
      'recovery-discard',
      'recovery-later',
      'recovery-save',
    ].forEach((name) => fireEvent.click(screen.getByRole('button', { name })));

    view.rerender(
      <WritingWorkspaceView
        {...props}
        summary={{ ...props.summary, loading: true, result: null }}
      />,
    );
    screen.getAllByRole('button', { name: /停止/ }).forEach((button) => fireEvent.click(button));

    view.rerender(
      <WritingWorkspaceView
        {...props}
        summary={{ ...props.summary, error: '总结失败', dialogOpen: false }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
  });

  it('keeps dirty editor content when adoption finishes and reloads a clean editor', () => {
    const clean = baseProps();
    const view = render(<WritingWorkspaceView {...clean} />);
    fireEvent.click(screen.getByRole('button', { name: 'right-adopted' }));
    expect(mocks.childCalls).toHaveBeenCalledWith('loadChapterDraft', 'chapter-1');

    const dirty = baseProps();
    dirty.refs.editorSnapshot.current.isDirty = true;
    view.rerender(<WritingWorkspaceView {...dirty} />);
    fireEvent.click(screen.getByRole('button', { name: 'right-adopted' }));
    expect(nativeDialog.showInfo).toHaveBeenCalled();
  });
});
