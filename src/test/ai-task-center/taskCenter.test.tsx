import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskCenterItem } from '../../types/aiTaskCenter';

let hookState: any;

vi.mock('../../hooks/useAiTaskCenter', () => ({
  useAiTaskCenter: () => hookState,
}));
vi.mock('../../services/ai-tasks/aiTaskCenterService', () => ({
  aiTaskCenterService: {
    getArtifact: vi.fn(), cancel: vi.fn(), retry: vi.fn(), refresh: vi.fn(),
  },
}));

import AiTaskBar from '../../components/ai-tasks/AiTaskBar';
import AiTasksPage from '../../pages/AiTasks/AiTasksPage';
import { aiTaskCenterService } from '../../services/ai-tasks/aiTaskCenterService';

const completedCandidate: AiTaskCenterItem = {
  source: 'unified', id: 'task-a', taskType: 'quality_check', status: 'completed',
  userStatus: 'awaiting_confirmation', isLegacy: false, novelTitle: '作品', chapterTitle: '第一章',
  createdAt: '2026-07-13T10:00:00Z', artifactId: 'artifact-a', artifactStatus: 'valid',
  targetLinkCount: 0, requiresReview: true, resultExpired: false,
};

const workflowRoot: AiTaskCenterItem = {
  ...completedCandidate,
  id: 'workflow-root', taskType: 'chapter_summary_workflow', status: 'running', userStatus: 'working',
  artifactId: undefined, artifactStatus: undefined, requiresReview: false,
  workflowId: 'workflow-a', workflowName: '第一章 · 摘要审查', rootTaskId: 'workflow-root',
  childCount: 2, completedChildCount: 1, failedChildCount: 0, staleChildCount: 0, progressPercent: 50,
};

const workflowChildren: AiTaskCenterItem[] = [
  { ...completedCandidate, id: 'step-prepare', taskType: 'workflow_prepare_materials', userStatus: 'completed', workflowId: 'workflow-a', rootTaskId: 'workflow-root', parentTaskId: 'workflow-root', stepKey: 'prepare_materials', priority: 10, requiresReview: false },
  { ...completedCandidate, id: 'step-summary', taskType: 'workflow_generate_summary', status: 'running', userStatus: 'working', artifactId: undefined, artifactStatus: undefined, workflowId: 'workflow-a', rootTaskId: 'workflow-root', parentTaskId: 'workflow-root', stepKey: 'generate_summary', priority: 20, requiresReview: false },
];

function baseState(items: AiTaskCenterItem[] = []) {
  return { items, loading: false, initialized: true, error: undefined, refresh: vi.fn(), updatedAt: undefined };
}

describe('unified AI task center', () => {
  beforeEach(() => {
    hookState = baseState();
    vi.mocked(aiTaskCenterService.getArtifact).mockReset();
  });

  it('shows query failure instead of an empty-list success state', () => {
    hookState = { ...baseState(), error: 'database unavailable' };
    render(<MemoryRouter><AiTasksPage /></MemoryRouter>);
    expect(screen.getByText('任务记录读取失败')).toBeTruthy();
    expect(screen.queryByText('还没有 AI 任务')).toBeNull();
  });

  it('keeps the global task bar non-modal and links to review', () => {
    hookState = baseState([completedCandidate]);
    render(<MemoryRouter><AiTaskBar /></MemoryRouter>);
    expect(screen.getByTestId('ai-task-bar')).toBeTruthy();
    expect(screen.getByRole('link', { name: '进入任务中心审查' }).getAttribute('href')).toBe('/ai-tasks');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses user-facing task labels in the ordinary task bar', () => {
    hookState = baseState([{
      ...completedCandidate,
      taskType: 'workflow_quality_review_bundle',
      status: 'running',
      userStatus: 'working',
    }]);
    render(<MemoryRouter><AiTaskBar /></MemoryRouter>);
    expect(screen.getByText('汇总审查包')).toBeTruthy();
    expect(screen.queryByText('workflow quality review bundle')).toBeNull();
  });

  it('keeps the task bar visible while the workspace route changes', async () => {
    hookState = baseState([completedCandidate]);
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <AiTaskBar />
        <Routes>
          <Route path="/workspace" element={<Link to="/settings">打开设置</Link>} />
          <Route path="/settings" element={<div>设置页面</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: '打开设置' }));
    expect(screen.getByText('设置页面')).toBeTruthy();
    expect(screen.getByTestId('ai-task-bar')).toBeTruthy();
    expect(screen.getByRole('link', { name: '进入任务中心审查' })).toBeTruthy();
  });

  it('hides engineering identifiers until advanced details are opened', async () => {
    hookState = baseState([{ ...completedCandidate, latestAttemptId: 'attempt-a', latestAttemptNumber: 1, requestHash: 'hash-a' }]);
    render(<MemoryRouter><AiTasksPage /></MemoryRouter>);
    expect(screen.getAllByText('等待确认').length).toBeGreaterThan(0);
    expect(screen.queryByText('task-a')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '高级详情' }));
    expect(screen.getByText('task-a')).toBeTruthy();
    expect(screen.getByText('attempt-a · #1')).toBeTruthy();
  });

  it('shows workflow progress and expands child steps without exposing ids by default', async () => {
    hookState = baseState([workflowRoot, ...workflowChildren]);
    render(<MemoryRouter><AiTasksPage /></MemoryRouter>);
    expect(screen.getByText('第一章 · 摘要审查')).toBeTruthy();
    expect(screen.getByText('总进度 50%')).toBeTruthy();
    expect(screen.queryByText('workflow-root')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '展开步骤' }));
    expect(screen.getByText('准备章节资料')).toBeTruthy();
    expect(screen.getAllByText('生成章节摘要候选').length).toBeGreaterThan(0);
  });

  it('renders a structured chapter candidate as prose and keeps raw JSON in advanced details', async () => {
    const candidateTask: AiTaskCenterItem = {
      ...completedCandidate,
      taskType: 'polish',
      proposalId: 'proposal-a',
    };
    const rawContent = JSON.stringify({
      mode: 'targeted_fix',
      revision_summary: '精简重复表达。',
      changed_ranges: [{ paragraphIndex: 0, before: '旧句', after: '新句' }],
      revised_content: '新句。\n\n第二段小说正文。',
    });
    vi.mocked(aiTaskCenterService.getArtifact).mockResolvedValue({
      artifactId: 'artifact-a', taskId: 'task-a', artifactType: 'chapter_text', processingStatus: 'valid',
      content: rawContent, rawContent, structuredPayload: JSON.parse(rawContent), baseContent: '旧句。\n\n第二段小说正文。',
    });
    hookState = baseState([candidateTask]);
    render(<MemoryRouter><AiTasksPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: '查看结果' }));
    const fullText = await screen.findByTestId('candidate-full-text');
    expect(fullText.textContent).toContain('第二段小说正文');
    expect(fullText.textContent).not.toMatch(/mode|changed_ranges|paragraphIndex/);
    expect(screen.getByText('本次修改摘要')).toBeTruthy();
    const advanced = screen.getByText('高级工程 / 技术详情').closest('details');
    expect(advanced?.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('button', { name: '审查并采用' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows format errors and disables adoption for malformed chapter JSON', async () => {
    const candidateTask: AiTaskCenterItem = {
      ...completedCandidate,
      taskType: 'polish',
      proposalId: 'proposal-a',
    };
    const rawContent = '{"mode":"targeted_fix","changed_ranges":[';
    vi.mocked(aiTaskCenterService.getArtifact).mockResolvedValue({
      artifactId: 'artifact-a', taskId: 'task-a', artifactType: 'chapter_text', processingStatus: 'valid',
      content: rawContent, rawContent,
    });
    hookState = baseState([candidateTask]);
    render(<MemoryRouter><AiTasksPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: '查看结果' }));
    expect(await screen.findByText('候选格式异常')).toBeTruthy();
    expect(screen.getByRole('button', { name: '审查并采用' }).hasAttribute('disabled')).toBe(true);
  });
});
