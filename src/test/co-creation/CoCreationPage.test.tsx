import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = {
  snapshot: {
    session: {
      sessionId: 'session-a', novelId: 'novel-a', title: 'AI 共创', status: 'active' as const,
      currentStage: 'story_seed' as const,
      stageProgress: [], objectContext: { novelId: 'novel-a', chapterId: 'chapter-a' },
      dataRevision: 1, dataHash: 'hash', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    },
    messages: [],
    draftRevisions: [],
  },
  loading: false, sending: false, applying: false, error: '', notice: '', novelTitle: '记忆之城',
  refresh: vi.fn(), sendMessage: vi.fn(), acceptSuggestion: vi.fn(), acceptAllSuggestions: vi.fn(),
  rejectSuggestion: vi.fn(), editField: vi.fn(), changeStage: vi.fn(), clearError: vi.fn(),
  applyPreparation: null, lastApplyResult: null, prepareFormalApply: vi.fn(),
  confirmFormalApply: vi.fn(), prepareFormalUndo: vi.fn(), cancelFormalApply: vi.fn(),
};

vi.mock('../../features/co-creation/useCoCreationController', () => ({
  useCoCreationController: () => controller,
}));

import CoCreationPage from '../../pages/CoCreation/CoCreationPage';

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/novels/novel-a/co-creation?chapterId=chapter-a']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/novels/:novelId/co-creation" element={<CoCreationPage />} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AI co-creation workspace page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the fixed ten stages and three workspace regions', () => {
    renderPage();
    expect(screen.getByText('故事种子')).not.toBeNull();
    expect(screen.getByText('章节生成')).not.toBeNull();
    expect(screen.getByRole('complementary', { name: '创作阶段' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'AI 共创对话' })).not.toBeNull();
    expect(screen.getByRole('complementary', { name: '当前设定与待确认草案' })).not.toBeNull();
    expect(screen.getByText('Proposal only')).not.toBeNull();
  });

  it('submits a natural-language message through the feature controller', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('回答当前问题，或直接讨论、修改设定…'), {
      target: { value: '我想写一个关于记忆代价的故事' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(controller.sendMessage).toHaveBeenCalledWith('我想写一个关于记忆代价的故事');
  });

  it('deep-links back to the same chapter in the writing workspace', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '在工作台完整审查' }));
    expect(screen.getByTestId('location').textContent)
      .toContain('/novels/novel-a/workspace?chapterId=chapter-a');
  });
});
