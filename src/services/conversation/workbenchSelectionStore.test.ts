import assert from 'node:assert/strict';
import test from 'node:test';
import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';
import { clear, load, resolve, save } from './workbenchSelectionStore';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  failGet = false;
  failSet = false;
  failRemove = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    if (this.failGet) throw new Error('get unavailable');
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error('remove unavailable');
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('set unavailable');
    this.values.set(key, value);
  }

  replaceOnlyValue(value: string): void {
    const key = this.key(0);
    if (key) this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

function novel(id: string, updatedAt: string): Novel {
  return {
    id,
    title: id,
    description: '',
    outline: '',
    protagonistMode: 'single',
    protagonists: [],
    dualProtagonistRelation: {
      type: 'partner',
      description: '',
      conflict: '',
      cooperation: '',
      emotionalProgression: '',
      narrativeWeight: 'balanced',
    },
    status: 'draft',
    totalWordCount: 0,
    totalWords: 0,
    targetWords: 0,
    createdAt: updatedAt,
    updatedAt,
    volumes: [],
  };
}

function conversation(
  conversationId: string,
  novelId: string,
  updatedAt: string,
  overrides: Partial<TaskConversation> = {},
): TaskConversation {
  return {
    conversationId,
    novelId,
    title: conversationId,
    status: 'idle',
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

test.beforeEach(() => {
  storage.failGet = false;
  storage.failSet = false;
  storage.failRemove = false;
  storage.clear();
});

test('save, load and clear normalize a valid selection', () => {
  save({ novelId: ' novel-1 ', conversationId: ' task-1 ' });
  assert.deepEqual(load(), { novelId: 'novel-1', conversationId: 'task-1' });

  clear();
  assert.equal(load(), null);
});

test('storage failures and corrupt payloads never escape to the workbench', () => {
  save({ novelId: 'novel-1' });
  storage.replaceOnlyValue('{not-json');
  assert.equal(load(), null);

  storage.failSet = true;
  assert.doesNotThrow(() => save({ novelId: 'novel-2' }));
  storage.failSet = false;
  storage.failGet = true;
  assert.equal(load(), null);
  storage.failGet = false;
  storage.failRemove = true;
  assert.doesNotThrow(() => clear());
});

test('resolve keeps an existing active preferred conversation', () => {
  const novels = [novel('novel-1', '2026-08-20T00:00:00Z')];
  const conversations = [
    conversation('task-preferred', 'novel-1', '2026-08-20T00:00:00Z'),
    conversation('task-newer', 'novel-1', '2026-08-22T00:00:00Z'),
  ];

  assert.deepEqual(
    resolve(novels, conversations, {
      novelId: 'novel-1',
      conversationId: 'task-preferred',
    }),
    {
      novelId: 'novel-1',
      conversationId: 'task-preferred',
    },
  );
});

test('resolve ignores archived or stale preferences and selects the newest active conversation', () => {
  const novels = [
    novel('novel-1', '2026-08-23T00:00:00Z'),
    novel('novel-2', '2026-08-24T00:00:00Z'),
  ];
  const conversations = [
    conversation('task-archived-status', 'novel-1', '2026-08-28T00:00:00Z', {
      status: 'archived',
    }),
    conversation('task-archived-time', 'novel-1', '2026-08-27T00:00:00Z', {
      archivedAt: '2026-08-27T00:00:00Z',
    }),
    conversation('task-active', 'novel-2', '2026-08-26T00:00:00Z'),
    conversation('task-orphan', 'missing-novel', '2026-08-29T00:00:00Z'),
  ];

  assert.deepEqual(
    resolve(novels, conversations, {
      novelId: 'novel-1',
      conversationId: 'task-archived-status',
    }),
    { novelId: 'novel-2', conversationId: 'task-active' },
  );
});

test('resolve falls back to the newest novel when no active conversation exists', () => {
  const novels = [
    novel('novel-older', '2026-08-20T00:00:00Z'),
    novel('novel-newer', '2026-08-25T00:00:00Z'),
  ];
  const conversations = [
    conversation('task-archived', 'novel-newer', '2026-08-28T00:00:00Z', {
      archivedAt: '2026-08-28T00:00:00Z',
    }),
  ];

  assert.deepEqual(resolve(novels, conversations, null), { novelId: 'novel-newer' });
  assert.equal(resolve([], conversations, null), null);
});
