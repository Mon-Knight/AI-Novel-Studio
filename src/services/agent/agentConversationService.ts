/**
 * Creative Agent Harness - Conversation & Confirmation Service
 * 管理 Agent 对话会话、多轮状态与写操作安全确认
 */
import type {
  AgentContext,
  AgentDecisionTrace,
  AgentMessage,
  AgentTaskStatus,
  AgentToolExecutionRecord,
} from '../../types/agentHarness';
import { createUniqueId } from '../../utils/uniqueId';
import { creativeAgentHarness } from './agentLoop';
import { agentToolExecutor } from './agentToolExecutor';
import { agentContextManager } from './agentContextManager';

export interface PendingToolConfirmation {
  confirmationId: string;
  conversationId: string;
  toolName: string;
  toolLabel: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
}

export interface AgentConversationItem {
  id: string;
  conversationId: string;
  novelId?: string;
  chapterId?: string;
  title: string;
  messages: AgentMessage[];
  context: AgentContext;
  toolRecords: AgentToolExecutionRecord[];
  decisionTraces: AgentDecisionTrace[];
  pendingConfirmations: PendingToolConfirmation[];
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
}

export const WRITE_SENSITIVE_TOOLS = new Set([
  'update_memory',
  'save_chapter_version',
  'save_version',
]);

export const AGENT_TOOL_METADATA: Record<
  string,
  { label: string; icon: string; isWrite?: boolean }
> = {
  query_world_state: { label: '查询世界状态', icon: '🏛️' },
  query_character_state: { label: '查询人物状态', icon: '👤' },
  query_chapter_info: { label: '查询章节信息', icon: '📖' },
  generate_outline: { label: '生成大纲', icon: '📋' },
  generate_scene_plan: { label: '生成分镜', icon: '🎬' },
  generate_prose: { label: '正文生成', icon: '✍️' },
  quality_check: { label: '质量检查', icon: '🔍' },
  update_memory: { label: '更新记忆', icon: '🧠', isWrite: true },
  save_chapter_version: { label: '保存版本', icon: '💾', isWrite: true },
};

export class AgentConversationService {
  private conversations = new Map<string, AgentConversationItem>();

  createConversation(novelId?: string, chapterId?: string, title?: string): AgentConversationItem {
    const conversationId = `conv-agent-${createUniqueId()}`;
    const initialContext = agentContextManager.createContext({ novelId, chapterId });
    const item: AgentConversationItem = {
      id: conversationId,
      conversationId,
      novelId,
      chapterId,
      title: title || '新创作会话',
      messages: [],
      context: initialContext,
      toolRecords: [],
      decisionTraces: [],
      pendingConfirmations: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conversationId, item);
    return item;
  }

  getConversation(conversationId: string): AgentConversationItem | undefined {
    return this.conversations.get(conversationId);
  }

  listConversations(novelId?: string): AgentConversationItem[] {
    const list = Array.from(this.conversations.values());
    if (!novelId) return list;
    return list.filter((c) => !c.novelId || c.novelId === novelId);
  }

  async sendMessage(
    conversationId: string,
    userInput: string,
    onEvent?: {
      onStatusChange?: (status: AgentTaskStatus) => void;
      onThought?: (thought: string) => void;
      onPendingConfirmation?: (confirmation: PendingToolConfirmation) => void;
    },
  ): Promise<AgentConversationItem> {
    let conversation = this.getConversation(conversationId);
    if (!conversation) {
      conversation = this.createConversation(undefined, undefined, userInput.slice(0, 20));
    }

    conversation.status = 'planning';
    conversation.updatedAt = new Date().toISOString();
    onEvent?.onStatusChange?.('planning');

    // 运行 Agent Harness Loop
    const execResult = await creativeAgentHarness.run(
      userInput,
      {
        novelId: conversation.novelId,
        chapterId: conversation.chapterId,
      },
      undefined,
      {
        onStatusChange: (s) => {
          conversation!.status = s;
          onEvent?.onStatusChange?.(s);
        },
        onThought: (t) => {
          onEvent?.onThought?.(t);
        },
        onToolStart: (toolCall) => {
          // 检查写操作安全拦截
          if (WRITE_SENSITIVE_TOOLS.has(toolCall.name)) {
            const conf: PendingToolConfirmation = {
              confirmationId: `conf-${createUniqueId()}`,
              conversationId,
              toolName: toolCall.name,
              toolLabel: AGENT_TOOL_METADATA[toolCall.name]?.label || toolCall.name,
              arguments: toolCall.arguments,
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            conversation!.pendingConfirmations.push(conf);
            onEvent?.onPendingConfirmation?.(conf);
          }
        },
      },
    );

    // 同步会话状态
    conversation.context = execResult.context;
    conversation.messages = [...execResult.context.messages];
    conversation.toolRecords = [...execResult.executionRecords];
    conversation.decisionTraces = [...execResult.decisionTraces];
    conversation.status = execResult.status;
    conversation.updatedAt = new Date().toISOString();

    return conversation;
  }

  async resolveConfirmation(
    conversationId: string,
    confirmationId: string,
    confirmed: boolean,
  ): Promise<{ success: boolean; record?: AgentToolExecutionRecord }> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const conf = conversation.pendingConfirmations.find(
      (c) => c.confirmationId === confirmationId,
    );
    if (!conf) throw new Error('Confirmation item not found');

    conf.status = confirmed ? 'confirmed' : 'rejected';
    conversation.updatedAt = new Date().toISOString();

    if (!confirmed) {
      return { success: false };
    }

    // 经用户确认后执行实际工具
    const toolCall = {
      id: `confirmed-${confirmationId}`,
      name: conf.toolName,
      arguments: conf.arguments,
    };

    const record = await agentToolExecutor.execute(toolCall, conversation.context);
    conversation.toolRecords.push(record);
    agentContextManager.addToolObservation(conversation.context, toolCall.id, record);
    return { success: record.success, record };
  }

  reset(): void {
    this.conversations.clear();
  }
}

export const agentConversationService = new AgentConversationService();
