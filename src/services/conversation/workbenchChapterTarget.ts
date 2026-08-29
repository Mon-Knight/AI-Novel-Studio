import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { classifyTaskIntent, selectCandidateTool } from './taskGoalRouting';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';

const NEXT_CHAPTER_GOAL =
  /^(?:(?:请|请帮我|帮我)\s*)?(?:继续(?:写(?:下一章)?)?|接着写|往下写|再写一章|下一章|生成下一章(?:正文)?|写下一章(?:正文)?|续写下一章)(?:[，,:：。；;！？!?].*)?$/i;
const EXPLICIT_CHAPTER_GOAL = /第\s*([\d０-９]+|[一二两三四五六七八九十百千万零〇]+)\s*章/i;

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CHINESE_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
};

export interface WorkbenchChapterTargetResolution {
  status: 'current' | 'advanced' | 'first' | 'complete' | 'missing';
  chapterId?: string;
}

interface WorkbenchChapterTargetDependencies {
  listChapters?: typeof chapterRepository.getByNovelId;
  listVolumes?: typeof volumeRepository.getByNovelId;
}

export function isNextChapterGoal(goal: string): boolean {
  const normalized = goal.replace(/\s+/g, ' ').trim();
  return NEXT_CHAPTER_GOAL.test(normalized);
}

function parseChineseChapterNumber(value: string): number | undefined {
  if (!value) return undefined;
  if (!/[十百千万]/.test(value)) {
    const digits = Array.from(value, (character) => CHINESE_DIGITS[character]);
    if (digits.some((digit) => digit === undefined)) return undefined;
    const parsed = Number(digits.join(''));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of value) {
    const parsedDigit = CHINESE_DIGITS[character];
    if (parsedDigit !== undefined) {
      digit = parsedDigit;
      continue;
    }
    const unit = CHINESE_UNITS[character];
    if (!unit) return undefined;
    if (unit === 10000) {
      total += (section + digit || 1) * unit;
      section = 0;
      digit = 0;
      continue;
    }
    section += (digit || 1) * unit;
    digit = 0;
  }
  const parsed = total + section + digit;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function requestedChapterNumber(goal: string): number | undefined {
  const match = goal.match(EXPLICIT_CHAPTER_GOAL);
  if (!match) return undefined;
  const raw = match[1].replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return parseChineseChapterNumber(raw);
}

export function shouldResolveWorkbenchChapterTarget(goal: string): boolean {
  const intent = classifyTaskIntent(goal);
  if (intent === 'chapter_write') return true;
  if (intent !== 'structured_write' || requestedChapterNumber(goal) === undefined) return false;
  return selectCandidateTool(goal)?.name === 'generate_outline';
}

function chapterOrder(volumes: readonly Volume[]) {
  const orderedVolumes = [...volumes].sort(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const indexById = new Map(orderedVolumes.map((volume, index) => [volume.id, index]));
  return (left: Chapter, right: Chapter): number => {
    const leftVolume = left.volumeId
      ? (indexById.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER)
      : -1;
    const rightVolume = right.volumeId
      ? (indexById.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER)
      : -1;
    return (
      leftVolume - rightVolume ||
      left.orderIndex - right.orderIndex ||
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  };
}

export function orderPlannedChapters(
  chapters: readonly Chapter[],
  volumes: readonly Volume[],
): Chapter[] {
  return [...chapters].filter((chapter) => !chapter.deletedAt).sort(chapterOrder(volumes));
}

export function findNextPlannedChapter(
  chapters: readonly Chapter[],
  volumes: readonly Volume[],
  currentChapterId: string,
): Chapter | undefined {
  const ordered = orderPlannedChapters(chapters, volumes);
  const index = ordered.findIndex((chapter) => chapter.id === currentChapterId);
  return index >= 0 ? ordered.slice(index + 1).find((chapter) => !isAdopted(chapter)) : undefined;
}

function isAdopted(chapter: Chapter): boolean {
  return Boolean(
    chapter.adoptedDraftId || chapter.status === 'adopted' || chapter.status === 'summarized',
  );
}

function findRequestedChapter(ordered: readonly Chapter[], chapterNumber: number) {
  const exactMatches = ordered.filter((chapter) => chapter.chapterNumber === chapterNumber);
  if (exactMatches.length === 1) return exactMatches[0];
  return ordered[chapterNumber - 1];
}

export async function resolveWorkbenchChapterTarget(
  input: { novelId: string; currentChapterId?: string; goal: string },
  deps: WorkbenchChapterTargetDependencies = {},
): Promise<WorkbenchChapterTargetResolution> {
  const listChapters = deps.listChapters ?? chapterRepository.getByNovelId;
  const listVolumes = deps.listVolumes ?? volumeRepository.getByNovelId;
  const [chapters, volumes] = await Promise.all([
    listChapters(input.novelId),
    listVolumes(input.novelId),
  ]);
  const ordered = orderPlannedChapters(chapters, volumes);
  if (ordered.length === 0) return { status: 'missing' };

  const current = input.currentChapterId
    ? ordered.find((chapter) => chapter.id === input.currentChapterId)
    : undefined;
  const explicitChapterNumber = shouldResolveWorkbenchChapterTarget(input.goal)
    ? requestedChapterNumber(input.goal)
    : undefined;
  if (explicitChapterNumber !== undefined) {
    const requested = findRequestedChapter(ordered, explicitChapterNumber);
    if (!requested) return { status: 'missing' };
    return {
      status: requested.id === current?.id ? 'current' : current ? 'advanced' : 'first',
      chapterId: requested.id,
    };
  }
  if (!current) {
    if (isNextChapterGoal(input.goal)) {
      const firstUnadopted = ordered.find((chapter) => !isAdopted(chapter));
      return firstUnadopted
        ? { status: 'first', chapterId: firstUnadopted.id }
        : { status: 'complete' };
    }
    return { status: 'first', chapterId: ordered[0].id };
  }
  if (!isNextChapterGoal(input.goal) || !isAdopted(current)) {
    return { status: 'current', chapterId: current.id };
  }
  const next = findNextPlannedChapter(ordered, volumes, current.id);
  return next ? { status: 'advanced', chapterId: next.id } : { status: 'complete' };
}
