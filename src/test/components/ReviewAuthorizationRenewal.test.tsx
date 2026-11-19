import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditorArea from '../../components/workspace/EditorArea';
import { ReviewAuthorizationRenewalDialog } from '../../components/workspace/ReviewAuthorizationRenewalDialog';
import { useReviewAuthorizationRenewal } from '../../features/workspace/useReviewAuthorizationRenewal';
import { useWorkspaceReviewAuthority } from '../../features/workspace/useWorkspaceReviewAuthority';
import { draftVersionService } from '../../services/database/draftVersionService';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';
import { confirmInfo } from '../../utils/nativeDialog';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ReviewAuthorization, ReviewCandidateDocument } from '../../types/conversation';
import type { ReviewRenewalPreview } from '../../types/reviewAuthorizationRenewal';

const native = vi.hoisted(() => ({
  isSupported: vi.fn(),
  preview: vi.fn(),
  renew: vi.fn(),
  getResult: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('../../services/conversation/reviewAuthorizationRenewalService', () => ({
  reviewAuthorizationRenewalService: native,
}));
vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: vi.fn(async (content: string) => `sha:${content}`),
}));
vi.mock('../../utils/nativeDialog', () => ({ confirmInfo: vi.fn() }));
const originalContent = '原始候选。';
const editedContent = '人工编辑的完整草稿，必须保留。';
const candidate: ReviewCandidateDocument = {
  authorizationId: 'old-auth',
  artifactId: 'artifact',
  novelId: 'novel',
  chapterId: 'chapter',
  content: originalContent,
  contentHash: `sha:${originalContent}`,
};
const draft: ChapterDraft = {
  id: 'saved-draft',
  novelId: 'novel',
  chapterId: 'chapter',
  content: editedContent,
  source: 'user_edited',
  versionNo: 2,
  wordCount: 18,
  isAdopted: false,
  createdAt: '2026-11-11',
  updatedAt: '2026-11-11',
};
const preview: ReviewRenewalPreview = {
  authorizationId: 'old-auth',
  cardId: 'card',
  conversationId: 'task',
  novelId: 'novel',
  chapterId: 'chapter',
  artifactId: 'artifact',
  artifactHash: candidate.contentHash,
  chapterBaselineHash: 'current-base',
  chapterRevision: 'current-revision',
  savedDraft: { draftId: draft.id, draftVersion: 2, contentHash: `sha:${editedContent}` },
  previewHash: 'a'.repeat(64),
};
const renewed: ReviewAuthorization = {
  authorizationId: 'new-auth',
  artifactId: 'artifact',
  novelId: 'novel',
  chapterId: 'chapter',
  decisionId: 'new-decision',
  status: 'issued',
  issuedAt: '2026-11-11',
  renewedFromAuthorizationId: 'old-auth',
  reviewDraftBinding: preview.savedDraft,
};
type Options = Parameters<typeof useReviewAuthorizationRenewal>[0];
function options(): Options {
  return {
    novelId: 'novel',
    chapterId: 'chapter',
    candidate,
    authorizationId: 'old-auth',
    currentDraft: draft,
    content: editedContent,
    isDirty: false,
    available: true,
    saving: false,
    adopting: false,
    scope: { current: { epoch: 1 } },
    adoptInFlightRef: { current: null },
    save: vi.fn().mockResolvedValue(draft),
    onRenewed: vi.fn(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function openPreview(result: { current: ReturnType<typeof useReviewAuthorizationRenewal> }) {
  act(() => result.current.reportAdoptionError('REVIEW_AUTHORIZATION_BASELINE_REQUIRED'));
  await act(async () => {
    await result.current.begin();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  native.isSupported.mockReturnValue(true);
  native.preview.mockResolvedValue(preview);
  native.renew.mockResolvedValue(renewed);
  native.getResult.mockResolvedValue(renewed);
  vi.mocked(confirmInfo).mockResolvedValue(true);
  vi.spyOn(draftVersionService, 'create').mockImplementation(async (input) => ({
    ...draft,
    content: input.content,
  }));
  vi.spyOn(draftVersionService, 'update').mockImplementation(async (_id, _chapter, content) => ({
    ...draft,
    content,
  }));
  vi.spyOn(draftVersionService, 'getById').mockResolvedValue(null);
  vi.spyOn(artifactDecisionService, 'adoptReviewAuthorizedDraft').mockRejectedValue({
    code: 'REVIEW_AUTHORIZATION_BASELINE_REQUIRED',
    message: '旧授权基线缺失',
    retryable: false,
  });
  vi.spyOn(artifactDecisionService, 'consume').mockResolvedValue({
    ...renewed,
    status: 'consumed',
  });
});

describe('explicit review renewal feature', () => {
  it('does not preview or sign on open, ordinary error, cancellation or component retry', async () => {
    const input = options();
    const { result } = renderHook(() => useReviewAuthorizationRenewal(input));
    expect(native.preview).not.toHaveBeenCalled();
    expect(native.renew).not.toHaveBeenCalled();
    act(() => result.current.reportAdoptionError('DATABASE_BUSY'));
    await act(async () => {
      await result.current.begin();
    });
    expect(native.preview).not.toHaveBeenCalled();
    await openPreview(result);
    expect(native.preview).toHaveBeenCalledWith({
      authorizationId: 'old-auth',
      savedDraftId: draft.id,
    });
    expect(input.save).not.toHaveBeenCalled();
    expect(native.renew).not.toHaveBeenCalled();
    act(() => result.current.dismiss());
    expect(native.renew).not.toHaveBeenCalled();
    expect(input.content).toBe(editedContent);
    expect(input.currentDraft).toBe(draft);
    expect(input.adoptInFlightRef.current).toBeNull();
  });

  it('cancels an in-flight preview read without discarding saved edits or issuing authority', async () => {
    const pending = deferred<ReviewRenewalPreview>();
    native.preview.mockReturnValue(pending.promise);
    const input = options();
    const { result } = renderHook(() => useReviewAuthorizationRenewal(input));
    act(() => result.current.reportAdoptionError('REVIEW_AUTHORIZATION_BASELINE_REQUIRED'));
    let work!: Promise<void>;
    await act(async () => {
      work = result.current.begin();
    });
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    await act(async () => {
      pending.resolve(preview);
      await work;
    });
    await act(async () => {
      await result.current.confirm();
    });
    expect(native.renew).not.toHaveBeenCalled();
    expect(input.content).toBe(editedContent);
    expect(input.adoptInFlightRef.current).toBeNull();
    expect(result.current.notice).toContain('未签发新授权');
  });

  it('changes only effective adoption authority after exact explicit confirmation', async () => {
    const input = options();
    const { result } = renderHook(() => useReviewAuthorizationRenewal(input));
    await openPreview(result);
    await act(async () => {
      await result.current.confirm();
    });
    expect(native.renew).toHaveBeenCalledTimes(1);
    expect(native.renew.mock.calls[0][0]).toMatchObject({
      authorizationId: 'old-auth',
      savedDraftId: draft.id,
      expectedPreviewHash: preview.previewHash,
    });
    expect(result.current.effectiveAuthorizationId).toBe('new-auth');
    expect(input.onRenewed).toHaveBeenCalledWith(renewed);
    expect(input.candidate?.authorizationId).toBe('old-auth');
    expect(input.content).toBe(editedContent);
    expect(artifactDecisionService.adoptReviewAuthorizedDraft).not.toHaveBeenCalled();
    expect(result.current.notice).toContain('尚未采用');
  });

  it('saves dirty edits only after the named preview action, and binds the returned saved draft', async () => {
    const input = { ...options(), currentDraft: null, isDirty: true };
    const view = renderHook((value: Options) => useReviewAuthorizationRenewal(value), {
      initialProps: input as Options,
    });
    expect(input.save).not.toHaveBeenCalled();
    await openPreview(view.result);
    expect(input.save).toHaveBeenCalledTimes(1);
    expect(native.renew).not.toHaveBeenCalled();
    view.rerender({ ...input, currentDraft: draft, isDirty: false });
    await act(async () => {
      await view.result.current.confirm();
    });
    expect(native.renew).toHaveBeenCalledTimes(1);
    expect(input.content).toBe(editedContent);
  });

  it('rejects a stale preview after edits or a saved-draft version changes', async () => {
    const input = options();
    const view = renderHook((value: Options) => useReviewAuthorizationRenewal(value), {
      initialProps: input,
    });
    await openPreview(view.result);
    view.rerender({ ...input, currentDraft: { ...draft, versionNo: 3 } });
    await act(async () => {
      await view.result.current.confirm();
    });
    expect(native.renew).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain('已变化');
    expect(view.result.current.savedContent).toBe(editedContent);
  });

  it('ignores late preview results after buffer changes and never signs the stale snapshot', async () => {
    const pending = deferred<ReviewRenewalPreview>();
    native.preview.mockReturnValue(pending.promise);
    const input = options();
    const view = renderHook((value: Options) => useReviewAuthorizationRenewal(value), {
      initialProps: input,
    });
    act(() => view.result.current.reportAdoptionError('REVIEW_AUTHORIZATION_BASE_CONFLICT'));
    let work!: Promise<void>;
    await act(async () => {
      work = view.result.current.begin();
    });
    view.rerender({ ...input, content: `${editedContent}继续编辑`, isDirty: true });
    await act(async () => {
      pending.resolve(preview);
      await work;
    });
    await act(async () => {
      await view.result.current.confirm();
    });
    expect(native.renew).not.toHaveBeenCalled();
    expect(view.result.current.error).toContain('正文已变化');
  });

  it('deduplicates confirmation and uses readback only for an unknown commit result', async () => {
    native.renew.mockRejectedValue({
      code: 'DATABASE_COMMIT_UNKNOWN',
      message: '未知提交',
      retryable: true,
    });
    const input = options();
    const { result } = renderHook(() => useReviewAuthorizationRenewal(input));
    await openPreview(result);
    await act(async () => {
      await Promise.all([result.current.confirm(), result.current.confirm()]);
    });
    expect(native.renew).toHaveBeenCalledTimes(1);
    expect(result.current.uncertain).toBe(true);
    expect(native.getResult).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.confirm();
    });
    expect(native.renew).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.lookup();
    });
    expect(native.getResult).toHaveBeenCalledWith({
      authorizationId: 'old-auth',
      operationId: native.renew.mock.calls[0][0].operationId,
    });
    expect(result.current.effectiveAuthorizationId).toBe('new-auth');
    expect(native.renew).toHaveBeenCalledTimes(1);
  });

  it('does not apply an old result after an A→B→A task switch', async () => {
    const pending = deferred<ReviewAuthorization>();
    native.renew.mockReturnValue(pending.promise);
    const input = options();
    const view = renderHook((value: Options) => useReviewAuthorizationRenewal(value), {
      initialProps: input,
    });
    await openPreview(view.result);
    let work!: Promise<void>;
    await act(async () => {
      work = view.result.current.confirm();
    });
    view.rerender({
      ...input,
      chapterId: 'other',
      candidate: { ...candidate, chapterId: 'other', artifactId: 'other-artifact' },
    });
    view.rerender(input);
    await act(async () => {
      pending.resolve(renewed);
      await work;
    });
    expect(view.result.current.effectiveAuthorizationId).toBeUndefined();
    expect(input.onRenewed).not.toHaveBeenCalled();
    expect(input.content).toBe(editedContent);
  });

  it('refuses mismatched saved hashes or formal text without enabling confirmation', async () => {
    native.preview.mockResolvedValue({
      ...preview,
      adoptedDraftId: 'formal',
      adoptedContentHash: 'wrong-formal-hash',
    });
    vi.mocked(draftVersionService.getById).mockResolvedValue({
      ...draft,
      id: 'formal',
      content: '当前正式稿',
      isAdopted: true,
    });
    const { result } = renderHook(() => useReviewAuthorizationRenewal(options()));
    await openPreview(result);
    expect(result.current.error).toContain('正式稿全文');
    await act(async () => {
      await result.current.confirm();
    });
    expect(native.renew).not.toHaveBeenCalled();
  });
});

describe('manual renewal editor and focus integration', () => {
  it('preserves edited text, selection and saved draft across conflict→preview→renew, and still requires adoption', async () => {
    const chapter: Chapter = {
      id: 'chapter',
      novelId: 'novel',
      title: '审阅章',
      chapterNumber: 1,
      outline: '',
      goal: '',
      orderIndex: 0,
      sortOrder: 0,
      status: 'editing',
      wordCount: 0,
      currentWords: 0,
      targetWords: 3000,
      drafts: [],
      createdAt: '',
      updatedAt: '',
    };
    const onRenewed = vi.fn();
    function Harness() {
      const [saved, setSaved] = useState<ChapterDraft | null>(null);
      const [command, setCommand] = useState<{ id: string; type: 'adopt-current' }>();
      return (
        <>
          <button onClick={() => setCommand({ id: `adopt-${Date.now()}`, type: 'adopt-current' })}>
            采用当前草稿
          </button>
          <EditorArea
            chapter={chapter}
            novelId="novel"
            currentDraft={saved}
            reviewCandidate={candidate}
            reviewAuthorizationId="old-auth"
            commandRequest={command}
            onDraftSaved={setSaved}
            onReviewAuthorizationRenewed={onRenewed}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const editor = (await screen.findByTestId('chapter-editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe(originalContent));
    fireEvent.change(editor, { target: { value: editedContent } });
    editor.setSelectionRange(2, 6);
    fireEvent.click(screen.getByRole('button', { name: '采用当前草稿' }));
    await screen.findByRole('button', { name: '预览重新授权当前草稿' });
    expect(editor.value).toBe(editedContent);
    expect(editor.getAttribute('data-dirty')).toBe('false');
    expect(native.renew).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '预览重新授权当前草稿' }));
    await screen.findByRole('button', { name: '确认签发新的审阅授权' });
    expect(editor.value).toBe(editedContent);
    await user.click(screen.getByRole('button', { name: '确认签发新的审阅授权' }));
    await waitFor(() => expect(onRenewed).toHaveBeenCalledWith(renewed));
    expect(editor.value).toBe(editedContent);
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(6);
    expect(artifactDecisionService.adoptReviewAuthorizedDraft).toHaveBeenCalledTimes(1);
    expect(draftVersionService.create).toHaveBeenCalledTimes(1);
  });

  it('defaults focus to cancellation, traps Tab and ignores IME/Composer shortcuts', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>预览授权</button>
          {open && (
            <ReviewAuthorizationRenewalDialog
              preview={preview}
              savedContent={editedContent}
              formalContent=""
              busy={false}
              error=""
              uncertain={false}
              onConfirm={confirm}
              onLookup={vi.fn()}
              onDismiss={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '预览授权' });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消，保留当前草稿' }));
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true });
    expect(confirm).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('projects the effective authority without changing route inputs and blocks stale callbacks', async () => {
    const input = {
      novelId: 'novel',
      chapterId: 'chapter',
      requestedAuthorizationId: 'old-auth',
      requestedArtifactId: 'artifact',
    };
    const view = renderHook((value: typeof input) => useWorkspaceReviewAuthority(value), {
      initialProps: input,
    });
    const stale = view.result.current.onRenewed;
    act(() => view.result.current.onRenewed(renewed));
    expect(view.result.current.authorizationId).toBe('new-auth');
    expect(input.requestedAuthorizationId).toBe('old-auth');
    await act(async () => {
      await view.result.current.beforeAdopt(draft.id);
    });
    expect(artifactDecisionService.consume).toHaveBeenCalledWith('new-auth', draft.id);
    view.rerender({ ...input, chapterId: 'other' });
    view.rerender(input);
    act(() => stale(renewed));
    expect(view.result.current.authorizationId).toBe('old-auth');
  });
});
