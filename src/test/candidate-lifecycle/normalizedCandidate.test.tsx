import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NormalizedCandidateReview from '../../components/ai-tasks/NormalizedCandidateReview';
import { deriveCandidateLifecycle } from '../../features/workspace/candidateLifecycle';
import {
  assertNormalizedCandidateReady,
  normalizeCandidate,
} from '../../services/ai-tasks/normalizedCandidateService';
import type { CandidateReviewRecord } from '../../types/placement';

const baseContent = '夜雨打在窗上。\n\n林舟推开旧门，屋里有错字。\n\n远处的钟声响了三次。';

describe('normalized chapter candidates', () => {
  it('normalizes targeted_fix with a complete revised chapter and keeps JSON out of full text', () => {
    const rawResponse = JSON.stringify({
      mode: 'targeted_fix',
      revision_summary: '修正第二段的错字，其他段落保持不变。',
      changed_ranges: [{ paragraphIndex: 1, startOffset: 16, endOffset: 19, before: '有错字', after: '措辞准确', reason: '修正错字' }],
      revised_content: '夜雨打在窗上。\n\n林舟推开旧门，屋里措辞准确。\n\n远处的钟声响了三次。',
    });
    const candidate = normalizeCandidate({ content: rawResponse, rawResponse, baseContent });
    expect(candidate).toMatchObject({ status: 'ready', mode: 'targeted_fix', rebuiltFrom: 'structured_full_text' });
    expect(candidate.fullText).toContain('屋里措辞准确');
    expect(candidate.fullText).not.toMatch(/mode|changed_ranges|paragraphIndex/);
    expect(candidate.revisionSummary).toBe('修正第二段的错字，其他段落保持不变。');
  });

  it('normalizes a plain full rewrite as prose', () => {
    const fullText = '第一段改写正文。\n\n第二段仍然只是小说正文。';
    const candidate = normalizeCandidate({ content: fullText, rawResponse: fullText, baseContent });
    expect(candidate).toMatchObject({ status: 'ready', mode: 'full_rewrite', fullText, rebuiltFrom: 'plain_text' });
    expect(candidate.changes.length).toBeGreaterThan(0);
    expect(candidate.changes[0]).toMatchObject({
      originalText: '夜雨打在窗上。',
      revisedText: '第一段改写正文。',
      paragraphIndex: 0,
      candidateParagraphIndex: 0,
    });
    const recovered = normalizeCandidate({
      content: fullText,
      rawResponse: JSON.stringify({ id: 'provider-response', choices: [{ message: { content: fullText } }] }),
      baseContent,
    });
    expect(recovered).toMatchObject({ status: 'ready', fullText, rebuiltFrom: 'plain_text' });
  });

  it('fails closed for malformed or nested JSON instead of treating it as chapter text', () => {
    const malformed = normalizeCandidate({ content: '{"mode":"targeted_fix","changed_ranges":[', baseContent });
    expect(malformed.status).toBe('format_error');
    expect(malformed.fullText).toBe('');
    expect(() => assertNormalizedCandidateReady(malformed)).toThrow(/格式异常|禁止采用/);

    const nested = normalizeCandidate({
      structuredPayload: { mode: 'full_rewrite', revised_content: '{"chapter":"not prose"}' },
      rawResponse: '{"mode":"full_rewrite"}',
      baseContent,
    });
    expect(nested.status).toBe('format_error');
  });

  it('rebuilds a complete targeted_fix chapter from uniquely located fragments', () => {
    const rawResponse = JSON.stringify({
      mode: 'targeted_fix',
      revision_summary: '只修改第二段。',
      changed_ranges: [{ paragraphIndex: 1, before: '屋里有错字', after: '屋里措辞准确', reason: '修正表达' }],
    });
    const candidate = normalizeCandidate({ content: rawResponse, rawResponse, baseContent });
    expect(candidate).toMatchObject({ status: 'ready', rebuiltFrom: 'changed_ranges' });
    expect(candidate.fullText).toBe('夜雨打在窗上。\n\n林舟推开旧门，屋里措辞准确。\n\n远处的钟声响了三次。');
    expect(candidate.changes[0].candidateParagraphIndex).toBe(1);
  });

  it('blocks adoption when structured fragments cannot rebuild a safe full chapter', () => {
    const rawResponse = JSON.stringify({
      mode: 'targeted_fix',
      changed_ranges: [{ paragraphIndex: 1, before: '不存在的原文', after: '替换文本' }],
    });
    const normalizedCandidate = normalizeCandidate({ content: rawResponse, rawResponse, baseContent });
    const record: CandidateReviewRecord = {
      candidate: {
        candidateId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', content: '', contentHash: '',
        wordCount: 0, baseContent, normalizedCandidate,
      },
      target: { resultId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a',
        sourceDraftId: 'draft-a', sourceRevision: 1, baseContentHash: 'base-hash', source: 'ai_generate' },
    };
    const lifecycle = deriveCandidateLifecycle({
      record,
      currentNovelId: 'novel-a',
      currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 1 },
      currentEditorContent: baseContent,
    });
    expect(lifecycle.canAdopt).toBe(false);
    expect(['format_error', 'empty_content']).toContain(lifecycle.status);
  });

  it('renders readable prose, compact summary, navigable diff cards, and raw JSON only in advanced details', () => {
    const rawResponse = JSON.stringify({
      mode: 'targeted_fix',
      revision_summary: '修正第二段。',
      changed_ranges: [{ paragraphIndex: 1, before: '屋里有错字', after: '屋里措辞准确', reason: '修正表达' }],
      revised_content: '夜雨打在窗上。\n\n林舟推开旧门，屋里措辞准确。\n\n远处的钟声响了三次。',
    });
    const candidate = normalizeCandidate({ content: rawResponse, rawResponse, baseContent });
    const onAdopt = vi.fn();
    render(
      <NormalizedCandidateReview
        title="第一章"
        candidate={candidate}
        status={{ tone: 'ready', label: '检查通过', message: '可以采用' }}
        canAdopt
        onDiscard={() => undefined}
        onRegenerate={() => undefined}
        onAdopt={onAdopt}
      />,
    );
    const fullText = screen.getByTestId('candidate-full-text');
    expect(fullText.textContent).toContain('屋里措辞准确');
    expect(fullText.textContent).not.toMatch(/mode|changed_ranges|paragraphIndex/);
    expect(screen.getByText('本次修改摘要')).toBeTruthy();
    expect(screen.getByText('修正第二段。')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '正文差异' }));
    expect(screen.getByText('原文')).toBeTruthy();
    expect(screen.getByText('修改后')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一处' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '定位到候选正文' }));
    expect(screen.getByRole('tab', { name: '候选全文' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('candidate-full-text').querySelector('.located')).toBeTruthy();

    const advanced = screen.getByText('高级工程 / 技术详情').closest('details');
    expect(advanced?.hasAttribute('open')).toBe(false);
    fireEvent.click(within(advanced as HTMLElement).getByText('高级工程 / 技术详情'));
    expect(screen.getByTestId('candidate-raw-response').textContent).toContain('changed_ranges');
  });

  it('uses one page scroll container for long prose without a nested full-text scrollbar', () => {
    const longText = Array.from({ length: 240 }, (_, index) => `第 ${index + 1} 段长正文，保持自然段空行。`).join('\n\n');
    const candidate = normalizeCandidate({ content: longText, rawResponse: longText, baseContent });
    const view = render(
      <NormalizedCandidateReview
        title="长正文"
        candidate={candidate}
        status={{ tone: 'ready', label: '检查通过', message: '可以采用' }}
        canAdopt
        onDiscard={() => undefined}
        onRegenerate={() => undefined}
        onAdopt={() => undefined}
      />,
    );
    expect(view.container.querySelectorAll('.normalized-candidate-scroll')).toHaveLength(1);
    expect(view.container.querySelector('.normalized-candidate-paper')?.querySelectorAll('p')).toHaveLength(240);
    expect(view.container.querySelector('.normalized-candidate-paper')?.classList.contains('overflow-auto')).toBe(false);
  });
});
