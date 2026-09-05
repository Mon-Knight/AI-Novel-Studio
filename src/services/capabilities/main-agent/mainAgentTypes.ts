import type { TaskModelSnapshot } from '../../../types/conversation';
import type { CanonicalModelToolDescriptor } from '../canonical/canonicalToolTypes';

export interface MainAgentTargetSnapshot {
  novelId: string;
  chapterId?: string;
  revision?: string;
}

export interface MainAgentExecutorToolCall {
  name: string;
  version?: string;
  argumentsJson: unknown;
}

export interface MainAgentExecutorAction {
  toolCalls?: MainAgentExecutorToolCall[];
  text?: string;
}

export type MainAgentExecutor = (
  prompt: string,
  tools: CanonicalModelToolDescriptor[],
) => Promise<MainAgentExecutorAction>;

export interface MainAgentRequest {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  userGoal: string;
  targetSnapshot?: MainAgentTargetSnapshot;
  modelSnapshot?: TaskModelSnapshot;
  signal?: AbortSignal;
  maxSteps?: number;
  executor?: MainAgentExecutor;
}

export interface MainAgentError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface MainAgentToolCallRecord {
  name: string;
  version: string;
  tool?: string;
  invocationId: string;
  argumentsJson: unknown;
  result: unknown;
  error?: MainAgentError;
  status: 'completed' | 'failed';
  durationMs: number;
}

export interface MainAgentResult {
  ok: boolean;
  conversationId: string;
  novelId: string;
  chapterId?: string;
  userGoal: string;
  toolCalls: MainAgentToolCallRecord[];
  finalMessage: string;
  error?: string;
  errorCode?: string;
}

export interface MainAgentTurnRequest {
  conversationId?: string;
  novelId: string;
  chapterId?: string;
  userGoal: string;
  targetSnapshot?: MainAgentTargetSnapshot;
  modelSnapshot?: TaskModelSnapshot;
  signal?: AbortSignal;
  maxSteps?: number;
  executor?: MainAgentExecutor;
}
