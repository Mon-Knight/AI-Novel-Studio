import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type {
  CoCreationObjectContext,
  CoCreationWorkspaceDiscussionHandoffV1,
} from '../../types/coCreation';
import type {
  CandidateGenerationActivity,
  CandidateReviewRecord,
} from '../../types/placement';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export const CO_CREATION_DEEP_LINK_VERSION = 1 as const;
export const CO_CREATION_SELECTION_INDEX_ENCODING = 'utf16_code_unit' as const;
export const MAX_CO_CREATION_SELECTION_LENGTH = 12_000;

export interface CoCreationNavigationStateV1 {
  schemaVersion: typeof CO_CREATION_DEEP_LINK_VERSION;
  source: 'writing_workspace';
  discussionHandoff: CoCreationWorkspaceDiscussionHandoffV1;
}

export interface CandidateReviewDeepLink {
  review: 'candidate';
  artifactId?: string;
  taskId?: string;
  invalidReason?: string;
}

interface CreateDiscussionHandoffInput {
  novelId: string;
  chapterId: string;
  volumeId?: string;
  draftId?: string;
  draftVersion?: number;
  content: string;
  contentAvailable: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}

interface ValidateDiscussionHandoffInput {
  handoff: CoCreationWorkspaceDiscussionHandoffV1;
  novelId: string;
  chapter: Pick<Chapter, 'id' | 'novelId' | 'volumeId'>;
  latestDraft: ChapterDraft | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeOpaqueId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function exactSelection(
  content: string,
  start: number | undefined,
  end: number | undefined,
): { start: number; end: number; text: string } | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  const safeStart = Number(start);
  const safeEnd = Number(end);
  if (safeStart < 0 || safeEnd <= safeStart || safeEnd > content.length) return null;
  if (splitsSurrogatePair(content, safeStart) || splitsSurrogatePair(content, safeEnd)) return null;
  const text = content.slice(safeStart, safeEnd);
  if (!text || text.length > MAX_CO_CREATION_SELECTION_LENGTH) return null;
  return { start: safeStart, end: safeEnd, text };
}

export async function createCoCreationNavigationState(
  input: CreateDiscussionHandoffInput,
): Promise<CoCreationNavigationStateV1> {
  const documentContentHash = await computeContentSha256(input.content);
  const selection = input.contentAvailable
    ? exactSelection(input.content, input.selectionStart, input.selectionEnd)
    : null;
  const handoffId = crypto.randomUUID();
  const selectedTextHash = selection
    ? await computeContentSha256(selection.text)
    : undefined;

  return {
    schemaVersion: CO_CREATION_DEEP_LINK_VERSION,
    source: 'writing_workspace',
    discussionHandoff: {
      schemaVersion: 1,
      handoffId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      ...(input.volumeId ? { volumeId: input.volumeId } : {}),
      ...(input.draftId ? { draftId: input.draftId } : {}),
      ...(input.draftVersion !== undefined ? { draftVersion: input.draftVersion } : {}),
      documentContentHash,
      ...(selection && selectedTextHash ? {
        selectionStart: selection.start,
        selectionEnd: selection.end,
        selectedText: selection.text,
        selectedTextHash,
      } : {}),
      createdAt: new Date().toISOString(),
    },
  };
}

export function parseCoCreationNavigationState(
  value: unknown,
  expectedNovelId: string,
  expectedChapterId?: string,
): CoCreationWorkspaceDiscussionHandoffV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== CO_CREATION_DEEP_LINK_VERSION
    || value.source !== 'writing_workspace' || !isRecord(value.discussionHandoff)) {
    return undefined;
  }
  const raw = value.discussionHandoff;
  const handoffId = safeOpaqueId(raw.handoffId);
  const novelId = safeOpaqueId(raw.novelId);
  const chapterId = safeOpaqueId(raw.chapterId);
  const documentContentHash = typeof raw.documentContentHash === 'string'
    ? raw.documentContentHash.trim()
    : '';
  if (raw.schemaVersion !== 1 || !handoffId || novelId !== expectedNovelId || !chapterId
    || (expectedChapterId && chapterId !== expectedChapterId)
    || !documentContentHash || documentContentHash.length > 128) {
    return undefined;
  }

  const selectionStart = optionalInteger(raw.selectionStart);
  const selectionEnd = optionalInteger(raw.selectionEnd);
  const selectedText = typeof raw.selectedText === 'string' ? raw.selectedText : undefined;
  const selectedTextHash = typeof raw.selectedTextHash === 'string'
    ? raw.selectedTextHash.trim()
    : undefined;
  const completeSelection = selectionStart !== undefined && selectionEnd !== undefined
    && selectionEnd > selectionStart && !!selectedText && selectedText.length <= MAX_CO_CREATION_SELECTION_LENGTH
    && !!selectedTextHash && selectedTextHash.length <= 128;

  return {
    schemaVersion: 1,
    handoffId,
    novelId,
    chapterId,
    ...(safeOpaqueId(raw.volumeId) ? { volumeId: safeOpaqueId(raw.volumeId) } : {}),
    ...(safeOpaqueId(raw.draftId) ? { draftId: safeOpaqueId(raw.draftId) } : {}),
    ...(optionalInteger(raw.draftVersion) !== undefined ? { draftVersion: optionalInteger(raw.draftVersion) } : {}),
    documentContentHash,
    ...(completeSelection ? { selectionStart, selectionEnd, selectedText, selectedTextHash } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
  };
}

export async function validateDiscussionHandoff(
  input: ValidateDiscussionHandoffInput,
): Promise<{ objectContext: CoCreationObjectContext; selectionAccepted: boolean; warning?: string }> {
  const { handoff, novelId, chapter, latestDraft } = input;
  if (handoff.novelId !== novelId || chapter.novelId !== novelId || handoff.chapterId !== chapter.id) {
    throw new Error('讨论交接不属于当前作品或章节，已阻止恢复对象上下文。');
  }
  if (handoff.volumeId && handoff.volumeId !== chapter.volumeId) {
    throw new Error('讨论交接的分卷与当前章节不一致，已阻止恢复对象上下文。');
  }

  const baseContext: CoCreationObjectContext = {
    novelId,
    chapterId: chapter.id,
    ...(chapter.volumeId ? { volumeId: chapter.volumeId } : {}),
    objectType: 'chapter',
    objectId: chapter.id,
    discussionHandoffId: handoff.handoffId,
  };
  const hasSelection = handoff.selectionStart !== undefined || handoff.selectionEnd !== undefined
    || handoff.selectedText !== undefined || handoff.selectedTextHash !== undefined;
  if (!hasSelection) return { objectContext: baseContext, selectionAccepted: false };
  if (!latestDraft || latestDraft.novelId !== novelId || latestDraft.chapterId !== chapter.id
    || latestDraft.contentState?.status === 'unavailable') {
    return {
      objectContext: baseContext,
      selectionAccepted: false,
      warning: '完整正文无法复核，已仅定位章节，未携带选中段落。',
    };
  }

  const selection = exactSelection(latestDraft.content, handoff.selectionStart, handoff.selectionEnd);
  const documentHash = await computeContentSha256(latestDraft.content);
  if (!selection || documentHash !== handoff.documentContentHash) {
    return {
      objectContext: baseContext,
      selectionAccepted: false,
      warning: '正文已变化，选中段落交接已过期；已仅定位章节。',
    };
  }
  const selectedTextHash = await computeContentSha256(selection.text);
  if (selection.text !== handoff.selectedText || selectedTextHash !== handoff.selectedTextHash) {
    return {
      objectContext: baseContext,
      selectionAccepted: false,
      warning: '选中段落完整性校验失败；已仅定位章节。',
    };
  }

  return {
    selectionAccepted: true,
    objectContext: {
      ...baseContext,
      selectedText: selection.text,
      selectedTextHash,
      documentContentHash: documentHash,
      draftId: latestDraft.id,
      draftVersion: latestDraft.versionNo,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    },
  };
}

export function buildWorkspaceDeepLink(input: {
  novelId: string;
  chapterId?: string;
  review?: 'candidate';
  artifactId?: string;
  taskId?: string;
}): string {
  const params = new URLSearchParams();
  if (input.chapterId) params.set('chapterId', input.chapterId);
  const artifactId = safeOpaqueId(input.artifactId);
  const taskId = safeOpaqueId(input.taskId);
  const invalidExplicitIdentity = (input.artifactId !== undefined && !artifactId)
    || (input.taskId !== undefined && !taskId);
  if (input.review === 'candidate' && !invalidExplicitIdentity && artifactId && taskId) {
    params.set('review', 'candidate');
    params.set('artifactId', artifactId);
    params.set('taskId', taskId);
  }
  const query = params.toString();
  return `/novels/${encodeURIComponent(input.novelId)}/workspace${query ? `?${query}` : ''}`;
}

export function parseCandidateReviewDeepLink(searchParams: URLSearchParams): CandidateReviewDeepLink | undefined {
  if (searchParams.get('review') !== 'candidate') return undefined;
  const rawArtifactId = searchParams.get('artifactId') || undefined;
  const rawTaskId = searchParams.get('taskId') || undefined;
  const artifactId = safeOpaqueId(rawArtifactId);
  const taskId = safeOpaqueId(rawTaskId);
  if (!artifactId || !taskId) {
    return { review: 'candidate', invalidReason: '候选审查链接必须包含有效的 Artifact 和 Task 身份。' };
  }
  return { review: 'candidate', artifactId, taskId };
}

export function candidateRecoveryMatchesDeepLink(input: {
  request: CandidateReviewDeepLink;
  record: CandidateReviewRecord | null;
  activity: CandidateGenerationActivity | null;
}): { ok: boolean; reason?: string } {
  if (input.request.invalidReason) return { ok: false, reason: input.request.invalidReason };
  const { record, request } = input;
  if (!request.artifactId || !request.taskId || !record) {
    return { ok: false, reason: '指定的正文候选不存在或身份不完整。' };
  }
  if (record.candidate.artifactId !== request.artifactId) {
    return { ok: false, reason: '指定的正文候选不存在或已被其他候选替代。' };
  }
  if (record.candidate.taskId !== request.taskId) {
    return { ok: false, reason: '指定的生成任务与当前章节候选不一致。' };
  }
  return { ok: true };
}

export function resolveWorkspaceChapterTarget(
  chapters: Array<Pick<Chapter, 'id'>>,
  requestedChapterId?: string,
): { chapterId?: string; invalidRequestedChapter: boolean } {
  if (!requestedChapterId) {
    return { chapterId: chapters[0]?.id, invalidRequestedChapter: false };
  }
  return chapters.some((chapter) => chapter.id === requestedChapterId)
    ? { chapterId: requestedChapterId, invalidRequestedChapter: false }
    : { invalidRequestedChapter: true };
}
