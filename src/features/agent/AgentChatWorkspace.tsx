import { useState, useRef, useEffect } from 'react';
import type { AgentTaskStatus } from '../../types/agentHarness';
import {
  agentConversationService,
  AGENT_TOOL_METADATA,
  type AgentConversationItem,
} from '../../services/agent/agentConversationService';

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
  const [currentThought, setCurrentThought] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [conversation.messages, conversation.toolRecords, currentThought]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputVal).trim();
    if (!text || isBusy) return;

    setInputVal('');
    setIsBusy(true);
    setCurrentThought('');

    try {
      const updated = await agentConversationService.sendMessage(
        conversation.conversationId,
        text,
        {
          onStatusChange: (status: AgentTaskStatus) => {
            setConversation((prev) => ({ ...prev, status }));
          },
          onThought: (t: string) => {
            setCurrentThought(t);
          },
        },
      );
      setConversation({ ...updated });
    } catch {
      // Error caught by service
    } finally {
      setIsBusy(false);
      setCurrentThought('');
    }
  };

  const handleResolveConfirmation = async (confirmationId: string, confirmed: boolean) => {
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
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'planning':
        return '思考规划中...';
      case 'executing_tool':
        return '正在执行工具...';
      case 'observing':
        return '分析结果中...';
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
          }}
          style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer' }}
        >
          新建对话
        </button>
      </header>

      {/* 2. Message & Tool Flow Scroll Area */}
      <div
        className="agent-message-scroll"
        data-testid="agent-message-scroll"
        style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {conversation.messages.length === 0 && !isBusy && (
          <div
            className="agent-empty-intro"
            data-testid="agent-empty-intro"
            style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted, #64748b)' }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
            <h3 style={{ fontSize: 16, marginBottom: 6, color: 'var(--color-text-primary, #1e293b)' }}>
              向创作智能体描述您的目标
            </h3>
            <p style={{ fontSize: 13, maxWidth: 420, margin: '0 auto' }}>
              例如：“为第一章规划分镜并生成前 1000 字正文”或“查询当前世界观设定”。Agent 将自主分析任务并调度工具。
            </p>
          </div>
        )}

        {conversation.messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          if (msg.role === 'tool') return null; // 工具结果由 ToolCard 统一展示

          return (
            <div
              key={msg.id || index}
              data-testid={`agent-msg-${msg.role}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted, #94a3b8)',
                  marginBottom: 4,
                  padding: '0 4px',
                }}
              >
                {isUser ? '你' : 'AI 创作智能体'}
              </div>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  background: isUser ? 'var(--color-primary, #4f46e5)' : 'var(--color-bg-subtle, #f1f5f9)',
                  color: isUser ? '#ffffff' : 'var(--color-text-primary, #1e293b)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* 3. 正在思考/规划气泡 */}
        {currentThought && (
          <div
            className="agent-thinking-card"
            data-testid="agent-thinking-card"
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px dashed #cbd5e1',
              fontSize: 12,
              color: '#475569',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>🧠 思考与规划中:</div>
            <div>{currentThought}</div>
          </div>
        )}

        {/* 4. 工具执行记录卡片 (Tool Calling & Observation) */}
        {conversation.toolRecords.map((record, i) => {
          const meta = AGENT_TOOL_METADATA[record.toolName] || { label: record.toolName, icon: '⚙️' };
          const isProseGen = record.toolName === 'generate_prose';
          const proseText =
            typeof (record.output as Record<string, unknown>)?.prose === 'string'
              ? String((record.output as Record<string, unknown>).prose)
              : undefined;

          return (
            <div
              key={record.callId || i}
              className="agent-tool-card"
              data-testid="agent-tool-card"
              data-tool-name={record.toolName}
              style={{
                border: '1px solid var(--color-border-light, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
                background: '#ffffff',
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta.icon}</span>
                  <strong style={{ fontSize: 13 }}>{meta.label}</strong>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>({record.toolName})</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: record.success ? '#dcfce7' : '#fee2e2',
                    color: record.success ? '#15803d' : '#b91c1c',
                  }}
                >
                  {record.success ? `✓ 完成 ${record.durationMs}ms` : `! 失败`}
                </span>
              </div>

              {/* 输入参数 */}
              <div style={{ marginBottom: 6, color: '#64748b' }}>
                <span style={{ fontWeight: 500 }}>输入参数: </span>
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {JSON.stringify(record.inputArgs)}
                </span>
              </div>

              {/* 输出结果摘要 */}
              <div
                style={{
                  background: '#f8fafc',
                  padding: 8,
                  borderRadius: 4,
                  maxHeight: 120,
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {record.success
                  ? JSON.stringify(record.output, null, 2)
                  : `错误: ${record.error}`}
              </div>

              {/* 采纳正文动作 (如果是正文生成工具) */}
              {isProseGen && proseText && onAdoptProse && (
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    data-testid="agent-adopt-prose-btn"
                    onClick={() => onAdoptProse(proseText)}
                    style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
                  >
                    采纳为章节正文
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* 5. 写操作安全确认卡片 (Safety Confirmation Gate) */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b45309', marginBottom: 6 }}>
                <span>⚠️</span>
                <strong>写操作安全确认申请</strong>
              </div>
              <p style={{ color: '#78350f', margin: '0 0 8px 0' }}>
                Agent 申请执行 <strong>{conf.toolLabel} ({conf.toolName})</strong>。此操作将写入状态或章节版本，请确认是否授权执行：
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

      {/* 6. Prompt Shortcut Chips & Input Bar */}
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
            placeholder="向创作智能体输入指令（如：构思本章分镜并生成前 1000 字正文）..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
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
            onClick={() => handleSend()}
            disabled={isBusy || !inputVal.trim()}
            style={{ padding: '8px 16px', cursor: isBusy || !inputVal.trim() ? 'not-allowed' : 'pointer' }}
          >
            {isBusy ? '执行中...' : '发送'}
          </button>
        </div>
      </footer>
    </div>
  );
}
