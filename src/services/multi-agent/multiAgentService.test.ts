import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChapterDraft, CreateChapterDraftInput } from '../../types/ai';
import type {
  CollaborationRound,
  DraftRevisionRequest,
  DraftRevisionResult,
  ExpertOpinion,
  ExpertReviewRequest,
  ExpertType,
  MultiAgentSessionBundle,
  MultiAgentSessionRecord,
} from '../../types/multiAgent';
import {
  MultiAgentService,
  calculateConsensus,
  type MultiAgentServiceDependencies,
} from './multiAgentService';
import type { MultiAgentProvider } from './multiAgentProvider';
import type {
  CompleteMultiAgentSessionInput,
  MultiAgentPersistence,
} from './multiAgentPersistence';
import { parseExpertOpinion } from './multiAgentOpinionParser';

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function draft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    id: 'draft-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    title: '第一章',
    content: '原始章节正文。',
    source: 'user_edited',
    versionNo: 1,
    wordCount: 7,
    isAdopted: false,
    contentState: {
      status: 'ready',
      content: '原始章节正文。',
      contentHash: hash('原始章节正文。'),
      contentLength: '原始章节正文。'.length,
    },
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function opinion(expert: ExpertType, score: number, accepted = score >= 75): ExpertOpinion {
  return {
    opinionId: `opinion-${expert}`,
    expert,
    status: 'succeeded',
    score,
    accepted,
    summary: `${expert} summary`,
    issues: accepted ? [] : [`${expert} issue`],
    suggestions: accepted ? [] : [`${expert} suggestion`],
    provider: 'test',
    model: 'test-model',
    tokensInput: 10,
    tokensOutput: 5,
    tokensUsed: 15,
    durationMs: 1,
  };
}

class MemoryPersistence implements MultiAgentPersistence {
  bundle?: MultiAgentSessionBundle;
  completions: CompleteMultiAgentSessionInput[] = [];

  async createSession(session: MultiAgentSessionRecord): Promise<MultiAgentSessionBundle> {
    if (this.bundle) {
      assert.equal(this.bundle.session.operationId, session.operationId);
      return this.bundle;
    }
    this.bundle = { session, rounds: [] };
    return this.bundle;
  }

  async appendRound(
    _sessionId: string,
    round: CollaborationRound,
  ): Promise<MultiAgentSessionBundle> {
    assert.ok(this.bundle);
    this.bundle = {
      session: {
        ...this.bundle.session,
        currentRound: round.roundNumber,
        totalTokensInput: this.bundle.session.totalTokensInput + round.tokensInput,
        totalTokensOutput: this.bundle.session.totalTokensOutput + round.tokensOutput,
        totalTokensUsed: this.bundle.session.totalTokensUsed + round.tokensUsed,
      },
      rounds: [...this.bundle.rounds, round],
    };
    return this.bundle;
  }

  async completeSession(input: CompleteMultiAgentSessionInput): Promise<MultiAgentSessionBundle> {
    assert.ok(this.bundle);
    this.completions.push(input);
    this.bundle = {
      session: {
        ...this.bundle.session,
        status: input.status,
        accepted: input.accepted,
        finalAction: input.finalAction,
        finalDraftId: input.finalDraftId,
        durationMs: input.durationMs,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt,
      },
      rounds: this.bundle.rounds,
    };
    return this.bundle;
  }

  async getSession(sessionId: string): Promise<MultiAgentSessionBundle | null> {
    return this.bundle?.session.sessionId === sessionId ? this.bundle : null;
  }

  async listSessionsByChapter(chapterId: string): Promise<MultiAgentSessionRecord[]> {
    return this.bundle?.session.chapterId === chapterId ? [this.bundle.session] : [];
  }
}

class MemoryDrafts {
  readonly items: ChapterDraft[] = [draft()];
  readonly creates: CreateChapterDraftInput[] = [];

  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    return this.items.filter((item) => item.chapterId === chapterId);
  }

  async create(input: CreateChapterDraftInput): Promise<ChapterDraft> {
    this.creates.push(input);
    const created = draft({
      id: `draft-${this.items.length + 1}`,
      content: input.content,
      source: input.source,
      versionNo: this.items.length + 1,
      aiTaskId: input.aiTaskId,
      note: input.note,
      contentState: {
        status: 'ready',
        content: input.content,
        contentHash: hash(input.content),
        contentLength: input.content.length,
      },
    });
    this.items.push(created);
    return created;
  }
}

class ScriptedProvider implements MultiAgentProvider {
  reviewCalls: ExpertReviewRequest[] = [];
  revisionCalls: DraftRevisionRequest[] = [];
  review: (input: ExpertReviewRequest) => Promise<ExpertOpinion> = async (input) =>
    opinion(input.expert, 85);
  revision: (input: DraftRevisionRequest) => Promise<DraftRevisionResult> = async (input) => ({
    content: `${input.draftContent}\n修订内容`,
    provider: 'test',
    model: 'test-model',
    aiTaskId: `revision-${input.roundNumber}`,
    tokensInput: 20,
    tokensOutput: 30,
    tokensUsed: 50,
    durationMs: 2,
  });

  async reviewExpert(input: ExpertReviewRequest): Promise<ExpertOpinion> {
    this.reviewCalls.push(input);
    return this.review(input);
  }

  async reviseDraft(input: DraftRevisionRequest): Promise<DraftRevisionResult> {
    this.revisionCalls.push(input);
    return this.revision(input);
  }
}

function harness(provider = new ScriptedProvider()) {
  const persistence = new MemoryPersistence();
  const drafts = new MemoryDrafts();
  let id = 0;
  let clock = 0;
  const dependencies: MultiAgentServiceDependencies = {
    provider,
    persistence,
    drafts,
    generateId: () => `id-${++id}`,
    now: () => new Date(Date.UTC(2026, 6, 27, 0, 0, clock++)).toISOString(),
    hashContent: async (content) => hash(content),
  };
  return {
    service: new MultiAgentService(dependencies),
    provider,
    persistence,
    drafts,
  };
}

const baseRequest = {
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  draftId: 'draft-1',
  draftVersion: 1,
  chapterTitle: '第一章',
  experts: ['outline', 'character', 'quality'] as ExpertType[],
  operationId: 'operation-1',
};

describe('calculateConsensus', () => {
  it('按 quorum、接受率和平均分区分 accept/revise/regenerate', () => {
    const accepted = calculateConsensus(
      [opinion('outline', 82), opinion('character', 80), opinion('quality', 86)],
      0.7,
      75,
      2,
    );
    assert.equal(accepted.action, 'accept');
    assert.equal(accepted.agreed, true);

    const revise = calculateConsensus(
      [opinion('outline', 72, true), opinion('character', 68, false)],
      0.7,
      75,
      2,
    );
    assert.equal(revise.action, 'revise');

    const regenerate = calculateConsensus(
      [
        opinion('outline', 90),
        { ...opinion('character', 0, false), status: 'failed', score: undefined },
      ],
      0.5,
      75,
      2,
    );
    assert.equal(regenerate.action, 'regenerate');
    assert.equal(regenerate.failedExperts, 1);
  });
});

describe('parseExpertOpinion', () => {
  it('解析代码围栏 JSON 并清理重复建议', () => {
    const parsed = parseExpertOpinion(`\n\`\`\`json\n{
      "score": 81.6,
      "accepted": true,
      "summary": "  可以进入审核。  ",
      "issues": [],
      "suggestions": ["加强结尾", "加强结尾"]
    }\n\`\`\``);
    assert.equal(parsed.score, 82);
    assert.equal(parsed.summary, '可以进入审核。');
    assert.deepEqual(parsed.suggestions, ['加强结尾']);
  });

  it('拒绝缺失布尔 verdict 或越界评分', () => {
    assert.throws(
      () => parseExpertOpinion('{"score":101,"accepted":true,"summary":"x"}'),
      /0 到 100/,
    );
    assert.throws(() => parseExpertOpinion('{"score":80,"summary":"x"}'), /布尔值/);
  });
});

describe('MultiAgentService', () => {
  it('在同一轮启动全部专家并行评审', async () => {
    const provider = new ScriptedProvider();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.review = async (input) => {
      await gate;
      return opinion(input.expert, 85);
    };
    const { service } = harness(provider);
    const running = service.review(baseRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(provider.reviewCalls.length, 3);
    release();
    const result = await running;
    assert.equal(result.accepted, true);
    assert.equal(result.session.rounds.length, 1);
  });

  it('单个专家失败时保留其他意见并按 quorum 决策', async () => {
    const provider = new ScriptedProvider();
    provider.review = async (input) => {
      if (input.expert === 'character') throw new Error('provider unavailable');
      return opinion(input.expert, 84);
    };
    const { service } = harness(provider);
    const result = await service.review({ ...baseRequest, minimumSuccessfulExperts: 2 });
    assert.equal(result.accepted, true);
    assert.equal(result.session.rounds[0].consensus.failedExperts, 1);
    assert.equal(
      result.session.rounds[0].expertOpinions.find((item) => item.expert === 'character')?.status,
      'failed',
    );
  });

  it('revise 会创建候选草稿并让下一轮评审新正文', async () => {
    const provider = new ScriptedProvider();
    provider.review = async (input) =>
      input.roundNumber === 1 ? opinion(input.expert, 68, false) : opinion(input.expert, 86, true);
    const { service, drafts } = harness(provider);
    const result = await service.review(baseRequest);

    assert.equal(provider.revisionCalls.length, 1);
    assert.equal(provider.revisionCalls[0].action, 'revise');
    assert.equal(drafts.creates.length, 1);
    assert.equal(result.finalDraft.id, 'draft-2');
    assert.equal(result.accepted, true);
    assert.equal(result.session.rounds.length, 2);
    assert.match(
      provider.reviewCalls.find((call) => call.roundNumber === 2)?.draftContent ?? '',
      /修订内容/,
    );
  });

  it('低分共识执行 regenerate 而不是假装修订', async () => {
    const provider = new ScriptedProvider();
    provider.review = async (input) =>
      input.roundNumber === 1 ? opinion(input.expert, 42, false) : opinion(input.expert, 82, true);
    const { service } = harness(provider);
    const result = await service.review(baseRequest);
    assert.equal(provider.revisionCalls[0].action, 'regenerate');
    assert.equal(result.session.rounds[0].consensus.action, 'regenerate');
    assert.equal(result.accepted, true);
  });

  it('达到最大轮数后明确返回未接受，不创建无评审候选', async () => {
    const provider = new ScriptedProvider();
    provider.review = async (input) => opinion(input.expert, 68, false);
    const { service, drafts } = harness(provider);
    const result = await service.review({ ...baseRequest, maxRounds: 1 });
    assert.equal(result.success, true);
    assert.equal(result.accepted, false);
    assert.equal(result.finalAction, 'revise');
    assert.equal(drafts.creates.length, 0);
    assert.equal(result.session.session.status, 'completed');
  });

  it('拒绝空专家、非法轮数、空正文和过期草稿版本', async () => {
    const { service, drafts } = harness();
    await assert.rejects(() => service.review({ ...baseRequest, experts: [] }), /至少选择一个专家/);
    await assert.rejects(() => service.review({ ...baseRequest, maxRounds: 0 }), /最大轮数/);
    await assert.rejects(() => service.review({ ...baseRequest, draftContent: '  ' }), /空正文/);
    await assert.rejects(
      () => service.review({ ...baseRequest, draftVersion: 99 }),
      /版本已经变化/,
    );
    assert.equal(drafts.creates.length, 0);
  });

  it('取消会持久化 cancelled 终态并向调用方传播', async () => {
    const provider = new ScriptedProvider();
    const controller = new AbortController();
    provider.review = async () => {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    };
    const { service, persistence } = harness(provider);
    await assert.rejects(
      () => service.review({ ...baseRequest, signal: controller.signal }),
      /cancelled/,
    );
    assert.equal(persistence.completions[persistence.completions.length - 1]?.status, 'cancelled');
  });

  it('相同已完成 operation 直接重放，不重复调用专家', async () => {
    const provider = new ScriptedProvider();
    const { service } = harness(provider);
    const first = await service.review(baseRequest);
    const callCount = provider.reviewCalls.length;
    const replay = await service.review(baseRequest);
    assert.equal(replay.session.session.sessionId, first.session.session.sessionId);
    assert.equal(provider.reviewCalls.length, callCount);
  });

  it('从已持久化的接受轮次恢复时保留该轮实际输入草稿', async () => {
    const provider = new ScriptedProvider();
    const { service, persistence, drafts } = harness(provider);
    const candidate = draft({
      id: 'draft-2',
      content: '已评审候选正文。',
      versionNo: 2,
      contentState: {
        status: 'ready',
        content: '已评审候选正文。',
        contentHash: hash('已评审候选正文。'),
        contentLength: '已评审候选正文。'.length,
      },
    });
    drafts.items.push(candidate);
    const revisionOpinions = baseRequest.experts.map((expert) => opinion(expert, 68, false));
    const revisionConsensus = calculateConsensus(revisionOpinions, 0.7, 75, 3);
    const acceptedOpinions = baseRequest.experts.map((expert) => ({
      ...opinion(expert, 85, true),
      opinionId: 'opinion-' + expert + '-round-2',
    }));
    const acceptedConsensus = calculateConsensus(acceptedOpinions, 0.7, 75, 3);
    persistence.bundle = {
      session: {
        sessionId: 'session-interrupted',
        operationId: baseRequest.operationId,
        novelId: baseRequest.novelId,
        chapterId: baseRequest.chapterId,
        sourceDraftId: baseRequest.draftId,
        sourceDraftVersion: 1,
        sourceContentHash: hash('原始章节正文。'),
        expertTypes: baseRequest.experts,
        maxRounds: 3,
        acceptanceThreshold: 0.7,
        minimumAverageScore: 75,
        minimumSuccessfulExperts: 3,
        status: 'running',
        currentRound: 2,
        accepted: false,
        totalTokensInput: 60,
        totalTokensOutput: 30,
        totalTokensUsed: 90,
        durationMs: 0,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:02.000Z',
      },
      rounds: [
        {
          roundNumber: 1,
          inputDraftId: baseRequest.draftId,
          inputDraftVersion: 1,
          inputContentHash: hash('原始章节正文。'),
          outputDraftId: candidate.id,
          outputDraftVersion: candidate.versionNo,
          outputContentHash: hash(candidate.content),
          expertOpinions: revisionOpinions,
          consensus: revisionConsensus,
          tokensInput: 30,
          tokensOutput: 15,
          tokensUsed: 45,
          durationMs: 10,
          startedAt: '2026-07-27T00:00:00.000Z',
          completedAt: '2026-07-27T00:00:01.000Z',
        },
        {
          roundNumber: 2,
          inputDraftId: candidate.id,
          inputDraftVersion: candidate.versionNo,
          inputContentHash: hash(candidate.content),
          expertOpinions: acceptedOpinions,
          consensus: acceptedConsensus,
          tokensInput: 30,
          tokensOutput: 15,
          tokensUsed: 45,
          durationMs: 10,
          startedAt: '2026-07-27T00:00:01.000Z',
          completedAt: '2026-07-27T00:00:02.000Z',
        },
      ],
    };

    const result = await service.review(baseRequest);

    assert.equal(provider.reviewCalls.length, 0);
    assert.equal(result.accepted, true);
    assert.equal(result.finalDraft.id, candidate.id);
    assert.equal(result.session.session.finalDraftId, candidate.id);
  });
});
