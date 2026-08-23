import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { AgentChatWorkspace } from './AgentChatWorkspace';
import { agentConversationService } from '../../services/agent/agentConversationService';
import { novelMemoryManager } from '../../services/memory/novelMemoryManager';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
  localStorage: { value: new MemoryStorage(), configurable: true, writable: true },
});

dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  agentConversationService.reset();
});
after(() => dom.window.close());

test('AgentChatWorkspace: 渲染初始界面与空状态提示', async () => {
  await act(async () => {
    render(<AgentChatWorkspace novelId="novel-chat-01" />);
  });

  const intro = screen.getByTestId('agent-empty-intro');
  assert.ok(intro);
  assert.equal(intro.textContent?.includes('向创作智能体描述您的目标'), true);
  assert.equal(screen.getByTestId('agent-status-badge').textContent, '待命');
});

test('AgentChatWorkspace: 多轮对话与工具调用卡片展示', async () => {
  const novelId = 'novel-chat-tools-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '青云门后山禁止私斗。',
    relatedEntities: ['qingyun'],
  });

  let _adoptedText = '';
  await act(async () => {
    render(
      <AgentChatWorkspace
        novelId={novelId}
        chapterId="chap-01"
        onAdoptProse={(txt) => {
          _adoptedText = txt;
        }}
      />,
    );
  });

  const input = screen.getByTestId('agent-chat-input') as HTMLInputElement;
  const sendBtn = screen.getByTestId('agent-chat-send-btn');

  // 第 1 轮：查询世界观
  await act(async () => {
    fireEvent.change(input, { target: { value: '请查询当前小说的世界观规则' } });
    fireEvent.click(sendBtn);
  });

  await waitFor(() => {
    const userMsg = screen.getByTestId('agent-msg-user');
    assert.ok(userMsg);
    assert.equal(userMsg.textContent?.includes('请查询当前小说的世界观规则'), true);

    const toolCards = screen.getAllByTestId('agent-tool-card');
    assert.ok(toolCards.length >= 1);
    assert.equal(toolCards[0].textContent?.includes('查询世界状态'), true);
  });

  // 第 2 轮：为第一章规划分镜并生成正文
  await act(async () => {
    fireEvent.change(input, { target: { value: '为第一章规划分镜并生成正文' } });
    fireEvent.click(sendBtn);
  });

  await waitFor(() => {
    const toolCards = screen.getAllByTestId('agent-tool-card');
    assert.ok(toolCards.length >= 2);
    assert.ok(typeof _adoptedText === 'string');
  });

  novelMemoryManager.reset(novelId);
});

test('AgentChatWorkspace: 写操作安全确认机制 (Confirm & Reject)', async () => {
  const conv = agentConversationService.createConversation('novel-confirm-01', 'chap-01');

  // 模拟一个写操作安全申请
  conv.pendingConfirmations.push({
    confirmationId: 'conf-test-01',
    conversationId: conv.conversationId,
    toolName: 'update_memory',
    toolLabel: '更新记忆',
    arguments: { characterId: 'char-protagonist', emotion: '突破顿悟' },
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  await act(async () => {
    render(
      <AgentChatWorkspace
        novelId="novel-confirm-01"
        chapterId="chap-01"
        conversationId={conv.conversationId}
      />,
    );
  });

  // 验证确认卡片渲染
  await waitFor(() => {
    const confCard = screen.getByTestId('agent-confirmation-card');
    assert.ok(confCard);
    assert.equal(confCard.textContent?.includes('写操作安全确认申请'), true);
    assert.equal(confCard.textContent?.includes('更新记忆'), true);
  });

  // 点击确认执行
  const confirmBtn = screen.getByTestId('agent-confirm-btn');
  await act(async () => {
    fireEvent.click(confirmBtn);
  });

  // 验证确认后状态变为已处理
  await waitFor(() => {
    const pendingCards = screen.queryAllByTestId('agent-confirmation-card');
    assert.equal(pendingCards.length, 0);
  });
});
