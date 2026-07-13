import { useMemo, useState } from 'react';
import type { CoCreationMessage, CoCreationTurnOutputV1 } from '../../types/coCreation';

interface Props {
  messages: CoCreationMessage[];
  lastTurn?: CoCreationTurnOutputV1;
  sending: boolean;
  onSend: (content: string) => void | Promise<void>;
}

export default function CoCreationChat({ messages, lastTurn, sending, onSend }: Props) {
  const [content, setContent] = useState('');
  const visibleMessages = useMemo(() => messages.slice().sort((a, b) => a.sequenceNo - b.sequenceNo), [messages]);

  const submit = () => {
    const value = content.trim();
    if (!value || sending) return;
    setContent('');
    void onSend(value);
  };

  return (
    <section className="co-creation-chat" aria-label="AI 共创对话">
      <div className="co-creation-chat-header">
        <div>
          <strong>AI 共创对话</strong>
          <span>回复与结构化建议同时保存</span>
        </div>
        <span className="co-creation-proposal-badge">Proposal only</span>
      </div>
      <div className="co-creation-message-scroll" aria-live="polite">
        {visibleMessages.length === 0 && (
          <div className="co-creation-welcome">
            <span aria-hidden="true">✦</span>
            <h2>从一句想法开始</h2>
            <p>你不需要先填完整表单。AI 会读取已有作品数据，只追问真正影响故事方向的问题。</p>
          </div>
        )}
        {visibleMessages.map((message) => (
          <article key={message.messageId} className={`co-creation-message is-${message.role}`}>
            <header>{message.role === 'user' ? '你' : 'AI 共创'}</header>
            <p>{message.content}</p>
            {message.status === 'pending' && <small>正在处理…</small>}
            {message.status === 'failed' && <small className="is-error">本轮失败，可重新发送</small>}
          </article>
        ))}
        {lastTurn?.nextHighValueQuestion && (
          <div className="co-creation-next-question">
            <span>下一高价值问题</span>
            <strong>{lastTurn.nextHighValueQuestion.question}</strong>
            <small>{lastTurn.nextHighValueQuestion.reason}</small>
          </div>
        )}
      </div>
      {!!lastTurn?.quickReplies.length && (
        <div className="co-creation-quick-replies" aria-label="快捷回答">
          {lastTurn.quickReplies.map((reply) => (
            <button type="button" key={reply.id} disabled={sending} onClick={() => void onSend(reply.value)}>
              {reply.label}
            </button>
          ))}
        </div>
      )}
      <div className="co-creation-composer">
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="回答当前问题，或直接讨论、修改设定…"
          rows={3}
          disabled={sending}
        />
        <div>
          <span>Enter 发送 · Shift+Enter 换行</span>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={sending || !content.trim()}>
            {sending ? 'AI 正在处理…' : '发送'}
          </button>
        </div>
      </div>
    </section>
  );
}
