import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceReviewDocument } from '../../features/workspace/loadWorkspaceReviewDocument';
import { useWorkspaceChapterLoader } from '../../features/workspace/useWorkspaceChapterLoader';
import {
  getEditorDocumentSourceKey,
  resolveEditorDraftContent,
} from '../../components/workspace/editor-area/editorDocumentSafety';
import type { ChapterDraft } from '../../types/ai';
import type { ReviewAuthorizationResume } from '../../types/reviewAuthorizationRenewal';

const mocks = vi.hoisted(() => ({
  supported: vi.fn(),
  resume: vi.fn(),
  artifact: vi.fn(),
  authorization: vi.fn(),
  getDraft: vi.fn(),
  latest: vi.fn(),
  novel: vi.fn(),
  volumes: vi.fn(),
  chapters: vi.fn(),
}));
vi.mock('../../services/conversation/reviewAuthorizationRenewalService', () => ({
  reviewAuthorizationRenewalService: { isSupported: mocks.supported, resume: mocks.resume },
}));
vi.mock('../../services/conversation/artifactDecisionService', () => ({
  artifactDecisionService: { getAuthorization: mocks.authorization },
}));
vi.mock('../../services/ai-tasks/aiTaskRuntimeService', () => ({
  aiTaskRuntimeService: { getArtifact: mocks.artifact },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { getById: mocks.getDraft, getLatestByChapterId: mocks.latest },
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.novel, getAll: vi.fn() },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: mocks.volumes },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: mocks.chapters },
}));
vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: vi.fn(async (content: string) => `sha:${content}`),
}));
const original = '原始候选内容，不得覆盖人工编辑。';
const edited = '签发后继续人工修改并保存的最新正文。';
const draft: ChapterDraft = {
  id: 'saved',
  novelId: 'novel',
  chapterId: 'chapter',
  versionNo: 3,
  content: edited,
  source: 'user_edited',
  wordCount: 20,
  isAdopted: false,
  createdAt: '2026-11-11',
  updatedAt: '2026-11-11',
};
const resume: ReviewAuthorizationResume = {
  requestedAuthorizationId: 'old-auth',
  authorization: {
    authorizationId: 'new-auth',
    artifactId: 'artifact',
    novelId: 'novel',
    chapterId: 'chapter',
    decisionId: 'new-decision',
    status: 'issued',
    issuedAt: '',
    renewedFromAuthorizationId: 'old-auth',
    reviewDraftBinding: { draftId: 'saved', draftVersion: 2, contentHash: 'sha:签发时的旧编辑' },
  },
  reviewDraftBinding: {
    draftId: 'saved',
    draftVersion: 3,
    contentHash: `sha:${edited}`,
    changedSinceRenewal: true,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.supported.mockReturnValue(true);
  mocks.resume.mockResolvedValue(resume);
  mocks.artifact.mockResolvedValue({
    artifact: { artifactId: 'artifact', contentHash: `sha:${original}` },
    rawContent: original,
    issues: [],
  });
  mocks.getDraft.mockResolvedValue(draft);
  mocks.novel.mockResolvedValue({ id: 'novel' });
  mocks.volumes.mockResolvedValue([]);
  mocks.chapters.mockResolvedValue([
    {
      id: 'chapter',
      novelId: 'novel',
      title: '章节',
      chapterNumber: 1,
      updatedAt: '',
      adoptedDraftId: null,
    },
  ]);
});

const input = {
  novelId: 'novel',
  chapterId: 'chapter',
  authorizationId: 'old-auth',
  artifactId: 'artifact',
  draftId: 'saved',
};

describe('native-bound manual review resume', () => {
  it('follows persisted explicit renewal and hydrates current same-draft edits while preserving original evidence', async () => {
    const result = await loadWorkspaceReviewDocument(input);
    expect(mocks.resume).toHaveBeenCalledWith('old-auth');
    expect(mocks.authorization).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled();
    expect(result.authorization.authorizationId).toBe('new-auth');
    expect(result.authorization.reviewDraftBinding?.draftVersion).toBe(2);
    expect(result.draft?.content).toBe(edited);
    expect(result.candidate?.content).toBe(original);
    expect(result.candidate?.reviewDraftBinding?.draftVersion).toBe(3);
    expect(result.candidate?.changedSinceRenewal).toBe(true);
    const source = {
      documentState: 'ready' as const,
      novelId: 'novel',
      chapterId: 'chapter',
      draft: result.draft,
      reviewCandidate: result.candidate,
    };
    expect(resolveEditorDraftContent(source)).toMatchObject({
      action: 'replace',
      content: edited,
      draft,
    });
    expect(getEditorDocumentSourceKey(source)).toBe(
      getEditorDocumentSourceKey({ ...source, reviewCandidate: { ...result.candidate! } }),
    );
  });

  it('rejects arbitrary draft URLs instead of picking the latest or raw candidate', async () => {
    await expect(loadWorkspaceReviewDocument({ ...input, draftId: 'other-draft' })).rejects.toThrow(
      '不是原生审阅授权绑定',
    );
    expect(mocks.getDraft).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it.each(['missing', 'hash', 'version', 'scope'] as const)(
    'fails closed on a %s saved-draft proof and never substitutes raw candidate content',
    async (kind) => {
      if (kind === 'missing')
        mocks.resume.mockResolvedValue({ ...resume, reviewDraftBinding: undefined });
      if (kind === 'hash') mocks.getDraft.mockResolvedValue({ ...draft, content: '正文不匹配' });
      if (kind === 'version') mocks.getDraft.mockResolvedValue({ ...draft, versionNo: 4 });
      if (kind === 'scope') mocks.getDraft.mockResolvedValue({ ...draft, novelId: 'other' });
      await expect(loadWorkspaceReviewDocument(input)).rejects.toThrow();
      expect(mocks.latest).not.toHaveBeenCalled();
    },
  );

  it('rejects foreign authorization and requested-origin mismatch before reading any candidate', async () => {
    mocks.resume.mockResolvedValue({ ...resume, requestedAuthorizationId: 'different-origin' });
    await expect(loadWorkspaceReviewDocument(input)).rejects.toThrow('请求授权不一致');
    expect(mocks.artifact).not.toHaveBeenCalled();
    mocks.resume.mockResolvedValue({
      ...resume,
      authorization: { ...resume.authorization, novelId: 'other' },
    });
    await expect(loadWorkspaceReviewDocument(input)).rejects.toThrow('作品或章节不匹配');
    expect(mocks.artifact).not.toHaveBeenCalled();
  });

  it('keeps normal unrenewed candidate loading and consumed-authority loading distinct', async () => {
    mocks.supported.mockReturnValue(false);
    mocks.authorization.mockResolvedValue({
      ...resume.authorization,
      renewedFromAuthorizationId: undefined,
      reviewDraftBinding: undefined,
    });
    const candidate = await loadWorkspaceReviewDocument({ ...input, draftId: undefined });
    expect(candidate.draft).toBeNull();
    expect(candidate.candidate?.content).toBe(original);
    mocks.supported.mockReturnValue(true);
    mocks.resume.mockResolvedValue({
      ...resume,
      authorization: { ...resume.authorization, status: 'consumed', consumedByDraftId: draft.id },
    });
    mocks.getDraft.mockResolvedValue({ ...draft, isAdopted: true });
    const adopted = await loadWorkspaceReviewDocument(input);
    expect(adopted.candidate).toBeNull();
    expect(adopted.draft?.content).toBe(edited);
    expect(adopted.draft?.isAdopted).toBe(true);
  });

  it('preserves the current editor value when a native-bound draft target mismatches', () => {
    expect(
      resolveEditorDraftContent({
        documentState: 'ready',
        novelId: 'novel',
        chapterId: 'chapter',
        draft: { ...draft, id: 'arbitrary' },
        reviewCandidate: {
          authorizationId: 'new-auth',
          artifactId: 'artifact',
          content: original,
          contentHash: `sha:${original}`,
          novelId: 'novel',
          chapterId: 'chapter',
          reviewDraftBinding: resume.reviewDraftBinding,
        },
      }),
    ).toMatchObject({ action: 'preserve' });
  });
});

function renderLoader(draftId = 'saved') {
  const refs = {
    activeNovelId: { current: 'novel' },
    activeChapterId: { current: '' },
    currentDraft: { current: null as ChapterDraft | null },
    editorSnapshot: {
      current: {
        content: '',
        wordCount: 0,
        isDirty: false,
        contentHash: '',
        contentAvailable: true,
      },
    },
  };
  const setCurrentDraft = vi.fn();
  const actions = {
    setNovel: vi.fn(),
    setVolumes: vi.fn(),
    setChapters: vi.fn(),
    setActiveChapterId: vi.fn(),
    setCurrentDraft,
    setDraftWordCount: vi.fn(),
    setDirty: vi.fn(),
  };
  const view = renderHook(() =>
    useWorkspaceChapterLoader({
      novelId: 'novel',
      requestedChapterId: 'chapter',
      requestedDraftId: draftId,
      requestedArtifactId: 'artifact',
      requestedAuthorizationId: 'old-auth',
      refs,
      ...actions,
    }),
  );
  return { view, refs, setCurrentDraft };
}

describe('workspace loader renewal integration', () => {
  it('reopens an old URL using the verified current edited draft, never the raw artifact', async () => {
    const { view, refs, setCurrentDraft } = renderLoader();
    await waitFor(() => expect(view.result.current.chapterDocumentLoad.status).toBe('ready'));
    await waitFor(() =>
      expect(view.result.current.effectiveReviewAuthorizationId).toBe('new-auth'),
    );
    expect(refs.currentDraft.current?.content).toBe(edited);
    expect(setCurrentDraft).toHaveBeenCalledWith(draft);
    expect(view.result.current.reviewCandidate?.content).toBe(original);
    expect(view.result.current.reviewCandidate?.reviewDraftBinding?.draftId).toBe('saved');
  });

  it('does not replace the current draft when a native saved-draft proof is invalid', async () => {
    mocks.getDraft.mockResolvedValue({ ...draft, content: '损坏内容' });
    const { view, refs, setCurrentDraft } = renderLoader();
    await waitFor(() => expect(view.result.current.chapterDocumentLoad.status).toBe('error'));
    expect(refs.currentDraft.current).toBeNull();
    expect(setCurrentDraft).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: original }),
    );
    expect(view.result.current.reviewCandidate).toBeNull();
  });
});
