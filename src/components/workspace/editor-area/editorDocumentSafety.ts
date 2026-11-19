import type { ChapterDraft } from '../../../types/ai';
import type { ReviewCandidateDocument } from '../../../types/conversation';
import type { EditorDocumentState, EditorDraftContentResolution } from './editorAreaTypes';

interface EditorDocumentSourceInput {
  documentState: EditorDocumentState;
  novelId?: string;
  chapterId?: string;
  draft?: ChapterDraft | null;
  reviewCandidate?: ReviewCandidateDocument | null;
}

export function getEditorDocumentSourceKey(input: EditorDocumentSourceInput): string | undefined {
  if (input.documentState !== 'ready' || !input.novelId || !input.chapterId) return undefined;
  if (input.reviewCandidate) {
    return [
      'review',
      input.novelId,
      input.chapterId,
      input.reviewCandidate.authorizationId,
      input.reviewCandidate.artifactId,
      input.reviewCandidate.contentHash,
      input.reviewCandidate.reviewDraftBinding?.draftId ?? '',
      input.reviewCandidate.reviewDraftBinding?.draftVersion ?? '',
      input.reviewCandidate.reviewDraftBinding?.contentHash ?? '',
    ].join(':');
  }
  if (input.draft) {
    return ['draft', input.novelId, input.chapterId, input.draft.id, input.draft.versionNo].join(
      ':',
    );
  }
  return ['empty', input.novelId, input.chapterId].join(':');
}

/**
 * Keeps the last known complete editor value until the target draft has been
 * fully hydrated and its ownership has been verified.
 */
export function resolveEditorDraftContent(
  input: EditorDocumentSourceInput,
): EditorDraftContentResolution {
  if (input.documentState !== 'ready') return { action: 'preserve' };

  if (input.reviewCandidate) {
    if (
      !input.novelId ||
      !input.chapterId ||
      input.reviewCandidate.novelId !== input.novelId ||
      input.reviewCandidate.chapterId !== input.chapterId
    ) {
      return { action: 'preserve', reason: '审阅候选与当前章节不一致，已阻止载入' };
    }
    const binding = input.reviewCandidate.reviewDraftBinding;
    if (binding) {
      const draft = input.draft;
      if (
        !draft ||
        draft.novelId !== input.novelId ||
        draft.chapterId !== input.chapterId ||
        draft.id !== binding.draftId ||
        draft.versionNo !== binding.draftVersion ||
        draft.contentState?.status === 'unavailable' ||
        (draft.contentState?.status === 'ready' &&
          draft.contentState.contentHash !== binding.contentHash)
      )
        return {
          action: 'preserve',
          reason: '已保存审阅稿与原生绑定不一致，已阻止用原始候选覆盖人工编辑',
        };
      return { action: 'replace', content: draft.content, draft };
    }
    return { action: 'replace', content: input.reviewCandidate.content, draft: null };
  }

  if (!input.draft) return { action: 'replace', content: '', draft: null };
  if (
    !input.novelId ||
    !input.chapterId ||
    input.draft.novelId !== input.novelId ||
    input.draft.chapterId !== input.chapterId
  ) {
    return { action: 'preserve', reason: '草稿与当前章节不一致，已阻止载入' };
  }

  return { action: 'replace', content: input.draft.content, draft: input.draft };
}

/**
 * The persistence service has already verified whether an update kept its ID
 * or atomically forked because adoption won the race. At the editor boundary
 * only live document ownership is checked; comparing against the preflight
 * draft ID would reject that valid fork using stale adoption state.
 */
export function isDraftSaveResultForDocument(
  draft: ChapterDraft | null | undefined,
  novelId: string,
  chapterId: string,
): draft is ChapterDraft {
  return Boolean(draft && draft.novelId === novelId && draft.chapterId === chapterId);
}
