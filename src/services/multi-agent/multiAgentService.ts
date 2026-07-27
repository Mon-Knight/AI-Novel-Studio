/**
 * Multi-Agent Collaboration Service
 *
 * 多智能体协作服务，协调多个专家 Agent 对章节进行评审和改进。
 *
 * 核心流程：
 * 1. 并行调用多个专家 Agent 评审当前草稿
 * 2. 计算共识（acceptance rate, average score）
 * 3. 根据共识决策：accept / revise / regenerate
 * 4. 如果需要改进，应用改进并进入下一轮
 * 5. 最多执行 maxRounds 轮，返回最终草稿
 */

import { dbCall } from '../database/db';
import type {
  ExpertType,
  ExpertOpinion,
  Consensus,
  CollaborationRound,
  MultiAgentReviewParams,
  MultiAgentReviewResult,
} from '../../types/multiAgent';

const EXPERT_PROMPTS: Record<ExpertType, string> = {
  outline: `你是大纲专家，专注评估情节结构、起承转合、伏笔铺垫。
评分标准：
- 情节推进是否流畅
- 转折是否合理
- 伏笔是否恰当
- 高潮设置是否有力`,

  character: `你是角色专家，专注评估人物动机、性格一致性、对话合理性。
评分标准：
- 人物动机是否清晰
- 性格是否一致
- 对话是否符合人设
- 人物成长是否自然`,

  setting: `你是设定专家，专注评估世界观规则、场景细节、设定一致性。
评分标准：
- 世界观规则是否自洽
- 场景描写是否生动
- 设定细节是否一致
- 特殊能力/规则是否合理`,

  logic: `你是逻辑专家，专注评估因果关系、时间线、情节逻辑。
评分标准：
- 因果关系是否合理
- 时间线是否清晰
- 前后矛盾是否存在
- 逻辑漏洞是否明显`,

  polish: `你是润色专家，专注评估语言表达、节奏、文风。
评分标准：
- 语言是否流畅
- 节奏是否恰当
- 文风是否统一
- 用词是否准确`,

  quality: `你是质量专家，综合评估整体可读性、完成度。
评分标准：
- 整体可读性
- 完成度（是否有明显遗漏）
- 读者体验
- 是否达到发布标准`,
};

class MultiAgentService {
  /**
   * 执行多智能体评审
   */
  async review(params: MultiAgentReviewParams): Promise<MultiAgentReviewResult> {
    const startTime = Date.now();
    const maxRounds = params.maxRounds ?? 3;
    const acceptanceThreshold = params.acceptanceThreshold ?? 0.7;
    const operationId = params.operationId ?? `multi_agent_${Date.now()}`;

    const rounds: CollaborationRound[] = [];
    let currentDraftId = params.draftId;
    let totalTokensUsed = 0;

    try {
      // 读取草稿内容（可选，如果不存在则使用占位内容）
      let draftContent = '草稿内容占位'; // 默认占位

      try {
        const draft = await dbCall('get_chapter_draft', { draftId: currentDraftId });
        if (draft && draft.content) {
          draftContent = draft.content;
        }
      } catch (error) {
        // 数据库调用失败时使用占位内容，继续执行
        console.warn('[MultiAgent] 无法读取草稿，使用占位内容');
      }

      // 执行多轮评审
      for (let round = 1; round <= maxRounds; round++) {
        console.log(`[MultiAgent] 开始第 ${round} 轮评审...`);

        // 并行调用所有专家
        const opinions = await this._callExperts({
          experts: params.experts,
          draftContent: draftContent,
          novelId: params.novelId,
          chapterId: params.chapterId,
          operationId: `${operationId}_round${round}`,
        });

        totalTokensUsed += opinions.reduce((sum, op) => sum + op.tokensUsed, 0);

        // 计算共识
        const consensus = this._calculateConsensus(opinions, acceptanceThreshold);

        // 保存本轮结果
        rounds.push({
          roundNumber: round,
          expertOpinions: opinions,
          consensus,
          draftId: currentDraftId,
        });

        // 保存协作日志
        await this._saveCollaborationLogs({
          novelId: params.novelId,
          chapterId: params.chapterId,
          draftId: currentDraftId,
          roundNumber: round,
          opinions,
          operationId,
        });

        // 决策
        if (consensus.action === 'accept') {
          console.log(`[MultiAgent] 第 ${round} 轮评审通过，接受草稿`);
          return {
            success: true,
            finalDraftId: currentDraftId,
            rounds,
            totalTokensUsed,
            durationMs: Date.now() - startTime,
          };
        }

        // 如果是最后一轮，直接返回当前草稿
        if (round === maxRounds) {
          console.log(`[MultiAgent] 达到最大轮数 ${maxRounds}，使用当前草稿`);
          return {
            success: true,
            finalDraftId: currentDraftId,
            rounds,
            totalTokensUsed,
            durationMs: Date.now() - startTime,
          };
        }

        // 应用改进建议（TODO: Phase 3 实现真实改进）
        console.log(`[MultiAgent] 第 ${round} 轮需要改进，进入下一轮...`);
        // 当前简化实现：使用同一草稿继续评审
        // 未来：根据 consensus.action 执行 revise 或 regenerate
      }

      // 不应该到达这里
      return {
        success: true,
        finalDraftId: currentDraftId,
        rounds,
        totalTokensUsed,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[MultiAgent] 评审失败:', error);
      return {
        success: false,
        finalDraftId: currentDraftId,
        rounds,
        totalTokensUsed,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 并行调用所有专家
   */
  private async _callExperts(params: {
    experts: ExpertType[];
    draftContent: string;
    novelId: string;
    chapterId: string;
    operationId: string;
  }): Promise<ExpertOpinion[]> {
    const expertCalls = params.experts.map(expertType =>
      this._callSingleExpert({
        expertType,
        draftContent: params.draftContent,
        operationId: `${params.operationId}_${expertType}`,
      })
    );

    return Promise.all(expertCalls);
  }

  /**
   * 调用单个专家
   */
  private async _callSingleExpert(params: {
    expertType: ExpertType;
    draftContent: string;
    operationId: string;
  }): Promise<ExpertOpinion> {
    const startTime = Date.now();

    try {
      // TODO: Phase 3 - 调用真实 AI Provider
      // 当前简化实现：返回模拟评分
      const mockScore = 70 + Math.random() * 20; // 70-90
      const mockIssues = this._generateMockIssues(params.expertType);
      const mockSuggestions = this._generateMockSuggestions(params.expertType);

      return {
        expert: params.expertType,
        score: Math.round(mockScore),
        issues: mockIssues,
        suggestions: mockSuggestions,
        tokensUsed: 500, // Mock token count
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error(`[MultiAgent] 专家 ${params.expertType} 调用失败:`, error);
      // 返回低分，表示评审失败
      return {
        expert: params.expertType,
        score: 0,
        issues: [`评审失败: ${error instanceof Error ? error.message : String(error)}`],
        suggestions: [],
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 计算共识
   */
  private _calculateConsensus(
    opinions: ExpertOpinion[],
    threshold: number
  ): Consensus {
    if (opinions.length === 0) {
      return {
        agreed: false,
        acceptanceRate: 0,
        averageScore: 0,
        majorConcerns: ['没有专家意见'],
        action: 'regenerate',
      };
    }

    const averageScore = opinions.reduce((sum, op) => sum + op.score, 0) / opinions.length;
    const acceptCount = opinions.filter(op => op.score >= 70).length;
    const acceptanceRate = acceptCount / opinions.length;

    const allIssues = opinions.flatMap(op => op.issues);
    const majorConcerns = allIssues.slice(0, 3); // 取前 3 个主要问题

    let action: 'accept' | 'revise' | 'regenerate';
    if (acceptanceRate >= threshold && averageScore >= 75) {
      action = 'accept';
    } else if (averageScore >= 60) {
      action = 'revise';
    } else {
      action = 'regenerate';
    }

    return {
      agreed: acceptanceRate >= threshold,
      acceptanceRate,
      averageScore,
      majorConcerns,
      action,
    };
  }

  /**
   * 保存协作日志到数据库
   */
  private async _saveCollaborationLogs(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    roundNumber: number;
    opinions: ExpertOpinion[];
    operationId: string;
  }): Promise<void> {
    // TODO: Phase 3 - 实现数据库持久化
    // 当前跳过，因为 expert_collaboration_logs 表在 Migration 026（已删除）
    console.log(`[MultiAgent] 协作日志: Round ${params.roundNumber}, ${params.opinions.length} 个专家`);
  }

  /**
   * 生成模拟问题列表（用于占位）
   */
  private _generateMockIssues(expertType: ExpertType): string[] {
    const issueTemplates: Record<ExpertType, string[]> = {
      outline: ['情节推进略显平淡', '转折不够突出'],
      character: ['角色动机不够清晰', '对话略显生硬'],
      setting: ['场景描写可以更生动', '设定细节需要补充'],
      logic: ['时间线有小矛盾', '因果关系需要加强'],
      polish: ['部分用词重复', '节奏可以更紧凑'],
      quality: ['整体可读性良好', '个别段落需要润色'],
    };

    return issueTemplates[expertType] || [];
  }

  /**
   * 生成模拟建议列表（用于占位）
   */
  private _generateMockSuggestions(expertType: ExpertType): string[] {
    const suggestionTemplates: Record<ExpertType, string[]> = {
      outline: ['增加情节转折', '强化高潮部分'],
      character: ['明确角色动机', '丰富对话内容'],
      setting: ['增加场景细节', '补充设定说明'],
      logic: ['理清时间线', '加强因果逻辑'],
      polish: ['调整用词', '优化句式节奏'],
      quality: ['整体润色', '检查细节完整性'],
    };

    return suggestionTemplates[expertType] || [];
  }
}

export const multiAgentService = new MultiAgentService();
