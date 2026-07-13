import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coCreationSessionService } from '../../services/co-creation/coCreationSessionService';

describe('co-creation session browser persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores messages and working draft after reopening', async () => {
    let workspace = await coCreationSessionService.open('novel-a');
    const appended = await coCreationSessionService.appendUserMessage({
      workspace,
      content: '我想写一个记忆会被交易的世界。',
      operationId: 'append-1',
    });
    workspace = appended.workspace;
    workspace = await coCreationSessionService.saveDraft({
      workspace,
      stage: 'story_seed',
      payload: {
        currentStage: 'story_seed',
        fields: { 'storySeed.premise': { value: '记忆交易', state: 'user_confirmed' } },
      },
      origin: 'author_edit',
      operationId: 'draft-1',
    });

    const reopened = await coCreationSessionService.open('novel-a');
    expect(reopened.session.sessionId).toBe(workspace.session.sessionId);
    expect(reopened.messages).toHaveLength(1);
    expect(reopened.messages[0].content).toContain('记忆');
    expect(reopened.activeDraft?.payload.fields).toBeTruthy();
  });

  it('replays the same operation but rejects stale different mutations', async () => {
    const initial = await coCreationSessionService.open('novel-b');
    const first = await coCreationSessionService.appendUserMessage({
      workspace: initial, content: '第一条', operationId: 'same-operation',
    });
    const replay = await coCreationSessionService.appendUserMessage({
      workspace: initial, content: '第一条', operationId: 'same-operation',
    });
    expect(replay.workspace.messages).toHaveLength(1);
    await expect(coCreationSessionService.appendUserMessage({
      workspace: initial, content: '不同内容', operationId: 'different-operation',
    })).rejects.toMatchObject({ code: 'DOCUMENT_VERSION_CONFLICT' });
    expect((await coCreationSessionService.read('novel-b', first.workspace.session.sessionId)).messages)
      .toHaveLength(1);
  });

  it('fails closed on corrupted storage', async () => {
    await coCreationSessionService.open('novel-c');
    const key = Object.keys(localStorage).find((item) => item.includes('novel-c'))!;
    localStorage.setItem(key, '{bad json');
    await expect(coCreationSessionService.open('novel-c'))
      .rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_FAILED' });
  });

  it('does not report success when browser persistence fails', async () => {
    const workspace = await coCreationSessionService.open('novel-d');
    const original = localStorage.getItem.bind(localStorage);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await expect(coCreationSessionService.appendUserMessage({
      workspace, content: '不能丢失', operationId: 'quota-operation',
    })).rejects.toThrow('quota');
    spy.mockRestore();
    const raw = Object.keys(localStorage).map((key) => original(key)).join('');
    expect(raw).not.toContain('不能丢失');
  });
});
