import { describe, expect, it, vi } from 'vitest';

import {
  persistRecoveryCandidate,
  RECOVERY_CANDIDATE_NOTE,
  RECOVERY_CANDIDATE_TITLE,
} from '../../features/workspace/recoveryCandidate';
import type { ChapterDraft, CreateChapterDraftInput } from '../../types/ai';
import type { WorkspaceRecoverySnapshot } from '../../types/workspaceRecovery';
import { computeContentSha256 } from '../../utils/contentIntegrity';

async function snapshot(): Promise<WorkspaceRecoverySnapshot> {
  const recoveryContent = '异常退出后保留的冲突正文';
  return {
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    baseDraftId: 'draft-base',
    baseDraftVersion: 2,
    baseContentHash: await computeContentSha256('旧正文'),
    recoveryContent,
    recoveryContentHash: await computeContentSha256(recoveryContent),
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:01:00.000Z',
  };
}

function candidate(input: CreateChapterDraftInput, id = 'draft-recovery'): ChapterDraft {
  return {
    id,
    novelId: input.novelId,
    chapterId: input.chapterId,
    title: input.title,
    content: input.content,
    source: input.source,
    versionNo: 3,
    wordCount: input.content.length,
    isAdopted: false,
    note: input.note,
    contentState: {
      status: 'ready',
      content: input.content,
      contentHash: '',
      contentLength: Array.from(input.content).length,
    },
    createdAt: '2026-07-26T00:02:00.000Z',
    updatedAt: '2026-07-26T00:02:00.000Z',
  };
}

describe('recovery candidate persistence', () => {
  it('reuses the committed candidate after cleanup failure and a new session', async () => {
    const recovery = await snapshot();
    let persisted: ChapterDraft | null = null;
    const createDraft = vi.fn(async (input: CreateChapterDraftInput) => {
      const saved = candidate(input);
      if (saved.contentState?.status === 'ready') {
        saved.contentState.contentHash = recovery.recoveryContentHash;
      }
      persisted = saved;
      return saved;
    });
    const dependencies = {
      listDrafts: vi.fn(async () => persisted ? [persisted] : []),
      createDraft,
    };

    const first = await persistRecoveryCandidate(recovery, dependencies);
    // Simulate snapshot deletion failing and the app restarting. The in-memory
    // call state is gone, but the committed draft remains authoritative.
    const second = await persistRecoveryCandidate(recovery, dependencies);

    expect(first.reused).toBe(false);
    expect(second).toEqual({ draft: first.draft, reused: true });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      note: RECOVERY_CANDIDATE_NOTE,
      title: RECOVERY_CANDIDATE_TITLE,
      operationId: expect.stringMatching(/^recovery-candidate-[0-9a-f]{64}$/),
    }));
  });

  it('rejects a candidate whose returned content identity differs', async () => {
    const recovery = await snapshot();
    await expect(persistRecoveryCandidate(recovery, {
      listDrafts: async () => [],
      createDraft: async (input) => {
        const saved = candidate(input);
        if (saved.contentState?.status === 'ready') {
          saved.contentState.contentHash = await computeContentSha256('其他正文');
        }
        return saved;
      },
    })).rejects.toEqual(expect.objectContaining({ code: 'RECOVERY_CONTENT_INVALID' }));
  });
});
