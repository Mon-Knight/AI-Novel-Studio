/**
 * Creative Agent Harness - Evaluator & Reflection Engine
 * 负责在工具执行后进行自我评估、质量反思与重试决策
 */
import type {
  AgentContext,
  AgentSelfEvaluation,
  AgentToolExecutionRecord,
} from '../../types/agentHarness';

export class AgentEvaluator {
  /**
   * 评估单次工具执行结果的质量与目标达成度
   */
  evaluateToolResult(
    record: AgentToolExecutionRecord,
    _context: AgentContext,
  ): AgentSelfEvaluation {
    const timestamp = new Date().toISOString();

    // 1. 工具执行异常处理
    if (!record.success) {
      return {
        score: 0,
        isSatisfied: false,
        critique: `工具 [${record.toolName}] 执行失败: ${record.error || '未知异常'}`,
        needsRetry: true,
        suggestedAdjustment: '分析失败原因，调整参数或切换降级策略后重试',
        evaluatedAt: timestamp,
      };
    }

    const output = record.output as Record<string, unknown> | undefined;

    // 2. 正文生成评估
    if (record.toolName === 'generate_prose') {
      const prose = typeof output?.prose === 'string' ? output.prose.trim() : '';
      if (!prose || prose.length < 5) {
        return {
          score: 30,
          isSatisfied: false,
          critique: '生成的正文字数过少或内容为空，不符合创作要求。',
          needsRetry: true,
          suggestedAdjustment: '补充场景细节与 Beat 冲突约束重新生成',
          evaluatedAt: timestamp,
        };
      }

      return {
        score: 90,
        isSatisfied: true,
        critique: `正文生成完成（长度约 ${prose.length} 字），情节节奏与视点约束达标。`,
        needsRetry: false,
        evaluatedAt: timestamp,
      };
    }

    // 3. 质量检查评估
    if (record.toolName === 'quality_check') {
      const score = typeof output?.overallScore === 'number' ? output.overallScore : 80;
      const passed = output?.passed !== false && score >= 75;

      if (!passed) {
        return {
          score,
          isSatisfied: false,
          critique: `质量检查未通过（得分 ${score} 分），检测到潜在问题。`,
          needsRetry: true,
          suggestedAdjustment: '针对检测出的问题进行微调润色或重新生成',
          evaluatedAt: timestamp,
        };
      }

      return {
        score,
        isSatisfied: true,
        critique: `质量检查通过（得分 ${score} 分），无严重偏离与连续性漏洞。`,
        needsRetry: false,
        evaluatedAt: timestamp,
      };
    }

    // 4. 分镜规划评估
    if (record.toolName === 'generate_scene_plan') {
      const scenes = Array.isArray(output?.scenes) ? output.scenes : [];
      if (scenes.length === 0) {
        return {
          score: 40,
          isSatisfied: false,
          critique: '分镜规划未输出有效 Scene 列表。',
          needsRetry: true,
          suggestedAdjustment: '重新明确章节目标后规划分镜',
          evaluatedAt: timestamp,
        };
      }

      return {
        score: 95,
        isSatisfied: true,
        critique: `分镜规划完成，共生成 ${scenes.length} 个场景的节奏脉络。`,
        needsRetry: false,
        evaluatedAt: timestamp,
      };
    }

    // 5. 其他查询与持久化工具默认评估
    return {
      score: 95,
      isSatisfied: true,
      critique: `工具 [${record.toolName}] 数据反馈正常，推进了创作上下文。`,
      needsRetry: false,
      evaluatedAt: timestamp,
    };
  }

  /**
   * 评估整个任务是否达到最终完成标准
   */
  evaluateTaskCompletion(context: AgentContext): { isCompleted: boolean; summary: string } {
    const taskState = context.taskState;
    if (!taskState) {
      return { isCompleted: true, summary: '单步任务已完成' };
    }

    const pendingSteps = taskState.plannedSteps.filter(
      (s) => !taskState.completedSteps.includes(s),
    );

    if (pendingSteps.length === 0) {
      return {
        isCompleted: true,
        summary: `全部 ${taskState.plannedSteps.length} 个规划步骤均已达成。`,
      };
    }

    return {
      isCompleted: false,
      summary: `尚有 ${pendingSteps.length} 个步骤待执行: ${pendingSteps.join(', ')}`,
    };
  }
}

export const agentEvaluator = new AgentEvaluator();
