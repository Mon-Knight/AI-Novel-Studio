import { memo } from 'react';
import type { AgentMessage } from '../../types/agentHarness';
import { VirtualList } from './VirtualMessageList';

export interface MessageListProps {
  messages: AgentMessage[];
  isBusy: boolean;
}

export const MessageItem = memo(function MessageItem({ msg }: { msg: AgentMessage }) {
  const isUser = msg.role === 'user';
  if (msg.role === 'tool') return null;

  return (
    <div
      data-testid={`agent-msg-${msg.role}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
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
});

export const MessageList = memo(function MessageList({ messages, isBusy }: MessageListProps) {
  const displayMessages = messages.filter((m) => m.role !== 'tool');

  if (displayMessages.length === 0 && !isBusy) {
    return (
      <div
        className="agent-empty-intro"
        data-testid="agent-empty-intro"
        style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--color-text-muted, #64748b)',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
        <h3
          style={{
            fontSize: 16,
            marginBottom: 6,
            color: 'var(--color-text-primary, #1e293b)',
          }}
        >
          向创作智能体描述您的目标
        </h3>
        <p style={{ fontSize: 13, maxWidth: 420, margin: '0 auto' }}>
          例如：“完成第三章创作”或“查询当前世界观设定”。Agent
          将自主拆解目标、调度工具、评估质量并自愈完成。
        </p>
      </div>
    );
  }

  return (
    <div className="agent-message-list" data-testid="agent-message-list">
      <VirtualList
        items={displayMessages}
        threshold={25}
        itemHeightEstimate={65}
        keyExtractor={(msg, idx) => msg.id || `${msg.role}-${idx}`}
        renderItem={(msg) => <MessageItem msg={msg} />}
      />
    </div>
  );
});
