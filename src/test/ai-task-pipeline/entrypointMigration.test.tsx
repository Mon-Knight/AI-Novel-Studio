import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  directGenerate: vi.fn(),
  buildContext: vi.fn(),
  buildRequest: vi.fn(),
  compileGeneration: vi.fn(),
  getDrafts: vi.fn(),
  createDraft: vi.fn(),
  getNovel: vi.fn(),
  getGenerationContexts: vi.fn(),
  getStyles: vi.fn(),
  getOutputs: vi.fn(),
  confirmInfo: vi.fn(),
  checkCompliance: vi.fn(),
  validateConstraints: vi.fn(),
  getLatestConstraint: vi.fn(),
}));

vi.mock('../../services/ai-tasks/unifiedAiPipeline', () => ({
  unifiedAiPipeline: { run: mocks.runPipeline, cancel: vi.fn() },
}));
vi.mock('../../services/ai/aiClient', () => ({
  aiSettingsService: {
    getSettings: () => ({
      runtimeMode: 'mock', provider: 'mock', baseUrl: '', apiKey: '', modelName: 'Mock',
      temperature: 0.7, maxTokens: 8000, timeoutSeconds: 120, mockMode: true,
    }),
  },
  createAiClient: () => ({ generate: mocks.directGenerate }),
}));
vi.mock('../../services/prompt/contextBuilder', () => ({
  buildFreshChapterGenerationContext: mocks.buildContext,
}));
vi.mock('../../services/prompt/promptOrchestrator', () => ({
  buildGenerateRequest: mocks.buildRequest,
}));
vi.mock('../../services/prompt/chapterGenerationCompiler', () => ({
  CHAPTER_GENERATION_COMPILER_VERSION: 'chapter-context-constraint-v1',
  compileChapterGeneration: mocks.compileGeneration,
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getByChapterId: mocks.getDrafts,
    create: mocks.createDraft,
    adoptExact: vi.fn(),
  },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { update: vi.fn() },
}));
vi.mock('../../services/context/contextRecordService', () => ({
  contextRecordService: { getForGeneration: mocks.getGenerationContexts },
}));
vi.mock('../../services/styles/styleProfileService', () => ({
  styleProfileService: { getAll: mocks.getStyles },
}));
vi.mock('../../services/styles/outputProfileService', () => ({
  outputProfileService: { getAll: mocks.getOutputs },
}));
vi.mock('../../services/ai/outlineComplianceChecker', () => ({
  checkOutlineCompliance: mocks.checkCompliance,
}));
vi.mock('../../services/ai-tasks/chapterConstraintValidationService', () => ({
  chapterConstraintValidationService: {
    validateAndPersist: mocks.validateConstraints,
    getLatest: mocks.getLatestConstraint,
  },
}));
vi.mock('../../services/ai/chapterRevisionService', () => ({ reviseChapterByOutline: vi.fn() }));
vi.mock('../../services/ai/aiTaskService', () => ({ aiTaskService: {} }));
vi.mock('../../utils/nativeNotification', () => ({ notifyNative: vi.fn() }));
vi.mock('../../utils/nativeDialog', () => ({
  confirmInfo: mocks.confirmInfo,
  confirmDanger: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (_options: unknown, task: (helpers: any) => Promise<unknown>) => task({
    setStage: vi.fn(), setMessage: vi.fn(), setPercent: vi.fn(), setCancelable: vi.fn(),
  }),
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));
vi.mock('../../services/database/protagonistRepository', () => ({
  protagonistRepository: { getByNovelId: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../services/prompt/contextReaderService', () => ({
  getContextForChapterTask: vi.fn().mockResolvedValue({ chapterSummaries: [], volumeContexts: [] }),
  buildContextPromptSection: vi.fn(() => ''),
}));

import { aiSettingsService } from '../../services/ai/aiSettingsService';
import { qualityCheckAiService } from '../../services/ai/qualityCheckAiService';
import AiGeneratePanel from '../../components/right-dock/panels/AiGeneratePanel';

function chapter(): Chapter {
  return {
    id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: 'Chapter A',
    chapterNumber: 1, orderIndex: 0, sortOrder: 0, status: 'editing', wordCount: 20,
    currentWords: 20, targetWords: 1000, drafts: [],
    createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function pipelineResult(text: string) {
  return {
    task: {
      taskId: 'task-a', taskType: 'test', novelId: 'novel-a', scopeType: 'chapter',
      status: 'completed', traceId: 'trace-a', operationId: 'operation-a', requestHash: 'hash',
      createdAt: '2026-07-12T00:00:00.000Z',
    },
    attemptId: 'attempt-a',
    artifact: {
      artifactId: 'artifact-a', taskId: 'task-a', attemptId: 'attempt-a',
      artifactType: 'generic_text', schemaVersion: 1, rawContentRefId: 'raw-a',
      contentHash: 'artifact-hash', contentLength: text.length, processingStatus: 'valid',
      issues: [], createdAt: '2026-07-12T00:00:00.000Z',
    },
    response: { text },
  } as any;
}

function compiledGeneration(context: Record<string, unknown>) {
  const request = {
    taskType: 'chapter_generate' as const,
    messages: [{ role: 'user' as const, content: 'Generate chapter with compiled constraints' }],
    maxTokens: 1000,
    promptTemplateSource: 'chapter_generate.md' as const,
  };
  return {
    contextContract: {
      context,
      text: 'bounded compiled context',
      sourceManifest: {
        schemaVersion: 1,
        novelId: 'novel-a',
        volumeId: 'volume-a',
        chapterId: 'chapter-a',
        sourceDraft: { id: 'draft-source', versionNo: 3, contentHash: context.baseContentHash || 'source-hash' },
        sources: [],
        contextHash: 'context-hash',
      },
      budget: { maxChars: 24000, usedChars: 100, truncatedChars: 0, omittedSections: [], trimmedSections: [], promptChars: 200 },
      hash: 'context-hash',
      sections: [],
      warnings: [],
    },
    constraints: {
      must: [{ id: 'must-01', kind: 'must', text: '必须完成当前章节大纲', sourceRefs: [] }],
      should: [],
      forbid: [{ id: 'forbid-01', kind: 'forbid', text: '不得写入其他章节', sourceRefs: [] }],
      text: '【必须满足】\n1. 必须完成当前章节大纲\n\n【禁止违反】\n1. 不得写入其他章节',
      hash: 'constraint-hash',
      budget: { maxChars: 12000, usedChars: 40, omittedShouldCount: 0 },
    },
    promptTemplate: {
      id: 'chapter_generate', version: '1', body: 'prompt template body', hash: 'template-hash',
    },
    request,
    compiledPrompt: 'system:\ncompiled prompt',
  };
}

describe('M1/M2 migrated production entrypoints', () => {
  beforeEach(() => {
    mocks.runPipeline.mockReset();
    mocks.directGenerate.mockReset();
    mocks.compileGeneration.mockReset();
    mocks.checkCompliance.mockReset();
    mocks.checkCompliance.mockReturnValue({ score: 100, coveredPoints: [], missingPoints: [], evidence: [] });
    mocks.validateConstraints.mockReset();
    mocks.validateConstraints.mockImplementation(async (input: any) => ({
      artifactId: input.artifactId, taskId: input.taskId, novelId: input.novelId, chapterId: input.chapterId,
      sourceDraftId: input.sourceDraftId, sourceDraftVersion: input.sourceDraftVersion, baseContentHash: input.baseContentHash,
      validationRunId: 'validation-a', status: 'passed', must: [], should: [], forbid: [], blockingCount: 0,
      warningCount: 0, validatorVersion: 'test', validatedAt: 'now',
    }));
    mocks.getLatestConstraint.mockReset().mockResolvedValue(null);
    mocks.getGenerationContexts.mockResolvedValue([]);
    mocks.getStyles.mockResolvedValue([]);
    mocks.getOutputs.mockResolvedValue([]);
    mocks.confirmInfo.mockResolvedValue(true);
    localStorage.clear();
  });

  it('routes settings connection test through the unified pipeline', async () => {
    mocks.runPipeline.mockResolvedValue(pipelineResult('OK'));
    const result = await aiSettingsService.testConnection({
      runtimeMode: 'api', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key', modelName: 'test-model', timeoutSeconds: 10, mockMode: false,
    });
    expect(result.ok).toBe(true);
    expect(mocks.runPipeline).toHaveBeenCalledOnce();
    expect(mocks.runPipeline.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskType: 'connection_test', artifactType: 'generic_text', expectedOk: true,
    }));
  });

  it('routes manual quality check through the unified pipeline and persists its identities', async () => {
    mocks.getNovel.mockResolvedValue({ id: 'novel-a', title: 'Novel A' });
    mocks.runPipeline.mockResolvedValue(pipelineResult(JSON.stringify({
      overallScore: 88, summary: 'Good', items: [],
    })));
    const result = await qualityCheckAiService.runCheck({
      novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a',
      chapterTitle: 'Chapter A', draftContent: 'Draft body', contentHash: 'base-hash',
      draftVersion: 3, wordCount: 20, useUnifiedPipeline: true,
    });
    expect(mocks.runPipeline).toHaveBeenCalledOnce();
    expect(mocks.runPipeline.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskType: 'quality_check', chapterId: 'chapter-a', draftId: 'draft-a',
      artifactType: 'quality_report',
    }));
    const parseStructuredPayload = mocks.runPipeline.mock.calls[0][0].parseStructuredPayload;
    expect(parseStructuredPayload('```json\n{"overall_score":88,"summary":"Good","issues":[]}\n```'))
      .toEqual({ overallScore: 88, summary: 'Good', items: [] });
    expect(result.aiTaskId).toBe('task-a');
    expect(result.artifactId).toBe('artifact-a');
    expect(mocks.directGenerate).not.toHaveBeenCalled();
  });

  it('routes chapter generation through Artifact and Placement without creating a draft before confirmation', async () => {
    const sourceHash = await computeContentSha256('Source');
    const source = {
      id: 'draft-source', novelId: 'novel-a', chapterId: 'chapter-a', content: 'Source',
      source: 'user_edit', versionNo: 3, wordCount: 20, isAdopted: false,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
      contentState: { status: 'ready' as const, contentHash: sourceHash, contentLength: 6 },
    };
    const candidate = { ...source, id: 'artifact-candidate', content: 'Generated chapter body', versionNo: 4 };
    mocks.getDrafts.mockResolvedValue([source]);
    mocks.buildContext.mockResolvedValue({
      novelId: 'novel-a', chapterId: 'chapter-a', chapterTitle: 'Chapter A',
      targetWordCount: 1000, outlineKeyPoints: [], requiredCharacters: [], chapterCharacterList: [],
    });
    mocks.buildRequest.mockResolvedValue({
      taskType: 'chapter_generate', messages: [{ role: 'user', content: 'Generate chapter' }],
      maxTokens: 1000, promptTemplateSource: 'chapter-generate-test',
    });
    mocks.compileGeneration.mockResolvedValue(compiledGeneration({
      novelId: 'novel-a', chapterId: 'chapter-a', chapterTitle: 'Chapter A', targetWordCount: 1000,
      outlineKeyPoints: [], requiredCharacters: [], chapterCharacterList: [], baseContentHash: sourceHash,
    }));
    mocks.runPipeline.mockResolvedValue(pipelineResult(candidate.content));

    render(
      <AiGeneratePanel
        novelId="novel-a"
        chapter={chapter()}
        currentDraftId="draft-source"
        currentDraftVersion={3}
        currentEditorContent="Source"
        currentContentHash="base-hash"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /生成本章/ }));
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce());
    await screen.findByText(/候选已安全保存/);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((key) => key?.startsWith('ai_novel_studio_placement_'))).toBe(true);
    expect(mocks.runPipeline.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskType: 'chapter_generate', chapterId: 'chapter-a', draftId: 'draft-source',
      artifactType: 'chapter_text',
    }));
    expect(mocks.compileGeneration).toHaveBeenCalledWith(expect.objectContaining({
      novelId: 'novel-a', chapterId: 'chapter-a', sourceDraftId: 'draft-source', sourceDraftVersion: 3,
    }));
    expect(mocks.runPipeline.mock.calls[0][0].contextSnapshot).toEqual(expect.objectContaining({
      compiledContext: 'bounded compiled context',
      compilerVersion: 'chapter-context-constraint-v1',
      sourceManifestJson: expect.objectContaining({ contextHash: 'context-hash', chapterId: 'chapter-a' }),
    }));
    expect(mocks.runPipeline.mock.calls[0][0].constraintSnapshot).toEqual(expect.objectContaining({
      promptTemplateHash: 'template-hash',
      payloadJson: expect.objectContaining({ constraintHash: 'constraint-hash', targetChapterId: 'chapter-a' }),
    }));
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.directGenerate).not.toHaveBeenCalled();
  });

  it('stops before unified pipeline and Provider when Context or Constraint compilation fails', async () => {
    const source = {
      id: 'draft-source', novelId: 'novel-a', chapterId: 'chapter-a', content: 'Source',
      source: 'user_edit', versionNo: 3, wordCount: 20, isAdopted: false,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    mocks.getDrafts.mockResolvedValue([source]);
    mocks.buildContext.mockResolvedValue({ chapterTitle: 'Chapter A', outlineKeyPoints: [] });
    mocks.compileGeneration.mockRejectedValue(new Error('章节不属于当前作品，已阻止构建上下文。'));

    render(
      <AiGeneratePanel
        novelId="novel-a"
        chapter={chapter()}
        currentDraftId="draft-source"
        currentDraftVersion={3}
        currentEditorContent="Source"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /生成本章/ }));
    await waitFor(() => expect(mocks.compileGeneration).toHaveBeenCalledOnce());

    expect(mocks.runPipeline).not.toHaveBeenCalled();
    expect(mocks.directGenerate).not.toHaveBeenCalled();
  });

  it('retries with a new compiled contract while retaining the original chapter and draft baseline', async () => {
    const source = {
      id: 'draft-source', novelId: 'novel-a', chapterId: 'chapter-a', content: 'Source',
      source: 'user_edit', versionNo: 3, wordCount: 20, isAdopted: false,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const missingPoint = { id: 'point-a', text: '让守卫接受钥匙线索', type: 'event', required: true };
    const context = {
      novelId: 'novel-a', chapterId: 'chapter-a', chapterTitle: 'Chapter A', targetWordCount: 1000,
      outlineKeyPoints: [missingPoint], requiredCharacters: [], chapterCharacterList: [],
    };
    mocks.getDrafts.mockResolvedValue([source]);
    mocks.buildContext.mockResolvedValue(context);
    mocks.compileGeneration.mockResolvedValue(compiledGeneration(context));
    const retryResult = pipelineResult('Generated retry body');
    retryResult.task.taskId = 'task-b';
    retryResult.artifact.artifactId = 'artifact-b';
    mocks.runPipeline.mockResolvedValueOnce(pipelineResult('Generated first body')).mockResolvedValueOnce(retryResult);
    mocks.checkCompliance.mockReturnValue({ score: 0, coveredPoints: [], missingPoints: [missingPoint], evidence: [] });

    render(
      <AiGeneratePanel
        novelId="novel-a"
        chapter={chapter()}
        currentDraftId="draft-source"
        currentDraftVersion={3}
        currentEditorContent="Source"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /生成本章/ }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '重新生成' }).length).toBeGreaterThan(1));
    const retryButton = screen.getAllByRole('button', { name: '重新生成' })
      .find((button) => button.classList.contains('btn-secondary') && button.classList.contains('btn-sm'));
    expect(retryButton).toBeDefined();
    fireEvent.click(retryButton!);
    await waitFor(() => expect(mocks.compileGeneration).toHaveBeenCalledTimes(2));

    const firstInput = mocks.compileGeneration.mock.calls[0][0];
    const retryInput = mocks.compileGeneration.mock.calls[1][0];
    expect(retryInput).toEqual(expect.objectContaining({
      novelId: firstInput.novelId,
      chapterId: firstInput.chapterId,
      sourceDraftId: firstInput.sourceDraftId,
      sourceDraftVersion: firstInput.sourceDraftVersion,
      baseContentHash: firstInput.baseContentHash,
    }));
    expect(retryInput.userInstruction).toContain(missingPoint.text);
  });

  it('clears an AI co-creation handoff instruction when the workspace changes chapters', async () => {
    mocks.getDrafts.mockResolvedValue([]);
    const generationHandoff = {
      receiptType: 'chapter_generation_handoff' as const,
      handoffId: 'handoff-a', requestId: 'request-a', requestHash: 'request-hash',
      novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
      chapterPlan: 'A 章专属计划', baseContextHash: 'context-hash',
      createdAt: '2026-07-13T00:00:00.000Z',
    };
    const rendered = render(
      <AiGeneratePanel novelId="novel-a" chapter={chapter()} generationHandoff={generationHandoff} />,
    );
    const instruction = screen.getByPlaceholderText(/本章开头要压抑一些/) as HTMLTextAreaElement;
    await waitFor(() => expect(instruction.value).toBe('A 章专属计划'));

    rendered.rerender(
      <AiGeneratePanel
        novelId="novel-a"
        chapter={{ ...chapter(), id: 'chapter-b', title: 'Chapter B', chapterNumber: 2 }}
        generationHandoff={generationHandoff}
      />,
    );
    await waitFor(() => expect(instruction.value).toBe(''));
    expect(mocks.compileGeneration).not.toHaveBeenCalled();
  });
});
