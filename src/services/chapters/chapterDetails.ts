import {
  ChapterStatusLabels,
  type Chapter,
  type ChapterStatus,
  type UpdateChapterInput,
} from '../../types/chapter';

export interface ChapterDetailsValues {
  title: string;
  volumeId: string;
  goal: string;
  targetWordCount: number;
  status: ChapterStatus;
}

export type ChapterDetailsPatch = Pick<
  UpdateChapterInput,
  'title' | 'volumeId' | 'goal' | 'targetWordCount' | 'status'
>;

export const CHAPTER_DETAILS_CONFLICT = 'CHAPTER_DETAILS_CONFLICT';

export function validateChapterDetailsPatch(patch: ChapterDetailsPatch): void {
  const allowed = ['title', 'volumeId', 'goal', 'targetWordCount', 'status'];
  if (
    Object.keys(patch).some((key) => !allowed.includes(key)) ||
    (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 80)) ||
    (patch.status !== undefined &&
      !Object.prototype.hasOwnProperty.call(ChapterStatusLabels, patch.status)) ||
    (patch.targetWordCount !== undefined &&
      (!Number.isInteger(patch.targetWordCount) ||
        (patch.targetWordCount !== 0 &&
          (patch.targetWordCount < 500 || patch.targetWordCount > 20000))))
  )
    throw new Error('章节编辑包含无效或不支持的字段。');
}

export function chapterDetailsValues(chapter: Chapter): ChapterDetailsValues {
  return {
    title: chapter.title,
    volumeId: chapter.volumeId ?? '',
    goal: chapter.goal ?? '',
    targetWordCount: chapter.targetWordCount ?? 0,
    status: chapter.status,
  };
}

/** Only explicitly changed fields leave the form. Outline adoption has its own authority. */
export function chapterDetailsPatch(
  baseline: Chapter,
  values: ChapterDetailsValues,
): ChapterDetailsPatch {
  const before = chapterDetailsValues(baseline);
  const after = { ...values, title: values.title.trim(), goal: values.goal.trim() };
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => value !== before[key as keyof ChapterDetailsValues],
    ),
  );
}

export function rebaseChapterDetails(
  baseline: Chapter,
  values: ChapterDetailsValues,
  latest: Chapter,
): ChapterDetailsValues {
  return { ...chapterDetailsValues(latest), ...chapterDetailsPatch(baseline, values) };
}

export function chapterDetailsBaseline(chapter: Chapter) {
  return {
    id: chapter.id,
    novelId: chapter.novelId,
    volumeId: chapter.volumeId ?? null,
    title: chapter.title,
    outline: chapter.outline ?? '',
    goal: chapter.goal ?? '',
    orderIndex: chapter.orderIndex,
    status: chapter.status,
    adoptedDraftId: chapter.adoptedDraftId ?? null,
    wordCount: chapter.wordCount,
    targetWordCount: chapter.targetWordCount ?? null,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
  };
}

export function requireChapterDetailsBaseline(
  current: Chapter | null | undefined,
  baseline: Chapter,
): asserts current is Chapter {
  if (
    !current ||
    current.deletedAt ||
    !baseline.id ||
    !baseline.novelId ||
    !baseline.updatedAt ||
    JSON.stringify(chapterDetailsBaseline(current)) !==
      JSON.stringify(chapterDetailsBaseline(baseline))
  )
    throw new Error(`${CHAPTER_DETAILS_CONFLICT}: 章节或采用章纲已变化，请刷新后核对。`);
}
