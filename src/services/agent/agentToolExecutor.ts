/**
 * Creative Agent Harness - Tool Executor
 * 安全执行 Agent 选定工具并捕获结构化观测结果
 */
import type {
  AgentContext,
  AgentToolCall,
  AgentToolExecutionRecord,
} from '../../types/agentHarness';
import { agentToolRegistry } from './agentToolRegistry';

export class AgentToolExecutor {
  async execute(
    toolCall: AgentToolCall,
    context: AgentContext,
  ): Promise<AgentToolExecutionRecord> {
    const startTime = Date.now();
    const tool = agentToolRegistry.getTool(toolCall.name);

    if (!tool) {
      const record: AgentToolExecutionRecord = {
        callId: toolCall.id,
        toolName: toolCall.name,
        inputArgs: toolCall.arguments,
        output: null,
        success: false,
        error: `Tool "${toolCall.name}" not found in AgentToolRegistry.`,
        durationMs: Date.now() - startTime,
      };
      return record;
    }

    try {
      const output = await tool.execute(toolCall.arguments, context);
      const record: AgentToolExecutionRecord = {
        callId: toolCall.id,
        toolName: toolCall.name,
        inputArgs: toolCall.arguments,
        output,
        success: true,
        durationMs: Date.now() - startTime,
      };
      return record;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const record: AgentToolExecutionRecord = {
        callId: toolCall.id,
        toolName: toolCall.name,
        inputArgs: toolCall.arguments,
        output: null,
        success: false,
        error: message,
        durationMs: Date.now() - startTime,
      };
      return record;
    }
  }
}

export const agentToolExecutor = new AgentToolExecutor();
