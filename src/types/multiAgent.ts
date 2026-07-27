/**
 * Multi-Agent Collaboration System Types
 *
 * 多智能体协作系统，用于章节内容的多维度评审和迭代改进。
 */

export type ExpertType =
  | 'outline'     // 大纲专家：情节结构、起承转合
  | 'character'   // 角色专家：人物动机、性格一致性
  | 'setting'     // 设定专家：世界观规则、场景细节
  | 'logic'       // 逻辑专家：因果关系、时间线
  | 'polish'      // 润色专家：语言、节奏、文风
  | 'quality';    // 质量专家：整体可读性、完成度

export interface ExpertOpinion {
  expert: ExpertType;
  score: number;                  // 0-100 评分
  issues: string[];               // 发现的问题列表
  suggestions: string[];          // 改进建议
  tokensUsed: number;
  durationMs: number;
}

export interface Consensus {
  agreed: boolean;                // 是否达成共识
  acceptanceRate: number;         // 接受率 (0-1)
  averageScore: number;           // 平均评分
  majorConcerns: string[];        // 主要关注点
  action: 'accept' | 'revise' | 'regenerate';
}

export interface CollaborationRound {
  roundNumber: number;
  expertOpinions: ExpertOpinion[];
  consensus: Consensus;
  draftId: string;                // 本轮评审的草稿 ID
}

export interface MultiAgentReviewParams {
  novelId: string;
  chapterId: string;
  draftId: string;
  experts: ExpertType[];          // 参与的专家类型
  maxRounds?: number;             // 最大轮数（默认 3）
  acceptanceThreshold?: number;   // 接受阈值（默认 0.7）
  operationId?: string;
}

export interface MultiAgentReviewResult {
  success: boolean;
  finalDraftId: string;           // 最终草稿 ID
  rounds: CollaborationRound[];
  totalTokensUsed: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ExpertCollaborationLog {
  id: string;
  novelId: string;
  chapterId: string;
  draftId: string;
  roundNumber: number;
  expertType: ExpertType;
  score: number;
  issues: string;                 // JSON 字符串
  suggestions: string;            // JSON 字符串
  tokensUsed: number;
  operationId: string;
  createdAt: string;
}
