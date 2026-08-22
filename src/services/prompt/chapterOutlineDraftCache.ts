const CHAPTER_OUTLINE_DRAFT_PREFIX = 'ai_novel_studio_unsaved_chapter_outline_';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyOf(chapterId: string): string {
  return `${CHAPTER_OUTLINE_DRAFT_PREFIX}${chapterId}`;
}

export function getCachedChapterOutlineDraft(chapterId: string): string | null {
  const storage = getStorage();
  if (!storage || !chapterId) return null;
  return storage.getItem(keyOf(chapterId));
}

export function setCachedChapterOutlineDraft(chapterId: string, value: string): void {
  const storage = getStorage();
  if (!storage || !chapterId) return;
  storage.setItem(keyOf(chapterId), value);
}

export function clearCachedChapterOutlineDraft(chapterId: string): void {
  const storage = getStorage();
  if (!storage || !chapterId) return;
  storage.removeItem(keyOf(chapterId));
}
