import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChapterSummaryValidationNotice } from '../../components/right-dock/panels/ChapterSummaryValidationNotice';
import { ChapterSummaryDetails } from '../../components/workspace/ChapterSummaryDetails';
import type { ChapterSummaryValidation } from '../../types/chapterSummary';

const unsafe: ChapterSummaryValidation = {
  passed: false,
  score: 76,
  safeToContext: true,
  problems: [{ type: 'character_error', message: '角色不在正文中' }],
  semanticValidation: 'not_checked',
};

describe('summary safety policy presentation', () => {
  it('does not downgrade a high-score blocking problem into a safe warning or suggest manual enable', () => {
    render(<ChapterSummaryValidationNotice validation={unsafe} />);
    expect(screen.getByText(/存在阻断性校验错误/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('不会启用为上下文或更新人物状态');
    expect(screen.queryByText(/你可以手动启用/)).toBeNull();
    expect(screen.queryByText(/校验有警告/)).toBeNull();
  });

  it('labels structural success without pretending semantics were verified', () => {
    render(
      <ChapterSummaryValidationNotice
        validation={{ ...unsafe, passed: true, problems: [], score: 88 }}
      />,
    );
    expect(screen.getByText(/结构与依据检查通过 · 语义未自动核验/)).toBeTruthy();
  });

  it('keeps legacy reviewed semantic uncertainty separate from blocking errors', () => {
    render(
      <ChapterSummaryDetails
        summary={{
          id: 'summary',
          novelId: 'novel',
          chapterId: 'chapter',
          adoptedDraftId: 'draft',
          summary: '已保存',
          enabled: true,
          isExpired: false,
          createdAt: '',
          updatedAt: '',
          validationStatus: 'pending',
          validationResult: {
            ...unsafe,
            score: 0,
            authorReviewed: true,
            evidenceValidation: 'passed',
            problems: [{ type: 'speculation', message: '作者已审阅，未执行语义证明' }],
          },
        }}
      />,
    );
    expect(screen.getByText('作者已审阅，语义未自动核实')).toBeTruthy();
    expect(screen.getByTestId('chapter-summary-validation-state').textContent).toContain(
      '无阻断性校验错误；可用于后续上下文',
    );
  });

  it('never labels task preauthorization as author review', () => {
    render(
      <ChapterSummaryDetails
        summary={{
          id: 'summary',
          novelId: 'novel',
          chapterId: 'chapter',
          adoptedDraftId: 'draft',
          summary: '已保存',
          enabled: true,
          isExpired: false,
          createdAt: '',
          updatedAt: '',
          validationStatus: 'passed',
          validationResult: {
            ...unsafe,
            policyVersion: 1,
            passed: true,
            problems: [],
            applicationProvenance: { mode: 'task_preauthorization', authorizationId: 'grant' },
          },
        }}
      />,
    );
    expect(screen.getByText(/根据任务预授权应用，未代替作者审阅/)).toBeTruthy();
    expect(screen.queryByText('作者已审阅，语义未自动核实')).toBeNull();
  });
});
