import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type {
  ReviewAuthorization,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { artifactDecisionService } from './artifactDecisionService';
import { classifyTaskIntent, selectCandidateTool } from './taskGoalRouting';

export type RetryTargetEvidenceSource =
  | 'run.chapterId'
  | 'tool.argumentsSummary.chapterId'
  | 'tool.argumentsSummary.targetChapterId'
  | 'artifact.sourceChapterId'
  | 'authorization.chapterId'
  | 'turn.goal.chapterId'
  | 'turn.goal.chapterTitle'
  | 'turn.goal.chapterNumber'
  | 'novel';

export interface RetryRunChapterTarget {
  chapterId?: string;
  source: RetryTargetEvidenceSource;
  evidence: string[];
}

interface RetryTargetEvidence {
  chapterId: string;
  source: RetryTargetEvidenceSource;
  evidence: string;
}

interface RetryTargetDependencies {
  listChapters?: typeof chapterRepository.getByNovelId;
  getReviewAuthorization?: (authorizationId: string) => Promise<ReviewAuthorization | null>;
  getDraftById?: (chapterId: string, draftId: string) => Promise<ChapterDraft | null>;
}

type RetryTargetErrorCode =
  | 'WORKBENCH_RETRY_TARGET_MISSING'
  | 'WORKBENCH_RETRY_TARGET_CONFLICT'
  | 'WORKBENCH_RETRY_TARGET_INVALID';

function retryTargetError(code: RetryTargetErrorCode, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function addEvidence(
  evidence: RetryTargetEvidence[],
  chapterId: unknown,
  source: RetryTargetEvidenceSource,
  detail: string,
): void {
  const value = safeId(chapterId);
  if (value) evidence.push({ chapterId: value, source, evidence: detail });
}

function collectPersistedEvidence(
  bundle: TaskConversationBundle,
  run: TaskRun,
): RetryTargetEvidence[] {
  const evidence: RetryTargetEvidence[] = [];
  addEvidence(evidence, run.chapterId, 'run.chapterId', `run:${run.runId}`);

  for (const event of bundle.toolEvents.filter((item) => item.runId === run.runId)) {
    addEvidence(
      evidence,
      event.argumentsSummary.chapterId,
      'tool.argumentsSummary.chapterId',
      `tool:${event.eventId}:chapterId`,
    );
    addEvidence(
      evidence,
      event.argumentsSummary.targetChapterId,
      'tool.argumentsSummary.targetChapterId',
      `tool:${event.eventId}:targetChapterId`,
    );
  }

  for (const artifact of bundle.artifacts.filter((item) => item.runId === run.runId)) {
    if (
      artifact.artifactEvidence?.sourceChapterId &&
      artifact.artifactEvidence.sourceNovelId !== bundle.conversation.novelId
    ) {
      throw retryTargetError(
        'WORKBENCH_RETRY_TARGET_CONFLICT',
        '原运行的产物来源与当前作品不一致，已停止重试。',
      );
    }
    addEvidence(
      evidence,
      artifact.artifactEvidence?.sourceChapterId,
      'artifact.sourceChapterId',
      `artifact:${artifact.cardId}:sourceChapterId`,
    );
    if (
      artifact.reviewAuthorization?.chapterId &&
      artifact.reviewAuthorization.novelId !== bundle.conversation.novelId
    ) {
      throw retryTargetError(
        'WORKBENCH_RETRY_TARGET_CONFLICT',
        '原运行的审阅授权与当前作品不一致，已停止重试。',
      );
    }
    addEvidence(
      evidence,
      artifact.reviewAuthorization?.chapterId,
      'authorization.chapterId',
      `artifact:${artifact.cardId}:authorizationChapterId`,
    );
  }
  return evidence;
}

const CHAPTER_SUMMARY_TURN_PREFIX = 'summary-generation-';

async function collectChapterSummaryAuthorizationEvidence(
  bundle: TaskConversationBundle,
  run: TaskRun,
  chapters: readonly Chapter[],
  dependencies: RetryTargetDependencies,
): Promise<RetryTargetEvidence[]> {
  if (!run.turnId.startsWith(CHAPTER_SUMMARY_TURN_PREFIX)) return [];

  const authorizationId = run.turnId.slice(CHAPTER_SUMMARY_TURN_PREFIX.length);
  if (!authorizationId || authorizationId.trim() !== authorizationId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合缺少审阅授权身份，已停止重试。',
    );
  }

  const getReviewAuthorization =
    dependencies.getReviewAuthorization ??
    ((id: string) => artifactDecisionService.getAuthorization(id));
  const authorization = await getReviewAuthorization(authorizationId);
  if (!authorization || authorization.authorizationId !== authorizationId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合引用的审阅授权不存在或身份不一致，已停止重试。',
    );
  }
  if (authorization.novelId !== bundle.conversation.novelId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_CONFLICT',
      '章节总结回合的审阅授权与当前作品不一致，已停止重试。',
    );
  }

  const adoptedDraftId = authorization.consumedByDraftId;
  if (authorization.status !== 'consumed' || !adoptedDraftId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合的审阅授权尚未形成正式采用事实，已停止重试。',
    );
  }
  if (adoptedDraftId.trim() !== adoptedDraftId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合的正式采用稿身份无效，已停止重试。',
    );
  }

  const chapter = chapters.find((item) => item.id === authorization.chapterId && !item.deletedAt);
  if (!chapter || chapter.novelId !== authorization.novelId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合引用的章节已不存在或不属于授权作品，已停止重试。',
    );
  }
  if (chapter.adoptedDraftId !== adoptedDraftId) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_CONFLICT',
      '章节总结回合引用的采用稿已不再是该章正式正文，已停止重试。',
    );
  }

  const getDraftById =
    dependencies.getDraftById ??
    ((chapterId: string, draftId: string) => draftVersionService.getById(chapterId, draftId));
  const adoptedDraft = await getDraftById(authorization.chapterId, adoptedDraftId);
  if (
    !adoptedDraft ||
    adoptedDraft.id !== adoptedDraftId ||
    adoptedDraft.novelId !== authorization.novelId ||
    adoptedDraft.chapterId !== authorization.chapterId ||
    !adoptedDraft.isAdopted
  ) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '章节总结回合引用的正式采用稿无法通过完整性核对，已停止重试。',
    );
  }

  return [
    {
      chapterId: authorization.chapterId,
      source: 'authorization.chapterId',
      evidence: `authorization:${authorizationId}:consumedDraft:${adoptedDraftId}`,
    },
  ];
}

const CHINESE_DIGITS: Record<string, number> = {
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

const CHINESE_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

function parseChineseInteger(value: string): number | undefined {
  if (!value) return undefined;
  if (!/[十百千万]/.test(value)) {
    const digits = Array.from(value).map((character) => CHINESE_DIGITS[character]);
    if (digits.some((digit) => digit === undefined)) return undefined;
    return Number(digits.join(''));
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of value) {
    if (character in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[character];
      continue;
    }
    if (character === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
      continue;
    }
    const unit = CHINESE_UNITS[character];
    if (!unit) return undefined;
    section += (digit || 1) * unit;
    digit = 0;
  }
  return total + section + digit;
}

function parseChapterNumber(value: string): number | undefined {
  const ascii = value.replace(/[０-９]/g, (character) => String(character.charCodeAt(0) - 0xff10));
  if (/^\d+$/.test(ascii)) {
    const parsed = Number(ascii);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  const parsed = parseChineseInteger(ascii);
  return parsed && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[\s:：,，.。;；_\-—]/g, '');
}

function collectGoalEvidence(goal: string, chapters: readonly Chapter[]): RetryTargetEvidence[] {
  const evidence: RetryTargetEvidence[] = [];
  const active = chapters.filter((chapter) => !chapter.deletedAt);

  for (const chapter of active) {
    if (chapter.id.length >= 4 && goal.includes(chapter.id)) {
      addEvidence(evidence, chapter.id, 'turn.goal.chapterId', `turnGoal:id:${chapter.id}`);
    }
    const title = normalizeTitle(chapter.title || '');
    if (title.length >= 4 && normalizeTitle(goal).includes(title)) {
      addEvidence(evidence, chapter.id, 'turn.goal.chapterTitle', `turnGoal:title:${chapter.id}`);
    }
  }

  for (const match of goal.matchAll(/第\s*([0-9０-９零〇一二两三四五六七八九十百千万]+)\s*章/g)) {
    const chapterNumber = parseChapterNumber(match[1]);
    if (!chapterNumber) continue;
    for (const chapter of active.filter((item) => item.chapterNumber === chapterNumber)) {
      addEvidence(
        evidence,
        chapter.id,
        'turn.goal.chapterNumber',
        `turnGoal:chapterNumber:${chapterNumber}`,
      );
    }
  }
  return evidence;
}

function requiresFrozenChapter(goal: string): boolean {
  if (classifyTaskIntent(goal) === 'chapter_write') return true;
  const withChapter = selectCandidateTool(goal, '__retry_target_probe__');
  const withoutChapter = selectCandidateTool(goal);
  if (withChapter && !withoutChapter) return true;
  return /(?:本|当前|上一|下一)章|第\s*[0-9０-９零〇一二两三四五六七八九十百千万]+\s*章|章节(?:正文|大纲|总结|摘要|质量|事件|人物)|正文/i.test(
    goal,
  );
}

function uniqueChapterIds(evidence: readonly RetryTargetEvidence[]): string[] {
  return [...new Set(evidence.map((item) => item.chapterId))];
}

function resolveEvidence(
  evidence: RetryTargetEvidence[],
  chapters: readonly Chapter[],
): RetryRunChapterTarget | undefined {
  const chapterIds = uniqueChapterIds(evidence);
  if (chapterIds.length > 1) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_CONFLICT',
      '原运行保存了互相冲突的章节目标，已停止重试。',
    );
  }
  const chapterId = chapterIds[0];
  if (!chapterId) return undefined;
  if (!chapters.some((chapter) => chapter.id === chapterId && !chapter.deletedAt)) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '原运行的冻结章节已不存在或不属于当前作品，已停止重试。',
    );
  }
  return {
    chapterId,
    source: evidence[0].source,
    evidence: evidence.map((item) => item.evidence),
  };
}

/** Resolves only immutable evidence from the source run/turn; current UI state is never consulted. */
export async function resolveRetryRunChapterTarget(
  input: {
    bundle: TaskConversationBundle;
    sourceRun: TaskRun;
    sourceGoal: string;
  },
  dependencies: RetryTargetDependencies = {},
): Promise<RetryRunChapterTarget> {
  const { bundle, sourceRun, sourceGoal } = input;
  if (
    sourceRun.conversationId !== bundle.conversation.conversationId ||
    !bundle.turns.some(
      (turn) =>
        turn.turnId === sourceRun.turnId &&
        turn.conversationId === bundle.conversation.conversationId &&
        turn.role === 'user',
    )
  ) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_INVALID',
      '原运行与用户回合的持久化范围不一致，已停止重试。',
    );
  }

  const listChapters = dependencies.listChapters ?? chapterRepository.getByNovelId;
  const chapters = (await listChapters(bundle.conversation.novelId)).filter(
    (chapter) => chapter.novelId === bundle.conversation.novelId,
  );
  const persistedEvidence = collectPersistedEvidence(bundle, sourceRun);
  persistedEvidence.push(
    ...(await collectChapterSummaryAuthorizationEvidence(
      bundle,
      sourceRun,
      chapters,
      dependencies,
    )),
  );
  const persisted = resolveEvidence(persistedEvidence, chapters);
  if (persisted) return persisted;

  const fromGoal = resolveEvidence(collectGoalEvidence(sourceGoal, chapters), chapters);
  if (fromGoal) return fromGoal;

  if (requiresFrozenChapter(sourceGoal)) {
    throw retryTargetError(
      'WORKBENCH_RETRY_TARGET_MISSING',
      '原运行未保存章节目标，且原回合内容无法唯一定位章节。为避免误用当前选中章节，已停止重试。',
    );
  }
  return { source: 'novel', evidence: [] };
}
