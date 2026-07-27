import { dbCall } from '../database/db';
import { draftVersionService } from '../database/draftVersionService';
import { runAutonomousProvider } from './autonomousProvider';

export type ExpertType = 'outline' | 'character' | 'setting' | 'logic' | 'polish' | 'quality';

export interface ExpertOpinion {
  expert: ExpertType;
  score: number;
  issues: string[];
  suggestions: string[];
  tokensUsed?: number;
  tokenInput?: number;
  tokenOutput?: number;
}

export interface Consensus {
  agreed: boolean;
  acceptanceRate: number;
  averageScore: number;
  majorConcerns: string[];
  action: 'accept' | 'revise' | 'regenerate';
}

export interface CollaborationRound {
  roundNumber: number;
  expertOpinions: ExpertOpinion[];
  consensus: Consensus;
}

export interface CollaborationResult {
  success: boolean;
  finalDraftId: string | null;
  rounds: CollaborationRound[];
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ReviewParams {
  novelId: string;
  chapterId: string;
  draftId: string;
  experts: ExpertType[];
  operationId?: string;
  signal?: AbortSignal;
}

const EXPERT_BRIEFS: Record<ExpertType, string> = {
  outline: '检查情节结构、起承转合、伏笔和章节目标。',
  character: '检查人物动机、性格一致性、对话和情感变化。',
  setting: '检查世界观规则、场景细节和设定一致性。',
  logic: '检查因果关系、时间线和行动合理性。',
  polish: '检查语言、节奏、文风和表达清晰度。',
  quality: '从整体可读性、完成度和发表标准进行综合评估。',
};

export class ExpertAgentSystem {
  async collaborativeReview(params: ReviewParams): Promise<CollaborationResult> {
    const startTime = Date.now();
    const rounds: CollaborationRound[] = [];
    let currentDraftId = params.draftId;
    let tokensUsed = 0;
    let tokenInput = 0;
    let tokenOutput = 0;
    const operationId = params.operationId ?? `expert:${params.draftId}`;
    try {
      for (let round = 1; round <= 3; round += 1) {
        const opinions = await this._parallelReview(
          params.experts,
          params.novelId,
          currentDraftId,
          params.chapterId,
          `${operationId}:round:${round}`,
          params.signal,
        );
        tokensUsed += opinions.reduce((sum, opinion) => sum + (opinion.tokensUsed ?? 0), 0);
        tokenInput += opinions.reduce((sum, opinion) => sum + (opinion.tokenInput ?? 0), 0);
        tokenOutput += opinions.reduce((sum, opinion) => sum + (opinion.tokenOutput ?? 0), 0);
        const consensus = this._calculateConsensus(opinions);
        rounds.push({ roundNumber: round, expertOpinions: opinions, consensus });
        await this._saveCollaborationLogs({
          novelId: params.novelId,
          chapterId: params.chapterId,
          draftId: currentDraftId,
          roundNumber: round,
          expertOpinions: opinions,
          operationId,
        });
        if (consensus.action === 'accept') {
          return {
            success: true,
            finalDraftId: currentDraftId,
            rounds,
            tokensUsed,
            tokenInput,
            tokenOutput,
            durationMs: Date.now() - startTime,
          };
        }
        if (round < 3) {
          const revised = await this._reviseDraft({
            novelId: params.novelId,
            chapterId: params.chapterId,
            draftId: currentDraftId,
            action: consensus.action,
            opinions,
            operationId: `${operationId}:round:${round}:${consensus.action}`,
            signal: params.signal,
          });
          currentDraftId = revised.draftId;
          tokensUsed += revised.tokensUsed;
          tokenInput += revised.tokenInput;
          tokenOutput += revised.tokenOutput;
        }
      }
      return {
        success: false,
        finalDraftId: null,
        rounds,
        tokensUsed,
        tokenInput,
        tokenOutput,
        durationMs: Date.now() - startTime,
        errorMessage: '专家协作未在三轮内达成共识',
      };
    } catch (error) {
      return {
        success: false,
        finalDraftId: null,
        rounds,
        tokensUsed,
        tokenInput,
        tokenOutput,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async _parallelReview(
    experts: ExpertType[],
    novelId: string,
    draftId: string,
    chapterId: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<ExpertOpinion[]> {
    return Promise.all(experts.map((expert) => this._callExpertAgent(
      expert,
      novelId,
      draftId,
      chapterId,
      `${operationId}:${expert}`,
      signal,
    )));
  }

  private async _callExpertAgent(
    expert: ExpertType,
    novelId: string,
    draftId: string,
    chapterId: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<ExpertOpinion> {
    const drafts = await draftVersionService.getByChapterId(chapterId).catch(() => []);
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);
    const generated = await runAutonomousProvider({
      taskType: 'expert_review',
      novelId,
      chapterId,
      draftId,
      operationId,
      inputSummary: `${expert} 专家评审草稿 ${draftId}`,
      systemPrompt: `你是${expert}专家。${EXPERT_BRIEFS[expert]}请严格返回 JSON。`,
      userPrompt: [
        EXPERT_BRIEFS[expert],
        'JSON schema: {"score": number, "issues": string[], "suggestions": string[]}',
        `正文：\n${draft.content.slice(0, 24000)}`,
      ].join('\n\n'),
      maxTokens: 1800,
      signal,
    });
    const payload = generated.structured as Record<string, unknown> | undefined;
    const scoreValue = Number(payload?.score ?? 0);
    return {
      expert,
      score: Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : 0,
      issues: this._stringArray(payload?.issues),
      suggestions: this._stringArray(payload?.suggestions),
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
    };
  }

  private async _reviseDraft(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    action: 'revise' | 'regenerate';
    opinions: ExpertOpinion[];
    operationId: string;
    signal?: AbortSignal;
  }): Promise<{ draftId: string; tokensUsed: number; tokenInput: number; tokenOutput: number }> {
    const drafts = await draftVersionService.getByChapterId(params.chapterId);
    const draft = drafts.find((item) => item.id === params.draftId);
    if (!draft) throw new Error(`Draft ${params.draftId} not found`);
    const concerns = params.opinions.flatMap((opinion) => [
      ...opinion.issues.map((issue) => `${opinion.expert}问题：${issue}`),
      ...opinion.suggestions.map((suggestion) => `${opinion.expert}建议：${suggestion}`),
    ]);
    const regenerate = params.action === 'regenerate';
    const generated = await runAutonomousProvider({
      taskType: regenerate ? 'chapter_rewrite' : 'chapter_polish',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      operationId: params.operationId,
      inputSummary: `专家共识${regenerate ? '重写' : '修订'}草稿 ${params.draftId}`,
      systemPrompt: regenerate
        ? '你是小说主笔。依据专家意见完整重写正文，保持章节大纲、角色身份和世界规则，只返回完整正文。'
        : '你是小说修订编辑。依据专家意见修订正文，保留正确情节和事实，只返回完整正文。',
      userPrompt: [
        '专家意见：',
        ...(concerns.length > 0 ? concerns : ['专家要求提高整体完成度和一致性。']),
        '',
        '待处理正文：',
        draft.content.slice(0, 30000),
      ].join('\n'),
      maxTokens: 12000,
      signal: params.signal,
    });
    const content = generated.text
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!content) throw new Error('专家修订返回空正文');
    const nextDraft = await draftVersionService.create({
      novelId: params.novelId,
      chapterId: params.chapterId,
      content,
      source: regenerate ? 'ai_regenerated' : 'ai_polished',
      operationId: params.operationId,
      aiTaskId: generated.taskId,
      note: `Expert consensus ${params.action} from ${params.draftId}`,
    });
    return {
      draftId: nextDraft.id,
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
    };
  }

  private _stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  }

  private _calculateConsensus(opinions: ExpertOpinion[]): Consensus {
    if (opinions.length === 0) {
      return { agreed: false, acceptanceRate: 0, averageScore: 0, majorConcerns: [], action: 'regenerate' };
    }
    const scores = opinions.map((opinion) => opinion.score);
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const acceptanceRate = scores.filter((score) => score >= 70).length / scores.length;
    const counts = new Map<string, number>();
    opinions.flatMap((opinion) => opinion.issues).forEach((issue) => counts.set(issue, (counts.get(issue) ?? 0) + 1));
    const majorConcerns = [...counts.entries()].filter(([, count]) => count >= 2).map(([issue]) => issue);
    const action = acceptanceRate >= 0.7 && averageScore >= 75
      ? 'accept'
      : acceptanceRate >= 0.5 || averageScore >= 60 ? 'revise' : 'regenerate';
    return { agreed: action === 'accept', acceptanceRate, averageScore, majorConcerns, action };
  }

  private async _saveCollaborationLogs(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    roundNumber: number;
    expertOpinions: ExpertOpinion[];
    operationId: string;
  }): Promise<void> {
    const createdAt = new Date().toISOString();
    await Promise.all(params.expertOpinions.map((opinion) => dbCall('create_expert_collaboration_log', {
      input: {
        id: `${params.operationId}:${params.roundNumber}:${opinion.expert}`,
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.draftId,
        roundNumber: params.roundNumber,
        expertType: opinion.expert,
        score: opinion.score,
        issuesJson: JSON.stringify(opinion.issues),
        suggestionsJson: JSON.stringify(opinion.suggestions),
        operationId: params.operationId,
        createdAt,
      },
    })));
  }
}

export const expertAgentSystem = new ExpertAgentSystem();
