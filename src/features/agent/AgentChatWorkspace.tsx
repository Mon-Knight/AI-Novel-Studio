import { useState, useRef, useEffect, useCallback } from 'react';
import type { AgentTaskState, AgentTaskStatus } from '../../types/agentHarness';
import {
  agentConversationService,
  type AgentConversationItem,
} from '../../services/agent/agentConversationService';
import { MessageList } from './MessageList';
import { ToolTraceList } from './ToolTraceList';
import { CurrentThinking } from './CurrentThinking';
import { DecisionTrace } from './DecisionTrace';

export interface AgentChatWorkspaceProps {
  novelId?: string;
  chapterId?: string;
  conversationId?: string;
  onAdoptProse?: (content: string) => void;
}

export function AgentChatWorkspace({
  novelId,
  chapterId,
  conversationId,
  onAdoptProse,
}: AgentChatWorkspaceProps) {
  const [conversation, setConversation] = useState<AgentConversationItem>(() => {
    if (conversationId) {
      const existing = agentConversationService.getConversation(conversationId);
      if (existing) return existing;
    }
    return agentConversationService.createConversation(novelId, chapterId, '当前创作会话');
  });
  const [inputVal, setInputVal] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [taskState, setTaskState] = useState<AgentTaskState | undefined>(
    conversation.context.taskState,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const thoughtListenerRef = useRef<((chunk: string) => void) | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView?.({ behavior: 'auto' });
  }, [conversation.messages.length, conversation.toolRecords.length]);

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const text = (textToSend || inputVal).trim();
      if (!text || isBusy) return;

      setInputVal('');
      setIsBusy(true);
      thoughtListenerRef.current?.('');

      try {
        const updated = await agentConversationService.sendMessage(
          conversation.conversationId,
          text,
          {
            onStatusChange: (status: AgentTaskStatus) => {
              setConversation((prev) => ({ ...prev, status }));
            },
            onThought: (t: string) => {
              // 局部更新：仅通知 CurrentThinking 组件，不触发 AgentChatWorkspace 全量重绘
              thoughtListenerRef.current?.(t);
            },
          },
        );
        setConversation({ ...updated });
        if (updated.context.taskState) {
          setTaskState(updated.context.taskState);
        }
      } catch {
        // Error caught by service
      } finally {
        setIsBusy(false);
        thoughtListenerRef.current?.('');
      }
    },
    [conversation.conversationId, inputVal, isBusy],
  );

  const handleResolveConfirmation = useCallback(
    async (confirmationId: string, confirmed: boolean) => {
      try {
        await agentConversationService.resolveConfirmation(
          conversation.conversationId,
          confirmationId,
          confirmed,
        );
        const updated = agentConversationService.getConversation(conversation.conversationId);
        if (updated) setConversation({ ...updated });
      } catch {
        // Handled
      }
    },
    [conversation.conversationId],
  );

  const statusLabel = (status: string) => {
    switch (status) {
      case 'planning':
        return '思考规划中...';
      case 'executing_tool':
        return '正在执行工具...';
      case 'observing':
        return '分析结果中...';
      case 'evaluating':
        return '自我评估反思中...';
      case 'retrying':
        return '自适应重试中...';
      case 'completed':
        return '已完成';
      default:
        return '待命';
    }
  };

  return (
    <div
      className="agent-chat-workspace"
      data-testid="agent-chat-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-main, #ffffff)',
      }}
    >
      {/* 1. Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-light, #e2e8f0)',
          background: 'var(--color-bg-subtle, #f8fafc)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <strong>Creative Agent Workspace</strong>
          <span
            data-testid="agent-status-badge"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 12,
              background: isBusy ? '#dbeafe' : '#f1f5f9',
              color: isBusy ? '#1e40af' : '#64748b',
              fontWeight: 500,
            }}
          >
            {statusLabel(conversation.status)}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="agent-new-conv-btn"
          onClick={() => {
            const newConv = agentConversationService.createConversation(novelId, chapterId);
            setConversation(newConv);
            setTaskState(undefined);
          }}
          style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer' }}
        >
          新建对话
        </button>
      </header>

      {/* 2. Autonomous Task State Progress Banner */}
      {taskState && taskState.plannedSteps.length > 0 && (
        <div
          className="agent-task-state-banner"
          data-testid="agent-task-state-banner"
          style={{
            padding: '10px 16px',
            background: '#f0fdf4',
            borderBottom: '1px solid #bbf7d0',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: '#166534' }}>🎯 任务目标: {taskState.goal}</span>
            <span
              data-testid="agent-progress-percentage"
              style={{ fontWeight: 600, color: '#15803d' }}
            >
              进度: {taskState.progressPercentage}%
            </span>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              height: 6,
              background: '#dcfce7',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${taskState.progressPercentage}%`,
                background: '#22c55e',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* Planned Steps */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {taskState.plannedSteps.map((step, idx) => {
              const isDone = taskState.completedSteps.some(
                (c) => step.includes(c) || step.includes('完成'),
              );
              return (
                <span
                  key={idx}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    background: isDone ? '#bbf7d0' : '#ffffff',
                    color: isDone ? '#14532d' : '#475569',
                    border: '1px solid #86efac',
                  }}
                >
                  {isDone ? '✓ ' : '○ '}
                  {step}
                </span>
              );
            })}
          </div>

          {/* Latest Evaluation Feedback */}
          {taskState.evaluations.length > 0 && (
            <div
              data-testid="agent-latest-evaluation"
              style={{
                marginTop: 6,
                color: '#15803d',
                fontSize: 11,
                fontStyle: 'italic',
              }}
            >
              💡 自我反思: {taskState.evaluations[taskState.evaluations.length - 1].critique}
            </div>
          )}
        </div>
      )}

      {/* 3. Message & Tool Flow Scroll Area */}
      <div
        className="agent-message-scroll"
        data-testid="agent-message-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* 3.1 历史消息列表（带虚拟滚动与 Memo 隔离） */}
        <MessageList messages={conversation.messages} isBusy={isBusy} />

        {/* 3.2 正在思考/规划气泡（局部更新） */}
        <CurrentThinking thoughtListenerRef={thoughtListenerRef} />

        {/* 3.3 决策追踪与质量审查卡片（Memo 隔离） */}
        <DecisionTrace
          decisionTraces={conversation.decisionTraces}
          qualityReviews={conversation.qualityReviews}
        />

        {/* 3.4 工具执行记录卡片（默认折叠摘要） */}
        <ToolTraceList toolRecords={conversation.toolRecords} onAdoptProse={onAdoptProse} />

        {/* 3.5 写操作安全确认卡片 */}
        {conversation.pendingConfirmations
          .filter((c) => c.status === 'pending')
          .map((conf) => (
            <div
              key={conf.confirmationId}
              className="agent-confirmation-card"
              data-testid="agent-confirmation-card"
              data-confirmation-id={conf.confirmationId}
              style={{
                border: '1px solid #fde68a',
                background: '#fffbeb',
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#b45309',
                  marginBottom: 6,
                }}
              >
                <span>⚠️</span>
                <strong>写操作安全确认申请</strong>
              </div>
              <p style={{ color: '#78350f', margin: '0 0 8px 0' }}>
                Agent 申请执行{' '}
                <strong>
                  {conf.toolLabel} ({conf.toolName})
                </strong>
                。此操作将写入状态或章节版本，请确认是否授权执行：
              </p>
              <div
                style={{
                  background: '#fef3c7',
                  padding: 6,
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  marginBottom: 10,
                }}
              >
                {JSON.stringify(conf.arguments, null, 2)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="agent-confirm-btn"
                  onClick={() => handleResolveConfirmation(conf.confirmationId, true)}
                  style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
                >
                  ✓ 确认执行
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  data-testid="agent-reject-btn"
                  onClick={() => handleResolveConfirmation(conf.confirmationId, false)}
                  style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
                >
                  ✕ 拒绝
                </button>
              </div>
            </div>
          ))}

        <div ref={scrollRef} />
      </div>

      {/* 4. Prompt Shortcut Chips & Input Bar */}
      <footer
        style={{
          borderTop: '1px solid var(--color-border-light, #e2e8f0)',
          padding: '12px 16px',
          background: 'var(--color-bg-subtle, #f8fafc)',
        }}
      >
        {/* Quick Chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
          {[
            '完成第三章创作',
            '构思本章分镜规划',
            '生成本章第一幕正文',
            '执行正文质量合规检查',
            '查询世界观与规则设定',
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              data-testid="agent-chip-btn"
              onClick={() => handleSend(chip)}
              disabled={isBusy}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 12,
                border: '1px solid var(--color-border-light, #cbd5e1)',
                background: '#ffffff',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Input Controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input-text"
            data-testid="agent-chat-input"
            placeholder="向创作智能体输入指令（如：完成第三章创作）..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={isBusy}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border-light, #cbd5e1)',
              fontSize: 13,
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="agent-chat-send-btn"
            onClick={() => void handleSend()}
            disabled={isBusy || !inputVal.trim()}
            style={{
              padding: '8px 16px',
              cursor: isBusy || !inputVal.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {isBusy ? '执行中...' : '发送'}
          </button>
        </div>
      </footer>
    </div>
  );
}
