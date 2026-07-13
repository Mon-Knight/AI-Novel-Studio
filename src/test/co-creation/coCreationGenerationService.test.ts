import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoCreationWorkspaceSnapshot } from '../../types/coCreation';
import { createCoCreationGenerationRequest } from '../../features/co-creation/generationProtocol';

const mocks = vi.hoisted(() => ({
  buildContext: vi.fn(),
  getNovel: vi.fn(),
  getVolume: vi.fn(),
  getChapter: vi.fn(),
  compileMaster: vi.fn(),
  compileVolume: vi.fn(),
  compileChapters: vi.fn(),
  submitPrepared: vi.fn(),
  open: vi.fn(),
}));

vi.mock('../../features/co-creation/contextBuilder', () => ({
  buildCoCreationContext: mocks.buildContext,
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getById: mocks.getVolume },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.getChapter },
}));
vi.mock('../../services/ai/outlineGenerateService', () => ({
  outlineGenerateService: {
    compileNovelOutline: mocks.compileMaster,
    compileVolumeOutline: mocks.compileVolume,
    compileChapterOutlines: mocks.compileChapters,
    submitPrepared: mocks.submitPrepared,
  },
}));
vi.mock('../../services/co-creation/coCreationSessionService', () => ({
  coCreationSessionService: { open: mocks.open },
}));

import { coCreationGenerationService } from '../../services/co-creation/coCreationGenerationService';

function workspace(payload: Record<string, unknown> = {}): CoCreationWorkspaceSnapshot {
  const activeDraft = {
    draftRevisionId: 'draft-a', sessionId: 'session-a', stage: 'outline' as const, revisionNo: 1,
    schemaVersion: 1, payload, contentHash: 'draft-hash', origin: 'author_edit' as const,
    operationId: 'persisted:draft-a', requestHash: 'draft-hash', createdAt: 'now',
  };
  return {
    session: {
      sessionId: 'session-a', novelId: 'novel-a', title: 'AI 共创', status: 'active',
      currentStage: 'outline', stageProgress: [], objectContext: { novelId: 'novel-a' },
      dataRevision: 7, dataHash: 'state-hash', createdAt: 'now', updatedAt: 'now',
    },
    messages: [],
    draftRevisions: [activeDraft],
    activeDraft,
  };
}

async function request(input: Parameters<typeof createCoCreationGenerationRequest>[0]) {
  if (input.kind === 'chapter_generation_handoff') {
    return createCoCreationGenerationRequest(input);
  }
  const compiled = await coCreationGenerationService.compileBaseContext(workspace(), input);
  return createCoCreationGenerationRequest({
    ...input,
    compiledInputHash: compiled.compiledInputHash,
  });
}

async function executeRequest(generationRequest: Awaited<ReturnType<typeof request>>) {
  const authoritative = workspace({
    generationRequests: [{
      request: generationRequest,
      status: 'prepared',
      updatedAt: generationRequest.createdAt,
    }],
  });
  mocks.open.mockResolvedValue(authoritative);
  return coCreationGenerationService.execute(authoritative, generationRequest);
}

describe('co-creation generation orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNovel.mockResolvedValue({ id: 'novel-a', title: '作品 A' });
    mocks.getVolume.mockResolvedValue({ id: 'volume-a', novelId: 'novel-a', title: '第一卷' });
    mocks.getChapter.mockResolvedValue({
      id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '第一章', goal: '进入遗迹',
    });
    mocks.buildContext.mockResolvedValue({
      canonicalDataHash: 'context-hash',
      sourceManifest: [{ sourceType: 'novel', sourceId: 'novel-a' }],
      priorityOrder: ['formal_project_data', 'pending_draft', 'session_summary', 'recent_messages'],
      knownFields: {
        'storySeed.premise': { value: '记忆可以买卖', state: 'user_confirmed' },
      },
      sessionSummary: '作者希望保持悬疑感。',
      recentMessages: [{
        messageId: 'message-a', role: 'user', content: '从失窃记忆开场', contentHash: 'message-hash',
      }],
      objectContext: { novelId: 'novel-a' },
    });
    const prepared = {
      workflowName: '冻结大纲工作流', taskType: 'outline_generate', novelId: 'novel-a',
      scopeType: 'novel', inputPayloadJson: { frozen: true }, inputBody: 'frozen input',
      sourceManifestJson: [{ type: 'novel', id: 'novel-a', version: 'now' }],
      steps: [{ stepKey: 'outline', taskType: 'outline_generate', agentRole: '总纲',
        artifactType: 'outline_text', messages: [{ role: 'user', content: 'frozen prompt' }], reviewOutput: true }],
    };
    mocks.compileMaster.mockResolvedValue(prepared);
    mocks.compileVolume.mockResolvedValue({ ...prepared, taskType: 'volume_outline_generate' });
    mocks.compileChapters.mockResolvedValue({ ...prepared, taskType: 'chapter_outline_generate' });
    mocks.submitPrepared.mockResolvedValue({ workflowId: 'workflow-a', rootTaskId: 'root-a', childTaskIds: ['task-a'] });
  });

  it('maps a master outline to the existing background workflow with stable provenance', async () => {
    const generationRequest = await request({
      requestId: 'request-master', kind: 'master_outline', novelId: 'novel-a', sessionId: 'session-a',
      baseContextHash: 'context-hash', baseDataRevision: 7, createdAt: '2026-07-14T00:00:00.000Z',
    });
    const receipt = await executeRequest(generationRequest);
    const replay = await executeRequest(generationRequest);
    expect(receipt).toEqual(expect.objectContaining({
      receiptType: 'background_workflow', workflowId: 'workflow-a', rootTaskId: 'root-a',
    }));
    expect(replay).toEqual(expect.objectContaining({
      receiptType: 'background_workflow', workflowId: 'workflow-a', rootTaskId: 'root-a',
    }));
    expect(mocks.submitPrepared).toHaveBeenCalledWith(expect.objectContaining({
      inputBody: 'frozen input',
    }), expect.objectContaining({
      operationId: generationRequest.operationId,
      inputPayloadJson: expect.objectContaining({ coCreationRequestHash: generationRequest.requestHash }),
      sourceManifestJson: expect.arrayContaining([
        expect.objectContaining({ type: 'co_creation_generation_request', id: 'request-master' }),
      ]),
    }));
    expect(mocks.compileMaster).toHaveBeenCalledWith('novel-a', expect.objectContaining({
      coCreationContext: expect.stringContaining('storySeed.premise [user_confirmed]：记忆可以买卖'),
      generationSource: 'ai_co_creation',
    }));
  });

  it('blocks stale data and cross-novel or cross-volume targets before task submission', async () => {
    const stale = await request({
      requestId: 'request-stale', kind: 'volume_outline', novelId: 'novel-a', sessionId: 'session-a',
      volumeId: 'volume-a', baseContextHash: 'old-hash', baseDataRevision: 7,
    });
    await expect(executeRequest(stale)).rejects.toThrow('已经变化');
    expect(mocks.submitPrepared).not.toHaveBeenCalled();

    const mismatch = await request({
      requestId: 'request-mismatch', kind: 'chapter_outlines', novelId: 'novel-a', sessionId: 'session-a',
      volumeId: 'volume-a', chapterId: 'chapter-a', chapterCount: 1,
      baseContextHash: 'context-hash', baseDataRevision: 7,
    });
    mocks.getChapter.mockResolvedValueOnce({
      id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-other', title: '第一章',
    });
    await expect(executeRequest(mismatch)).rejects.toThrow('分卷不一致');
    expect(mocks.submitPrepared).not.toHaveBeenCalled();

    const invalidSource = await request({
      requestId: 'request-invalid-source', kind: 'master_outline',
      novelId: 'novel-a', sessionId: 'session-a', baseContextHash: 'context-hash', baseDataRevision: 7,
      sourceDraftRevisionId: 'draft-a', sourceDraftContentHash: 'wrong-draft-hash',
    });
    await expect(executeRequest(invalidSource))
      .rejects.toThrow('来源共创草案');
    expect(mocks.submitPrepared).not.toHaveBeenCalled();
  });

  it('trusts only the reopened authoritative workspace in a multi-window race', async () => {
    const generationRequest = await request({
      requestId: 'request-multi-window', kind: 'master_outline', novelId: 'novel-a',
      sessionId: 'session-a', baseContextHash: 'context-hash', baseDataRevision: 7,
    });
    const staleCaller = workspace({
      generationRequests: [{
        request: generationRequest, status: 'prepared', updatedAt: generationRequest.createdAt,
      }],
    });
    mocks.buildContext.mockClear();
    mocks.compileMaster.mockClear();
    mocks.submitPrepared.mockClear();
    mocks.open.mockResolvedValueOnce(workspace({ generationRequests: [] }));

    await expect(coCreationGenerationService.execute(staleCaller, generationRequest))
      .rejects.toThrow('权威共创草案中不存在');
    expect(mocks.buildContext).not.toHaveBeenCalled();
    expect(mocks.compileMaster).not.toHaveBeenCalled();
    expect(mocks.submitPrepared).not.toHaveBeenCalled();

    const tampered = { ...generationRequest, additionalInstruction: '另一窗口改写的请求' };
    mocks.open.mockResolvedValueOnce(workspace({
      generationRequests: [{
        request: tampered, status: 'prepared', updatedAt: generationRequest.createdAt,
      }],
    }));
    await expect(coCreationGenerationService.execute(staleCaller, generationRequest))
      .rejects.toThrow('精确生成请求');
    expect(mocks.submitPrepared).not.toHaveBeenCalled();
  });

  it('creates a handoff receipt without launching any generation task', async () => {
    const generationRequest = await request({
      requestId: 'request-handoff', kind: 'chapter_generation_handoff',
      novelId: 'novel-a', sessionId: 'session-a', chapterId: 'chapter-a',
      chapterPlan: '本章目标：进入遗迹', targetWordCount: 4200,
      baseContextHash: 'context-hash', baseDataRevision: 7,
    });
    const receipt = await executeRequest(generationRequest);
    expect(receipt).toEqual(expect.objectContaining({
      receiptType: 'chapter_generation_handoff', chapterId: 'chapter-a',
      chapterPlan: '本章目标：进入遗迹', targetWordCount: 4200,
    }));
    expect(mocks.submitPrepared).not.toHaveBeenCalled();
  });

  it('recovers the exact persisted handoff after reopening the co-creation session', async () => {
    const generationRequest = await request({
      requestId: 'request-recover', kind: 'chapter_generation_handoff',
      novelId: 'novel-a', sessionId: 'session-a', chapterId: 'chapter-a',
      chapterPlan: '本章目标：恢复计划', baseContextHash: 'context-hash', baseDataRevision: 7,
    });
    const receipt = await executeRequest(generationRequest);
    if (receipt.receiptType !== 'chapter_generation_handoff') throw new Error('expected handoff');
    mocks.open.mockResolvedValue(workspace({
      generationRequests: [{
        request: generationRequest,
        status: 'handoff_ready',
        receipt,
        updatedAt: '2026-07-14T00:00:00.000Z',
      }],
    }));
    await expect(coCreationGenerationService.getChapterGenerationHandoff(
      'novel-a', `co-creation-handoff:${generationRequest.requestId}`,
    )).resolves.toEqual(expect.objectContaining({
      requestId: 'request-recover', chapterId: 'chapter-a', chapterPlan: '本章目标：恢复计划',
    }));
    mocks.open.mockResolvedValueOnce(workspace({
      generationRequests: [{
        request: generationRequest,
        status: 'handoff_ready',
        receipt: { ...receipt, targetWordCount: 9_999 },
        updatedAt: '2026-07-14T00:00:00.000Z',
      }],
    }));
    await expect(coCreationGenerationService.getChapterGenerationHandoff(
      'novel-a', `co-creation-handoff:${generationRequest.requestId}`,
    )).rejects.toThrow('来源校验失败');
    mocks.open.mockResolvedValue(workspace({
      generationRequests: [{
        request: generationRequest,
        status: 'handoff_ready',
        receipt,
        updatedAt: '2026-07-14T00:00:00.000Z',
      }],
    }));
    mocks.buildContext.mockResolvedValueOnce({ canonicalDataHash: 'changed-context', sourceManifest: [] });
    await expect(coCreationGenerationService.getChapterGenerationHandoff(
      'novel-a', `co-creation-handoff:${generationRequest.requestId}`,
    )).rejects.toThrow('已经变化');
  });
});
