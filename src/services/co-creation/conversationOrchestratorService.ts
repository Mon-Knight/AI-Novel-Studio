import conversationPrompt from '../../../prompts/co-creation-turn.md?raw';
import type {
  CoCreationDraftRevision,
  CoCreationMessage,
  CoCreationSession,
  CoCreationTurnOutputV1,
} from '../../types/coCreation';
import { aiWorkflowService, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';
import { aiTaskCenterService } from '../ai-tasks/aiTaskCenterService';
import { buildCoCreationContext } from '../../features/co-creation/contextBuilder';
import { parseCoCreationTurnOutput } from '../../features/co-creation/protocol';
import {
  getStageDefinition,
  nextHighValueField,
  selectCurrentStage,
} from '../../features/co-creation/stageMachine';
import { dbCall, isTauri } from '../database/db';

export interface SubmittedCoCreationTurn {
  workflow?: WorkflowCreated;
  sourceTaskId: string;
  currentStage: CoCreationTurnOutputV1['currentStage'];
  canonicalDataHash: string;
  dataRevision: number;
}

export interface CoCreationTurnPollResult {
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'stale';
  output?: CoCreationTurnOutputV1;
  artifactId?: string;
  message?: string;
}

const browserTurns = new Map<string, {
  output: CoCreationTurnOutputV1;
  artifactId: string;
  cancelled: boolean;
}>();

function objectTypeForPath(path: string): CoCreationTurnOutputV1['extractedInformation'][number]['target']['objectType'] {
  if (path.startsWith('storySeed.')) return 'story_seed';
  if (path.startsWith('creativeIntent.')) return 'creative_intent';
  if (path.startsWith('worldSetting.')) return 'world_setting';
  if (path.startsWith('ruleSystem.')) return 'rule_system';
  if (path.startsWith('protagonist.')) return 'protagonist';
  if (path.startsWith('chapter')) return 'chapter';
  return 'outline';
}

function browserOutput(
  stage: CoCreationTurnOutputV1['currentStage'],
  dataRevision: number,
  userMessage: CoCreationMessage,
  knownFields: Awaited<ReturnType<typeof buildCoCreationContext>>['knownFields'],
): CoCreationTurnOutputV1 {
  const definition = getStageDefinition(stage);
  const answeredPath = nextHighValueField(stage, knownFields);
  const completed = answeredPath ? [answeredPath] : [];
  const missing = definition.minimumRequiredFields.filter((path) => !completed.includes(path));
  return {
    schemaVersion: 1,
    naturalLanguageReply: '已把这条信息整理到待确认工作草案中。浏览器开发模式不会写入正式作品数据。',
    intent: 'answer_current_question',
    currentStage: stage,
    extractedInformation: answeredPath ? [{
      target: { objectType: objectTypeForPath(answeredPath), fieldPath: answeredPath },
      value: userMessage.content,
      fieldState: 'user_confirmed',
      sourceReferences: [{
        sourceType: 'author_message', sourceId: userMessage.messageId, excerpt: userMessage.content.slice(0, 160),
        contentHash: userMessage.contentHash,
      }],
      confidence: 1,
    }] : [],
    pendingConfirmations: [],
    ...(missing[0] ? {
      nextHighValueQuestion: {
        question: `请继续补充：${missing[0]}`,
        reason: '这是当前阶段仍缺少的最低完备字段。',
        targetFieldPaths: [missing[0]],
      },
    } : {}),
    quickReplies: [],
    changeSuggestions: [],
    stageCompletion: {
      stage,
      status: missing.length === 0 ? 'complete' : 'in_progress',
      completedRequiredFields: completed,
      missingRequiredFields: missing,
      percentage: Math.round((completed.length / definition.minimumRequiredFields.length) * 100),
    },
    dataRevision,
  };
}

function compactContextForModel(context: Awaited<ReturnType<typeof buildCoCreationContext>>) {
  return {
    priorityOrder: context.priorityOrder,
    formalProjectData: context.canonical,
    pendingDraft: context.pendingDraft?.payload ?? null,
    sessionSummary: context.sessionSummary ?? null,
    recentMessages: context.recentMessages,
    objectContext: context.objectContext,
    knownFields: context.knownFields,
    dataRevision: context.dataRevision,
    canonicalDataHash: context.canonicalDataHash,
  };
}

function validateOutputSources(
  output: CoCreationTurnOutputV1,
  context: Awaited<ReturnType<typeof buildCoCreationContext>>,
  messages: CoCreationMessage[],
  activeDraft?: CoCreationDraftRevision,
  expectedUserMessageId?: string,
): void {
  const messageIds = new Set(messages.map((message) => message.messageId));
  const formalIds = new Set(context.sourceManifest
    .map((source) => source.sourceId)
    .filter((sourceId): sourceId is string => typeof sourceId === 'string'));
  const chapterId = context.objectContext.chapterId;
  const validate = (reference: CoCreationTurnOutputV1['extractedInformation'][number]['sourceReferences'][number]) => {
    const valid = reference.sourceType === 'ai_inference'
      || (reference.sourceType === 'author_message' && messageIds.has(reference.sourceId))
      || (reference.sourceType === 'formal_project_data' && formalIds.has(reference.sourceId))
      || (reference.sourceType === 'pending_draft' && activeDraft?.draftRevisionId === reference.sourceId)
      || (reference.sourceType === 'adopted_chapter_text' && chapterId === reference.sourceId);
    if (!valid) throw new Error(`AI 共创结构化结果无效：来源引用 ${reference.sourceId} 不在冻结上下文中`);
  };
  output.extractedInformation.forEach((item) => item.sourceReferences.forEach(validate));
  output.extractedInformation
    .filter((item) => item.fieldState === 'user_confirmed')
    .forEach((item) => {
      if (!item.sourceReferences.some((reference) => reference.sourceType === 'author_message'
          && reference.sourceId === expectedUserMessageId)) {
        throw new Error('AI 共创结构化结果无效：user_confirmed 缺少本轮作者来源');
      }
    });
  output.changeSuggestions.forEach((suggestion) => {
    suggestion.sourceReferences.forEach(validate);
    suggestion.conflicts.forEach((conflict) => conflict.sourceReferences.forEach(validate));
    if (suggestion.sourceType !== 'ai_inference'
        && !suggestion.sourceReferences.some((reference) => reference.sourceType === suggestion.sourceType)) {
      throw new Error('AI 共创结构化结果无效：建议来源类型与引用不一致');
    }
  });
}

export const conversationOrchestratorService = {
  async recoverTurnTask(input: {
    novelId: string;
    sessionId: string;
    userMessageId: string;
  }): Promise<SubmittedCoCreationTurn | null> {
    if (!isTauri()) return null;
    const recovered = await dbCall<{
      taskId: string;
      currentStage: CoCreationTurnOutputV1['currentStage'];
      canonicalDataHash: string;
      dataRevision: number;
    } | null>('recover_co_creation_turn_task', { input });
    if (!recovered) return null;
    return {
      sourceTaskId: recovered.taskId,
      currentStage: recovered.currentStage,
      canonicalDataHash: recovered.canonicalDataHash,
      dataRevision: recovered.dataRevision,
    };
  },

  async submitTurn(input: {
    session: CoCreationSession;
    messages: CoCreationMessage[];
    activeDraft?: CoCreationDraftRevision;
    userMessage: CoCreationMessage;
  }): Promise<SubmittedCoCreationTurn> {
    if (input.userMessage.role !== 'user' || !input.userMessage.content.trim()) {
      throw new Error('AI 共创消息不能为空');
    }
    const context = await buildCoCreationContext(input);
    const currentStage = selectCurrentStage(context.knownFields, input.session.currentStage);
    const modelContext = compactContextForModel(context);
    const messages = [
      { role: 'system', content: conversationPrompt },
      {
        role: 'user',
        content: `以下是按优先级编译的共创上下文。只使用这里提供的数据，不得补造来源：\n${JSON.stringify(modelContext)}`,
      },
      {
        role: 'user',
        content: `本轮消息 ID：${input.userMessage.messageId}\n当前阶段：${currentStage}\n作者输入：\n${input.userMessage.content}`,
      },
    ];
    const operationId = `co-creation:${input.session.sessionId}:message:${input.userMessage.messageId}`;
    if (!isTauri()) {
      const sourceTaskId = `browser:${operationId}:turn`;
      const artifactId = `browser:${operationId}:artifact`;
      browserTurns.set(sourceTaskId, {
        output: browserOutput(currentStage, context.dataRevision, input.userMessage, context.knownFields),
        artifactId,
        cancelled: false,
      });
      return {
        workflow: {
          workflowId: `browser:${operationId}:workflow`,
          rootTaskId: `browser:${operationId}:root`,
          childTaskIds: [sourceTaskId],
        },
        sourceTaskId,
        currentStage,
        canonicalDataHash: context.canonicalDataHash,
        dataRevision: context.dataRevision,
      };
    }
    const workflow = await aiWorkflowService.createBackground({
      operationId,
      workflowName: `${context.canonical.novel.title} · AI 共创`,
      taskType: 'co_creation_turn',
      novelId: input.session.novelId,
      chapterId: input.session.objectContext.chapterId,
      scopeType: input.session.objectContext.chapterId ? 'chapter' : 'novel',
      targetHintJson: {
        contract: 'co_creation_turn_v1',
        sessionId: input.session.sessionId,
        userMessageId: input.userMessage.messageId,
        currentStage,
        canonicalDataHash: context.canonicalDataHash,
        dataRevision: context.dataRevision,
        automaticApply: false,
      },
      inputPayloadJson: {
        contract: 'co_creation_turn_v1',
        sessionId: input.session.sessionId,
        userMessageId: input.userMessage.messageId,
        currentStage,
        dataRevision: context.dataRevision,
        canonicalDataHash: context.canonicalDataHash,
      },
      inputBody: input.userMessage.content,
      sourceManifestJson: context.sourceManifest,
      steps: [{
        stepKey: 'conversation_turn',
        taskType: 'co_creation_turn',
        agentRole: 'conversation_orchestrator',
        artifactType: 'generic_json',
        messages,
        reviewOutput: true,
      }],
    });
    const sourceTaskId = workflow.childTaskIds[0];
    if (!sourceTaskId) throw new Error('AI 共创工作流没有创建对话任务');
    return {
      workflow,
      sourceTaskId,
      currentStage,
      canonicalDataHash: context.canonicalDataHash,
      dataRevision: context.dataRevision,
    };
  },

  async pollTurn(input: {
    session: CoCreationSession;
    messages: CoCreationMessage[];
    activeDraft?: CoCreationDraftRevision;
    sourceTaskId: string;
    expectedCanonicalDataHash: string;
    expectedDataRevision: number;
    expectedStage: CoCreationTurnOutputV1['currentStage'];
    expectedUserMessageId: string;
  }): Promise<CoCreationTurnPollResult> {
    if (!isTauri()) {
      const browser = browserTurns.get(input.sourceTaskId);
      if (!browser) return { status: 'failed', message: '浏览器共创任务不存在' };
      if (browser.cancelled) return { status: 'cancelled', message: '共创对话任务已取消' };
      if (browser.output.currentStage !== input.expectedStage) {
        throw new Error('AI 共创结构化结果无效：currentStage 与冻结阶段不一致');
      }
      const latestContext = await buildCoCreationContext(input);
      if (latestContext.canonicalDataHash !== input.expectedCanonicalDataHash) {
        return { status: 'stale', artifactId: browser.artifactId, message: '正式作品数据或共创草案已变化，请重新生成' };
      }
      validateOutputSources(
        browser.output, latestContext, input.messages, input.activeDraft, input.expectedUserMessageId,
      );
      return { status: 'completed', output: browser.output, artifactId: browser.artifactId };
    }
    const tasks = await aiTaskCenterService.refresh();
    const task = tasks.find((item) => item.id === input.sourceTaskId);
    if (!task) return { status: 'failed', message: '共创对话任务不存在' };
    if (task.userStatus === 'failed') return { status: 'failed', message: task.errorMessage || '共创对话任务失败' };
    if (task.userStatus === 'cancelled') return { status: 'cancelled', message: '共创对话任务已取消' };
    if (!task.artifactId) return { status: 'pending' };

    const latestContext = await buildCoCreationContext(input);
    if (latestContext.canonicalDataHash !== input.expectedCanonicalDataHash) {
      return { status: 'stale', artifactId: task.artifactId, message: '正式作品数据或共创草案已变化，请重新生成' };
    }
    const artifact = await aiTaskCenterService.getArtifact(task.artifactId);
    const raw = artifact.structuredPayload === undefined
      ? artifact.content
      : JSON.stringify(artifact.structuredPayload);
    const output = await parseCoCreationTurnOutput(
      raw, input.expectedDataRevision, input.expectedStage, input.expectedUserMessageId,
    );
    validateOutputSources(
      output, latestContext, input.messages, input.activeDraft, input.expectedUserMessageId,
    );
    return { status: 'completed', output, artifactId: artifact.artifactId };
  },

  async cancelTurn(sourceTaskId: string): Promise<void> {
    if (!isTauri()) {
      const browser = browserTurns.get(sourceTaskId);
      if (browser) browser.cancelled = true;
      return;
    }
    await aiTaskCenterService.cancel(sourceTaskId, true);
  },
};
