import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChapterScenePlanCandidate } from '../../components/right-dock/panels/useChapterScenePlanCandidate';
import { aiSettingsService } from '../../services/ai/aiClient';
import {
  generateChapterScenePlanCandidates,
  type ChapterScenePlanCandidate,
} from '../../services/ai/chapterScenePlanService';
import { chapterEngineeringService } from '../../services/engineering/chapterEngineeringService';
import { generationContextCompiler } from '../../services/generation/generationContextCompiler';
import type { AiSettings } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ChapterEngineeringState, ScenePlanItem } from '../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';

vi.mock('../../services/ai/chapterScenePlanService', async () => {
  const actual = await vi.importActual<typeof import('../../services/ai/chapterScenePlanService')>(
    '../../services/ai/chapterScenePlanService',
  );
  return {
    ...actual,
    generateChapterScenePlanCandidates: vi.fn(),
  };
});

const timestamp = '2026-08-18T00:00:00.000Z';
const aiSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  mockMode: true,
};

function createChapter(id: string, novelId = 'novel-1'): Chapter {
  return {
    id,
    novelId,
    volumeId: 'volume-1',
    title: id === 'chapter-1' ? '第一章' : '第二章',
    outline: '章节大纲',
    goal: '推进主线',
    chapterNumber: id === 'chapter-1' ? 1 : 2,
    orderIndex: id === 'chapter-1' ? 1 : 2,
    sortOrder: id === 'chapter-1' ? 1 : 2,
    status: 'outline_ready',
    wordCount: 0,
    currentWords: 0,
    targetWordCount: 2_400,
    targetWords: 2_400,
    drafts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createSnapshot(novelId: string, chapterId: string): ChapterGenerationSnapshot {
  return {
    id: `snapshot-${chapterId}`,
    novelId,
    chapterId,
    contextHash: `hash-${chapterId}`,
    compiledPromptText: `context-${chapterId}`,
    compiledContext: {
      novelId,
      chapterId,
      baseContext: { chapterTitle: chapterId },
    },
  } as ChapterGenerationSnapshot;
}

function createScene(label: string): ScenePlanItem {
  return {
    id: `scene-${label}`,
    sceneNo: 1,
    title: label,
    location: '旧城区',
    characters: [],
    goal: '找到线索',
    conflict: '时间不足',
    keyActions: ['调查'],
    keyDialogue: '',
    informationRelease: [],
    result: '取得进展',
    transition: '进入下一场',
    beats: [{ id: `beat-${label}`, order: 1, text: label, required: true }],
  };
}

function createCandidate(label: string): ChapterScenePlanCandidate {
  return {
    scenes: [createScene(label)],
    rawText: label,
    execution: {},
  } as ChapterScenePlanCandidate;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createHarness(initialChapter = createChapter('chapter-1')) {
  const persistDraft = vi.fn(
    async (_scenePlanOverride?: ScenePlanItem[]): Promise<ChapterEngineeringState | null> => null,
  );
  const setActiveTab = vi.fn();
  const setBundle = vi.fn();
  const setScenePlan = vi.fn();
  const setDirty = vi.fn();
  const setBusy = vi.fn();
  const setMessage = vi.fn();
  const setError = vi.fn();
  const view = renderHook(
    ({ chapter, novelId }: { chapter: Chapter; novelId: string }) =>
      useChapterScenePlanCandidate({
        chapter,
        effectiveNovelId: novelId,
        currentEditorContent: '',
        dirty: false,
        persistDraft,
        setActiveTab,
        setBundle,
        setScenePlan,
        setDirty,
        setBusy,
        setMessage,
        setError,
      }),
    { initialProps: { chapter: initialChapter, novelId: initialChapter.novelId } },
  );
  return {
    ...view,
    persistDraft,
    setActiveTab,
    setBundle,
    setScenePlan,
    setDirty,
    setBusy,
    setMessage,
    setError,
  };
}

const generateMock = vi.mocked(generateChapterScenePlanCandidates);

beforeEach(() => {
  generateMock.mockReset();
  vi.spyOn(aiSettingsService, 'getSettings').mockReturnValue(aiSettings);
  vi.spyOn(generationContextCompiler, 'compileAndSave').mockImplementation(async (input) =>
    createSnapshot(input.novelId, input.chapterId),
  );
  vi.spyOn(chapterEngineeringService, 'activate');
});

describe('useChapterScenePlanCandidate identity and cancellation', () => {
  it('切章后丢弃迟到的 compile 结果且不启动 Provider', async () => {
    const pendingCompile = deferred<ChapterGenerationSnapshot>();
    vi.mocked(generationContextCompiler.compileAndSave).mockReturnValueOnce(pendingCompile.promise);
    const harness = createHarness();
    let generation!: Promise<void>;

    act(() => {
      generation = harness.result.current.handleGenerateScenePlan();
    });
    await waitFor(() => expect(generationContextCompiler.compileAndSave).toHaveBeenCalledOnce());

    harness.rerender({ chapter: createChapter('chapter-2'), novelId: 'novel-1' });
    await act(async () => {
      pendingCompile.resolve(createSnapshot('novel-1', 'chapter-1'));
      await generation;
    });

    expect(generateMock).not.toHaveBeenCalled();
    expect(harness.result.current.scenePlanCandidate).toBeNull();
    expect(harness.result.current.scenePlanRunning).toBe(false);
  });

  it('切章会中止 Provider signal 并忽略迟到候选', async () => {
    const pendingCandidate = deferred<ChapterScenePlanCandidate>();
    let signal: AbortSignal | undefined;
    generateMock.mockImplementationOnce(async (input) => {
      signal = input.signal;
      return pendingCandidate.promise;
    });
    const harness = createHarness();
    let generation!: Promise<void>;

    act(() => {
      generation = harness.result.current.handleGenerateScenePlan();
    });
    await waitFor(() => expect(signal).toBeDefined());

    harness.rerender({ chapter: createChapter('chapter-2'), novelId: 'novel-1' });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pendingCandidate.resolve(createCandidate('迟到的第一章候选'));
      await generation;
    });

    expect(harness.result.current.scenePlanCandidate).toBeNull();
    expect(harness.setActiveTab).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalledWith(expect.stringContaining('已生成'));
  });

  it('卸载时中止在途 Provider 且迟到结果不再写状态', async () => {
    const pendingCandidate = deferred<ChapterScenePlanCandidate>();
    let signal: AbortSignal | undefined;
    generateMock.mockImplementationOnce(async (input) => {
      signal = input.signal;
      return pendingCandidate.promise;
    });
    const harness = createHarness();
    let generation!: Promise<void>;

    act(() => {
      generation = harness.result.current.handleGenerateScenePlan();
    });
    await waitFor(() => expect(signal).toBeDefined());
    harness.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      pendingCandidate.resolve(createCandidate('卸载后的迟到候选'));
      await generation;
    });
    expect(harness.setActiveTab).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalledWith(expect.stringContaining('已生成'));
  });

  it('同章新请求覆盖旧请求且旧 finally 不会清除新请求 running', async () => {
    const first = deferred<ChapterScenePlanCandidate>();
    const second = deferred<ChapterScenePlanCandidate>();
    const signals: Array<AbortSignal | undefined> = [];
    generateMock
      .mockImplementationOnce(async (input) => {
        signals.push(input.signal);
        return first.promise;
      })
      .mockImplementationOnce(async (input) => {
        signals.push(input.signal);
        return second.promise;
      });
    const harness = createHarness();
    let firstGeneration!: Promise<void>;
    let secondGeneration!: Promise<void>;

    act(() => {
      firstGeneration = harness.result.current.handleGenerateScenePlan();
    });
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    act(() => {
      secondGeneration = harness.result.current.handleGenerateScenePlan();
    });
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    await act(async () => {
      first.resolve(createCandidate('旧请求候选'));
      await firstGeneration;
    });
    expect(harness.result.current.scenePlanRunning).toBe(true);
    expect(harness.result.current.scenePlanCandidate).toBeNull();

    await act(async () => {
      second.resolve(createCandidate('新请求候选'));
      await secondGeneration;
    });
    expect(harness.result.current.scenePlanRunning).toBe(false);
    expect(harness.result.current.scenePlanCandidate?.[0].title).toBe('新请求候选');
  });

  it('旧候选的保存与应用处理器在切章后均拒绝写入', async () => {
    generateMock.mockResolvedValueOnce(createCandidate('第一章候选'));
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.handleGenerateScenePlan();
    });
    expect(harness.result.current.scenePlanCandidate?.[0].title).toBe('第一章候选');
    const staleSaveHandler = harness.result.current.handleSaveScenePlanCandidate;

    harness.rerender({ chapter: createChapter('chapter-2'), novelId: 'novel-1' });
    await act(async () => {
      await staleSaveHandler(false);
      await staleSaveHandler(true);
    });

    expect(harness.persistDraft).not.toHaveBeenCalled();
    expect(chapterEngineeringService.activate).not.toHaveBeenCalled();
    expect(harness.setScenePlan).not.toHaveBeenCalled();
    expect(harness.setError).toHaveBeenCalledWith('Scene/Beat 候选所属章节已变化，请重新生成。');
  });
});
