import { dbCall, isTauri } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { isContextCompressionCandidate } from '../context/novelContextCompressionProvider';
import { decodeArtifactRevisionTurn } from './artifactRevisionSourceCodec';
import { modelSnapshotFrom } from './conversationModelSnapshotValidation';
import {
  conversationWindowCommand,
  runningTaskTargetsCommand,
  sliceConversationWindow,
} from './conversationWindow';
import { readStoredConversationBundle, readStoredRunningTargets } from './taskConversationService';
import type {
  ConversationArtifactCard,
  ConversationTurn,
  ConversationWindow,
  ConversationWindowPage,
  ConversationWindowQuery,
  RunningTaskTarget,
  TaskConversation,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';

export interface ConversationWindowReadOptions {
  /** A saved reading anchor may name a turn this task no longer has. Explicit locate must not set this. */
  allowStaleFocusFallback?: boolean;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeConversation(raw: unknown): TaskConversation {
  const item = raw as TaskConversation;
  return {
    conversationId: String(item.conversationId),
    novelId: String(item.novelId),
    title: String(item.title || '未命名任务'),
    status: item.status ?? 'idle',
    defaultModel: modelSnapshotFrom(item.defaultModel),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    archivedAt: text(item.archivedAt),
  };
}

function normalizeBundle(raw: unknown): TaskConversationBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<TaskConversationBundle>;
  if (!item.conversation) return null;
  return {
    conversation: normalizeConversation(item.conversation),
    turns: Array.isArray(item.turns)
      ? item.turns.map((turn) => normalizeTurn(turn as ConversationTurn))
      : [],
    runs: Array.isArray(item.runs) ? item.runs.map((run) => normalizeRun(run as TaskRun)) : [],
    toolEvents: Array.isArray(item.toolEvents) ? item.toolEvents : [],
    artifacts: Array.isArray(item.artifacts)
      ? item.artifacts.map((artifact) => normalizeCard(artifact))
      : [],
    decisions: Array.isArray(item.decisions) ? item.decisions : [],
    authorizations: Array.isArray(item.authorizations) ? item.authorizations : [],
  };
}

function normalizeCard(artifact: ConversationArtifactCard): ConversationArtifactCard {
  const { candidateOrdinal, artifactEvidence, ...rest } = artifact;
  const ordinal =
    Number.isInteger(candidateOrdinal) && (candidateOrdinal ?? 0) >= 1
      ? candidateOrdinal
      : undefined;
  const normalized = {
    ...rest,
    content: artifact.content ?? '',
    ...(ordinal ? { candidateOrdinal: ordinal } : {}),
  };
  return isTauri()
    ? { ...normalized, ...(artifactEvidence ? { artifactEvidence } : {}) }
    : normalized;
}

function normalizeTurn(turn: ConversationTurn): ConversationTurn {
  return { ...turn, ...decodeArtifactRevisionTurn(turn.content ?? '') };
}

function normalizeRun(run: TaskRun): TaskRun {
  const chapterId = text(run.chapterId);
  return {
    ...run,
    ...(chapterId ? { chapterId } : {}),
    modelSnapshot: modelSnapshotFrom(run.modelSnapshot)!,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePage(raw: unknown): ConversationWindowPage {
  const item = raw as Partial<ConversationWindowPage>;
  return {
    startSequence: numberOrNull(item.startSequence),
    endSequenceExclusive: numberOrNull(item.endSequenceExclusive),
    oldestUserSequence: numberOrNull(item.oldestUserSequence),
    newestUserSequence: numberOrNull(item.newestUserSequence),
    hasOlder: item.hasOlder === true,
    hasNewer: item.hasNewer === true,
    userRoundCount: typeof item.userRoundCount === 'number' ? item.userRoundCount : 0,
  };
}

function normalizeWindow(raw: unknown): ConversationWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as { bundle?: unknown; page?: unknown };
  const bundle = normalizeBundle(item.bundle ?? raw);
  if (!bundle) return null;
  return { bundle, page: normalizePage(item.page ?? raw) };
}

function isFocusRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes('不属于当前任务');
}

async function readOnce(query: ConversationWindowQuery): Promise<ConversationWindow | null> {
  const invocation = conversationWindowCommand(query);
  const raw = await dbCall<unknown | null>(invocation.command, invocation.args, () => {
    const stored = readStoredConversationBundle(query.conversationId);
    return stored ? sliceConversationWindow(stored, query) : null;
  });
  if (raw == null) return null;
  const window = normalizeWindow(raw);
  if (!window) throw new Error('任务窗口无法读取。');
  return { ...window, bundle: await hydrateMissingArtifacts(window.bundle) };
}

async function hydrateMissingArtifacts(
  bundle: TaskConversationBundle,
): Promise<TaskConversationBundle> {
  if (!isTauri()) return bundle;
  const artifacts = await Promise.all(bundle.artifacts.map((card) => hydrateCard(card)));
  return { ...bundle, artifacts };
}

async function hydrateCard(card: ConversationArtifactCard): Promise<ConversationArtifactCard> {
  if (!card.artifactId || card.artifactEvidence) return card;
  try {
    const artifact = await aiTaskRuntimeService.getArtifact(card.artifactId);
    const structuredPayload = artifact.structuredPayloadJson;
    const isContextCompression =
      isContextCompressionCandidate(structuredPayload) && structuredPayload.valid;
    return {
      ...card,
      content: artifact.displayContent ?? artifact.rawContent,
      contentLoadError: undefined,
      artifactEvidence: {
        sourceNovelId: artifact.artifact.sourceNovelId,
        sourceChapterId: artifact.artifact.sourceChapterId ?? undefined,
        sourceDraftId: artifact.artifact.sourceDraftId ?? undefined,
        sourceDraftVersion: artifact.artifact.sourceDraftVersion ?? undefined,
        baseContentHash: artifact.artifact.sourceBaseContentHash ?? undefined,
        derivationType:
          artifact.artifact.derivationType ??
          (isContextCompression ? 'context_compression' : undefined),
        processingStatus: artifact.artifact.processingStatus,
        validationIssues: artifact.issues,
      },
    };
  } catch {
    return { ...card, contentLoadError: '候选内容读取失败，请重新读取当前任务产物。' };
  }
}

export const taskConversationWindow = {
  async read(
    query: ConversationWindowQuery,
    options: ConversationWindowReadOptions = {},
  ): Promise<ConversationWindow | null> {
    try {
      return await readOnce(query);
    } catch (error) {
      if (
        options.allowStaleFocusFallback &&
        query.focusTurnId &&
        isFocusRejection(error) &&
        !query.focusCardId
      ) {
        const { focusTurnId: _ignored, ...rest } = query;
        return readOnce(rest);
      }
      throw error;
    }
  },

  async listRunningTargets(novelId: string): Promise<RunningTaskTarget[]> {
    const invocation = runningTaskTargetsCommand(novelId);
    const raw = await dbCall<unknown[]>(invocation.command, invocation.args, () =>
      readStoredRunningTargets(novelId),
    );
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const target = item as RunningTaskTarget;
      if (!target.conversationId || !target.runId) return [];
      const chapterId = text(target.chapterId);
      const latestGoal = text(target.latestGoal);
      return [
        {
          conversationId: String(target.conversationId),
          novelId: String(target.novelId),
          title: String(target.title || '未命名任务'),
          runId: String(target.runId),
          ...(chapterId ? { chapterId } : {}),
          ...(latestGoal ? { latestGoal } : {}),
        },
      ];
    });
  },
};
