import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationArtifactCard } from '../../types/conversation';
import { SummaryGroundingReview } from '../../pages/Workbench/SummaryGroundingReview';

function artifact(): ConversationArtifactCard {
  return {
    cardId: 'card-summary',
    artifactId: 'summary',
    conversationId: 'conversation',
    artifactType: 'chapter_summary',
    title: '章节总结',
    summary: '等待审阅',
    status: 'candidate',
    createdAt: '2026-10-16T00:00:00Z',
    content: JSON.stringify({
      summary: '账册已调取。',
      grounding: {
        version: 1,
        claims: [{ path: '/summary', status: 'confirmed', quotes: ['警员计划下周调取账册。'] }],
      },
    }),
    artifactEvidence: {
      sourceNovelId: 'novel',
      sourceChapterId: 'chapter',
      sourceDraftId: 'draft',
      processingStatus: 'valid_with_warnings',
      validationIssues: [
        {
          issueId: 'warning',
          artifactId: 'summary',
          validationRunId: 'validation',
          issueIndex: 0,
          severity: 'warning',
          code: 'SUMMARY_CERTAINTY_ESCALATION',
          message: '原文计划尚未完成，请核对新增断言。',
          jsonPath: '/summary',
          validatorVersion: 'v1',
          createdAt: 'now',
        },
        {
          issueId: 'receipt',
          artifactId: 'summary',
          validationRunId: 'validation',
          issueIndex: 1,
          severity: 'warning',
          code: 'SUMMARY_SEMANTICS_REQUIRE_REVIEW',
          message: '未执行语义证明。',
          jsonPath: '/grounding',
          validatorVersion: 'v1',
          createdAt: 'now',
          detailsJson: {
            claims: [
              { path: '/summary', sources: [{ quote: '警员计划下周调取账册。', line: 27 }] },
            ],
          },
        },
      ],
    },
  };
}

describe('summary assertion evidence review', () => {
  it('shows each new assertion, its certainty, native source location and actionable warning', () => {
    const onRedo = vi.fn();
    render(<SummaryGroundingReview artifact={artifact()} onRedo={onRedo} />);
    expect(screen.getByText(/本次新增断言与原文依据（1）/)).toBeTruthy();
    expect(screen.getByText('【已确认】账册已调取。')).toBeTruthy();
    expect(screen.getByText('当前采用稿第 27 行')).toBeTruthy();
    expect(screen.getByText('原文计划尚未完成，请核对新增断言。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '将核对问题带入重做' }));
    expect(onRedo).toHaveBeenCalledWith('/summary：原文计划尚未完成，请核对新增断言。');
  });
  it('can target one assertion without editing or automatically applying the candidate', () => {
    const candidate = artifact();
    const original = candidate.content;
    const onRedo = vi.fn();
    render(<SummaryGroundingReview artifact={candidate} onRedo={onRedo} />);
    fireEvent.click(screen.getByRole('button', { name: '针对这条重做总结' }));
    expect(onRedo.mock.calls[0][0]).toContain('对应字段 /summary');
    expect(onRedo.mock.calls[0][0]).toContain('保留否定、未知、口述与计划');
    expect(candidate.content).toBe(original);
  });
  it.each([
    ['inferred', '【推测】这份账册可能与案件有关。'],
    ['unresolved', '【待查】账册来源尚未查明。'],
    ['planned', '【计划】警员下周调取账册。'],
  ])(
    'shows one certainty label for %s and preserves the original redo text',
    (status, statement) => {
      const candidate = artifact();
      candidate.content = JSON.stringify({
        summary: statement,
        grounding: {
          version: 1,
          claims: [{ path: '/summary', status, quotes: ['警员计划下周调取账册。'] }],
        },
      });
      const original = candidate.content;
      const onRedo = vi.fn();
      render(<SummaryGroundingReview artifact={candidate} onRedo={onRedo} />);
      expect(
        screen.getByTestId('summary-grounding-claim').querySelector('summary')?.textContent,
      ).toBe(statement);
      fireEvent.click(screen.getByRole('button', { name: '针对这条重做总结' }));
      expect(onRedo.mock.calls[0][0]).toContain(`断言：${statement}\n`);
      expect(candidate.content).toBe(original);
    },
  );
  it('old candidates do not get invented receipts and busy actions cannot trigger redo', () => {
    const candidate = {
      ...artifact(),
      content: JSON.stringify({ summary: '旧版总结。' }),
      artifactEvidence: undefined,
    };
    const onRedo = vi.fn();
    render(<SummaryGroundingReview artifact={candidate} disabled onRedo={onRedo} />);
    expect(screen.getByRole('alert').textContent).toContain('未提供逐条原文依据');
    expect(screen.getByText('【未分类】旧版总结。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '将核对问题带入重做' }));
    expect(onRedo).not.toHaveBeenCalled();
  });
  it('displays host supplied full sentences when a quote omits a qualifier', () => {
    const candidate = artifact();
    candidate.artifactEvidence!.validationIssues[1].detailsJson = {
      claims: [
        {
          path: '/summary',
          sources: [
            {
              quote: '警员计划下周调取账册。',
              line: 27,
              context: '据她听说，警员计划下周调取账册。',
            },
          ],
        },
      ],
    };
    render(<SummaryGroundingReview artifact={candidate} />);
    expect(screen.getByText('对应完整原句（请保留限定）')).toBeTruthy();
    expect(screen.getByText('据她听说，警员计划下周调取账册。')).toBeTruthy();
  });
});
