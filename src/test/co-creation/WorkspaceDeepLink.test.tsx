import { useLocation } from 'react-router-dom';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateReviewRecord } from '../../types/placement';

const harness = vi.hoisted(() => ({
  snapshot: {
    chapterId: 'chapter-a',
    draftId: 'draft-a',
    draftVersion: 2,
    content: '甲😀乙段落',
    wordCount: 6,
    isDirty: false,
    contentHash: 'editor-hash',
    contentAvailable: true,
    selectionStart: 1,
    selectionEnd: 3,
  },
  saveResult: null as null | Record<string, unknown>,
  recoverCandidate: vi.fn(),
  getGenerationHandoff: vi.fn(),
  getNovel: vi.fn(),
  getVolumes: vi.fn(),
  getChapters: vi.fn(),
  getLatestDraft: vi.fn(),
  getSummary: vi.fn(),
  clearRecovery: vi.fn(),
  flushRecovery: vi.fn(),
  confirmInfo: vi.fn(),
}));

vi.mock('../../components/common/BackButton', () => ({ default: () => <button type="button">返回</button> }));
vi.mock('../../components/workspace/VolumeTree', () => ({ default: () => <div data-testid="volume-tree" /> }));
vi.mock('../../components/workspace/StatusBar', () => ({ default: () => <div data-testid="status-bar" /> }));
vi.mock('../../components/right-dock/RightToolbar', () => ({ default: () => <div data-testid="right-toolbar" /> }));
vi.mock('../../components/right-dock/panels/DraftHistoryPanel', () => ({ default: () => null }));
vi.mock('../../components/chapter-summary/ChapterSummaryDialog', () => ({ default: () => null }));
vi.mock('../../components/workspace/RecoveryDialog', () => ({ default: () => null }));
vi.mock('../../components/workspace/CandidateReviewPane', () => ({
  default: ({ context }: { context: { status: string; record?: CandidateReviewRecord | null } }) => (
    <div data-testid="candidate-review">{context.status}:{context.record?.candidate.artifactId || 'none'}</div>
  ),
}));
vi.mock('../../components/right-dock/RightPanel', () => ({
  default: ({
    onChapterGoalDirtyChange,
    generationHandoff,
    panelType,
  }: {
    onChapterGoalDirtyChange?: (dirty: boolean) => void;
    generationHandoff?: { handoffId?: string; chapterPlan?: string } | null;
    panelType?: string;
  }) => (
    <>
      <button type="button" onClick={() => onChapterGoalDirtyChange?.(true)}>修改章节目标</button>
      <div data-testid="right-panel-type">{panelType || 'closed'}</div>
      <div data-testid="generation-handoff">
        {generationHandoff ? `${generationHandoff.handoffId}|${generationHandoff.chapterPlan}` : 'none'}
      </div>
    </>
  ),
}));
vi.mock('../../components/workspace/EditorArea', async () => {
  const React = await import('react');
  const Editor = React.forwardRef(function Editor(
    props: { onEditorContentChange?: (snapshot: typeof harness.snapshot) => void },
    ref: React.ForwardedRef<{ save: () => Promise<unknown>; restoreRecovery: () => boolean }>,
  ) {
    const { onEditorContentChange } = props;
    React.useImperativeHandle(ref, () => ({
      save: async () => harness.saveResult,
      restoreRecovery: () => true,
    }));
    React.useEffect(() => {
      onEditorContentChange?.({ ...harness.snapshot });
    }, [onEditorContentChange]);
    return <div data-testid="editor-area" />;
  });
  return { default: Editor };
});

vi.mock('../../services/database/novelRepository', () => ({ novelRepository: { getById: harness.getNovel, getAll: vi.fn() } }));
vi.mock('../../services/database/volumeRepository', () => ({ volumeRepository: { getByNovelId: harness.getVolumes } }));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: harness.getChapters, getById: vi.fn(), update: vi.fn() },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getLatestByChapterId: harness.getLatestDraft,
    getByChapterId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: { getByChapterId: harness.getSummary },
}));
vi.mock('../../services/ai-tasks/chapterCandidateService', () => ({
  chapterCandidateService: { recover: harness.recoverCandidate, adopt: vi.fn() },
}));
vi.mock('../../services/co-creation/coCreationGenerationService', () => ({
  coCreationGenerationService: { getChapterGenerationHandoff: harness.getGenerationHandoff },
}));
vi.mock('../../hooks/useWorkspaceRecovery', () => ({
  useWorkspaceRecovery: () => ({
    prompt: { status: 'none' },
    saveStatus: 'idle',
    flush: harness.flushRecovery,
    clear: harness.clearRecovery,
    dismissPrompt: vi.fn(),
  }),
}));
vi.mock('../../utils/nativeDialog', () => ({
  confirmInfo: harness.confirmInfo,
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import WritingWorkspacePage from '../../pages/WritingWorkspace/WritingWorkspacePage';

class RouterTestRequest {
  readonly url: string;
  readonly method: string;
  readonly signal: AbortSignal | null;
  readonly headers: Headers;

  constructor(input: string | URL | { url: string }, init: RequestInit = {}) {
    this.url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    this.method = init.method ?? 'GET';
    this.signal = init.signal ?? null;
    this.headers = new Headers(init.headers);
  }
}

const chapter = {
  id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '第一章',
  chapterNumber: 1, orderIndex: 0, sortOrder: 0, status: 'editing' as const,
  wordCount: 6, currentWords: 6, targetWords: 4000, drafts: [],
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
};

const persistedDraft = {
  id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', content: '甲😀乙段落',
  source: 'user_edited' as const, versionNo: 2, wordCount: 6, isAdopted: false,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  contentState: { status: 'ready' as const, content: '甲😀乙段落', contentHash: 'base-hash', contentLength: 7 },
};

function Destination() {
  const location = useLocation();
  return (
    <div>
      <div data-testid="destination-url">{location.pathname}{location.search}</div>
      <pre data-testid="destination-state">{JSON.stringify(location.state)}</pre>
    </div>
  );
}

function renderWorkspace(initialEntry: string) {
  const router = createMemoryRouter([
    { path: '/novels/:novelId/workspace', element: <WritingWorkspacePage /> },
    { path: '/novels/:novelId/co-creation', element: <Destination /> },
    { path: '*', element: <Destination /> },
  ], { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}

function candidateRecord(artifactId = 'artifact-a', taskId = 'task-a'): CandidateReviewRecord {
  return {
    candidate: {
      candidateId: artifactId,
      artifactId,
      taskId,
      content: '候选正文',
      contentHash: 'candidate-hash',
      wordCount: 4,
      baseContent: persistedDraft.content,
    },
    target: {
      resultId: artifactId,
      artifactId,
      taskId,
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      sourceDraftId: 'draft-a',
      sourceRevision: 2,
      baseContentHash: 'base-hash',
      source: 'ai_generate',
    },
  };
}

describe('workspace/co-creation deep links', () => {
  beforeEach(() => {
    // Keep loader-free React Router navigation independent from Node undici's
    // stricter AbortSignal realm check under jsdom.
    vi.stubGlobal('Request', RouterTestRequest);
    harness.snapshot = {
      chapterId: 'chapter-a', draftId: 'draft-a', draftVersion: 2,
      content: '甲😀乙段落', wordCount: 6, isDirty: false, contentHash: 'editor-hash',
      contentAvailable: true, selectionStart: 1, selectionEnd: 3,
    };
    harness.saveResult = persistedDraft;
    harness.getNovel.mockResolvedValue({ id: 'novel-a', title: '作品 A' });
    harness.getVolumes.mockResolvedValue([{ id: 'volume-a', novelId: 'novel-a', title: '第一卷' }]);
    harness.getChapters.mockResolvedValue([chapter]);
    harness.getLatestDraft.mockResolvedValue(persistedDraft);
    harness.getSummary.mockResolvedValue(null);
    harness.recoverCandidate.mockResolvedValue({ record: null, activity: null });
    harness.getGenerationHandoff.mockResolvedValue({
      receiptType: 'chapter_generation_handoff',
      handoffId: 'co-creation-handoff:request-a',
      requestId: 'request-a',
      requestHash: 'request-hash',
      novelId: 'novel-a',
      volumeId: 'volume-a',
      chapterId: 'chapter-a',
      chapterPlan: '本章目标：找到线索',
      baseContextHash: 'context-hash',
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    harness.clearRecovery.mockResolvedValue(undefined);
    harness.flushRecovery.mockResolvedValue(undefined);
    harness.confirmInfo.mockResolvedValue(true);
  });

  it('sends chapter, volume, object and selected paragraph through location.state only', async () => {
    renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a');
    await screen.findByText('与 AI 讨论当前章节');
    await act(async () => fireEvent.click(screen.getByText('与 AI 讨论当前章节')));

    await screen.findByTestId('destination-url');
    expect(screen.getByTestId('destination-url').textContent).toBe('/novels/novel-a/co-creation?chapterId=chapter-a');
    const state = JSON.parse(screen.getByTestId('destination-state').textContent || '{}');
    expect(state.discussionHandoff).toEqual(expect.objectContaining({
      novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
      selectedText: '😀', selectionStart: 1, selectionEnd: 3,
    }));
    expect(screen.getByTestId('destination-url').textContent).not.toContain('😀');
  });

  it('keeps a dirty document in place when the existing Leave Guard is cancelled', async () => {
    harness.snapshot = { ...harness.snapshot, isDirty: true, content: '甲😀乙段落（未保存）' };
    const user = userEvent.setup();
    const { router } = renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a');
    await screen.findByText('与 AI 讨论当前章节');
    await user.click(screen.getByText('与 AI 讨论当前章节'));
    expect(await screen.findByTestId('workspace-leave-dialog')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/novels/novel-a/workspace'));
    expect(screen.queryByTestId('destination-url')).toBeNull();
  });

  it('does not navigate when saving the dirty正文 fails', async () => {
    harness.snapshot = { ...harness.snapshot, isDirty: true, content: '保存会失败的正文' };
    harness.saveResult = null;
    const user = userEvent.setup();
    const { router } = renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a');
    await user.click(await screen.findByText('与 AI 讨论当前章节'));
    await user.click(await screen.findByRole('button', { name: '保存并继续' }));
    expect((await screen.findByRole('alert')).textContent).toContain('正文保存失败');
    expect(router.state.location.pathname).toBe('/novels/novel-a/workspace');
    expect(screen.queryByTestId('destination-url')).toBeNull();
  });

  it('does not bypass the separate unsaved chapter-goal decision', async () => {
    harness.confirmInfo.mockResolvedValue(false);
    const user = userEvent.setup();
    const { router } = renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a');
    await user.click(await screen.findByRole('button', { name: '修改章节目标' }));
    await user.click(screen.getByText('与 AI 讨论当前章节'));
    expect(harness.confirmInfo).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/novels/novel-a/workspace');
    expect(screen.queryByTestId('workspace-leave-dialog')).toBeNull();
  });

  it('opens candidate review only for the exact recovered Artifact and Task', async () => {
    harness.recoverCandidate.mockResolvedValue({ record: candidateRecord(), activity: null });
    renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a&review=candidate&artifactId=artifact-a&taskId=task-a');
    expect(await screen.findByTestId('candidate-review')).not.toBeNull();
    expect(screen.getByTestId('candidate-review').textContent).toContain('artifact-a');
    expect(harness.recoverCandidate).toHaveBeenCalledWith('novel-a', 'chapter-a');
  });

  it('keeps candidate review closed when the requested Artifact cannot be recovered', async () => {
    renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-a&review=candidate&artifactId=artifact-missing');
    await waitFor(() => expect(harness.recoverCandidate).toHaveBeenCalledWith('novel-a', 'chapter-a'));
    expect(screen.queryByTestId('candidate-review')).toBeNull();
  });

  it('loads a persisted chapter-plan handoff only for the exact workspace chapter', async () => {
    renderWorkspace(
      '/novels/novel-a/workspace?chapterId=chapter-a&panel=ai-generate&handoffId=co-creation-handoff%3Arequest-a',
    );
    await waitFor(() => expect(screen.getByTestId('right-panel-type').textContent).toBe('ai-generate'));
    expect(screen.getByTestId('generation-handoff').textContent)
      .toBe('co-creation-handoff:request-a|本章目标：找到线索');
    expect(harness.getGenerationHandoff).toHaveBeenCalledWith(
      'novel-a', 'co-creation-handoff:request-a',
    );
  });

  it('fails a missing generation handoff closed without opening another generator', async () => {
    harness.getGenerationHandoff.mockRejectedValue(
      new Error('AI 共创章节生成交接不存在或已经失效'),
    );
    renderWorkspace(
      '/novels/novel-a/workspace?chapterId=chapter-a&panel=ai-generate&handoffId=missing',
    );
    expect(await screen.findByText('AI 共创章节生成交接不存在或已经失效')).not.toBeNull();
    expect(screen.getByTestId('right-panel-type').textContent).toBe('closed');
  });

  it('fails an explicit invalid chapter closed instead of opening the first chapter', async () => {
    renderWorkspace('/novels/novel-a/workspace?chapterId=chapter-missing&review=candidate');
    expect(await screen.findByText('指定章节不存在或不属于当前作品，已阻止回退到其他章节。')).not.toBeNull();
    expect(harness.getLatestDraft).not.toHaveBeenCalled();
    expect(harness.recoverCandidate).not.toHaveBeenCalled();
  });
});
