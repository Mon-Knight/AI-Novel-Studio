import type { ChapterDraft, CreateChapterDraftInput } from '../../types/ai';
import type { WorkspaceRecoverySnapshot } from '../../types/workspaceRecovery';
import { draftVersionService } from '../../services/database/draftVersionService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export const RECOVERY_CANDIDATE_NOTE = '由冲突恢复快照另存';
export const RECOVERY_CANDIDATE_TITLE = '恢复候选';

interface RecoveryCandidateDependencies {
  listDrafts(chapterId: string): Promise<ChapterDraft[]>;
  createDraft(input: CreateChapterDraftInput): Promise<ChapterDraft>;
}

const defaultDependencies: RecoveryCandidateDependencies = {
  listDrafts: (chapterId) => draftVersionService.getByChapterId(chapterId),
  createDraft: (input) => draftVersionService.create(input),
};

function isExactRecoveryCandidate(
  draft: ChapterDraft,
  snapshot: WorkspaceRecoverySnapshot,
): boolean {
  return (
    draft.novelId === snapshot.novelId &&
    draft.chapterId === snapshot.chapterId &&
    draft.note === RECOVERY_CANDIDATE_NOTE &&
    draft.contentState?.status === 'ready' &&
    draft.contentState.contentHash.toLowerCase() === snapshot.recoveryContentHash.toLowerCase() &&
    draft.contentState.content === snapshot.recoveryContent
  );
}

async function recoveryOperationId(snapshot: WorkspaceRecoverySnapshot): Promise<string> {
  const identity = JSON.stringify({
    version: 1,
    novelId: snapshot.novelId,
    chapterId: snapshot.chapterId,
    baseDraftId: snapshot.baseDraftId ?? null,
    baseDraftVersion: snapshot.baseDraftVersion ?? null,
    baseContentHash: snapshot.baseContentHash?.toLowerCase() ?? null,
    recoveryContentHash: snapshot.recoveryContentHash.toLowerCase(),
  });
  return `recovery-candidate-${await computeContentSha256(identity)}`;
}

/**
 * Persists one conflict recovery snapshot as exactly one candidate across app
 * restarts. The durable operation ID closes the commit/response crash window;
 * the exact content lookup lets a later session retry only snapshot cleanup.
 */
export async function persistRecoveryCandidate(
  snapshot: WorkspaceRecoverySnapshot,
  dependencies: RecoveryCandidateDependencies = defaultDependencies,
): Promise<{ draft: ChapterDraft; reused: boolean }> {
  const drafts = await dependencies.listDrafts(snapshot.chapterId);
  const existing = drafts.find((draft) => isExactRecoveryCandidate(draft, snapshot));
  if (existing) return { draft: existing, reused: true };

  const draft = await dependencies.createDraft({
    novelId: snapshot.novelId,
    chapterId: snapshot.chapterId,
    // Keep the full atomic payload stable across chapter renames and sessions.
    title: RECOVERY_CANDIDATE_TITLE,
    content: snapshot.recoveryContent,
    source: 'user_edited',
    note: RECOVERY_CANDIDATE_NOTE,
    operationId: await recoveryOperationId(snapshot),
  });
  if (!isExactRecoveryCandidate(draft, snapshot)) {
    throw {
      code: 'RECOVERY_CONTENT_INVALID',
      message: '候选草稿返回的目标或正文身份不一致。',
      retryable: false,
    };
  }
  return { draft, reused: false };
}
