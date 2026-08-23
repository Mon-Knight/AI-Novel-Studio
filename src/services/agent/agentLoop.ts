/**
 * Creative Agent Harness - Main Execution Loop
 * 编排理解、规划、工具执行与反思的完整 ReAct 创作循环
 */
import type {
  AgentContext,
  AgentDecision,
  AgentExecutionResult,
  AgentHarnessConfig,
  AgentHarnessEvents,
  AgentToolCall,
} from '../../types/agentHarness';
import { createUniqueId } from '../../utils/uniqueId';
import { agentContextManager } from './agentContextManager';
import { agentPlanner } from './agentPlanner';
import { agentToolExecutor } from './agentToolExecutor';

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
    const maxTurns = config?.maxTurns ?? 6;
    const context: AgentContext = agentContextManager.createContext({
      novelId: initialContextParams?.novelId,
      chapterId: initialContextParams?.chapterId,
      sceneId: initialContextParams?.sceneId,
      goal: userInput,
    });

    agentContextManager.addUserMessage(context, userInput);
    let turns = 0;
    let finalResponse = '';

    while (turns < maxTurns) {
      turns += 1;

      // 1. 规划阶段
      context.status = 'planning';
      events?.onStatusChange?.('planning');

      const decision: AgentDecision = await agentPlanner.decideNextStep(context, config);

      if (decision.thought) {
        context.currentThought = decision.thought;
        events?.onThought?.(decision.thought);
      }

      // 2. 检查是否达成终止条件 / 输出最终答复
      if (decision.isDone || !decision.selectedTool) {
        finalResponse = decision.finalResponse || decision.thought;
        agentContextManager.addAssistantMessage(context, finalResponse, decision.thought);
        context.status = 'completed';
        events?.onStatusChange?.('completed');
        events?.onTurnComplete?.(decision, turns);
        break;
      }

      // 3. 执行工具阶段
      const toolCall: AgentToolCall = {
        id: `call-${createUniqueId()}`,
        name: decision.selectedTool.name,
        arguments: decision.selectedTool.arguments,
      };

      agentContextManager.addAssistantMessage(
        context,
        `正在调用工具: ${toolCall.name}`,
        decision.thought,
        [toolCall],
      );

      context.status = 'executing_tool';
      events?.onStatusChange?.('executing_tool');
      events?.onToolStart?.(toolCall);

      const record = await agentToolExecutor.execute(toolCall, context);
      events?.onToolEnd?.(record);

      // 4. 观察阶段与上下文注入
      context.status = 'observing';
      events?.onStatusChange?.('observing');
      agentContextManager.addToolObservation(context, toolCall.id, record);

      events?.onTurnComplete?.(decision, turns);
    }

    if (context.status !== 'completed') {
      context.status = 'completed';
      if (!finalResponse) {
        finalResponse = '已达到单次任务最大轮数限制，已为您保留当前执行的所有状态。';
      }
    }

    return {
      finalResponse,
      status: context.status,
      turns,
      executionRecords: context.executionRecords,
      context,
    };
  }
}

export const creativeAgentHarness = new CreativeAgentHarness();
