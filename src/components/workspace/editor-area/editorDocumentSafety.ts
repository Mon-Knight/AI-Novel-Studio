import type { ChapterDraft } from '../../../types/ai';
import type { EditorDocumentState, EditorDraftContentResolution } from './editorAreaTypes';

/**
 * Keeps the last known complete editor value until the target draft has been
 * fully hydrated and its ownership has been verified.
 */
export function resolveEditorDraftContent(input: {
  documentState: EditorDocumentState;
  novelId?: string;
  chapterId?: string;
  draft?: ChapterDraft | null;
}): EditorDraftContentResolution {
  if (input.documentState !== 'ready') return { action: 'preserve' };

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
