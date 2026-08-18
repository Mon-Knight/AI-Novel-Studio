import { isAiRequestCancelled } from '../ai/aiCancellation';
import type { ChapterDraft, CreateChapterDraftInput } from '../../types/ai';
import type {
  CollaborationRound,
  Consensus,
  ConsensusAction,
  ExpertOpinion,
  ExpertType,
  MultiAgentReviewParams,
  MultiAgentReviewResult,
  MultiAgentSessionBundle,
  MultiAgentSessionRecord,
} from '../../types/multiAgent';
import { MULTI_AGENT_EXPERT_TYPES, getExpertLabel, isExpertType } from './expertRegistry';
import type { MultiAgentProvider } from './multiAgentProvider';
import type { MultiAgentPersistence } from './multiAgentPersistence';
import { mapWithConcurrency } from '../../utils/asyncPool';

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_ACCEPTANCE_THRESHOLD = 0.7;
const DEFAULT_MINIMUM_AVERAGE_SCORE = 75;
const MAX_REVIEW_CONTENT_CHARS = 60_000;

interface DraftGateway {
  getByChapterId(chapterId: string): Promise<ChapterDraft[]>;
  create(input: CreateChapterDraftInput): Promise<ChapterDraft>;
}

export interface MultiAgentServiceDependencies {
  provider: MultiAgentProvider;
  persistence: MultiAgentPersistence;
  drafts: DraftGateway;
  generateId: () => string;
  now: () => string;
  hashContent: (content: string) => Promise<string>;
  maxConcurrentProviderCalls?: () => number;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueText(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized) seen.add(normalized.length > 500 ? normalized.slice(0, 500) : normalized);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

export function calculateConsensus(
  opinions: ExpertOpinion[],
  acceptanceThreshold: number,
  minimumAverageScore: number,
  minimumSuccessfulExperts: number,
): Consensus {
  const successful = opinions.filter((opinion) => opinion.status === 'succeeded');
  const failed = opinions.filter((opinion) => opinion.status === 'failed');
  const acceptedCount = successful.filter((opinion) => opinion.accepted).length;
  const acceptanceRate = successful.length > 0 ? acceptedCount / successful.length : 0;
  const averageScore =
    successful.length > 0
      ? successful.reduce((sum, opinion) => sum + (opinion.score ?? 0), 0) / successful.length
      : 0;
  const hasQuorum = successful.length >= minimumSuccessfulExperts;

  let action: ConsensusAction;
  if (hasQuorum && acceptanceRate >= acceptanceThreshold && averageScore >= minimumAverageScore) {
    action = 'accept';
  } else if (hasQuorum && averageScore >= 60) {
    action = 'revise';
  } else {
    action = 'regenerate';
  }

  const failureConcerns = failed.map(
    (opinion) => `${getExpertLabel(opinion.expert)}评审失败：${opinion.errorMessage || '未知错误'}`,
  );

  return {
    agreed: action === 'accept',
    acceptanceRate: rounded(acceptanceRate),
    averageScore: rounded(averageScore),
    successfulExperts: successful.length,
    failedExperts: failed.length,
    requiredSuccessfulExperts: minimumSuccessfulExperts,
    majorConcerns: uniqueText(
      [...successful.flatMap((opinion) => opinion.issues), ...failureConcerns],
      8,
    ),
    mergedSuggestions: uniqueText(
      successful.flatMap((opinion) => opinion.suggestions),
      12,
    ),
    action,
  };
}

function validateInteger(value: number, label: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min} 到 ${max} 之间的整数。`);
  }
}

function validateNumber(value: number, label: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间。`);
  }
}

function normalizeExperts(experts: ExpertType[]): ExpertType[] {
  const unique = [...new Set(experts)];
  if (unique.length === 0) throw new Error('至少选择一个专家。');
  if (unique.some((expert) => !isExpertType(expert))) throw new Error('包含不支持的专家类型。');
  return MULTI_AGENT_EXPERT_TYPES.filter((expert) => unique.includes(expert));
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function failedOpinion(
  expert: ExpertType,
  error: unknown,
  id: string,
  durationMs: number,
): ExpertOpinion {
  return {
    opinionId: id,
    expert,
    status: 'failed',
    accepted: false,
    summary: `${getExpertLabel(expert)}未能完成评审。`,
    issues: [],
    suggestions: [],
    tokensInput: 0,
    tokensOutput: 0,
    tokensUsed: 0,
    durationMs,
    errorMessage: safeErrorMessage(error),
  };
}

function terminalDuration(createdAt: string, fallbackStartedAt: number): number {
  const persistedStart = Date.parse(createdAt);
  return Math.max(
    0,
    Date.now() - (Number.isFinite(persistedStart) ? persistedStart : fallbackStartedAt),
  );
}

export class MultiAgentService {
  constructor(private readonly dependencies: MultiAgentServiceDependencies) {}

  private async findDraft(chapterId: string, draftId: string): Promise<ChapterDraft> {
    const drafts = await this.dependencies.drafts.getByChapterId(chapterId);
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error('目标草稿不存在或不属于当前章节。');
    if (draft.contentState?.status === 'unavailable') {
      throw new Error('目标草稿完整正文不可用，已阻止 Multi-Agent 评审。');
    }
    return draft;
  }

  private async resolveSourceDraft(params: MultiAgentReviewParams): Promise<{
    draft: ChapterDraft;
    content: string;
    contentHash: string;
  }> {
    const draft = await this.findDraft(params.chapterId, params.draftId);
    if (draft.novelId !== params.novelId) throw new Error('目标草稿不属于当前作品。');
    if (params.draftVersion !== undefined && draft.versionNo !== params.draftVersion) {
      throw new Error('目标草稿版本已经变化，请重新载入后再评审。');
    }
    const content = params.draftContent ?? draft.content;
    if (!content.trim()) throw new Error('空正文不能进入 Multi-Agent 评审。');
    if (content.length > MAX_REVIEW_CONTENT_CHARS) {
      throw new Error(`正文超过 ${MAX_REVIEW_CONTENT_CHARS} 字符，请拆分章节后再评审。`);
    }
    const contentHash = await this.dependencies.hashContent(content);
    if (params.contentHash && params.contentHash !== contentHash) {
      throw new Error('正文 hash 与评审请求不一致。');
    }
    return { draft, content, contentHash };
  }

  private async restoreFinalDraft(bundle: MultiAgentSessionBundle): Promise<ChapterDraft> {
    const draftId = bundle.session.finalDraftId;
    if (!draftId) throw new Error('已完成的 Multi-Agent session 缺少最终草稿。');
    return this.findDraft(bundle.session.chapterId, draftId);
  }

  async review(params: MultiAgentReviewParams): Promise<MultiAgentReviewResult> {
    const startedAt = Date.now();
    const experts = normalizeExperts(params.experts);
    const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const acceptanceThreshold = params.acceptanceThreshold ?? DEFAULT_ACCEPTANCE_THRESHOLD;
    const minimumAverageScore = params.minimumAverageScore ?? DEFAULT_MINIMUM_AVERAGE_SCORE;
    const minimumSuccessfulExperts =
      params.minimumSuccessfulExperts ?? Math.max(1, Math.ceil(experts.length * 0.67));
    validateInteger(maxRounds, '最大轮数', 1, 3);
    validateNumber(acceptanceThreshold, '接受率阈值', 0, 1);
    validateNumber(minimumAverageScore, '平均分阈值', 0, 100);
    validateInteger(minimumSuccessfulExperts, '最少成功专家数', 1, experts.length);
    if (params.signal?.aborted) throw new DOMException('评审已取消', 'AbortError');

    const source = await this.resolveSourceDraft(params);
    const operationId =
      params.operationId?.trim() || `multi-agent-${this.dependencies.generateId()}`;
    if (!operationId) throw new Error('operationId 不能为空。');
    const sessionId = this.dependencies.generateId();
    const createdAt = this.dependencies.now();
    const initialSession: MultiAgentSessionRecord = {
      sessionId,
      operationId,
      novelId: params.novelId,
      chapterId: params.chapterId,
      sourceDraftId: source.draft.id,
      sourceDraftVersion: source.draft.versionNo,
      sourceContentHash: source.contentHash,
      expertTypes: experts,
      maxRounds,
      acceptanceThreshold,
      minimumAverageScore,
      minimumSuccessfulExperts,
      status: 'running',
      currentRound: 0,
      accepted: false,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalTokensUsed: 0,
      durationMs: 0,
      createdAt,
      updatedAt: createdAt,
    };

    let bundle = await this.dependencies.persistence.createSession(initialSession);
    if (bundle.session.status === 'completed') {
      const finalDraft = await this.restoreFinalDraft(bundle);
      return {
        success: true,
        accepted: bundle.session.accepted,
        finalAction: bundle.session.finalAction ?? 'regenerate',
        finalDraft,
        session: bundle,
        totalTokensUsed: bundle.session.totalTokensUsed,
        durationMs: bundle.session.durationMs,
      };
    }
    if (bundle.session.status !== 'running') {
      throw new Error(`该 operation 已处于 ${bundle.session.status} 终态。`);
    }

    let currentDraft = source.draft;
    let currentContent = source.content;
    let currentHash = source.contentHash;
    const previousRound = bundle.rounds[bundle.rounds.length - 1];
    if (previousRound) {
      const resumeDraftId = previousRound.outputDraftId ?? previousRound.inputDraftId;
      if (resumeDraftId === source.draft.id) {
        currentDraft = source.draft;
        currentContent = source.content;
      } else {
        currentDraft = await this.findDraft(params.chapterId, resumeDraftId);
        currentContent = currentDraft.content;
      }
      currentHash =
        (previousRound.outputDraftId
          ? previousRound.outputContentHash
          : previousRound.inputContentHash) ??
        (await this.dependencies.hashContent(currentContent));
    }

    try {
      for (
        let roundNumber = bundle.rounds.length + 1;
        roundNumber <= maxRounds && previousRound?.consensus.action !== 'accept';
        roundNumber += 1
      ) {
        if (params.signal?.aborted) throw new DOMException('评审已取消', 'AbortError');
        const roundStartedAt = this.dependencies.now();
        const roundStartedMs = Date.now();
        const opinions = await mapWithConcurrency(
          experts,
          this.dependencies.maxConcurrentProviderCalls?.() ?? experts.length,
          async (expert) => {
            const expertStartedAt = Date.now();
            try {
              return await this.dependencies.provider.reviewExpert({
                expert,
                novelId: params.novelId,
                chapterId: params.chapterId,
                chapterTitle: params.chapterTitle?.trim() || '当前章节',
                chapterOutline: params.chapterOutline?.trim() || '',
                chapterGoal: params.chapterGoal?.trim() || '',
                draftContent: currentContent,
                roundNumber,
                operationId: `${operationId}-round-${roundNumber}`,
                signal: params.signal,
              });
            } catch (error) {
              if (isAiRequestCancelled(error) || params.signal?.aborted) throw error;
              return failedOpinion(
                expert,
                error,
                this.dependencies.generateId(),
                Math.max(0, Date.now() - expertStartedAt),
              );
            }
          },
        );

        const consensus = calculateConsensus(
          opinions,
          acceptanceThreshold,
          minimumAverageScore,
          minimumSuccessfulExperts,
        );
        let outputDraft: ChapterDraft | undefined;
        let outputHash: string | undefined;
        let revisionTokensInput = 0;
        let revisionTokensOutput = 0;
        let revisionTokensUsed = 0;

        if (consensus.action !== 'accept' && roundNumber < maxRounds) {
          const revision = await this.dependencies.provider.reviseDraft({
            action: consensus.action,
            novelId: params.novelId,
            chapterId: params.chapterId,
            chapterTitle: params.chapterTitle?.trim() || '当前章节',
            chapterOutline: params.chapterOutline?.trim() || '',
            chapterGoal: params.chapterGoal?.trim() || '',
            draftContent: currentContent,
            majorConcerns: consensus.majorConcerns,
            suggestions: consensus.mergedSuggestions,
            roundNumber,
            operationId,
            signal: params.signal,
          });
          const revisedHash = await this.dependencies.hashContent(revision.content);
          if (revisedHash === currentHash) throw new Error('主编 Agent 返回了未变化的候选正文。');
          outputDraft = await this.dependencies.drafts.create({
            novelId: params.novelId,
            chapterId: params.chapterId,
            title: params.chapterTitle,
            content: revision.content,
            source: 'ai_regenerated',
            operationId: `${operationId}-candidate-${roundNumber}`,
            aiTaskId: revision.aiTaskId,
            note: `Multi-Agent 第 ${roundNumber} 轮 ${consensus.action} 候选`,
          });
          outputHash = revisedHash;
          revisionTokensInput = revision.tokensInput;
          revisionTokensOutput = revision.tokensOutput;
          revisionTokensUsed = revision.tokensUsed;
        }

        const expertTokensInput = opinions.reduce((sum, opinion) => sum + opinion.tokensInput, 0);
        const expertTokensOutput = opinions.reduce((sum, opinion) => sum + opinion.tokensOutput, 0);
        const expertTokensUsed = opinions.reduce((sum, opinion) => sum + opinion.tokensUsed, 0);
        const completedAt = this.dependencies.now();
        const round: CollaborationRound = {
          roundNumber,
          inputDraftId: currentDraft.id,
          inputDraftVersion: currentDraft.versionNo,
          inputContentHash: currentHash,
          outputDraftId: outputDraft?.id,
          outputDraftVersion: outputDraft?.versionNo,
          outputContentHash: outputHash,
          expertOpinions: opinions,
          consensus,
          tokensInput: expertTokensInput + revisionTokensInput,
          tokensOutput: expertTokensOutput + revisionTokensOutput,
          tokensUsed: expertTokensUsed + revisionTokensUsed,
          durationMs: Math.max(0, Date.now() - roundStartedMs),
          startedAt: roundStartedAt,
          completedAt,
        };
        bundle = await this.dependencies.persistence.appendRound(bundle.session.sessionId, round);

        if (consensus.action === 'accept') break;
        if (outputDraft && outputHash) {
          currentDraft = outputDraft;
          currentContent = outputDraft.content;
          currentHash = outputHash;
        }
      }

      const finalRound = bundle.rounds[bundle.rounds.length - 1];
      if (!finalRound) throw new Error('Multi-Agent 未产生任何评审轮次。');
      const accepted = finalRound.consensus.action === 'accept';
      const completedAt = this.dependencies.now();
      bundle = await this.dependencies.persistence.completeSession({
        sessionId: bundle.session.sessionId,
        status: 'completed',
        accepted,
        finalAction: finalRound.consensus.action,
        finalDraftId: currentDraft.id,
        durationMs: terminalDuration(bundle.session.createdAt, startedAt),
        completedAt,
      });
      return {
        success: true,
        accepted,
        finalAction: finalRound.consensus.action,
        finalDraft: currentDraft,
        session: bundle,
        totalTokensUsed: bundle.session.totalTokensUsed,
        durationMs: bundle.session.durationMs,
      };
    } catch (error) {
      const cancelled = isAiRequestCancelled(error) || params.signal?.aborted;
      await this.dependencies.persistence
        .completeSession({
          sessionId: bundle.session.sessionId,
          status: cancelled ? 'cancelled' : 'failed',
          accepted: false,
          finalDraftId: currentDraft.id,
          durationMs: terminalDuration(bundle.session.createdAt, startedAt),
          errorMessage: cancelled ? undefined : safeErrorMessage(error),
          completedAt: this.dependencies.now(),
        })
        .catch(() => undefined);
      throw error;
    }
  }

  getSession(sessionId: string): Promise<MultiAgentSessionBundle | null> {
    return this.dependencies.persistence.getSession(sessionId);
  }

  listSessionsByChapter(chapterId: string, limit = 20): Promise<MultiAgentSessionRecord[]> {
    return this.dependencies.persistence.listSessionsByChapter(chapterId, limit);
  }
}
