import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoCreationSession } from '../../types/coCreation';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  dbCall: vi.fn(),
  createBackground: vi.fn(),
  refreshTasks: vi.fn(),
  getArtifact: vi.fn(),
  cancelTask: vi.fn(),
  buildContext: vi.fn(),
}));

vi.mock('../../services/database/db', () => ({
  isTauri: mocks.isTauri,
  dbCall: mocks.dbCall,
}));

vi.mock('../../services/ai-tasks/aiWorkflowService', () => ({
  aiWorkflowService: { createBackground: mocks.createBackground },
}));

vi.mock('../../services/ai-tasks/aiTaskCenterService', () => ({
  aiTaskCenterService: {
    refresh: mocks.refreshTasks,
    getArtifact: mocks.getArtifact,
    cancel: mocks.cancelTask,
  },
}));

vi.mock('../../features/co-creation/contextBuilder', () => ({
  buildCoCreationContext: mocks.buildContext,
}));

import { conversationOrchestratorService } from '../../services/co-creation/conversationOrchestratorService';

function session(): CoCreationSession {
  return {
    sessionId: 'session-1',
    novelId: 'novel-1',
    title: 'AI 共创',
    status: 'active',
    currentStage: 'story_seed',
    stageProgress: [],
    objectContext: { novelId: 'novel-1' },
    dataRevision: 7,
    dataHash: 'session-hash',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

const pollInput = {
  session: session(),
  messages: [],
  sourceTaskId: 'task-1',
  expectedCanonicalDataHash: 'frozen-hash',
  expectedDataRevision: 7,
  expectedStage: 'story_seed' as const,
  expectedUserMessageId: 'user-1',
};

describe('conversation orchestrator recovery and stale boundary', () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.refreshTasks.mockResolvedValue([{
      id: 'task-1', userStatus: 'completed', artifactId: 'artifact-1',
    }]);
    mocks.buildContext.mockResolvedValue({ canonicalDataHash: 'frozen-hash' });
  });

  it('recovers the Task created for an unbound user turn', async () => {
    mocks.dbCall.mockResolvedValue({
      taskId: 'task-1',
      currentStage: 'story_seed',
      canonicalDataHash: 'frozen-hash',
      dataRevision: 7,
    });

    await expect(conversationOrchestratorService.recoverTurnTask({
      novelId: 'novel-1', sessionId: 'session-1', userMessageId: 'user-1',
    })).resolves.toEqual({
      sourceTaskId: 'task-1',
      currentStage: 'story_seed',
      canonicalDataHash: 'frozen-hash',
      dataRevision: 7,
    });
    expect(mocks.dbCall).toHaveBeenCalledWith('recover_co_creation_turn_task', {
      input: { novelId: 'novel-1', sessionId: 'session-1', userMessageId: 'user-1' },
    });
  });

  it('marks a completed task stale before reading its Artifact when formal data changed', async () => {
    mocks.buildContext.mockResolvedValue({ canonicalDataHash: 'new-formal-data-hash' });

    await expect(conversationOrchestratorService.pollTurn(pollInput)).resolves.toEqual({
      status: 'stale',
      artifactId: 'artifact-1',
      message: '正式作品数据或共创草案已变化，请重新生成',
    });
    expect(mocks.getArtifact).not.toHaveBeenCalled();
  });

  it('rejects an Artifact whose structured protocol changes the frozen stage', async () => {
    mocks.getArtifact.mockResolvedValue({
      artifactId: 'artifact-1',
      structuredPayload: { schemaVersion: 1, currentStage: 'creative_intent' },
    });

    await expect(conversationOrchestratorService.pollTurn(pollInput))
      .rejects.toThrow('AI 共创结构化结果无效：currentStage 与冻结阶段不一致');
  });
});
