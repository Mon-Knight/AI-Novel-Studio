import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  directGenerate: vi.fn(),
  buildContext: vi.fn(),
  buildRequest: vi.fn(),
  getDrafts: vi.fn(),
  createDraft: vi.fn(),
  getNovel: vi.fn(),
  getGenerationContexts: vi.fn(),
  getStyles: vi.fn(),
  getOutputs: vi.fn(),
  confirmInfo: vi.fn(),
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
  checkOutlineCompliance: () => ({ score: 100, coveredPoints: [], missingPoints: [], evidence: [] }),
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

describe('M1/M2 migrated production entrypoints', () => {
  beforeEach(() => {
    mocks.runPipeline.mockReset();
    mocks.directGenerate.mockReset();
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
    expect(result.aiTaskId).toBe('task-a');
    expect(result.artifactId).toBe('artifact-a');
    expect(mocks.directGenerate).not.toHaveBeenCalled();
  });

  it('routes chapter generation through Artifact and Placement without creating a draft before confirmation', async () => {
    const source = {
      id: 'draft-source', novelId: 'novel-a', chapterId: 'chapter-a', content: 'Source',
      source: 'user_edit', versionNo: 3, wordCount: 20, isAdopted: false,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
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
    await screen.findByText(/候选已保存为 Artifact 与 PlacementProposal/);
    expect(mocks.runPipeline.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskType: 'chapter_generate', chapterId: 'chapter-a', draftId: 'draft-source',
      artifactType: 'chapter_text',
    }));
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.directGenerate).not.toHaveBeenCalled();
  });
});
