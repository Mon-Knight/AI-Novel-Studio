import { normalizeDrafts } from '../database/draftBrowserPersistence';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export const CHAPTER_SOURCE_REF_PREFIX = 'ans-adopted-chapter-v1:';
const changed = () =>
  new Error('CHAPTER_SOURCE_CHANGED: 采用正文已变化或无法完整读取，请重新核对并预览影响。');

function references(metadata?: string): string[] {
  try {
    const value = JSON.parse(metadata ?? '{}') as { provenance?: { sourceRefs?: unknown } };
    const refs = value?.provenance?.sourceRefs;
    return Array.isArray(refs)
      ? refs.filter(
          (ref): ref is string =>
            typeof ref === 'string' && ref.startsWith(CHAPTER_SOURCE_REF_PREFIX),
        )
      : [];
  } catch {
    return [];
  }
}

/** Browser guard over the same captured state that is synchronously rechecked before writing. */
export async function validateLocalChapterSource(
  novelId: string,
  state: {
    chapters: Array<{ id: string; novelId: string; adoptedDraftId?: string }>;
    drafts: Array<{ chapterId: string; records: unknown }>;
  },
  nextMetadata?: string,
  previousMetadata?: string,
  notes?: string,
) {
  const previous = new Set(references(previousMetadata));
  const refs = new Set([
    ...references(nextMetadata).filter((ref) => !previous.has(ref)),
    ...(notes ?? '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(CHAPTER_SOURCE_REF_PREFIX)),
  ]);
  for (const ref of refs) {
    const parts = ref.slice(CHAPTER_SOURCE_REF_PREFIX.length).split(':');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !/^[a-f\d]{64}$/iu.test(parts[2]))
      throw changed();
    const [chapterId, draftId, hash] = parts;
    const chapter = state.chapters.find((item) => item.id === chapterId);
    const raw = state.drafts.find((item) => item.chapterId === chapterId)?.records;
    const records = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? (raw as { drafts?: unknown }).drafts
        : undefined;
    const draft = normalizeDrafts(records).find((item) => item.id === draftId);
    if (
      chapter?.novelId !== novelId ||
      chapter.adoptedDraftId !== draftId ||
      !draft ||
      draft.novelId !== novelId ||
      draft.chapterId !== chapterId ||
      !draft.isAdopted ||
      draft.largeTextRefId ||
      !draft.content.trim() ||
      (draft.contentState &&
        (draft.contentState.status !== 'ready' || draft.contentState.content !== draft.content)) ||
      (await computeContentSha256(draft.content)).toLowerCase() !== hash.toLowerCase()
    )
      throw changed();
  }
}
