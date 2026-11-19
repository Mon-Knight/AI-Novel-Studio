import type {
  InitializedTaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
} from '../../types/conversation';
import type { StyleAnalyzeResult } from '../../types/style';
import type { StyleSourceSnapshot, TaskScope } from '../../types/taskLibrary';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { taskConversationService } from '../conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { generateId, isTauri, nowISO } from '../database/db';
import { taskSessionAdapter } from '../dsh/taskSessionAdapter';
import { tauriInvoke } from '../tauri/runtime';

export async function styleTextHash(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('风格分析需要可靠 SHA-256，已停止。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function globalStyleSource(text: string): Promise<StyleSourceSnapshot> {
  const utf8ByteLength = new TextEncoder().encode(text).length;
  if (!text.trim() || text.length > 20_000 || utf8ByteLength > 80_000)
    throw new Error('参考文本为空或超过 20,000 字符 / 80,000 UTF-8 字节快照上限。');
  const contentHash = await styleTextHash(text);
  return {
    sourceId: generateId(),
    contentHash,
    utf8ByteLength,
    samples: [
      {
        sampleId: `style-sample-${contentHash.slice(0, 24)}`,
        content: text,
        contentHash,
        utf8ByteLength,
      },
    ],
  };
}

export function validateStyleCandidate(value: unknown): StyleAnalyzeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('STYLE_CANDIDATE_INVALID');
  const record = value as Record<string, unknown>;
  const strings = [
    'name',
    'narrativePerspective',
    'tone',
    'pace',
    'sentenceStyle',
    'battleStyle',
    'battleIntensity',
    'emotionTendency',
    'chapterEnding',
    'styleSummary',
  ];
  const numbers = ['dialogueRatio', 'descriptionRatio', 'psychologicalRatio'];
  if (typeof record.styleSummary !== 'string' || !record.styleSummary.trim())
    throw new Error('STYLE_SUMMARY_REQUIRED');
  for (const [key, field] of Object.entries(record)) {
    if (strings.includes(key)) {
      if (typeof field !== 'string' || field.length > 10_000)
        throw new Error('STYLE_CANDIDATE_FIELD_INVALID');
    } else if (numbers.includes(key)) {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 1)
        throw new Error('STYLE_CANDIDATE_RATIO_INVALID');
    } else if (key === 'forbiddenStyles') {
      if (
        !Array.isArray(field) ||
        field.length > 100 ||
        field.some((item) => typeof item !== 'string' || item.length > 10_000)
      )
        throw new Error('STYLE_CANDIDATE_FIELD_INVALID');
    } else throw new Error('STYLE_CANDIDATE_UNKNOWN_FIELD');
  }
  return record as unknown as StyleAnalyzeResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function modelIdentity(model: TaskModelSnapshot): string {
  const { providerId, modelId, runtimeMode, baseUrl, options, pricing } = model;
  return canonical({ providerId, modelId, runtimeMode, baseUrl, options, pricing });
}

function matchesScope(
  conversation: { novelId?: string | null; scope?: TaskScope },
  source: StyleSourceSnapshot,
): boolean {
  if (source.reference)
    return (
      conversation.novelId === source.reference.novelId &&
      conversation.scope?.kind === 'novel' &&
      conversation.scope.novelId === source.reference.novelId
    );
  return (
    conversation.novelId == null &&
    conversation.scope?.kind === 'library' &&
    conversation.scope.sourceId === source.sourceId &&
    conversation.scope.sourceHash === source.contentHash
  );
}

/** One submission for every sample. This service owns no model loop, retries or writes. */
export async function analyzeStyleSource(
  inputSource: StyleSourceSnapshot,
  options: { signal?: AbortSignal; modelSnapshot?: TaskModelSnapshot } = {},
): Promise<{
  modelSnapshot: TaskModelSnapshot;
  profiles: StyleAnalyzeResult[];
  conversationId: string;
  artifactIds: string[];
}> {
  if (!isTauri()) throw new Error('统一风格任务仅支持桌面；浏览器预览不是桌面验收。');
  options.signal?.throwIfAborted();
  const source = structuredClone(inputSource);
  const modelSnapshot = structuredClone(options.modelSnapshot ?? captureTaskModelSnapshot());
  const goal = source.reference
    ? '分析当前参考资料的分层风格，返回待人工审阅的画像候选。'
    : '分析所提供 TXT 快照的风格，返回可编辑候选，不保存或启用画像。';
  const novelId = source.reference?.novelId ?? null;
  const initialized = source.reference
    ? await taskConversationService.createInitialized(source.reference.novelId, goal, modelSnapshot)
    : await tauriInvoke<InitializedTaskConversation>('create_initialized_library_task', {
        input: {
          conversationId: generateId(),
          turnId: generateId(),
          title: '全局 TXT 风格分析',
          goal,
          defaultModel: modelSnapshot,
          createdAt: nowISO(),
          source,
        },
      });
  const conversationId = initialized.conversation.conversationId;
  if (!matchesScope(initialized.conversation, source)) throw new Error('STYLE_TASK_SCOPE_MISMATCH');
  options.signal?.throwIfAborted();
  const run = await taskSessionAdapter.startTurn({
    conversationId,
    novelId,
    turnId: initialized.turn.turnId,
    goal,
    modelSnapshot,
    cancellationSignal: options.signal,
    domainEntry: { kind: 'style_analyze', source },
  });
  if (run.status === 'cancelled' || run.status === 'cancel_requested')
    throw new DOMException('风格任务已停止；已持久候选未撤销。', 'AbortError');
  if (run.status !== 'completed') throw new Error(run.error ?? 'STYLE_TASK_NOT_COMPLETED');
  const bundle = await tauriInvoke<TaskConversationBundle | null>('get_task_conversation', {
    conversationId,
  });
  if (
    !bundle ||
    bundle.conversation.conversationId !== conversationId ||
    !matchesScope(bundle.conversation, source)
  )
    throw new Error('STYLE_TASK_SCOPE_MISMATCH');
  const bySample = new Map<string, { profile: StyleAnalyzeResult; artifactId: string }>();
  let rootIdentity: string | undefined;
  for (const card of bundle.artifacts.filter(
    (item) => item.turnId === initialized.turn.turnId && item.artifactType === 'style_analysis',
  )) {
    if (!card.artifactId || !card.runId) throw new Error('STYLE_CANDIDATE_IDENTITY_MISSING');
    const sampleRun = bundle.runs.find(
      (item) => item.runId === card.runId && item.turnId === initialized.turn.turnId,
    );
    const execution = bundle.toolEvents.find(
      (event) => event.runId === card.runId && event.toolName === 'dsh.execution_contract',
    )?.argumentsSummary.execution as Record<string, unknown> | undefined;
    if (
      !sampleRun ||
      modelIdentity(sampleRun.modelSnapshot) !== modelIdentity(modelSnapshot) ||
      !execution ||
      execution.rootTaskId !== conversationId ||
      execution.rootTurnId !== initialized.turn.turnId ||
      typeof execution.rootRunId !== 'string' ||
      typeof execution.budgetEpoch !== 'string'
    )
      throw new Error('STYLE_ROOT_EVIDENCE_INVALID');
    const identity = `${execution.rootRunId}:${execution.budgetEpoch}`;
    if (rootIdentity && rootIdentity !== identity) throw new Error('STYLE_SAMPLE_ROOT_CHANGED');
    rootIdentity = identity;
    const artifact = await aiTaskRuntimeService.getArtifact(card.artifactId);
    if (
      artifact.artifact.artifactId !== card.artifactId ||
      (artifact.artifact.sourceNovelId ?? null) !== novelId ||
      artifact.artifact.sourceChapterId ||
      !['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus)
    )
      throw new Error('STYLE_ARTIFACT_SCOPE_MISMATCH');
    const task = await aiTaskRuntimeService.get(artifact.artifact.taskId);
    const hint = task.task.targetHintJson as Record<string, unknown> | undefined;
    if (
      !hint ||
      hint.conversationId !== conversationId ||
      hint.turnId !== initialized.turn.turnId ||
      hint.runId !== card.runId ||
      (!source.reference &&
        (hint.librarySourceId !== source.sourceId || hint.librarySourceHash !== source.contentHash))
    )
      throw new Error('STYLE_ARTIFACT_TASK_MISMATCH');
    const envelope = JSON.parse(artifact.rawContent) as {
      entryKind?: string;
      stageKey?: string;
      payload?: unknown;
    };
    if (
      envelope.entryKind !== 'style_analyze' ||
      !source.samples.some((sample) => sample.sampleId === envelope.stageKey)
    )
      throw new Error('STYLE_CANDIDATE_SOURCE_MISMATCH');
    const profile = validateStyleCandidate(envelope.payload);
    const previous = bySample.get(envelope.stageKey!);
    if (previous && canonical(previous.profile) !== canonical(profile))
      throw new Error('STYLE_SAMPLE_RESULT_CONFLICT');
    bySample.set(envelope.stageKey!, { profile, artifactId: card.artifactId });
  }
  if (bySample.size !== source.samples.length) throw new Error('STYLE_SAMPLE_RESULTS_INCOMPLETE');
  const ordered = source.samples.map((sample) => bySample.get(sample.sampleId)!);
  return {
    modelSnapshot,
    profiles: ordered.map((item) => item.profile),
    conversationId,
    artifactIds: ordered.map((item) => item.artifactId),
  };
}
