import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CoCreationStage,
  CoCreationWorkspaceSnapshot,
} from '../../types/coCreation';
import { coCreationSessionService } from '../../services/co-creation/coCreationSessionService';
import { conversationOrchestratorService } from '../../services/co-creation/conversationOrchestratorService';
import {
  acceptSuggestionToDraft,
  deserializeWorkingDraft,
  mergeTurnIntoWorkingDraft,
  rejectSuggestion,
  serializeWorkingDraft,
  type CoCreationWorkingDraftState,
} from './draftState';
import { deriveAllStageProgress, selectCurrentStage } from './stageMachine';
import { compressCoCreationMessages } from './sessionSummary';
import { buildCoCreationContext, computeCoCreationDataHash } from './contextBuilder';
import { parseCoCreationTurnOutput } from './protocol';
import { novelRepository } from '../../services/database/novelRepository';

const POLL_INTERVAL_MS = 700;
const MAX_POLL_ATTEMPTS = 260;
const MAX_FAILURE_MESSAGE_CHARS = 900;

interface PendingTurnMetadata {
  userMessageId: string;
  sourceTaskId: string;
  canonicalDataHash: string;
  dataRevision: number;
  currentStage: CoCreationStage;
}

function pendingMetadata(snapshot: CoCreationWorkspaceSnapshot | null): PendingTurnMetadata | null {
  const pendingMessage = snapshot?.pendingTurn;
  if (!pendingMessage) return null;
  const value = snapshot?.activeDraft?.payload.pendingTurn;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (item.userMessageId === pendingMessage.messageId
        && typeof item.sourceTaskId === 'string'
        && item.sourceTaskId === pendingMessage.sourceTaskId
        && typeof item.canonicalDataHash === 'string' && typeof item.dataRevision === 'number'
        && typeof item.currentStage === 'string') {
      return {
        userMessageId: pendingMessage.messageId,
        sourceTaskId: item.sourceTaskId,
        canonicalDataHash: item.canonicalDataHash,
        dataRevision: item.dataRevision,
        currentStage: item.currentStage as CoCreationStage,
      };
    }
  }
  if (!pendingMessage.sourceTaskId || !pendingMessage.turnContext) return null;
  return {
    userMessageId: pendingMessage.messageId,
    sourceTaskId: pendingMessage.sourceTaskId,
    canonicalDataHash: pendingMessage.turnContext.canonicalDataHash,
    dataRevision: pendingMessage.turnContext.dataRevision,
    currentStage: pendingMessage.turnContext.currentStage,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function draftPayload(input: {
  snapshot: CoCreationWorkspaceSnapshot;
  state: CoCreationWorkingDraftState;
  currentStage: CoCreationStage;
  pendingTurn?: PendingTurnMetadata | null;
  summary?: Awaited<ReturnType<typeof compressCoCreationMessages>>;
}): Record<string, unknown> {
  const progress = deriveAllStageProgress(input.state.fields);
  return {
    ...serializeWorkingDraft(input.state),
    currentStage: input.currentStage,
    stageProgress: progress,
    objectContext: input.snapshot.session.objectContext,
    sessionSummary: input.summary?.summary ?? input.snapshot.session.summary ?? null,
    sessionSummaryHash: input.summary?.summaryHash ?? input.snapshot.session.summaryHash ?? null,
    summarizedThroughSequence: input.summary?.summarizedThroughSequence ?? null,
    pendingTurn: input.pendingTurn ?? null,
  };
}

async function preparePendingTurn(
  workspace: CoCreationWorkspaceSnapshot,
  userMessage: CoCreationWorkspaceSnapshot['messages'][number],
): Promise<{ workspace: CoCreationWorkspaceSnapshot; pending: PendingTurnMetadata }> {
  const submitted = await conversationOrchestratorService.recoverTurnTask({
    novelId: workspace.session.novelId,
    sessionId: workspace.session.sessionId,
    userMessageId: userMessage.messageId,
  }) ?? await conversationOrchestratorService.submitTurn({
      session: workspace.session,
      messages: workspace.messages,
      activeDraft: workspace.activeDraft,
      userMessage,
    });
  let bound = await coCreationSessionService.bindTurnTask({
    workspace,
    userMessageId: userMessage.messageId,
    taskId: submitted.sourceTaskId,
    turnContext: {
      currentStage: submitted.currentStage,
      canonicalDataHash: submitted.canonicalDataHash,
      dataRevision: submitted.dataRevision,
    },
  });
  const pending: PendingTurnMetadata = {
    userMessageId: userMessage.messageId,
    sourceTaskId: submitted.sourceTaskId,
    canonicalDataHash: submitted.canonicalDataHash,
    dataRevision: submitted.dataRevision,
    currentStage: submitted.currentStage,
  };
  const state = deserializeWorkingDraft(bound.activeDraft?.payload);
  bound = await coCreationSessionService.saveDraft({
    workspace: bound,
    stage: submitted.currentStage,
    payload: draftPayload({ snapshot: bound, state, currentStage: submitted.currentStage, pendingTurn: pending }),
    origin: 'author_edit',
    operationId: `co-creation:${bound.session.sessionId}:message:${userMessage.messageId}:pending`,
  });
  return { workspace: bound, pending };
}

function terminalValidationFailure(value: unknown): boolean {
  const code = value && typeof value === 'object' && 'code' in value
    ? String((value as { code?: unknown }).code ?? '') : '';
  const message = value instanceof Error ? value.message : '';
  return message.startsWith('AI 共创结构化结果无效：')
    || ['ARTIFACT_VALIDATION_FAILED', 'CO_CREATION_RESULT_STALE'].includes(code);
}

function containsCredential(value: string): boolean {
  const namedCredential = /(?:api[_ -]?key|authorization|client[_ -]?secret|access[_ -]?(?:token|key)|refresh[_ -]?token|password|passwd|secret|token)\s*["']?\s*[:=]/i;
  return namedCredential.test(value)
    || /bearer\s+\S+/i.test(value)
    || /sk-[a-z0-9._-]+/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)
    || /:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value);
}

export function safeFailureMessage(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('');
  const normalized = withoutControlCharacters
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '共创对话任务失败';
  if (containsCredential(normalized)) {
    return '共创对话任务失败';
  }
  return Array.from(normalized).slice(0, MAX_FAILURE_MESSAGE_CHARS).join('');
}

async function terminalizeTurnFailure(
  workspace: CoCreationWorkspaceSnapshot,
  pending: PendingTurnMetadata,
  errorCode: string,
  errorMessage: string,
): Promise<CoCreationWorkspaceSnapshot> {
  const failed = await coCreationSessionService.failTurn({
    workspace,
    userMessageId: pending.userMessageId,
    taskId: pending.sourceTaskId,
    errorCode,
    errorMessage: safeFailureMessage(errorMessage),
  });
  const state = deserializeWorkingDraft(failed.activeDraft?.payload);
  return coCreationSessionService.saveDraft({
    workspace: failed,
    stage: failed.session.currentStage,
    payload: draftPayload({ snapshot: failed, state, currentStage: failed.session.currentStage, pendingTurn: null }),
    origin: 'author_edit',
    operationId: `co-creation:${failed.session.sessionId}:message:${pending.userMessageId}:clear-failed`,
  });
}

function artifactMarkers(snapshot: CoCreationWorkspaceSnapshot, key: string): string[] {
  const values = snapshot.draftRevisions.flatMap((draft) => {
    const value = draft.payload[key];
    return Array.isArray(value) ? value : [];
  });
  return [...new Set(values.filter((item): item is string => typeof item === 'string'))];
}

async function projectAssistantTurn(input: {
  workspace: CoCreationWorkspaceSnapshot;
  pending: PendingTurnMetadata;
  output?: Awaited<ReturnType<typeof parseCoCreationTurnOutput>>;
}): Promise<{ workspace: CoCreationWorkspaceSnapshot; notice?: string }> {
  const { workspace, pending } = input;
  const assistant = [...workspace.messages].reverse().find((message) => (
    message.role === 'assistant'
      && message.replyToMessageId === pending.userMessageId
      && message.sourceTaskId === pending.sourceTaskId
  ));
  if (!assistant?.sourceArtifactId) throw new Error('共创回复完成后缺少可追溯的 assistant 消息');
  if (workspace.draftRevisions.some((draft) => draft.origin === 'assistant_turn'
      && draft.sourceArtifactId === assistant.sourceArtifactId)) {
    return { workspace };
  }

  let output = input.output;
  if (!output) {
    if (assistant.structuredPayload === undefined) throw new Error('共创回复缺少可恢复的结构化结果');
    const latestContext = await buildCoCreationContext(workspace);
    if (latestContext.canonicalDataHash !== pending.canonicalDataHash) {
      const state = deserializeWorkingDraft(workspace.activeDraft?.payload);
      const staleArtifactIds = [...new Set([
        ...artifactMarkers(workspace, 'staleArtifactIds'),
        assistant.sourceArtifactId,
      ])];
      const marked = await coCreationSessionService.saveDraft({
        workspace,
        stage: workspace.session.currentStage,
        payload: {
          ...draftPayload({ snapshot: workspace, state, currentStage: workspace.session.currentStage, pendingTurn: null }),
          staleArtifactIds,
        },
        origin: 'author_edit',
        operationId: `co-creation:${workspace.session.sessionId}:artifact:${assistant.sourceArtifactId}:stale`,
      });
      return { workspace: marked, notice: '正式数据已变化，恢复的 AI 建议已标记过期。' };
    }
    output = await parseCoCreationTurnOutput(
      JSON.stringify(assistant.structuredPayload),
      pending.dataRevision,
      pending.currentStage,
      pending.userMessageId,
    );
  }

  const provisionalOutput = {
    ...output,
    changeSuggestions: output.changeSuggestions.map((suggestion) => ({
      ...suggestion,
      sourceMessageId: assistant.messageId,
      sourceTaskId: pending.sourceTaskId,
      sourceArtifactId: assistant.sourceArtifactId,
    })),
  };
  const previousState = deserializeWorkingDraft(workspace.activeDraft?.payload);
  const provisionalState = mergeTurnIntoWorkingDraft(previousState, provisionalOutput);
  const currentContext = await buildCoCreationContext(workspace);
  const reviewContextHash = await computeCoCreationDataHash(currentContext.canonical, provisionalState.fields);
  const outputWithProvenance = {
    ...provisionalOutput,
    changeSuggestions: provisionalOutput.changeSuggestions.map((suggestion) => ({
      ...suggestion,
      baseContextHash: reviewContextHash,
    })),
  };
  const state = mergeTurnIntoWorkingDraft(previousState, outputWithProvenance);
  const summary = await compressCoCreationMessages(workspace.messages, workspace.session.summary);
  const canAdvance = ['complete', 'minimum_complete'].includes(output.stageCompletion.status);
  const nextStage = canAdvance ? selectCurrentStage(state.fields) : output.currentStage;
  const saved = await coCreationSessionService.saveDraft({
    workspace,
    stage: nextStage,
    payload: {
      ...draftPayload({ snapshot: workspace, state, currentStage: nextStage, pendingTurn: null, summary }),
      lastTurn: outputWithProvenance,
    },
    origin: 'assistant_turn',
    sourceMessageId: assistant.messageId,
    sourceTaskId: pending.sourceTaskId,
    sourceArtifactId: assistant.sourceArtifactId,
    operationId: `co-creation:${workspace.session.sessionId}:artifact:${assistant.sourceArtifactId}:draft`,
  });
  return { workspace: saved };
}

async function recoverCompletedAssistantTurns(
  start: CoCreationWorkspaceSnapshot,
): Promise<{ workspace: CoCreationWorkspaceSnapshot; notice?: string }> {
  let workspace = start;
  let notice: string | undefined;
  for (const assistant of workspace.messages.filter((message) => message.role === 'assistant')) {
    const artifactId = assistant.sourceArtifactId;
    if (!artifactId || workspace.draftRevisions.some((draft) => draft.origin === 'assistant_turn'
      && draft.sourceArtifactId === artifactId) || artifactMarkers(workspace, 'staleArtifactIds').includes(artifactId)) continue;
    const user = workspace.messages.find((message) => message.messageId === assistant.replyToMessageId);
    if (!user?.sourceTaskId || !user.turnContext) throw new Error('共创历史 turn 缺少恢复上下文');
    const recovered = await projectAssistantTurn({
      workspace,
      pending: {
        userMessageId: user.messageId,
        sourceTaskId: user.sourceTaskId,
        canonicalDataHash: user.turnContext.canonicalDataHash,
        dataRevision: user.turnContext.dataRevision,
        currentStage: user.turnContext.currentStage,
      },
    });
    workspace = recovered.workspace;
    notice = recovered.notice ?? notice;
  }
  return { workspace, ...(notice ? { notice } : {}) };
}

export function useCoCreationController(novelId: string | undefined, chapterId?: string) {
  const [snapshot, setSnapshot] = useState<CoCreationWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [novelTitle, setNovelTitle] = useState('');
  const snapshotRef = useRef<CoCreationWorkspaceSnapshot | null>(null);
  const generationRef = useRef(0);
  const sendLockRef = useRef(false);
  snapshotRef.current = snapshot;

  const replaceSnapshot = useCallback((next: CoCreationWorkspaceSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!novelId) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError('');
    try {
      const [openedWorkspace, novel] = await Promise.all([
        coCreationSessionService.open(novelId),
        novelRepository.getById(novelId),
      ]);
      if (!novel) throw new Error('作品不存在');
      let opened = openedWorkspace;
      if (generation !== generationRef.current) return;
      if (chapterId && opened.session.objectContext.chapterId !== chapterId) {
        const state = deserializeWorkingDraft(opened.activeDraft?.payload);
        opened = await coCreationSessionService.saveDraft({
          workspace: opened,
          stage: opened.session.currentStage,
          payload: {
            ...draftPayload({ snapshot: opened, state, currentStage: opened.session.currentStage }),
            objectContext: { ...opened.session.objectContext, novelId, chapterId },
          },
          origin: 'author_edit',
          operationId: `co-creation:${opened.session.sessionId}:context:${chapterId}`,
        });
      }
      const recovered = await recoverCompletedAssistantTurns(opened);
      opened = recovered.workspace;
      if (recovered.notice) setNotice(recovered.notice);
      if (generation !== generationRef.current) return;
      setNovelTitle(novel.title);
      replaceSnapshot(opened);
    } catch (value) {
      if (generation !== generationRef.current) return;
      setError(value instanceof Error ? value.message : 'AI 共创会话读取失败');
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [chapterId, novelId, replaceSnapshot]);

  const finishTurn = useCallback(async (
    start: CoCreationWorkspaceSnapshot,
    pending: PendingTurnMetadata,
  ): Promise<CoCreationWorkspaceSnapshot> => {
    let current = start;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      let result: Awaited<ReturnType<typeof conversationOrchestratorService.pollTurn>>;
      try {
        result = await conversationOrchestratorService.pollTurn({
          session: current.session,
          messages: current.messages,
          activeDraft: current.activeDraft,
          sourceTaskId: pending.sourceTaskId,
          expectedCanonicalDataHash: pending.canonicalDataHash,
          expectedDataRevision: pending.dataRevision,
          expectedStage: pending.currentStage,
          expectedUserMessageId: pending.userMessageId,
        });
      } catch (value) {
        if (!terminalValidationFailure(value)) throw value;
        setNotice('AI 返回的结构化结果未通过校验，本轮已安全终止。');
        return terminalizeTurnFailure(
          current,
          pending,
          'CO_CREATION_OUTPUT_INVALID',
          'AI 共创结构化结果未通过校验',
        );
      }
      if (result.status === 'pending') {
        await delay(POLL_INTERVAL_MS);
        const latest = snapshotRef.current;
        if (latest?.session.sessionId === current.session.sessionId) current = latest;
        continue;
      }
      if (result.status === 'failed' || result.status === 'cancelled') {
        return terminalizeTurnFailure(
          current,
          pending,
          result.status === 'cancelled' ? 'AI_PROVIDER_CANCELLED' : 'AI_TASK_FAILED',
          result.message || '共创对话任务失败',
        );
      }
      if (result.status === 'stale') {
        if (!result.artifactId) throw new Error(result.message || '共创建议已经过期');
        let completed: CoCreationWorkspaceSnapshot;
        try {
          completed = await coCreationSessionService.completeTurn({
            workspace: current,
            userMessageId: pending.userMessageId,
            taskId: pending.sourceTaskId,
            artifactId: result.artifactId,
            assistantContent: JSON.stringify({ naturalLanguageReply: result.message || '建议已经过期' }),
          });
        } catch (value) {
          if (!terminalValidationFailure(value)) throw value;
          return terminalizeTurnFailure(
            current, pending, 'CO_CREATION_RESULT_STALE', 'AI 共创结果已经过期',
          );
        }
        const state = deserializeWorkingDraft(completed.activeDraft?.payload);
        const cleared = await coCreationSessionService.saveDraft({
          workspace: completed,
          stage: completed.session.currentStage,
          payload: {
            ...draftPayload({ snapshot: completed, state, currentStage: completed.session.currentStage, pendingTurn: null }),
            staleArtifactIds: [...new Set([
              ...artifactMarkers(completed, 'staleArtifactIds'), result.artifactId,
            ])],
          },
          origin: 'author_edit',
          operationId: `co-creation:${completed.session.sessionId}:artifact:${result.artifactId}:stale`,
        });
        setNotice(result.message || '正式数据已变化，本轮建议已标记过期。');
        return cleared;
      }
      if (!result.output || !result.artifactId) throw new Error('共创任务完成但没有可审查结果');
      let completed: CoCreationWorkspaceSnapshot;
      try {
        completed = await coCreationSessionService.completeTurn({
          workspace: current,
          userMessageId: pending.userMessageId,
          taskId: pending.sourceTaskId,
          artifactId: result.artifactId,
          assistantContent: JSON.stringify(result.output),
        });
      } catch (value) {
        if (!terminalValidationFailure(value)) throw value;
        setNotice('AI 结果已失效或未通过校验，本轮已安全终止。');
        return terminalizeTurnFailure(
          current, pending, 'ARTIFACT_VALIDATION_FAILED', 'AI 共创 Artifact 未通过校验',
        );
      }
      const projected = await projectAssistantTurn({ workspace: completed, pending, output: result.output });
      if (projected.notice) setNotice(projected.notice);
      return projected.workspace;
    }
    setNotice('AI 任务仍在后台运行，稍后重新打开页面会继续恢复。');
    return current;
  }, []);

  const resumePending = useCallback(async (current: CoCreationWorkspaceSnapshot) => {
    if (!current.pendingTurn || sending) return;
    setSending(true);
    try {
      let workspace = current;
      let pending = pendingMetadata(workspace);
      if (!pending) {
        const pendingTurn = workspace.pendingTurn;
        if (!pendingTurn) return;
        if (pendingTurn.sourceTaskId) {
          throw new Error('运行中的共创任务缺少可恢复的输入快照');
        }
        const prepared = await preparePendingTurn(workspace, pendingTurn);
        workspace = prepared.workspace;
        pending = prepared.pending;
        replaceSnapshot(workspace);
      }
      const finished = await finishTurn(workspace, pending);
      replaceSnapshot(finished);
    } catch (value) {
      setError(value instanceof Error ? value.message : '恢复共创任务失败');
    } finally {
      setSending(false);
    }
  }, [finishTurn, replaceSnapshot, sending]);

  useEffect(() => {
    void refresh();
    return () => { generationRef.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (snapshot?.pendingTurn && !sending) void resumePending(snapshot);
  }, [resumePending, sending, snapshot]);

  const sendMessage = useCallback(async (content: string) => {
    const current = snapshotRef.current;
    if (!current || sendLockRef.current || !content.trim()) return;
    sendLockRef.current = true;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const appendOperationId = `co-creation:${current.session.sessionId}:append:${crypto.randomUUID()}`;
      const appended = await coCreationSessionService.appendUserMessage({
        workspace: current,
        content: content.trim(),
        operationId: appendOperationId,
      });
      replaceSnapshot(appended.workspace);
      const prepared = await preparePendingTurn(appended.workspace, appended.userMessage);
      replaceSnapshot(prepared.workspace);
      const finished = await finishTurn(prepared.workspace, prepared.pending);
      replaceSnapshot(finished);
    } catch (value) {
      setError(value instanceof Error ? value.message : '发送共创消息失败');
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  }, [finishTurn, replaceSnapshot]);

  const saveState = useCallback(async (
    state: CoCreationWorkingDraftState,
    operationSuffix: string,
    origin: 'author_edit' | 'assistant_proposal_accepted' = 'author_edit',
    source?: { messageId: string; taskId: string; artifactId: string },
  ) => {
    const current = snapshotRef.current;
    if (!current) return;
    const nextStage = selectCurrentStage(state.fields, current.session.currentStage);
    const saved = await coCreationSessionService.saveDraft({
      workspace: current,
      stage: nextStage,
      payload: draftPayload({ snapshot: current, state, currentStage: nextStage, pendingTurn: null }),
      origin,
      sourceMessageId: source?.messageId,
      sourceTaskId: source?.taskId,
      sourceArtifactId: source?.artifactId,
      operationId: `co-creation:${current.session.sessionId}:${operationSuffix}:${crypto.randomUUID()}`,
    });
    replaceSnapshot(saved);
  }, [replaceSnapshot]);

  const acceptSuggestion = useCallback(async (
    suggestionId: string,
    editedValue?: unknown,
    allowReplaceConfirmed = false,
    acknowledgeConflicts = false,
  ) => {
    try {
      const current = snapshotRef.current;
      if (!current) return;
      const state = deserializeWorkingDraft(current.activeDraft?.payload);
      const suggestion = state.suggestions.find((item) => item.suggestionId === suggestionId);
      if (!suggestion) throw new Error('待确认建议不存在');
      const latestContext = await buildCoCreationContext(current);
      if (!suggestion.baseContextHash || suggestion.baseContextHash !== latestContext.canonicalDataHash) {
        throw new Error('建议基于旧的数据版本，必须重新生成或合并');
      }
      const next = acceptSuggestionToDraft(state, suggestionId, {
        editedValue,
        allowReplaceConfirmed,
        acknowledgeConflicts,
        expectedDataRevision: suggestion.baseDataRevision,
      });
      if (!suggestion.sourceMessageId || !suggestion.sourceTaskId || !suggestion.sourceArtifactId) {
        throw new Error('建议缺少可追溯的 Task/Artifact 来源');
      }
      await saveState(next, `accept:${suggestionId}`, 'assistant_proposal_accepted', {
        messageId: suggestion.sourceMessageId,
        taskId: suggestion.sourceTaskId,
        artifactId: suggestion.sourceArtifactId,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : '采用共创建议失败');
    }
  }, [saveState]);

  const acceptAllSuggestions = useCallback(async () => {
    try {
      const current = snapshotRef.current;
      if (!current) return;
      let state = deserializeWorkingDraft(current.activeDraft?.payload);
      const pendingSuggestions = state.suggestions.filter((item) => item.decision === 'pending');
      const latestContext = await buildCoCreationContext(current);
      if (pendingSuggestions.some((item) => !item.baseContextHash
        || item.baseContextHash !== latestContext.canonicalDataHash)) {
        throw new Error('批量建议中包含旧的数据版本，必须重新生成或合并');
      }
      const sourceKey = (item: typeof pendingSuggestions[number]) => (
        `${item.sourceMessageId ?? ''}:${item.sourceTaskId ?? ''}:${item.sourceArtifactId ?? ''}`
      );
      if (new Set(pendingSuggestions.map(sourceKey)).size > 1) {
        throw new Error('批量采用只能处理同一轮 AI Artifact 的建议');
      }
      for (const suggestion of pendingSuggestions) {
        state = acceptSuggestionToDraft(state, suggestion.suggestionId, {
          expectedDataRevision: suggestion.baseDataRevision,
        });
      }
      const source = pendingSuggestions[0];
      if (!source?.sourceMessageId || !source.sourceTaskId || !source.sourceArtifactId) {
        throw new Error('建议缺少可追溯的 Task/Artifact 来源');
      }
      await saveState(state, 'accept-all', 'assistant_proposal_accepted', {
        messageId: source.sourceMessageId,
        taskId: source.sourceTaskId,
        artifactId: source.sourceArtifactId,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : '批量采用共创建议失败');
    }
  }, [saveState]);

  const rejectDraftSuggestion = useCallback(async (suggestionId: string) => {
    try {
      const current = snapshotRef.current;
      if (!current) return;
      const next = rejectSuggestion(deserializeWorkingDraft(current.activeDraft?.payload), suggestionId);
      await saveState(next, `reject:${suggestionId}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : '拒绝共创建议失败');
    }
  }, [saveState]);

  const editField = useCallback(async (fieldPath: string, value: unknown) => {
    try {
      const current = snapshotRef.current;
      if (!current) return;
      const state = deserializeWorkingDraft(current.activeDraft?.payload);
      state.fields[fieldPath] = { value, state: 'user_confirmed' };
      await saveState(state, `edit:${fieldPath}`);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : '编辑共创字段失败');
    }
  }, [saveState]);

  const changeStage = useCallback(async (stage: CoCreationStage) => {
    try {
      const current = snapshotRef.current;
      if (!current) return;
      const state = deserializeWorkingDraft(current.activeDraft?.payload);
      const saved = await coCreationSessionService.saveDraft({
        workspace: current,
        stage,
        payload: draftPayload({ snapshot: current, state, currentStage: stage, pendingTurn: null }),
        origin: 'author_edit',
        operationId: `co-creation:${current.session.sessionId}:stage:${stage}:${crypto.randomUUID()}`,
      });
      replaceSnapshot(saved);
    } catch (value) {
      setError(value instanceof Error ? value.message : '切换共创阶段失败');
    }
  }, [replaceSnapshot]);

  return {
    snapshot,
    loading,
    sending,
    error,
    notice,
    novelTitle,
    refresh,
    sendMessage,
    acceptSuggestion,
    acceptAllSuggestions,
    rejectSuggestion: rejectDraftSuggestion,
    editField,
    changeStage,
    clearError: () => setError(''),
  };
}
