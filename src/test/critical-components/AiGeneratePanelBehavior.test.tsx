import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiSettings,
  ChapterDraft,
  ChapterGenerationContext,
  ChapterPromptDebugInfo,
} from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { OutputProfile } from '../../types/output';
import type { StyleProfile } from '../../types/style';

const mocks = vi.hoisted(() => ({
  resetStreamPreview: vi.fn(),
  beginStreamPreview: vi.fn(),
  flushStreamPreview: vi.fn(),
  handleStreamEvent: vi.fn(),
  setStreamPreviewStatus: vi.fn(),
  setSelectedStyleId: vi.fn(),
  setSelectedOutputId: vi.fn(),
  setWordCountDraft: vi.fn(),
  setWordCountSaved: vi.fn(),
  handleSaveWordCount: vi.fn(),
  setContextSummary: vi.fn(),
  setPromptDebug: vi.fn(),
  handlePreviewContext: vi.fn(),
  generationOptions: null as Record<string, unknown> | null,
}));

vi.mock('../../features/agent-planner/ChapterReadinessPlanCard', () => ({
  ChapterReadinessPlanCard: () => <div data-testid="readiness-card" />,
}));

vi.mock('../../components/right-dock/panels/AiGenerateResultsView', () => ({
  AiGenerateResultsView: (props: Record<string, unknown>) => (
    <div data-testid="generation-results">
      <span>{String(props.statusMsg ?? '')}</span>
      <span>{String(props.errorMsg ?? '')}</span>
      <span>{String(props.streamPreview ?? '')}</span>
      <button
        type="button"
        data-testid="results-generate"
        onClick={() => (props.onGenerate as () => void)()}
      >
        生成
      </button>
      <button
        type="button"
        data-testid="results-revise"
        onClick={() => (props.onReviseByOutline as () => void)()}
      >
        修正
      </button>
      <button
        type="button"
        data-testid="results-keep"
        onClick={() => (props.onKeepDraft as () => void)()}
      >
        保留
      </button>
      <button
        type="button"
        data-testid="results-append"
        onClick={() => (props.onAppendCandidate as () => void)()}
      >
        追加
      </button>
      <button
        type="button"
        data-testid="results-replace"
        onClick={() => (props.onReplaceCandidate as () => void)()}
      >
        替换
      </button>
      <button
        type="button"
        data-testid="results-adopt"
        onClick={() => (props.onAdopt as () => void)()}
      >
        采用
      </button>
    </div>
  ),
}));

vi.mock('../../components/right-dock/panels/useGenerationStreamPreview', () => ({
  useGenerationStreamPreview: () => ({
    streamPreview: '安全流式预览',
    streamPreviewStatus: 'streaming',
    streamBufferRef: { current: '' },
    setStreamPreviewStatus: mocks.setStreamPreviewStatus,
    flushStreamPreview: mocks.flushStreamPreview,
    beginStreamPreview: mocks.beginStreamPreview,
    resetStreamPreview: mocks.resetStreamPreview,
    handleStreamEvent: mocks.handleStreamEvent,
  }),
}));

vi.mock('../../components/right-dock/panels/useAiGenerateResources', () => ({
  useAiGenerateResources: () => ({
    availableStyles: [style],
    availableOutputs: [output],
    selectedStyleId: style.id,
    setSelectedStyleId: mocks.setSelectedStyleId,
    selectedOutputId: output.id,
    setSelectedOutputId: mocks.setSelectedOutputId,
    wordCountDraft: 2_400,
    setWordCountDraft: mocks.setWordCountDraft,
    wordCountSaving: false,
    wordCountSaved: false,
    setWordCountSaved: mocks.setWordCountSaved,
    handleSaveWordCount: mocks.handleSaveWordCount,
    contextSummary: context,
    setContextSummary: mocks.setContextSummary,
    promptDebug,
    setPromptDebug: mocks.setPromptDebug,
    showContext: true,
    contextCount: 2,
    contextLoadError: '',
    handlePreviewContext: mocks.handlePreviewContext,
  }),
}));

vi.mock('../../components/right-dock/panels/useChapterGenerationAction', () => ({
  useChapterGenerationAction: (options: Record<string, unknown>) => {
    mocks.generationOptions = options;
    return () => {
      (options.setLatestGeneratedDraft as (value: ChapterDraft) => void)(generatedDraft);
      (options.setLatestGeneratedTarget as (value: Record<string, unknown>) => void)({
        resultId: generatedDraft.id,
        novelId: generatedDraft.novelId,
        chapterId: generatedDraft.chapterId,
        sourceDraftId: 'draft-source',
        sourceRevision: 1,
        baseContentHash: 'base-hash',
        source: 'ai_generate',
      });
      (options.setValidationState as (value: Record<string, unknown>) => void)({
        draftId: generatedDraft.id,
        outlineCompliance: {
          score: 92,
          coveredPoints: outlinePoints,
          missingPoints: [],
          warnings: [],
        },
        requiredNames: ['林岚'],
        missingRequiredNames: [],
        note: '校验通过',
      });
      (options.setStatusMsg as (value: string) => void)('候选已生成');
    };
  },
}));

import AiGeneratePanel from '../../components/right-dock/panels/AiGeneratePanel';
import { AiGeneratePanelView } from '../../components/right-dock/panels/AiGeneratePanelView';
import { aiSettingsService } from '../../services/ai/aiClient';
import { draftVersionService } from '../../services/database/draftVersionService';
import * as nativeDialog from '../../utils/nativeDialog';

const timestamp = '2026-07-28T00:00:00.000Z';
const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '主角发现线索并进入档案库。',
  goal: '推进调查',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 600,
  currentWords: 600,
  targetWords: 2_400,
  drafts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const generatedDraft: ChapterDraft = {
  id: 'draft-generated',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  content: '林岚进入档案库并发现了被删去的地图。',
  source: 'ai_generated',
  versionNo: 2,
  wordCount: 600,
  isAdopted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'openai_compatible',
  baseUrl: 'https://fixture.invalid',
  apiKey: '',
  modelName: '',
  mockMode: false,
};
const style: StyleProfile = {
  id: 'style-1',
  novelId: 'novel-1',
  name: '克制悬疑',
  sourceType: 'manual',
  targetWordsPerChapter: 2_400,
  rhythmPreference: 'moderate',
  narrativePerspective: '第三人称',
  tone: '克制',
  pace: '中速',
  dialogueRatio: 0.35,
  descriptionRatio: 0.45,
  prohibitedStyles: [],
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const output: OutputProfile = {
  id: 'output-1',
  novelId: 'novel-1',
  name: '章节正文',
  chapterWordRange: { min: 2_000, max: 3_000, default: 2_400 },
  paragraphLength: 'medium',
  povType: 'third_person_limited',
  tenseType: 'past',
  endingHookRequired: true,
  isDefault: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const outlinePoints = [
  { id: 'point-1', text: '进入档案库', type: 'event' as const, required: true },
];
const context: ChapterGenerationContext = {
  novelTitle: '遗忘之城',
  novelGenre: '悬疑',
  novelOutline: '调查城市失忆。',
  masterOutline: '全书总纲',
  worldBackground: '街道会被遗忘。',
  chapterTitle: chapter.title,
  chapterOutline: chapter.outline,
  chapterOutlineSource: 'active_chapter_outline',
  outlineKeyPoints: outlinePoints,
  outlineChecklistText: '- 进入档案库',
  chapterGoal: chapter.goal,
  targetWordCount: 2_400,
  volumeOutline: '第一卷调查异常',
  chapterCharacterList: [
    {
      id: 'chapter-character-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      characterId: 'character-1',
      name: '林岚',
      roleInChapter: '主角',
      mustAppear: true,
    },
  ],
  requiredCharacters: [
    {
      id: 'chapter-character-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      characterId: 'character-1',
      name: '林岚',
      roleInChapter: '主角',
      mustAppear: true,
    },
  ],
  chapterEvents: '- 进入档案库\n- 找到地图',
  previousContext: '上一章发现空白地图。',
  styleProfile: '克制悬疑',
};
const promptDebug: ChapterPromptDebugInfo = {
  templateSource: 'chapter_generate.md',
  hasChapterOutlineBlock: true,
  hasOutlineChecklistBlock: true,
  hasVolumeOutlineBlock: true,
  hasMasterOutlineBlock: true,
  hasChapterGoalBlock: true,
  hasChapterCharactersBlock: true,
  hasRequiredCharactersBlock: true,
  includesChapterOutlineText: true,
  includesOutlineChecklistText: true,
  includesVolumeOutlineText: true,
  includesMasterOutlineText: true,
  outlineKeyPointCount: 1,
  requiredCharactersCount: 1,
  requiredCharacterNames: ['林岚'],
  promptLength: 1_200,
};

beforeEach(() => {
  vi.spyOn(aiSettingsService, 'getSettings').mockReturnValue(settings);
  vi.spyOn(nativeDialog, 'confirmInfo').mockResolvedValue(true);
  vi.spyOn(nativeDialog, 'confirmDanger').mockResolvedValue(true);
});

describe('AiGeneratePanelView', () => {
  it('renders configured context and dispatches every generation control', () => {
    const callbacks = {
      onWordCountChange: vi.fn(),
      onWordCountSave: vi.fn(),
      onModeChange: vi.fn(),
      onStyleChange: vi.fn(),
      onOutputChange: vi.fn(),
      onInstructionChange: vi.fn(),
      onPreviewContext: vi.fn(),
      onGenerate: vi.fn(),
      onReviseByOutline: vi.fn(),
      onKeepDraft: vi.fn(),
      onAppendCandidate: vi.fn(),
      onReplaceCandidate: vi.fn(),
      onAdopt: vi.fn(),
    };
    const props: React.ComponentProps<typeof AiGeneratePanelView> = {
      novelId: 'novel-1',
      chapter,
      settings,
      contextCount: 2,
      contextLoadError: '',
      wordCountDraft: 2_400,
      wordCountSaving: false,
      wordCountSaved: true,
      genMode: 'new',
      availableStyles: [style],
      selectedStyleId: style.id,
      availableOutputs: [output],
      selectedOutputId: output.id,
      userInstruction: '结尾留下悬念',
      contextSummary: context,
      promptDebug,
      showContext: true,
      generating: false,
      revising: false,
      streamPreview: '安全预览',
      streamPreviewStatus: 'completed',
      statusMsg: '生成成功',
      errorMsg: '校验提示',
      validationState: {
        draftId: generatedDraft.id,
        outlineCompliance: {
          score: 92,
          coveredPoints: outlinePoints,
          missingPoints: [],
          warnings: [],
        },
        requiredNames: ['林岚'],
        missingRequiredNames: [],
        note: '通过',
      },
      latestGeneratedDraft: generatedDraft,
      latestGeneratedTarget: {
        resultId: generatedDraft.id,
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        sourceDraftId: 'draft-source',
        sourceRevision: 1,
        baseContentHash: 'base-hash',
        source: 'ai_generate',
      },
      latestGeneratedAlreadyDisplayed: false,
      candidateApplyAvailable: true,
      adopting: false,
      ...callbacks,
    };
    const view = render(<AiGeneratePanelView {...props} />);
    const wordInput = screen.getByRole('spinbutton');
    fireEvent.change(wordInput, { target: { value: '3000' } });
    fireEvent.blur(wordInput);
    fireEvent.click(screen.getByRole('button', { name: '已保存' }));
    fireEvent.click(screen.getByRole('button', { name: '生成新稿' }));
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: style.id } });
    fireEvent.change(selects[1], { target: { value: output.id } });
    fireEvent.change(screen.getByPlaceholderText(/本章开头/), { target: { value: '新要求' } });
    fireEvent.click(screen.getByRole('button', { name: /查看上下文摘要/ }));
    [
      'results-generate',
      'results-revise',
      'results-keep',
      'results-append',
      'results-replace',
      'results-adopt',
    ].forEach((testId) => fireEvent.click(screen.getByTestId(testId)));
    expect(callbacks.onWordCountChange).toHaveBeenCalledWith(3_000);
    expect(callbacks.onWordCountSave).toHaveBeenCalledOnce();
    expect(callbacks.onModeChange).toHaveBeenCalledTimes(2);
    expect(callbacks.onStyleChange).toHaveBeenCalledWith(style.id);
    expect(callbacks.onOutputChange).toHaveBeenCalledWith(output.id);
    expect(callbacks.onGenerate).toHaveBeenCalledOnce();

    view.rerender(
      <AiGeneratePanelView
        {...props}
        settings={{ ...settings, runtimeMode: 'mock', mockMode: true }}
        contextCount={0}
        contextLoadError="上下文读取失败"
        wordCountDraft={0}
        wordCountSaving
        wordCountSaved={false}
        genMode="rewrite"
        availableStyles={[]}
        selectedStyleId="missing-style"
        availableOutputs={[]}
        selectedOutputId=""
        contextSummary={{ ...context, chapterOutline: '', outlineKeyPoints: [] }}
        promptDebug={null}
        showContext={false}
        generating
        streamPreviewStatus="interrupted"
      />,
    );
    fireEvent.blur(screen.getByRole('spinbutton'));
    expect(callbacks.onWordCountChange).toHaveBeenCalledWith(4_000);

    view.rerender(
      <AiGeneratePanelView
        {...props}
        wordCountDraft={1_800}
        contextSummary={{ ...context, targetWordCount: 0 }}
      />,
    );
    expect(screen.getAllByText(/目标字数：1800 字/).length).toBeGreaterThan(0);

    view.rerender(<AiGeneratePanelView {...props} contextCount={null} contextSummary={null} />);
    expect(screen.getByTestId('generation-context-count').getAttribute('data-context-count')).toBe(
      'error',
    );
  });
});

describe('AiGeneratePanel controller', () => {
  it('connects resource controls, generated candidate application and adoption', async () => {
    const getLatest = vi
      .spyOn(draftVersionService, 'getLatestByChapterId')
      .mockResolvedValueOnce(null)
      .mockResolvedValue(generatedDraft);
    const adopt = vi.spyOn(draftVersionService, 'adopt').mockResolvedValue(generatedDraft);
    const onApplyAiText = vi.fn(async () => true);
    const onAdopted = vi.fn();
    const onGenerated = vi.fn();
    const view = render(
      <AiGeneratePanel
        novelId="novel-1"
        chapter={chapter}
        currentDraftId="draft-source"
        currentDraftVersion={1}
        currentEditorContent="编辑器正文"
        currentContentHash="base-hash"
        onApplyAiText={onApplyAiText}
        onAdopted={onAdopted}
        onGenerated={onGenerated}
        onBeforeDocumentChange={async () => true}
      />,
    );
    expect(mocks.resetStreamPreview).toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2800' } });
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: style.id } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: output.id } });
    fireEvent.change(screen.getByPlaceholderText(/本章开头/), { target: { value: '加快节奏' } });
    fireEvent.click(screen.getByRole('button', { name: /查看上下文摘要/ }));
    fireEvent.click(screen.getByTestId('results-generate'));
    await waitFor(() => expect(screen.getByText('候选已生成')).not.toBeNull());
    fireEvent.click(screen.getByTestId('results-append'));
    fireEvent.click(screen.getByTestId('results-replace'));
    expect(onApplyAiText).toHaveBeenNthCalledWith(1, expect.objectContaining({ mode: 'append' }));
    expect(onApplyAiText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'replace_all' }),
    );
    fireEvent.click(screen.getByTestId('results-keep'));

    fireEvent.click(screen.getByTestId('results-revise'));
    await waitFor(() => expect(getLatest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('没有可修正的草稿')).not.toBeNull());

    fireEvent.click(screen.getByTestId('results-adopt'));
    await waitFor(() => expect(adopt).toHaveBeenCalledWith(generatedDraft.id, chapter.id));
    expect(onAdopted).toHaveBeenCalledOnce();
    expect(mocks.setWordCountDraft).toHaveBeenCalledWith(2_800);
    expect(mocks.setWordCountSaved).toHaveBeenCalledWith(false);
    expect(mocks.setSelectedStyleId).toHaveBeenCalledWith(style.id);
    expect(mocks.setSelectedOutputId).toHaveBeenCalledWith(output.id);

    view.rerender(<AiGeneratePanel novelId="novel-1" />);
    expect(screen.getByText('请先在左侧目录树中选择一个章节')).not.toBeNull();
  });

  it('blocks adoption when the latest draft belongs to another chapter', async () => {
    vi.spyOn(draftVersionService, 'getLatestByChapterId').mockResolvedValue({
      ...generatedDraft,
      chapterId: 'other-chapter',
    });
    const adopt = vi.spyOn(draftVersionService, 'adopt');
    render(<AiGeneratePanel novelId="novel-1" chapter={chapter} />);
    fireEvent.click(screen.getByTestId('results-adopt'));
    await waitFor(() =>
      expect(screen.getByText('草稿与当前作品章节不一致，已阻止采用')).not.toBeNull(),
    );
    expect(adopt).not.toHaveBeenCalled();
  });
});
