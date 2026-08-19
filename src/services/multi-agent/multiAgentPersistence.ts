import { dbCall, lsGet, lsSet } from '../database/db';
import type {
  CollaborationRound,
  ConsensusAction,
  MultiAgentSessionBundle,
  MultiAgentSessionRecord,
  MultiAgentSessionStatus,
} from '../../types/multiAgent';

const STORAGE_KEY = 'ai_novel_studio_multi_agent_sessions';

export interface CompleteMultiAgentSessionInput {
  sessionId: string;
  status: Exclude<MultiAgentSessionStatus, 'running'>;
  accepted: boolean;
  finalAction?: ConsensusAction;
  finalDraftId?: string;
  durationMs: number;
  errorMessage?: string;
  completedAt: string;
}

export interface MultiAgentPersistence {
  createSession(session: MultiAgentSessionRecord): Promise<MultiAgentSessionBundle>;
  appendRound(sessionId: string, round: CollaborationRound): Promise<MultiAgentSessionBundle>;
  completeSession(input: CompleteMultiAgentSessionInput): Promise<MultiAgentSessionBundle>;
  getSession(sessionId: string): Promise<MultiAgentSessionBundle | null>;
  listSessionsByChapter(chapterId: string, limit?: number): Promise<MultiAgentSessionRecord[]>;
}

function isBundle(value: unknown): value is MultiAgentSessionBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bundle = value as Partial<MultiAgentSessionBundle>;
  return Boolean(bundle.session?.sessionId) && Array.isArray(bundle.rounds);
}

function readLocalBundles(): MultiAgentSessionBundle[] {
  const value = lsGet<unknown>(STORAGE_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isBundle);
}

function writeLocalBundles(bundles: MultiAgentSessionBundle[]): void {
  lsSet(STORAGE_KEY, bundles);
}

function sameSessionIdentity(
  left: MultiAgentSessionRecord,
  right: MultiAgentSessionRecord,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.novelId === right.novelId &&
    left.chapterId === right.chapterId &&
    left.sourceDraftId === right.sourceDraftId &&
    left.sourceDraftVersion === right.sourceDraftVersion &&
    left.sourceContentHash === right.sourceContentHash &&
    JSON.stringify(left.expertTypes) === JSON.stringify(right.expertTypes) &&
    left.maxRounds === right.maxRounds &&
    left.acceptanceThreshold === right.acceptanceThreshold &&
    left.minimumAverageScore === right.minimumAverageScore &&
    left.minimumSuccessfulExperts === right.minimumSuccessfulExperts
  );
}

function createLocalSession(session: MultiAgentSessionRecord): MultiAgentSessionBundle {
  const bundles = readLocalBundles();
  const replay = bundles.find((bundle) => bundle.session.operationId === session.operationId);
  if (replay) {
    if (!sameSessionIdentity(replay.session, session)) {
      throw new Error('相同 operationId 对应的 Multi-Agent 请求不一致。');
    }
    return replay;
  }
  const bundle = { session, rounds: [] };
  bundles.unshift(bundle);
  writeLocalBundles(bundles);
  return bundle;
}

function appendLocalRound(sessionId: string, round: CollaborationRound): MultiAgentSessionBundle {
  const bundles = readLocalBundles();
  const index = bundles.findIndex((bundle) => bundle.session.sessionId === sessionId);
  if (index < 0) throw new Error('Multi-Agent session 不存在。');
  const bundle = bundles[index];
  const replay = bundle.rounds.find((item) => item.roundNumber === round.roundNumber);
  if (replay) {
    if (JSON.stringify(replay) !== JSON.stringify(round)) {
      throw new Error('Multi-Agent round 重放内容不一致。');
    }
    return bundle;
  }
  if (bundle.session.status !== 'running' || round.roundNumber !== bundle.rounds.length + 1) {
    throw new Error('Multi-Agent round 状态或顺序无效。');
  }

  const updated: MultiAgentSessionBundle = {
    session: {
      ...bundle.session,
      currentRound: round.roundNumber,
      totalTokensInput: bundle.session.totalTokensInput + round.tokensInput,
      totalTokensOutput: bundle.session.totalTokensOutput + round.tokensOutput,
      totalTokensUsed: bundle.session.totalTokensUsed + round.tokensUsed,
      updatedAt: round.completedAt,
    },
    rounds: [...bundle.rounds, round],
  };
  bundles[index] = updated;
  writeLocalBundles(bundles);
  return updated;
}

function completeLocalSession(input: CompleteMultiAgentSessionInput): MultiAgentSessionBundle {
  const bundles = readLocalBundles();
  const index = bundles.findIndex((bundle) => bundle.session.sessionId === input.sessionId);
  if (index < 0) throw new Error('Multi-Agent session 不存在。');
  const bundle = bundles[index];
  if (bundle.session.status !== 'running') {
    const matches =
      bundle.session.status === input.status &&
      bundle.session.accepted === input.accepted &&
      bundle.session.finalAction === input.finalAction &&
      bundle.session.finalDraftId === input.finalDraftId;
    if (!matches) throw new Error('Multi-Agent session 终态重放不一致。');
    return bundle;
  }
  const updated: MultiAgentSessionBundle = {
    session: {
      ...bundle.session,
      status: input.status,
      accepted: input.accepted,
      finalAction: input.finalAction,
      finalDraftId: input.finalDraftId,
      durationMs: Math.max(0, input.durationMs),
      errorMessage: input.errorMessage,
      updatedAt: input.completedAt,
      completedAt: input.completedAt,
    },
    rounds: bundle.rounds,
  };
  bundles[index] = updated;
  writeLocalBundles(bundles);
  return updated;
}

export const multiAgentPersistence: MultiAgentPersistence = {
  async createSession(session) {
    const value = await dbCall<unknown>('create_multi_agent_session', { input: session }, () =>
      createLocalSession(session),
    );
    if (!isBundle(value)) throw new Error('Multi-Agent session 返回格式无效。');
    return value;
  },

  async appendRound(sessionId, round) {
    const value = await dbCall<unknown>(
      'append_multi_agent_round',
      { input: { sessionId, round } },
      () => appendLocalRound(sessionId, round),
    );
    if (!isBundle(value)) throw new Error('Multi-Agent round 返回格式无效。');
    return value;
  },

  async completeSession(input) {
    const value = await dbCall<unknown>('complete_multi_agent_session', { input }, () =>
      completeLocalSession(input),
    );
    if (!isBundle(value)) throw new Error('Multi-Agent session 终态返回格式无效。');
    return value;
  },

  async getSession(sessionId) {
    const value = await dbCall<unknown | null>(
      'get_multi_agent_session',
      { input: { sessionId } },
      () => readLocalBundles().find((bundle) => bundle.session.sessionId === sessionId) ?? null,
    );
    if (value === null) return null;
    if (!isBundle(value)) throw new Error('Multi-Agent session 返回格式无效。');
    return value;
  },

  async listSessionsByChapter(chapterId, limit = 20) {
    const value = await dbCall<unknown[]>(
      'list_multi_agent_sessions_by_chapter',
      { input: { chapterId, limit } },
      () =>
        readLocalBundles()
          .map((bundle) => bundle.session)
          .filter((session) => session.chapterId === chapterId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, limit),
    );
    if (!Array.isArray(value)) throw new Error('Multi-Agent session 列表格式无效。');
    return value.filter(
      (item): item is MultiAgentSessionRecord =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as MultiAgentSessionRecord).sessionId === 'string',
    );
  },
};
