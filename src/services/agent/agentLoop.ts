/**
 * Creative Agent Harness - Autonomous Task Execution Loop
 * 编排 Observe -> Plan -> Act -> Evaluate -> Retry 的完整自适应创作循环
 */
import type {
  AgentContext,
  AgentDecision,
  AgentExecutionResult,
  AgentHarnessConfig,
  AgentHarnessEvents,
  AgentTaskState,
  AgentToolCall,
} from '../../types/agentHarness';
import { createUniqueId } from '../../utils/uniqueId';
import { agentContextManager } from './agentContextManager';
import { agentPlanner } from './agentPlanner';
import { agentToolExecutor } from './agentToolExecutor';
import { agentEvaluator } from './agentEvaluator';

export class CreativeAgentHarness {
  async run(
    userInput: string,
    initialContextParams?: {
      novelId?: string;
      chapterId?: string;
      sceneId?: string;
    },
    config?: AgentHarnessConfig,
    events?: AgentHarnessEvents,
  ): Promise<AgentExecutionResult> {
    const maxTurns = config?.maxTurns ?? 8;
    const context: AgentContext = agentContextManager.createContext({
      novelId: initialContextParams?.novelId,
      chapterId: initialContextParams?.chapterId,
      sceneId: initialContextParams?.sceneId,
      goal: userInput,
    });

    const taskState: AgentTaskState = {
      goal: userInput,
      completedSteps: [],
      plannedSteps: [],
      retryCount: 0,
      progressPercentage: 0,
      evaluations: [],
    };
    context.taskState = taskState;

    agentContextManager.addUserMessage(context, userInput);
    let turns = 0;
    let finalResponse = '';

    while (turns < maxTurns) {
      turns += 1;

      // 1. Observe & Plan (规划阶段)
      context.status = 'planning';
      events?.onStatusChange?.('planning');

      const decision: AgentDecision = await agentPlanner.decideNextStep(context, config);

      if (decision.plan && decision.plan.length > 0) {
        taskState.plannedSteps = decision.plan;
      }

      if (decision.thought) {
        context.currentThought = decision.thought;
        events?.onThought?.(decision.thought);
      }

      // 2. 检查是否达成终止条件 / 输出最终答复
      if (decision.isDone || !decision.selectedTool) {
        finalResponse = decision.finalResponse || decision.thought;
        agentContextManager.addAssistantMessage(context, finalResponse, decision.thought);
        context.status = 'completed';
        taskState.progressPercentage = 100;
        events?.onTaskStateUpdate?.(taskState);
        events?.onStatusChange?.('completed');
        events?.onTurnComplete?.(decision, turns);
        break;
      }

      // 3. Act (执行工具阶段)
      const toolCall: AgentToolCall = {
        id: `call-${createUniqueId()}`,
        name: decision.selectedTool.name,
        arguments: decision.selectedTool.arguments,
      };

      taskState.activeTool = toolCall.name;
      taskState.currentStep = decision.thought;
      events?.onTaskStateUpdate?.(taskState);

      if (decision.needsRetry) {
        context.status = 'retrying';
        taskState.retryCount += 1;
        events?.onStatusChange?.('retrying');
      } else {
        context.status = 'executing_tool';
        events?.onStatusChange?.('executing_tool');
      }

      agentContextManager.addAssistantMessage(
        context,
        `正在调用工具: ${toolCall.name}`,
        decision.thought,
        [toolCall],
      );

      events?.onToolStart?.(toolCall);
      const record = await agentToolExecutor.execute(toolCall, context);
      events?.onToolEnd?.(record);

      // 4. Observe & Evaluate (自我评估与反思阶段)
      context.status = 'evaluating';
      events?.onStatusChange?.('evaluating');

      const evaluation = agentEvaluator.evaluateToolResult(record, context);
      taskState.evaluations.push(evaluation);
      events?.onEvaluation?.(evaluation);

      // 如果工具成功且评估达标，记录完成步骤并更新进度
      if (record.success && evaluation.isSatisfied) {
        taskState.completedSteps.push(toolCall.name);
        const totalPlanned = Math.max(taskState.plannedSteps.length, 1);
        taskState.progressPercentage = Math.min(
          Math.round((taskState.completedSteps.length / totalPlanned) * 100),
          95,
        );
      } else if (!record.success) {
        taskState.failureReason = record.error || '工具执行未成功';
      }

      events?.onTaskStateUpdate?.(taskState);

      // 上下文注入观察反馈
      context.status = 'observing';
      events?.onStatusChange?.('observing');
      agentContextManager.addToolObservation(context, toolCall.id, record);

      events?.onTurnComplete?.(decision, turns);
    }

    if (context.status !== 'completed') {
      context.status = 'completed';
      taskState.progressPercentage = 100;
      if (!finalResponse) {
        finalResponse = `已成功完成本阶段创作任务并调度 ${context.executionRecords.length} 个工具步骤，所有状态与产物均已保存。`;
      }
    }

    return {
      finalResponse,
      status: context.status,
      turns,
      executionRecords: context.executionRecords,
      taskState,
      context,
    };
  }
}

export const creativeAgentHarness = new CreativeAgentHarness();
