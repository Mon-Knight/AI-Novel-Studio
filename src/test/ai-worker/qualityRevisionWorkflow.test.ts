import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBackground: vi.fn(async (input: unknown) => ({
    workflowId: 'workflow-quality', rootTaskId: 'root-quality', childTaskIds: ['1', '2', '3', '4', '5'], input,
  })),
  prepareQualityCheck: vi.fn(async () => ({
    request: { messages: [{ role: 'user', content: 'frozen quality prompt' }] },
  })),
}));

vi.mock('../../services/ai-tasks/aiWorkflowService', () => ({
  aiWorkflowService: { createBackground: mocks.createBackground },
}));
vi.mock('../../services/ai/qualityCheckAiService', () => ({
  prepareQualityCheck: mocks.prepareQualityCheck,
}));
vi.mock('../../utils/contentIntegrity', () => ({ computeContentSha256: vi.fn(async () => 'source-hash') }));

import {
  buildQualityRevisionWorkflowSteps,
  qualityRevisionWorkflowService,
} from '../../services/ai/qualityRevisionWorkflowService';

describe('stage 2E quality revision workflow', () => {
  beforeEach(() => {
    mocks.createBackground.mockClear();
    mocks.prepareQualityCheck.mockClear();
  });

  it('builds five independent DAG steps with one review output', () => {
    const steps = buildQualityRevisionWorkflowSteps(
      [{ role: 'user', content: 'quality prompt' }],
      '第一章',
      '冻结后的章节正文',
      '章节大纲',
    );
    expect(steps.map((step) => step.stepKey)).toEqual([
      'freeze_chapter', 'quality_check', 'quality_fix', 'quality_recheck', 'review_bundle',
    ]);
    expect(steps.map((step) => step.dependencies || [])).toEqual([
      [], ['freeze_chapter'], ['quality_check'], ['quality_fix'],
      ['quality_check', 'quality_fix', 'quality_recheck'],
    ]);
    expect(steps.filter((step) => step.reviewOutput)).toHaveLength(1);
    expect(steps[steps.length - 1]?.taskType).toBe('workflow_quality_review_bundle');
    expect(steps[2].messages[1].content).toContain('冻结后的章节正文');
  });

  it('submits a frozen nonblocking workflow without applying content', async () => {
    const created = await qualityRevisionWorkflowService.submit({
      novelId: 'novel-a',
      chapter: {
        id: 'chapter-a', novelId: 'novel-a', title: '第一章', chapterNumber: 1,
        orderIndex: 0, sortOrder: 0, status: 'editing', wordCount: 4, currentWords: 4,
        targetWords: 4000, drafts: [], createdAt: 'now', updatedAt: 'now',
      },
      currentDraft: {
        id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', content: '冻结后的章节正文',
        source: 'user_edited', versionNo: 1, wordCount: 4, isAdopted: true,
        createdAt: 'now', updatedAt: 'now',
      },
    });
    expect(created.rootTaskId).toBe('root-quality');
    expect(mocks.createBackground).toHaveBeenCalledOnce();
    const input = mocks.createBackground.mock.calls[0][0] as any;
    expect(input.taskType).toBe('quality_revision');
    expect(input.steps).toHaveLength(5);
    expect(input.targetHintJson).toMatchObject({ staleAgainstLatest: true, automaticApply: false });
    expect(input.inputBody).toBe('冻结后的章节正文');
    expect(input.steps[1].messages[0].content).toBe('frozen quality prompt');
  });
});
