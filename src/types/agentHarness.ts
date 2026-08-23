/**
 * Creative Agent Harness - Domain Types
 * 模型驱动创作智能体底座类型定义
 */
import type { AiSettings } from './ai';

export type AgentRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentMessage {
  id?: string;
  role: AgentRole;
  content: string;
  name?: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  thought?: string;
  timestamp?: string;
}

export type AgentTaskStatus =
  | 'idle'
  | 'planning'
  | 'executing_tool'
  | 'observing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolExecutionRecord {
  callId: string;
  toolName: string;
  inputArgs: Record<string, unknown>;
  output: unknown;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface AgentDecision {
  thought: string;
  plan?: string[];
  selectedTool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  finalResponse?: string;
  isDone: boolean;
}

export interface AgentContext {
  novelId?: string;
  chapterId?: string;
  sceneId?: string;
  messages: AgentMessage[];
  executionRecords: AgentToolExecutionRecord[];
  status: AgentTaskStatus;
  currentGoal?: string;
  currentThought?: string;
  modelSettings?: AiSettings;
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface AgentTool {
  descriptor: AgentToolDescriptor;
  execute: (args: Record<string, unknown>, context: AgentContext) => Promise<unknown>;
}

export interface AgentHarnessEvents {
  onStatusChange?: (status: AgentTaskStatus) => void;
  onThought?: (thought: string) => void;
  onToolStart?: (toolCall: AgentToolCall) => void;
  onToolEnd?: (record: AgentToolExecutionRecord) => void;
  onTurnComplete?: (decision: AgentDecision, turn: number) => void;
}

export interface AgentHarnessConfig {
  maxTurns?: number;
  temperature?: number;
  modelSettings?: AiSettings;
  enableAutoRecovery?: boolean;
}

export interface AgentExecutionResult {
  finalResponse: string;
  status: AgentTaskStatus;
  turns: number;
  executionRecords: AgentToolExecutionRecord[];
  context: AgentContext;
}
