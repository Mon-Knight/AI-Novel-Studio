/**
 * Creative Agent Harness - Context Manager
 * 管理多轮上下文、系统提示词与工具调用历史
 */
import type {
  AgentContext,
  AgentToolExecutionRecord,
} from '../../types/agentHarness';
import { agentToolRegistry } from './agentToolRegistry';

export class AgentContextManager {
  createContext(params: {
    novelId?: string;
    chapterId?: string;
    sceneId?: string;
    goal?: string;
  }): AgentContext {
    return {
      novelId: params.novelId,
      chapterId: params.chapterId,
      sceneId: params.sceneId,
      messages: [],
      executionRecords: [],
      status: 'idle',
      currentGoal: params.goal,
    };
  }

  addUserMessage(context: AgentContext, content: string): void {
    context.messages.push({
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    });
    context.currentGoal = content;
  }

  addAssistantMessage(
    context: AgentContext,
    content: string,
    thought?: string,
    toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[],
  ): void {
    context.messages.push({
      role: 'assistant',
      content,
      thought,
      toolCalls,
      timestamp: new Date().toISOString(),
    });
    if (thought) {
      context.currentThought = thought;
    }
  }

  addToolObservation(
    context: AgentContext,
    toolCallId: string,
    record: AgentToolExecutionRecord,
  ): void {
    context.executionRecords.push(record);
    const observationText = record.success
      ? JSON.stringify(record.output, null, 2)
      : `Error: ${record.error}`;

    context.messages.push({
      role: 'tool',
      name: record.toolName,
      toolCallId,
      content: observationText,
      timestamp: new Date().toISOString(),
    });
  }

  buildSystemPrompt(context: AgentContext): string {
    const tools = agentToolRegistry.getToolDescriptors();
    const toolDescriptions = tools
      .map(
        (t) =>
          `- **${t.name}**: ${t.description}\n  参数: ${JSON.stringify(t.parameters)}`,
      )
      .join('\n\n');

    return `你是由 AI Novel Studio 驱动的专业长篇小说创作智能体（Creative Autonomous Agent）。
你负责理解作者意图、拆解创作任务、自主调用领域工具，并逐步推进长篇小说的构思、分镜、生成与状态更新。

### 当前创作上下文:
- 作品 ID: ${context.novelId || '（未选定）'}
- 章节 ID: ${context.chapterId || '（未选定）'}
- 分镜 ID: ${context.sceneId || '（未选定）'}

### 可用创作工具列表:
${toolDescriptions}

### 决策与响应协议:
每一轮请必须以 JSON 格式输出你的思考与行动方案（严禁包含额外说明）：

\`\`\`json
{
  "thought": "你的思考过程：分析当前需求、已有观察与下一步动作",
  "plan": ["任务步骤1", "任务步骤2"],
  "action": "要调用的工具名称（必须是上述列表中的一个）或者 final_answer",
  "actionInput": {
    "参数名": "参数值"
  }
}
\`\`\`

当任务已全部完成，无需进一步调用工具时，将 action 设为 "final_answer"，并在 actionInput 中提供 "response" 字段。
`;
  }
}

export const agentContextManager = new AgentContextManager();
