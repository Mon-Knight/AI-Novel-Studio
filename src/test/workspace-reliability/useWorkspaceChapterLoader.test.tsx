import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceChapterLoader } from '../../features/workspace/useWorkspaceChapterLoader';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { EditorContentSnapshot } from '../../types/workspaceSafety';

const serviceMocks = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  getAuthorization: vi.fn(),
  getNovelById: vi.fn(),
  getAllNovels: vi.fn(),
  getVolumesByNovelId: vi.fn(),
  getChaptersByNovelId: vi.fn(),
  getDraftById: vi.fn(),
  getLatestDraftByChapterId: vi.fn(),
  computeContentSha256: vi.fn(),
}));

vi.mock('../../services/ai-tasks/aiTaskRuntimeService', () => ({
  aiTaskRuntimeService: { getArtifact: serviceMocks.getArtifact },
}));

vi.mock('../../services/conversation/artifactDecisionService', () => ({
  artifactDecisionService: { getAuthorization: serviceMocks.getAuthorization },
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: serviceMocks.getChaptersByNovelId },
}));

vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getById: serviceMocks.getDraftById,
    getLatestByChapterId: serviceMocks.getLatestDraftByChapterId,
  },
}));

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: {
    getById: serviceMocks.getNovelById,
    getAll: serviceMocks.getAllNovels,
  },
}));

vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: serviceMocks.getVolumesByNovelId },
}));

vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: serviceMocks.computeContentSha256,
}));

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'draft_generated',
  wordCount: 0,
  currentWords: 0,
  targetWords: 3_000,
  drafts: [],
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('useWorkspaceChapterLoader review hydration', () => {
  it('keeps an active review candidate across ordinary chapter-tree refreshes', async () => {
    vi.useFakeTimers();
    serviceMocks.getNovelById.mockResolvedValue({ id: 'novel-1' });
    serviceMocks.getAllNovels.mockResolvedValue([]);
    serviceMocks.getVolumesByNovelId.mockResolvedValue([]);
    serviceMocks.getChaptersByNovelId.mockResolvedValue([chapter]);
    serviceMocks.getAuthorization.mockResolvedValue({
      authorizationId: 'authorization-1',
      artifactId: 'artifact-1',
      chapterId: 'chapter-1',
      novelId: 'novel-1',
      decisionId: 'decision-1',
      status: 'issued',
      issuedAt: '2026-08-31T00:00:00.000Z',
    });
    serviceMocks.getArtifact.mockResolvedValue({
      artifact: { contentHash: 'sha256-candidate' },
      rawContent: '待审阅候选正文',
      issues: [],
    });
    serviceMocks.computeContentSha256.mockResolvedValue('sha256-candidate');

    const refs = {
      activeNovelId: { current: 'novel-1' },
      activeChapterId: { current: '' },
      editorSnapshot: {
        current: {
          content: '',
          wordCount: 0,
          isDirty: false,
          contentHash: '',
          contentAvailable: true,
        } satisfies EditorContentSnapshot,
      },
      currentDraft: { current: null as ChapterDraft | null },
    };
    const setNovel = vi.fn();
    const setVolumes = vi.fn();
    const setChapters = vi.fn();
    const setActiveChapterId = vi.fn();
    const setCurrentDraft = vi.fn();
    const setDraftWordCount = vi.fn();
    const setDirty = vi.fn();

    const view = renderHook(() =>
      useWorkspaceChapterLoader({
        novelId: 'novel-1',
        requestedChapterId: 'chapter-1',
        requestedArtifactId: 'artifact-1',
        requestedAuthorizationId: 'authorization-1',
        refs,
        setNovel,
        setVolumes,
        setChapters,
        setActiveChapterId,
        setCurrentDraft,
        setDraftWordCount,
        setDirty,
      }),
    );

    await act(flushMicrotasks);
    expect(view.result.current.reviewCandidate).toEqual(
      expect.objectContaining({
        authorizationId: 'authorization-1',
        artifactId: 'artifact-1',
        content: '待审阅候选正文',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
      await flushMicrotasks();
    });

    expect(serviceMocks.getChaptersByNovelId).toHaveBeenCalledTimes(4);
    expect(serviceMocks.getLatestDraftByChapterId).not.toHaveBeenCalled();
    expect(view.result.current.reviewCandidate).toEqual(
      expect.objectContaining({ authorizationId: 'authorization-1' }),
    );
  });
});
