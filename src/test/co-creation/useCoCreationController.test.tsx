import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CoCreationDraftRevision,
  CoCreationMessage,
  CoCreationTurnOutputV1,
  CoCreationWorkspaceDiscussionHandoffV1,
  CoCreationWorkspaceSnapshot,
} from '../../types/coCreation';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  appendUserMessage: vi.fn(),
  bindTurnTask: vi.fn(),
  completeTurn: vi.fn(),
  failTurn: vi.fn(),
  saveDraft: vi.fn(),
  recoverTurnTask: vi.fn(),
  submitTurn: vi.fn(),
  pollTurn: vi.fn(),
  getNovel: vi.fn(),
  getChapter: vi.fn(),
  getLatestDraft: vi.fn(),
  buildContext: vi.fn(),
  computeDataHash: vi.fn(),
  prepareApply: vi.fn(),
  executeApply: vi.fn(),
  prepareUndo: vi.fn(),
  executeGeneration: vi.fn(),
  compileGenerationContext: vi.fn(),
}));

vi.mock('../../services/co-creation/coCreationSessionService', () => ({
  coCreationSessionService: {
    open: mocks.open,
    appendUserMessage: mocks.appendUserMessage,
    bindTurnTask: mocks.bindTurnTask,
    completeTurn: mocks.completeTurn,
    failTurn: mocks.failTurn,
    saveDraft: mocks.saveDraft,
  },
}));

vi.mock('../../services/co-creation/conversationOrchestratorService', () => ({
  conversationOrchestratorService: {
    recoverTurnTask: mocks.recoverTurnTask,
    submitTurn: mocks.submitTurn,
    pollTurn: mocks.pollTurn,
  },
}));

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.getChapter },
}));

vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { getLatestByChapterId: mocks.getLatestDraft },
}));

vi.mock('../../features/co-creation/contextBuilder', () => ({
  buildCoCreationContext: mocks.buildContext,
  computeCoCreationDataHash: mocks.computeDataHash,
}));

vi.mock('../../services/co-creation/coCreationApplyService', () => ({
  coCreationApplyService: {
    prepare: mocks.prepareApply,
    execute: mocks.executeApply,
    prepareUndo: mocks.prepareUndo,
  },
}));

vi.mock('../../services/co-creation/coCreationGenerationService', () => ({
  coCreationGenerationService: {
    execute: mocks.executeGeneration,
    compileBaseContext: mocks.compileGenerationContext,
  },
}));

import { useCoCreationController } from '../../features/co-creation/useCoCreationController';

const turnContext = {
  currentStage: 'story_seed' as const,
  canonicalDataHash: 'frozen-hash',
  dataRevision: 7,
};

function output(overrides: Partial<CoCreationTurnOutputV1> = {}): CoCreationTurnOutputV1 {
  return {
    schemaVersion: 1,
    naturalLanguageReply: '我们继续完善故事种子。',
    intent: 'answer_current_question',
    currentStage: 'story_seed',
    extractedInformation: [],
    pendingConfirmations: [],
    quickReplies: [],
    changeSuggestions: [],
    stageCompletion: {
      stage: 'story_seed',
      status: 'in_progress',
      completedRequiredFields: [],
      missingRequiredFields: ['storySeed.premise'],
      percentage: 0,
    },
    dataRevision: 7,
    ...overrides,
  };
}

function userMessage(input: {
  status?: CoCreationMessage['status'];
  taskId?: string;
  withTurnContext?: boolean;
} = {}): CoCreationMessage {
  return {
    messageId: 'user-1',
    sessionId: 'session-1',
    sequenceNo: 1,
    role: 'user',
    status: input.status ?? 'pending',
    content: '记忆可以被交易。',
    contentHash: 'user-hash',
    contentLength: 8,
    sourceTaskId: input.taskId,
    ...(input.withTurnContext ? { turnContext } : {}),
    operationId: 'append-1',
    requestHash: 'append-hash',
    createdAt: '2026-07-13T00:00:00.000Z',
  };
}

function assistantMessage(structuredPayload: unknown = output()): CoCreationMessage {
  return {
    messageId: 'assistant-1',
    sessionId: 'session-1',
    sequenceNo: 2,
    role: 'assistant',
    status: 'completed',
    content: '我们继续完善故事种子。',
    contentHash: 'assistant-hash',
    contentLength: 12,
    replyToMessageId: 'user-1',
    sourceTaskId: 'task-1',
    sourceArtifactId: 'artifact-1',
    structuredPayload,
    operationId: 'complete-1',
    requestHash: 'complete-hash',
    createdAt: '2026-07-13T00:00:01.000Z',
    completedAt: '2026-07-13T00:00:01.000Z',
  };
}

function draft(input: {
  id?: string;
  revision?: number;
  payload?: Record<string, unknown>;
  origin?: CoCreationDraftRevision['origin'];
  artifactId?: string;
} = {}): CoCreationDraftRevision {
  return {
    draftRevisionId: input.id ?? 'draft-1',
    sessionId: 'session-1',
    stage: 'story_seed',
    revisionNo: input.revision ?? 1,
    schemaVersion: 1,
    payload: input.payload ?? { currentStage: 'story_seed', fields: {}, suggestions: [] },
    contentHash: `draft-hash-${input.revision ?? 1}`,
    origin: input.origin ?? 'author_edit',
    ...(input.artifactId ? {
      sourceMessageId: 'assistant-1',
      sourceTaskId: 'task-1',
      sourceArtifactId: input.artifactId,
    } : {}),
    operationId: `draft-operation-${input.revision ?? 1}`,
    requestHash: `draft-request-${input.revision ?? 1}`,
    createdAt: '2026-07-13T00:00:02.000Z',
  };
}

function workspace(input: {
  messages?: CoCreationMessage[];
  drafts?: CoCreationDraftRevision[];
} = {}): CoCreationWorkspaceSnapshot {
  const messages = input.messages ?? [];
  const drafts = input.drafts ?? [];
  const activeDraft = drafts[drafts.length - 1];
  return {
    session: {
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
    },
    messages,
    draftRevisions: drafts,
    ...(activeDraft ? { activeDraft } : {}),
    pendingTurn: [...messages].reverse().find((message) => (
      message.role === 'user' && message.status === 'pending'
    )),
  };
}

function withDraft(
  current: CoCreationWorkspaceSnapshot,
  input: {
    stage: CoCreationDraftRevision['stage'];
    payload: Record<string, unknown>;
    origin: CoCreationDraftRevision['origin'];
    sourceMessageId?: string;
    sourceTaskId?: string;
    sourceArtifactId?: string;
  },
): CoCreationWorkspaceSnapshot {
  const previous = current.draftRevisions[current.draftRevisions.length - 1];
  const next = draft({
    id: `draft-${current.draftRevisions.length + 1}`,
    revision: (previous?.revisionNo ?? 0) + 1,
    payload: input.payload,
    origin: input.origin,
    artifactId: input.sourceArtifactId,
  });
  return {
    ...current,
    session: { ...current.session, currentStage: input.stage },
    draftRevisions: [...current.draftRevisions, next],
    activeDraft: next,
  };
}

function completeWorkspace(
  current: CoCreationWorkspaceSnapshot,
  artifactId: string,
  assistantContent: string,
): CoCreationWorkspaceSnapshot {
  const parsed = JSON.parse(assistantContent) as Record<string, unknown>;
  const completedUser = current.messages.map((message) => message.messageId === 'user-1'
    ? { ...message, status: 'completed' as const, sourceArtifactId: artifactId }
    : message);
  const assistant = {
    ...assistantMessage(parsed),
    sourceArtifactId: artifactId,
    content: typeof parsed.naturalLanguageReply === 'string'
      ? parsed.naturalLanguageReply : assistantMessage().content,
  };
  return {
    ...current,
    messages: [...completedUser, assistant],
    pendingTurn: undefined,
  };
}

describe('AI co-creation controller recovery and stale safety', () => {
  beforeEach(() => {
    mocks.getNovel.mockResolvedValue({ id: 'novel-1', title: '记忆之城' });
    mocks.getChapter.mockResolvedValue({
      id: 'chapter-1', novelId: 'novel-1', volumeId: 'volume-1', title: '第一章',
    });
    mocks.getLatestDraft.mockResolvedValue(null);
    mocks.buildContext.mockResolvedValue({ canonicalDataHash: 'frozen-hash', canonical: {} });
    mocks.computeDataHash.mockResolvedValue('review-hash');
    mocks.recoverTurnTask.mockResolvedValue(null);
    mocks.submitTurn.mockResolvedValue({
      sourceTaskId: 'task-1',
      currentStage: 'story_seed',
      canonicalDataHash: 'frozen-hash',
      dataRevision: 7,
    });
    mocks.pollTurn.mockResolvedValue({
      status: 'completed', artifactId: 'artifact-1', output: output(),
    });
    mocks.executeGeneration.mockResolvedValue({
      receiptType: 'chapter_generation_handoff',
      handoffId: 'co-creation-handoff:request-1',
      requestId: 'request-1',
      requestHash: 'request-hash',
      novelId: 'novel-1',
      volumeId: 'volume-1',
      chapterId: 'chapter-1',
      chapterPlan: '本章目标：找到线索',
      baseContextHash: 'frozen-hash',
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    mocks.compileGenerationContext.mockImplementation(async (_workspace, input) => ({
      baseContextHash: 'frozen-hash',
      ...(input.kind === 'chapter_generation_handoff'
        ? {} : { compiledInputHash: 'compiled-input-hash' }),
    }));
    mocks.bindTurnTask.mockImplementation(async ({ workspace: current, taskId, turnContext: context }) => {
      const messages = current.messages.map((message: CoCreationMessage) => message.messageId === 'user-1'
        ? { ...message, sourceTaskId: taskId, turnContext: context }
        : message);
      return workspace({ messages, drafts: current.draftRevisions });
    });
    mocks.completeTurn.mockImplementation(async ({ workspace: current, artifactId, assistantContent }) => (
      completeWorkspace(current, artifactId, assistantContent)
    ));
    mocks.failTurn.mockImplementation(async ({ workspace: current }) => {
      const messages = current.messages.map((message: CoCreationMessage) => message.messageId === 'user-1'
        ? { ...message, status: 'failed' as const }
        : message);
      return workspace({ messages, drafts: current.draftRevisions });
    });
    mocks.saveDraft.mockImplementation(async (input) => withDraft(input.workspace, input));
  });

  it('persists a workspace selection only after the latest full draft passes hash and range verification', async () => {
    const content = '开端\n被选中的段落\n结尾';
    const selectionStart = content.indexOf('被选中');
    const selectionEnd = selectionStart + '被选中的段落'.length;
    const handoff: CoCreationWorkspaceDiscussionHandoffV1 = {
      schemaVersion: 1,
      handoffId: 'handoff-1',
      novelId: 'novel-1',
      volumeId: 'volume-1',
      chapterId: 'chapter-1',
      draftId: 'draft-old',
      draftVersion: 2,
      documentContentHash: await computeContentSha256(content),
      selectionStart,
      selectionEnd,
      selectedText: '被选中的段落',
      selectedTextHash: await computeContentSha256('被选中的段落'),
      createdAt: '2026-07-14T00:00:00.000Z',
    };
    mocks.open.mockResolvedValue(workspace());
    mocks.getLatestDraft.mockResolvedValue({
      id: 'draft-saved', novelId: 'novel-1', chapterId: 'chapter-1', versionNo: 3,
      content, contentState: { status: 'ready', content, contentHash: 'hash', contentLength: content.length },
    });

    const { result } = renderHook(() => useCoCreationController('novel-1', 'chapter-1', handoff));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'author_edit',
      payload: expect.objectContaining({
        objectContext: expect.objectContaining({
          novelId: 'novel-1', chapterId: 'chapter-1', volumeId: 'volume-1',
          objectType: 'chapter', objectId: 'chapter-1', discussionHandoffId: 'handoff-1',
          selectedText: '被选中的段落', draftId: 'draft-saved', draftVersion: 3,
          selectionStart, selectionEnd,
        }),
      }),
    }));
    expect(result.current.notice).toContain('安全恢复');
  });

  it('drops a dirty-editor selection after the author discards it and the persisted body hash differs', async () => {
    const dirtyContent = '未保存且最终放弃的正文';
    const handoff: CoCreationWorkspaceDiscussionHandoffV1 = {
      schemaVersion: 1,
      handoffId: 'handoff-stale',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      documentContentHash: await computeContentSha256(dirtyContent),
      selectionStart: 0,
      selectionEnd: dirtyContent.length,
      selectedText: dirtyContent,
      selectedTextHash: await computeContentSha256(dirtyContent),
      createdAt: '2026-07-14T00:00:00.000Z',
    };
    mocks.open.mockResolvedValue(workspace());
    mocks.getLatestDraft.mockResolvedValue({
      id: 'draft-persisted', novelId: 'novel-1', chapterId: 'chapter-1', versionNo: 2,
      content: '仍然是原正文',
      contentState: { status: 'ready', content: '仍然是原正文', contentHash: 'hash', contentLength: 7 },
    });

    const { result } = renderHook(() => useCoCreationController('novel-1', 'chapter-1', handoff));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const lastSaveCall = mocks.saveDraft.mock.calls[mocks.saveDraft.mock.calls.length - 1];
    const savedContext = lastSaveCall?.[0].payload.objectContext;
    expect(savedContext).toEqual(expect.objectContaining({
      novelId: 'novel-1', chapterId: 'chapter-1', objectType: 'chapter', objectId: 'chapter-1',
    }));
    expect(savedContext.selectedText).toBeUndefined();
    expect(result.current.notice).toContain('正文已变化');
  });

  it('recovers a crash immediately after appending the user message', async () => {
    mocks.open.mockResolvedValue(workspace({ messages: [userMessage()] }));

    const { result } = renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(result.current.sending).toBe(false));
    await waitFor(() => expect(mocks.completeTurn).toHaveBeenCalledTimes(1));
    expect(mocks.recoverTurnTask).toHaveBeenCalledWith({
      novelId: 'novel-1', sessionId: 'session-1', userMessageId: 'user-1',
    });
    expect(mocks.submitTurn).toHaveBeenCalledTimes(1);
    expect(mocks.bindTurnTask).toHaveBeenCalledWith(expect.objectContaining({
      userMessageId: 'user-1', taskId: 'task-1', turnContext,
    }));
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'author_edit',
      operationId: 'co-creation:session-1:message:user-1:pending',
    }));
    expect(result.current.snapshot?.messages.some((message) => message.role === 'assistant')).toBe(true);
  });

  it('recovers the already-created Task instead of creating a duplicate before bind', async () => {
    mocks.open.mockResolvedValue(workspace({ messages: [userMessage()] }));
    mocks.recoverTurnTask.mockResolvedValue({
      sourceTaskId: 'task-1',
      currentStage: 'story_seed',
      canonicalDataHash: 'frozen-hash',
      dataRevision: 7,
    });

    renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.completeTurn).toHaveBeenCalledTimes(1));
    expect(mocks.submitTurn).not.toHaveBeenCalled();
    expect(mocks.bindTurnTask).toHaveBeenCalledTimes(1);
  });

  it('resumes a bound turn even when the pending-draft checkpoint was not saved', async () => {
    mocks.open.mockResolvedValue(workspace({
      messages: [userMessage({ taskId: 'task-1', withTurnContext: true })],
      drafts: [draft()],
    }));

    renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.completeTurn).toHaveBeenCalledTimes(1));
    expect(mocks.recoverTurnTask).not.toHaveBeenCalled();
    expect(mocks.submitTurn).not.toHaveBeenCalled();
    expect(mocks.bindTurnTask).not.toHaveBeenCalled();
    expect(mocks.pollTurn).toHaveBeenCalledWith(expect.objectContaining({
      sourceTaskId: 'task-1',
      expectedCanonicalDataHash: 'frozen-hash',
      expectedDataRevision: 7,
      expectedStage: 'story_seed',
      expectedUserMessageId: 'user-1',
    }));
  });

  it('projects a completed assistant message after a crash before draft creation', async () => {
    const completedUser = userMessage({ status: 'completed', taskId: 'task-1', withTurnContext: true });
    mocks.open.mockResolvedValue(workspace({ messages: [completedUser, assistantMessage()] }));

    const { result } = renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'assistant_turn',
      sourceMessageId: 'assistant-1',
      sourceTaskId: 'task-1',
      sourceArtifactId: 'artifact-1',
      operationId: 'co-creation:session-1:artifact:artifact-1:draft',
    })));
    expect(mocks.pollTurn).not.toHaveBeenCalled();
    expect(result.current.snapshot?.activeDraft?.origin).toBe('assistant_turn');
  });

  it('terminalizes invalid protocol output and clears the pending checkpoint', async () => {
    mocks.open.mockResolvedValue(workspace({
      messages: [userMessage({ taskId: 'task-1', withTurnContext: true })],
      drafts: [draft({ payload: {
        currentStage: 'story_seed', fields: {}, suggestions: [],
        pendingTurn: { userMessageId: 'user-1', sourceTaskId: 'task-1', ...turnContext },
      } })],
    }));
    mocks.pollTurn.mockRejectedValue(new Error('AI 共创结构化结果无效：currentStage 与冻结阶段不一致'));

    const { result } = renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.failTurn).toHaveBeenCalledWith(expect.objectContaining({
      userMessageId: 'user-1',
      taskId: 'task-1',
      errorCode: 'CO_CREATION_OUTPUT_INVALID',
    })));
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'author_edit',
      operationId: 'co-creation:session-1:message:user-1:clear-failed',
      payload: expect.objectContaining({ pendingTurn: null }),
    }));
    expect(result.current.snapshot?.pendingTurn).toBeUndefined();
    expect(result.current.notice).toContain('安全终止');
  });

  it('terminalizes provider failure with a bounded credential-free error summary', async () => {
    mocks.open.mockResolvedValue(workspace({
      messages: [userMessage({ taskId: 'task-1', withTurnContext: true })],
    }));
    mocks.pollTurn.mockResolvedValue({
      status: 'failed',
      message: `${'上游服务错误'.repeat(300)} Authorization: Bearer abcdefghijk`,
    });

    renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.failTurn).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'AI_TASK_FAILED',
      errorMessage: '共创对话任务失败',
    })));
  });

  it('preserves historical stale markers when a later stale Artifact is recorded', async () => {
    const historical = draft({
      id: 'draft-old-stale',
      revision: 1,
      payload: {
        currentStage: 'story_seed', fields: {}, suggestions: [], staleArtifactIds: ['artifact-old'],
      },
    });
    const latest = draft({ id: 'draft-latest', revision: 2 });
    mocks.open.mockResolvedValue(workspace({
      messages: [userMessage({ taskId: 'task-1', withTurnContext: true })],
      drafts: [historical, latest],
    }));
    mocks.pollTurn.mockResolvedValue({
      status: 'stale', artifactId: 'artifact-new', message: '正式页面已修改',
    });

    const { result } = renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'co-creation:session-1:artifact:artifact-new:stale',
      payload: expect.objectContaining({ staleArtifactIds: ['artifact-old', 'artifact-new'] }),
    })));
    expect(mocks.completeTurn).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-new',
    }));
    expect(result.current.snapshot?.pendingTurn).toBeUndefined();
    expect(result.current.notice).toBe('正式页面已修改');
  });

  it('does not re-project a stale Artifact whose marker only exists in an older revision', async () => {
    const completedUser = userMessage({ status: 'completed', taskId: 'task-1', withTurnContext: true });
    mocks.open.mockResolvedValue(workspace({
      messages: [completedUser, assistantMessage()],
      drafts: [
        draft({
          id: 'draft-stale-marker',
          revision: 1,
          payload: {
            currentStage: 'story_seed', fields: {}, suggestions: [], staleArtifactIds: ['artifact-1'],
          },
        }),
        draft({ id: 'draft-later-author-edit', revision: 2 }),
      ],
    }));

    const { result } = renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
  });

  it('terminalizes a stale result when the backend refuses completion', async () => {
    mocks.open.mockResolvedValue(workspace({
      messages: [userMessage({ taskId: 'task-1', withTurnContext: true })],
    }));
    mocks.pollTurn.mockResolvedValue({ status: 'stale', artifactId: 'artifact-stale' });
    mocks.completeTurn.mockRejectedValue({ code: 'CO_CREATION_RESULT_STALE' });

    renderHook(() => useCoCreationController('novel-1'));

    await waitFor(() => expect(mocks.failTurn).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'CO_CREATION_RESULT_STALE',
      errorMessage: 'AI 共创结果已经过期',
    })));
  });

  it('blocks suggestion adoption after formal project data changes', async () => {
    const suggestion = {
      suggestionId: 'suggestion-1',
      target: { objectType: 'story_seed' as const, fieldPath: 'storySeed.premise' },
      originalValue: null,
      suggestedValue: '一座出售记忆的城市',
      fieldState: 'ai_suggested' as const,
      sourceType: 'ai_inference' as const,
      sourceReferences: [],
      confidence: 0.9,
      conflicts: [],
      baseDataRevision: 7,
      baseContextHash: 'old-context-hash',
      decision: 'pending' as const,
      candidateHash: 'candidate-hash',
      sourceMessageId: 'assistant-1',
      sourceTaskId: 'task-1',
      sourceArtifactId: 'artifact-1',
    };
    const acceptedSourceDraft = draft({
      origin: 'assistant_turn',
      artifactId: 'artifact-1',
      payload: { currentStage: 'story_seed', fields: {}, suggestions: [suggestion] },
    });
    mocks.open.mockResolvedValue(workspace({
      messages: [
        userMessage({ status: 'completed', taskId: 'task-1', withTurnContext: true }),
        assistantMessage(),
      ],
      drafts: [acceptedSourceDraft],
    }));
    mocks.buildContext.mockResolvedValue({ canonicalDataHash: 'new-context-hash', canonical: {} });

    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.saveDraft.mockClear();

    await act(async () => {
      await result.current.acceptSuggestion('suggestion-1');
    });

    expect(result.current.error).toContain('建议基于旧的数据版本');
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it('keeps sibling suggestions from the same Artifact adoptable after a draft decision', async () => {
    const suggestion = (id: string, fieldPath: string) => ({
      suggestionId: id,
      target: { objectType: 'creative_intent' as const, fieldPath },
      originalValue: null,
      suggestedValue: id === 'suggestion-1' ? '悬疑' : '紧凑、沉浸',
      fieldState: 'ai_suggested' as const,
      sourceType: 'ai_inference' as const,
      sourceReferences: [],
      confidence: 0.9,
      conflicts: [],
      baseDataRevision: 7,
      baseContextHash: 'frozen-hash',
      decision: 'pending' as const,
      candidateHash: `candidate-${id}`,
      sourceMessageId: 'assistant-1',
      sourceTaskId: 'task-1',
      sourceArtifactId: 'artifact-1',
    });
    const activeDraft = draft({
      origin: 'assistant_turn',
      artifactId: 'artifact-1',
      payload: {
        currentStage: 'creative_intent',
        fields: {},
        suggestions: [
          suggestion('suggestion-1', 'creativeIntent.genre'),
          suggestion('suggestion-2', 'creativeIntent.readerExperience'),
        ],
      },
    });
    mocks.open.mockResolvedValue(workspace({ drafts: [activeDraft] }));
    mocks.buildContext.mockImplementation(async (input) => ({
      canonicalDataHash: input.activeDraft?.payload.fields
        && Object.keys(input.activeDraft.payload.fields as object).length > 0
        ? 'review-hash' : 'frozen-hash',
      canonical: {},
    }));
    mocks.computeDataHash
      .mockResolvedValueOnce('review-hash')
      .mockResolvedValueOnce('review-hash-2');

    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.acceptSuggestion('suggestion-1');
      await result.current.acceptSuggestion('suggestion-2');
    });

    expect(result.current.error).toBe('');
    const latestSave = mocks.saveDraft.mock.calls[mocks.saveDraft.mock.calls.length - 1];
    const latestPayload = latestSave?.[0].payload;
    expect(latestPayload.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionId: 'suggestion-1', decision: 'accepted_to_draft' }),
      expect.objectContaining({ suggestionId: 'suggestion-2', decision: 'accepted_to_draft' }),
    ]));
  });

  it('preserves durable turn and generation metadata when an ordinary field is edited', async () => {
    const activeDraft = draft({
      payload: {
        currentStage: 'story_seed',
        fields: {},
        suggestions: [],
        lastTurn: { intent: 'generate_outline', naturalLanguageReply: '可以开始生成总纲。' },
        generationRequests: [{ request: { requestId: 'request-a' }, status: 'submitted' }],
      },
    });
    mocks.open.mockResolvedValue(workspace({ drafts: [activeDraft] }));
    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.saveDraft.mockClear();

    await act(async () => {
      await result.current.editField('storySeed.premise', '记忆可以被交易');
    });

    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        lastTurn: expect.objectContaining({ intent: 'generate_outline' }),
        generationRequests: [expect.objectContaining({ status: 'submitted' })],
      }),
    }));
  });

  it('preserves a verified selection when preparing generation for the same chapter', async () => {
    const activeDraft = draft({
      payload: {
        currentStage: 'chapter_plan',
        fields: {
          'chapterPlan.goal': { value: '找到失落线索', state: 'user_confirmed' },
        },
        suggestions: [],
      },
    });
    const initial = workspace({ drafts: [activeDraft] });
    initial.session.objectContext = {
      novelId: 'novel-1',
      volumeId: 'volume-1',
      chapterId: 'chapter-1',
      selectedText: '被选中的段落',
      selectedTextHash: 'selection-hash',
      documentContentHash: 'document-hash',
      selectionStart: 2,
      selectionEnd: 9,
    };
    mocks.open.mockResolvedValue(initial);
    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.saveDraft.mockClear();

    await act(async () => {
      await result.current.startGeneration({
        kind: 'chapter_generation_handoff',
        volumeId: 'volume-1',
        chapterId: 'chapter-1',
      });
    });

    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        objectContext: expect.objectContaining({
          chapterId: 'chapter-1',
          selectedText: '被选中的段落',
          selectedTextHash: 'selection-hash',
        }),
      }),
    }));
    const completedCall = mocks.saveDraft.mock.calls.find((call) => (
      call[0].payload.generationRequests?.[0]?.status === 'handoff_ready'
    ));
    expect(completedCall?.[0].payload.fields).toEqual(expect.objectContaining({
      'chapterGeneration.chapterId': { value: 'chapter-1', state: 'user_confirmed' },
      'chapterGeneration.planReady': { value: true, state: 'user_confirmed' },
    }));
    expect(completedCall?.[0].payload.stageProgress).toContainEqual(expect.objectContaining({
      stage: 'chapter_generation', status: 'complete', percentage: 100,
    }));
  });

  it('reconciles a committed generation record when its save response is lost', async () => {
    const activeDraft = draft({
      payload: {
        currentStage: 'chapter_plan',
        fields: {
          'chapterPlan.goal': { value: '找到失落线索', state: 'user_confirmed' },
        },
        suggestions: [],
      },
    });
    let authoritative = workspace({ drafts: [activeDraft] });
    mocks.open.mockImplementation(async () => authoritative);
    let lostResponse = false;
    mocks.saveDraft.mockImplementation(async (input) => {
      const saved = withDraft(input.workspace, input);
      authoritative = saved;
      const statuses = (input.payload.generationRequests as Array<{ status?: string }> | undefined)
        ?.map((record) => record.status) ?? [];
      if (!lostResponse && statuses.includes('handoff_ready')) {
        lostResponse = true;
        throw new Error('commit response lost');
      }
      return saved;
    });

    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.startGeneration({
        kind: 'chapter_generation_handoff',
        volumeId: 'volume-1',
        chapterId: 'chapter-1',
      });
    });

    expect(lostResponse).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.notice).toContain('安全交接');
    const savedStatuses = mocks.saveDraft.mock.calls.map((call) => (
      (call[0].payload.generationRequests as Array<{ status?: string }> | undefined)?.[0]?.status
    ));
    expect(savedStatuses).toEqual(['prepared', 'handoff_ready']);
    expect(savedStatuses).not.toContain('failed');
    const completedCall = mocks.saveDraft.mock.calls[1][0];
    const completedRecord = completedCall.payload.generationRequests[0];
    expect(completedCall.operationId).toMatch(
      /^co-creation:session-1:generation:.+:handoff_ready$/,
    );
    expect(completedRecord.updatedAt).toBe(completedRecord.request.createdAt);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.activeDraft?.payload.generationRequests)
      .toEqual([expect.objectContaining({ status: 'handoff_ready' })]);
  });

  it('drops the old selection when preparing generation for another chapter', async () => {
    const activeDraft = draft({
      payload: {
        currentStage: 'chapter_plan',
        fields: {
          'chapterPlan.goal': { value: '找到失落线索', state: 'user_confirmed' },
        },
        suggestions: [],
      },
    });
    const initial = workspace({ drafts: [activeDraft] });
    initial.session.objectContext = {
      novelId: 'novel-1', chapterId: 'chapter-1', selectedText: '旧章节选区',
    };
    mocks.open.mockResolvedValue(initial);
    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.saveDraft.mockClear();

    await act(async () => {
      await result.current.startGeneration({
        kind: 'chapter_generation_handoff',
        volumeId: 'volume-2',
        chapterId: 'chapter-2',
      });
    });

    const preparedCall = mocks.saveDraft.mock.calls.find((call) => (
      call[0].payload.generationRequests?.[0]?.status === 'prepared'
    ));
    expect(preparedCall?.[0].payload.objectContext).toEqual({
      novelId: 'novel-1', volumeId: 'volume-2', chapterId: 'chapter-2',
    });
  });

  it('blocks direct retry of a stale generation request', async () => {
    const activeDraft = draft({
      payload: {
        currentStage: 'outline',
        fields: {},
        suggestions: [],
        generationRequests: [{
          request: { requestId: 'request-stale' },
          status: 'failed',
          errorCode: 'CO_CREATION_GENERATION_STALE',
          updatedAt: '2026-07-13T00:00:00.000Z',
        }],
      },
    });
    mocks.open.mockResolvedValue(workspace({ drafts: [activeDraft] }));
    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.executeGeneration.mockClear();

    await act(async () => {
      await result.current.retryGeneration('request-stale');
    });

    expect(result.current.error).toContain('不能重试');
    expect(mocks.executeGeneration).not.toHaveBeenCalled();
  });

  it('blocks a formal ApplyPlan that mixes accepted suggestions from different Artifacts', async () => {
    const acceptedSuggestion = (id: string, artifactId: string, fieldPath: string) => ({
      suggestionId: id,
      target: { objectType: 'world_setting' as const, fieldPath },
      originalValue: null,
      suggestedValue: id,
      fieldState: 'ai_suggested' as const,
      sourceType: 'ai_inference' as const,
      sourceReferences: [],
      confidence: 0.9,
      conflicts: [],
      baseDataRevision: 7,
      baseContextHash: 'frozen-hash',
      decision: 'accepted_to_draft' as const,
      candidateHash: `hash-${id}`,
      sourceMessageId: `message-${artifactId}`,
      sourceTaskId: `task-${artifactId}`,
      sourceArtifactId: artifactId,
    });
    const activeDraft = draft({
      payload: {
        currentStage: 'world_background',
        fields: {
          'worldSetting.era': { value: '蒸汽纪元', state: 'user_confirmed' },
          'worldSetting.society': { value: '浮空城邦', state: 'user_confirmed' },
        },
        suggestions: [
          acceptedSuggestion('suggestion-a', 'artifact-a', 'worldSetting.era'),
          acceptedSuggestion('suggestion-b', 'artifact-b', 'worldSetting.society'),
        ],
      },
    });
    mocks.open.mockResolvedValue(workspace({ drafts: [activeDraft] }));

    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.prepareFormalApply(['suggestion-a', 'suggestion-b']);
    });

    expect(result.current.error).toContain('同一轮 AI Artifact');
    expect(mocks.prepareApply).not.toHaveBeenCalled();
  });

  it('rechecks the full formal context before preparing an ApplyPlan', async () => {
    const accepted = {
      suggestionId: 'suggestion-a',
      target: { objectType: 'world_setting' as const, fieldPath: 'worldSetting.era' },
      originalValue: null,
      suggestedValue: '蒸汽纪元',
      fieldState: 'ai_suggested' as const,
      sourceType: 'ai_inference' as const,
      sourceReferences: [],
      confidence: 0.9,
      conflicts: [],
      baseDataRevision: 7,
      baseContextHash: 'frozen-hash',
      decision: 'accepted_to_draft' as const,
      candidateHash: 'candidate-hash',
      sourceMessageId: 'message-a',
      sourceTaskId: 'task-a',
      sourceArtifactId: 'artifact-a',
    };
    mocks.open.mockResolvedValue(workspace({
      drafts: [draft({
        payload: {
          currentStage: 'world_background',
          fields: { 'worldSetting.era': { value: '蒸汽纪元', state: 'user_confirmed' } },
          suggestions: [accepted],
        },
      })],
    }));
    const { result } = renderHook(() => useCoCreationController('novel-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.buildContext.mockResolvedValue({ canonicalDataHash: 'changed-formal-hash', canonical: {} });
    mocks.prepareApply.mockClear();

    await act(async () => {
      await result.current.prepareFormalApply(['suggestion-a']);
    });

    expect(result.current.error).toContain('正式作品数据已在建议生成后变化');
    expect(mocks.prepareApply).not.toHaveBeenCalled();
  });
});
