import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChapterSummaryPanel from '../../components/right-dock/panels/ChapterSummaryPanel';
import { ChapterSummaryWorkflowNotice } from '../../components/workspace/ChapterSummaryWorkflowNotice';
import type { ChapterWorkflowState } from '../../services/conversation/chapterWorkflowService';

const fixture = vi.hoisted(() => ({
  load: vi.fn(),
  summarize: vi.fn(),
  chapter: vi.fn(),
  summary: vi.fn(),
  setEnabled: vi.fn(),
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: fixture.chapter },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: { getByChapterId: fixture.summary, setEnabled: fixture.setEnabled },
}));
vi.mock('../../services/conversation/chapterWorkflowService', async (original) => ({
  ...(await original<typeof import('../../services/conversation/chapterWorkflowService')>()),
  loadChapterWorkflow: fixture.load,
}));
vi.mock('../../services/ai/chapterSummarizeService', () => ({
  chapterSummarizeService: { summarize: fixture.summarize },
}));

const state: ChapterWorkflowState = {
  chapter: {
    id: 'chapter',
    novelId: 'novel',
    title: '旧信',
    chapterNumber: 3,
    outline: '',
    goal: '',
    orderIndex: 2,
    sortOrder: 2,
    status: 'adopted',
    adoptedDraftId: 'draft',
    wordCount: 3400,
    currentWords: 3400,
    targetWords: 3400,
    drafts: [],
    createdAt: '',
    updatedAt: '',
  },
  summary: null,
  phase: 'awaiting_apply',
  conversationId: 'source-task',
  conversationTitle: '第三章',
  cardId: 'summary-card',
  model: {
    providerId: 'configured',
    modelId: 'model-3.8',
    runtimeMode: 'api',
    capabilities: [],
    options: {},
    capturedAt: '',
  },
  actualModel: true,
  archived: false,
};
function Location() {
  const location = useLocation();
  return <output data-testid="location-state">{JSON.stringify(location.state)}</output>;
}
describe('governed chapter summary entry', () => {
  beforeEach(() => {
    fixture.load.mockResolvedValue(state);
  });
  it('shows actual summary model and navigates to the exact candidate without an independent model call', async () => {
    render(
      <MemoryRouter>
        <ChapterSummaryPanel novelId="novel" chapter={state.chapter} />
        <Location />
      </MemoryRouter>,
    );
    await screen.findByText(/本次总结实际模型/);
    expect(screen.getByText(/model-3.8/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('chapter-summary-open-source'));
    const target = JSON.parse(screen.getByTestId('location-state').textContent!);
    expect(target.chapterWorkflow).toMatchObject({
      novelId: 'novel',
      chapterId: 'chapter',
      adoptedDraftId: 'draft',
      conversationId: 'source-task',
      cardId: 'summary-card',
    });
    expect(fixture.summarize).not.toHaveBeenCalled();
  });
  it('prepares a rejected summary for explicit resubmission and retains the chapter scope', async () => {
    fixture.load.mockResolvedValue({ ...state, phase: 'rejected' });
    render(
      <MemoryRouter>
        <ChapterSummaryWorkflowNotice novelId="novel" chapter={state.chapter} />
        <Location />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('chapter-summary-redo'));
    const target = JSON.parse(screen.getByTestId('location-state').textContent!).chapterWorkflow;
    expect(target.chapterId).toBe('chapter');
    expect(target.draft).toContain('需要修正');
    expect(target.cardId).toBeUndefined();
    expect(fixture.summarize).not.toHaveBeenCalled();
  });
  it('keeps an unsaved editor in place when the leave check is cancelled', async () => {
    render(
      <MemoryRouter>
        <ChapterSummaryWorkflowNotice
          novelId="novel"
          chapter={state.chapter}
          onBeforeNavigate={() => false}
        />
        <Location />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('chapter-summary-open-source'));
    await waitFor(() => expect(screen.getByTestId('location-state').textContent).toBe('null'));
  });
  it('keeps the original writing task as the explicit back destination', async () => {
    fixture.load.mockResolvedValue({ ...state, sourceConversationId: 'writing-task' });
    render(
      <MemoryRouter>
        <ChapterSummaryWorkflowNotice novelId="novel" chapter={state.chapter} returnOnly />
        <Location />
      </MemoryRouter>,
    );
    const back = await screen.findByRole('button', { name: '返回本章任务' });
    await waitFor(() => expect((back as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(back);
    const target = JSON.parse(screen.getByTestId('location-state').textContent!).chapterWorkflow;
    expect(target).toMatchObject({ destination: 'source', conversationId: 'writing-task' });
    expect(target.cardId).toBeUndefined();
    expect(target.draft).toBeUndefined();
  });
  it('retains saved summary details and distinguishes intentional disablement from missing context', async () => {
    fixture.load.mockResolvedValue({
      ...state,
      phase: 'disabled',
      summary: {
        id: 'summary',
        novelId: 'novel',
        chapterId: 'chapter',
        adoptedDraftId: 'draft',
        summary: '信件已交接，来路仍待查',
        enabled: false,
        isExpired: false,
        keyEvents: ['完成交接'],
        newForeshadows: ['缺失的登记页'],
        resolvedForeshadows: ['确认寄件人'],
        nextChapterHints: '按约定查阅台账',
        createdAt: '2026-10-16',
        updatedAt: '2026-10-16',
        validationResult: {
          passed: false,
          score: 0,
          problems: [],
          safeToContext: true,
          authorReviewed: true,
          semanticValidation: 'not_checked',
        },
      },
    });
    render(
      <MemoryRouter>
        <ChapterSummaryPanel novelId="novel" chapter={state.chapter} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('正文已采用 · 总结已停用')).toBeTruthy();
    for (const text of [
      '完成交接',
      '缺失的登记页',
      '确认寄件人',
      '按约定查阅台账',
      '作者已审阅，语义未自动核实',
    ])
      expect(screen.getByText(text)).toBeTruthy();
    expect(fixture.summarize).not.toHaveBeenCalled();
  });
  it('revalidates current adoption before enabling an old displayed summary', async () => {
    const summary = {
      id: 'summary',
      novelId: 'novel',
      chapterId: 'chapter',
      adoptedDraftId: 'draft',
      summary: '旧总结',
      enabled: false,
      isExpired: false,
      createdAt: '2026-10-16',
      updatedAt: '2026-10-16',
    };
    fixture.load.mockResolvedValue({ ...state, phase: 'disabled', summary });
    fixture.summary.mockResolvedValue(summary);
    fixture.chapter.mockResolvedValue({ ...state.chapter, adoptedDraftId: 'new-draft' });
    render(
      <MemoryRouter>
        <ChapterSummaryPanel novelId="novel" chapter={state.chapter} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '启用此总结' }));
    expect((await screen.findByRole('alert')).textContent).toContain('已过期');
    expect(fixture.setEnabled).not.toHaveBeenCalled();
  });
});
