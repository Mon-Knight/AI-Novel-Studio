/**
 * Creative Agent - Tool Selection Evaluator
 * 评估 Agent 工具选择准确性、冗余度与缺失度
 */
import type { ToolSelectionScore } from '../../types/agentHarness';

export interface EvaluateSelectionInput {
  userGoal: string;
  selectedTool: string;
  availableTools?: string[];
  completedTools?: string[];
}

export class ToolSelectionEvaluator {
  /**
   * 评估单步工具选择质量
   */
  evaluateSelection(input: EvaluateSelectionInput): ToolSelectionScore {
    const goal = input.userGoal.trim().toLowerCase();
    const tool = input.selectedTool;
    const completed = input.completedTools || [];

    // 1. 意图分类与期望工具集合推断
    const expectedIntent = this.inferIntent(goal);
    const intentTools = this.getIntentExpectedTools(expectedIntent);

    // 2. 相关度评分 (Relevance Score: 0-100)
    let relevanceScore = 50;
    if (intentTools.includes(tool)) {
      relevanceScore = 95;
    } else if (this.isComplementaryTool(tool, expectedIntent, completed)) {
      relevanceScore = 85;
    } else {
      relevanceScore = 20;
    }

    // 3. 冗余工具评分 (Unnecessary Tool Score: 0-100, 0 为最优无冗余)
    let unnecessaryToolScore = 0;
    if (completed.includes(tool) && !this.isRepeatableTool(tool)) {
      unnecessaryToolScore = 70; // 重复调用非幂等/无状态变化工具
    } else if (!intentTools.includes(tool) && relevanceScore < 60) {
      unnecessaryToolScore = 60; // 调度与目标无关的工具
    }

    // 4. 缺失前置工具惩罚 (Missing Tool Score: 0-100, 0 为最优无缺失)
    let missingToolScore = 0;
    const missingPrerequisites = this.getMissingPrerequisites(tool, completed, expectedIntent);
    if (missingPrerequisites.length > 0) {
      missingToolScore = Math.min(80, missingPrerequisites.length * 30);
    }

    // 5. 综合得分计算
    const overallScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          relevanceScore * 0.6 +
            (100 - unnecessaryToolScore) * 0.2 +
            (100 - missingToolScore) * 0.2,
        ),
      ),
    );

    const isOptimal =
      overallScore >= 80 && unnecessaryToolScore === 0 && missingToolScore === 0;

    let feedback = `工具 [${tool}] 选择有效，与创作目标匹配。`;
    if (unnecessaryToolScore > 0) {
      feedback = `工具 [${tool}] 存在冗余或与目标相关度较低，建议优化为意图专属工具。`;
    } else if (missingToolScore > 0) {
      feedback = `建议先执行前置准备工具: [${missingPrerequisites.join(', ')}]，以保证上下文完整。`;
    }

    return {
      relevanceScore,
      unnecessaryToolScore,
      missingToolScore,
      overallScore,
      feedback,
      isOptimal,
    };
  }

  /**
   * 评估全流程工具调用序列 (Trajectory)
   */
  evaluateTrajectory(userGoal: string, toolSequence: string[]): ToolSelectionScore {
    const intent = this.inferIntent(userGoal);
    const expectedTools = this.getIntentExpectedTools(intent);

    if (toolSequence.length === 0) {
      return {
        relevanceScore: 0,
        unnecessaryToolScore: 0,
        missingToolScore: 100,
        overallScore: 0,
        feedback: '未调用任何工具，无法达成创作目标。',
        isOptimal: false,
      };
    }

    // 检查匹配的有效工具数量
    const relevantCount = toolSequence.filter((t) => expectedTools.includes(t)).length;
    const relevanceScore = Math.min(100, Math.round((relevantCount / expectedTools.length) * 100));

    // 检查冗余工具
    const unnecessaryCount = toolSequence.filter((t) => !expectedTools.includes(t)).length;
    const unnecessaryToolScore = Math.min(100, unnecessaryCount * 25);

    // 检查缺失核心工具
    const missingCount = expectedTools.filter((t) => !toolSequence.includes(t)).length;
    const missingToolScore = Math.min(100, Math.round((missingCount / expectedTools.length) * 100));

    const overallScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          relevanceScore * 0.5 +
            (100 - unnecessaryToolScore) * 0.25 +
            (100 - missingToolScore) * 0.25,
        ),
      ),
    );

    const isOptimal = overallScore >= 85 && missingCount === 0;

    return {
      relevanceScore,
      unnecessaryToolScore,
      missingToolScore,
      overallScore,
      feedback: isOptimal
        ? '工具链执行轨迹完整达标，精准覆盖全流程环节。'
        : `工具调用序列中存在 ${missingCount} 个缺失工具或 ${unnecessaryCount} 个冗余步骤。`,
      isOptimal,
    };
  }

  private inferIntent(
    goal: string,
  ): 'character' | 'world' | 'outline' | 'scene' | 'full_chapter' | 'general' {
    if (
      (goal.includes('完成') || goal.includes('写') || goal.includes('创作')) &&
      (goal.includes('章') || goal.includes('节') || goal.includes('遗迹'))
    ) {
      return 'full_chapter';
    }
    if (
      goal.includes('人物') ||
      goal.includes('主角') ||
      goal.includes('性格') ||
      goal.includes('心境') ||
      goal.includes('伤势')
    ) {
      return 'character';
    }
    if (
      goal.includes('世界观') ||
      goal.includes('世界状态') ||
      goal.includes('规则') ||
      goal.includes('时间线')
    ) {
      return 'world';
    }
    if (goal.includes('大纲') || goal.includes('架构') || goal.includes('分卷')) {
      return 'outline';
    }
    if (goal.includes('分镜') || goal.includes('scene') || goal.includes('节奏') || goal.includes('beat')) {
      return 'scene';
    }
    return 'general';
  }

  private getIntentExpectedTools(intent: string): string[] {
    switch (intent) {
      case 'character':
        return ['query_character_state', 'generate_scene_plan', 'update_memory'];
      case 'world':
        return ['query_world_state'];
      case 'outline':
        return ['generate_outline'];
      case 'scene':
        return ['generate_scene_plan', 'generate_prose', 'quality_check'];
      case 'full_chapter':
        return [
          'query_world_state',
          'query_character_state',
          'generate_scene_plan',
          'generate_prose',
          'quality_check',
          'update_memory',
          'save_chapter_version',
        ];
      default:
        return ['query_world_state', 'query_character_state'];
    }
  }

  private isComplementaryTool(
    tool: string,
    intent: string,
    _completed: string[],
  ): boolean {
    if (intent === 'character' && (tool === 'update_memory' || tool === 'generate_scene_plan')) {
      return true;
    }
    if (intent === 'full_chapter') {
      return true;
    }
    return false;
  }

  private isRepeatableTool(tool: string): boolean {
    return tool === 'generate_prose' || tool === 'quality_check';
  }

  private getMissingPrerequisites(
    tool: string,
    completed: string[],
    intent: string,
  ): string[] {
    if (tool === 'generate_prose' && !completed.includes('generate_scene_plan') && intent === 'full_chapter') {
      return ['generate_scene_plan'];
    }
    if (tool === 'save_chapter_version' && !completed.includes('generate_prose')) {
      return ['generate_prose'];
    }
    return [];
  }
}

export const toolSelectionEvaluator = new ToolSelectionEvaluator();
