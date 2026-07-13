import { describe, expect, it } from 'vitest';
import { compressCoCreationMessages } from '../../features/co-creation/sessionSummary';
import type { CoCreationMessage } from '../../types/coCreation';

function message(index: number): CoCreationMessage {
  return {
    messageId: `message-${index}`,
    sessionId: 'session-a',
    sequenceNo: index,
    role: index % 2 ? 'user' : 'assistant',
    status: 'completed',
    content: `第 ${index} 轮内容`,
    contentHash: `hash-${index}`,
    contentLength: 8,
    operationId: `operation-${index}`,
    requestHash: `request-${index}`,
    createdAt: new Date(index * 1000).toISOString(),
  };
}

describe('co-creation session summary compression', () => {
  it('keeps raw messages while summarizing only history outside the recent window', async () => {
    const messages = Array.from({ length: 12 }, (_, index) => message(index + 1));
    const result = await compressCoCreationMessages(messages);
    expect(messages).toHaveLength(12);
    expect(result.summary).toContain('第 1 轮内容');
    expect(result.summary).toContain('第 4 轮内容');
    expect(result.summary).not.toContain('第 12 轮内容');
    expect(result.summarizedThroughSequence).toBe(4);
    expect(result.summaryHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
