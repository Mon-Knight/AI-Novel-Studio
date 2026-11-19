import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleSourceSnapshot } from '../../types/taskLibrary';
const fixture = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
  start: vi.fn(),
  capture: vi.fn(),
  create: vi.fn(),
  artifact: vi.fn(),
  task: vi.fn(),
  legacy: vi.fn(),
  settings: vi.fn(),
  model: {
    providerId: 'mock',
    modelId: 'offline-v1',
    runtimeMode: 'mock' as const,
    capabilities: [],
    options: { maxTokens: 4000 },
    capturedAt: 'frozen',
  },
  bundle: {} as Record<string, unknown>,
  artifacts: new Map<string, unknown>(),
  tasks: new Map<string, unknown>(),
}));
vi.mock('../database/db', () => ({
  isTauri: () => fixture.desktop,
  generateId: (() => {
    let n = 0;
    return () => `id-${++n}`;
  })(),
  nowISO: () => '2026-11-11T00:00:00Z',
}));
vi.mock('../tauri/runtime', () => ({ tauriInvoke: fixture.invoke }));
vi.mock('../conversation/taskModelSnapshot', () => ({
  captureTaskModelSnapshot: fixture.capture,
  captureTaskModelSnapshotFromSettings: () => fixture.model,
}));
vi.mock('../conversation/taskConversationService', () => ({
  taskConversationService: { createInitialized: fixture.create },
}));
vi.mock('../dsh/taskSessionAdapter', () => ({ taskSessionAdapter: { startTurn: fixture.start } }));
vi.mock('../ai-tasks/aiTaskRuntimeService', () => ({
  aiTaskRuntimeService: { getArtifact: fixture.artifact, get: fixture.task },
}));
vi.mock('../ai/aiClient', () => ({
  createAiClient: fixture.legacy,
  aiSettingsService: { getSettings: fixture.settings },
}));
vi.mock('../ai/aiSettingsService', () => ({
  aiSettingsService: { getSettings: fixture.settings },
}));
vi.mock('../ai/aiTaskService', () => ({ aiTaskService: {} }));
import {
  analyzeStyleSource,
  globalStyleSource,
  validateStyleCandidate,
} from './styleRuntimeService';
import { analyzeStyle, analyzeStyleBrowser } from './styleAnalyzeService';
import { analyzeLayeredReferenceStyle } from '../references/layeredStyleAnalyzer';

function initialized(conversationId: string, novelId: string | null, source?: StyleSourceSnapshot) {
  return {
    conversation: {
      conversationId,
      novelId,
      defaultModel: fixture.model,
      scope: novelId
        ? { kind: 'novel', novelId }
        : { kind: 'library', sourceId: source!.sourceId, sourceHash: source!.contentHash },
    },
    turn: { turnId: `${conversationId}-turn` },
  };
}
function prepareResult(input: {
  conversationId: string;
  novelId: string | null;
  turnId: string;
  modelSnapshot: typeof fixture.model;
  domainEntry: { source: StyleSourceSnapshot };
}) {
  const source = input.domainEntry.source;
  const artifacts = source.samples.map((_sample, index) => ({
    cardId: `card-${index}`,
    artifactId: `artifact-${index}`,
    artifactType: 'style_analysis',
    conversationId: input.conversationId,
    turnId: input.turnId,
    runId: `run-${index}`,
  }));
  const runs = artifacts.map((card) => ({
    runId: card.runId,
    turnId: input.turnId,
    modelSnapshot: structuredClone(input.modelSnapshot),
    status: 'completed',
  }));
  const toolEvents = runs.map((run) => ({
    runId: run.runId,
    toolName: 'dsh.execution_contract',
    argumentsSummary: {
      execution: {
        rootTaskId: input.conversationId,
        rootTurnId: input.turnId,
        rootRunId: 'same-root',
        budgetEpoch: 'same-budget',
      },
    },
  }));
  fixture.bundle = {
    conversation: initialized(input.conversationId, input.novelId, source).conversation,
    artifacts,
    runs,
    toolEvents,
  };
  artifacts.forEach((card, index) => {
    fixture.artifacts.set(card.artifactId, {
      artifact: {
        artifactId: card.artifactId,
        taskId: `task-${index}`,
        sourceNovelId: input.novelId,
        processingStatus: 'valid',
        artifactType: 'style_analysis',
      },
      rawContent: JSON.stringify({
        entryKind: 'style_analyze',
        stageKey: source.samples[index].sampleId,
        payload: { styleSummary: `离线抽象风格${index}`, dialogueRatio: 0.3 },
      }),
    });
    fixture.tasks.set(`task-${index}`, {
      task: {
        targetHintJson: {
          conversationId: input.conversationId,
          turnId: input.turnId,
          runId: card.runId,
          librarySourceId: source.sourceId,
          librarySourceHash: source.contentHash,
        },
      },
    });
  });
  return { runId: runs[runs.length - 1]?.runId, status: 'completed' };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.desktop = true;
  fixture.artifacts.clear();
  fixture.tasks.clear();
  fixture.capture.mockReturnValue(fixture.model);
  fixture.create.mockImplementation(async (novelId: string) =>
    initialized('project-root', novelId),
  );
  fixture.invoke.mockImplementation(
    async (
      command: string,
      args: { input?: { conversationId: string; source: StyleSourceSnapshot } },
    ) =>
      command === 'create_initialized_library_task'
        ? initialized(args.input!.conversationId, null, args.input!.source)
        : fixture.bundle,
  );
  fixture.start.mockImplementation(async (input) => prepareResult(input));
  fixture.artifact.mockImplementation(async (id: string) => fixture.artifacts.get(id));
  fixture.task.mockImplementation(async (id: string) => fixture.tasks.get(id));
});

describe('unified style source tasks', () => {
  it.each(['mock', 'api'] as const)(
    'uses the same host contract for %s with no provider execution in the caller',
    async (runtimeMode) => {
      fixture.capture.mockReturnValue({
        ...fixture.model,
        runtimeMode,
        providerId: runtimeMode === 'mock' ? 'mock' : 'ollama',
        baseUrl: runtimeMode === 'api' ? 'http://127.0.0.1:1/v1' : undefined,
      });
      await analyzeStyle('离线协议适配夹具，不访问网络。');
      expect(fixture.start).toHaveBeenCalledTimes(1);
      expect(fixture.start.mock.calls[0][0].modelSnapshot.runtimeMode).toBe(runtimeMode);
      expect(fixture.legacy).not.toHaveBeenCalled();
    },
  );
  it('rejects a library task initialized with another source scope before dispatch', async () => {
    fixture.invoke.mockResolvedValueOnce({
      conversation: {
        conversationId: 'wrong-root',
        novelId: null,
        scope: { kind: 'library', sourceId: 'foreign', sourceHash: 'f'.repeat(64) },
      },
      turn: { turnId: 'turn' },
    });
    await expect(analyzeStyle('离线样本')).rejects.toThrow('STYLE_TASK_SCOPE_MISMATCH');
    expect(fixture.start).not.toHaveBeenCalled();
  });
  it('global TXT uses true library scope, one frozen model and candidate-only facts', async () => {
    const result = await analyzeStyle('完全人工构造的离线样本。');
    expect(result.styleSummary).toBe('离线抽象风格0');
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.start).toHaveBeenCalledTimes(1);
    expect(fixture.start.mock.calls[0][0]).toMatchObject({
      novelId: null,
      modelSnapshot: fixture.model,
      domainEntry: { kind: 'style_analyze' },
    });
    expect(fixture.legacy).not.toHaveBeenCalled();
    expect(fixture.settings).not.toHaveBeenCalled();
    expect(fixture.invoke.mock.calls.map(([name]) => name)).toEqual([
      'create_initialized_library_task',
      'get_task_conversation',
    ]);
  });
  it('all project layers share one root/model/signal and native ranges instead of caller bodies', async () => {
    const controller = new AbortController();
    const sections = Array.from({ length: 6 }, (_, index) => ({
      id: `section-${index}`,
      novelId: 'novel-a',
      workId: 'work-a',
      importId: 'import-a',
      orderIndex: index + 1,
      title: `层${index}`,
      content: `${index}离线纯夹具句子。`.repeat(400),
      contentHash: 'a'.repeat(64),
      charCount: 4000,
      sourceStartUtf16: 0,
      sourceEndUtf16: 4000,
    }));
    const result = await analyzeLayeredReferenceStyle({
      work: {
        id: 'work-a',
        novelId: 'novel-a',
        title: '离线参考',
        purpose: 'style',
        activeImportId: 'import-a',
        activeSourceHash: 'b'.repeat(64),
        revision: 1,
        sourceStatus: 'available',
        sectionCount: 6,
        totalChars: 24000,
        createdAt: '',
        updatedAt: '',
      },
      importId: 'import-a',
      sourceHash: 'b'.repeat(64),
      sections,
      options: { signal: controller.signal },
    });
    expect(fixture.start).toHaveBeenCalledTimes(1);
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    const request = fixture.start.mock.calls[0][0];
    expect(request.cancellationSignal).toBe(controller.signal);
    expect(request.domainEntry.source.samples.length).toBeGreaterThan(1);
    expect(
      request.domainEntry.source.samples.every(
        (sample: Record<string, unknown>) => !('content' in sample),
      ),
    ).toBe(true);
    expect(result.layerResults).toHaveLength(request.domainEntry.source.samples.length);
    expect(result.model).toEqual({
      runtimeMode: 'mock',
      provider: 'mock',
      modelName: 'offline-v1',
    });
    expect(fixture.settings).not.toHaveBeenCalled();
    expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it('rejects cross-library task artifacts rather than treating two NULL owners as equal', async () => {
    fixture.task.mockResolvedValue({
      task: { targetHintJson: { conversationId: 'foreign', turnId: 'foreign', runId: 'run-0' } },
    });
    await expect(analyzeStyle('离线样本')).rejects.toThrow('STYLE_ARTIFACT_TASK_MISMATCH');
  });
  it('rejects a changed root budget or frozen model in sample receipts', async () => {
    fixture.start.mockImplementation(async (input) => {
      const result = prepareResult(input);
      const runs = fixture.bundle.runs as Array<{ modelSnapshot: typeof fixture.model }>;
      runs[0].modelSnapshot.modelId = 'other-model';
      return result;
    });
    await expect(analyzeStyle('离线样本')).rejects.toThrow('STYLE_ROOT_EVIDENCE_INVALID');
  });
  it('does not retry uncertain commits/model errors or fall back to legacy generation', async () => {
    fixture.start.mockRejectedValue(new Error('DATABASE_COMMIT_UNKNOWN'));
    await expect(analyzeStyle('离线样本')).rejects.toThrow('DATABASE_COMMIT_UNKNOWN');
    expect(fixture.start).toHaveBeenCalledTimes(1);
    expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it('cancellation before start dispatches nothing; native cancellation preserves committed-fact wording', async () => {
    const stopped = new AbortController();
    stopped.abort();
    await expect(analyzeStyle('离线样本', { signal: stopped.signal })).rejects.toMatchObject({
      code: 'AI_REQUEST_CANCELLED',
    });
    expect(fixture.start).not.toHaveBeenCalled();
    fixture.start.mockResolvedValue({ status: 'cancelled' });
    await expect(analyzeStyle('离线样本')).rejects.toThrow('已持久候选未撤销');
  });
  it('validates full source bounds and refuses arbitrary candidate authority flags', async () => {
    const source = await globalStyleSource('Unicode😀离线');
    expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(source.utf8ByteLength).toBe(new TextEncoder().encode('Unicode😀离线').length);
    await expect(globalStyleSource('😀'.repeat(10_001))).rejects.toThrow('上限');
    expect(() => validateStyleCandidate({ styleSummary: '候选', authorReviewed: true })).toThrow(
      'UNKNOWN_FIELD',
    );
    expect(() => validateStyleCandidate({ styleSummary: '候选', dialogueRatio: 1.1 })).toThrow(
      'RATIO_INVALID',
    );
    await expect(analyzeStyleBrowser('样本', {}, {} as never)).rejects.toThrow('不得进入');
    fixture.desktop = false;
    await expect(analyzeStyleSource(source)).rejects.toThrow('浏览器预览不是桌面验收');
  });
});
