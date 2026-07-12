import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CandidateReviewPane from '../../components/workspace/CandidateReviewPane';
import RightToolbar from '../../components/right-dock/RightToolbar';
import type { Chapter } from '../../types/chapter';
import type { CandidateReviewRecord } from '../../types/placement';
import { deriveCandidateLifecycle } from '../../features/workspace/candidateLifecycle';

const chapter: Chapter = {
  id: 'chapter-a',
  novelId: 'novel-a',
  volumeId: 'volume-a',
  title: '候选审查测试',
  chapterNumber: 3,
  orderIndex: 3,
  sortOrder: 3,
  status: 'editing',
  wordCount: 1200,
  currentWords: 1200,
  targetWordCount: 3000,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

function createReviewRecord(): CandidateReviewRecord {
  return {
    candidate: {
      artifactId: 'artifact-a',
      taskId: 'task-a',
      contentHash: 'candidate-hash',
      content: '候选正文第一段。\n\n候选正文第二段。',
      baseContent: '原稿段落。',
      wordCount: 18,
      proposal: {
        proposalId: 'proposal-a',
        artifactId: 'artifact-a',
        schemaVersion: 1,
        targets: [{
          targetType: 'chapter', targetId: 'chapter-a', novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a',
          action: 'save_and_adopt_chapter_text', expectedVersion: 2, expectedHash: 'base-hash', sourcePriority: 1,
          confidence: 1, reason: 'test', isReady: true,
        }],
        confidence: 1, reasons: [], warnings: [], unresolvedItems: [], projectRevisionHash: 'revision-a',
        createdAt: '2026-07-13T00:00:00.000Z',
      },
      constraintValidation: {
        artifactId: 'artifact-a',
        taskId: 'task-a',
        novelId: 'novel-a',
        chapterId: 'chapter-a',
        sourceDraftId: 'draft-a',
        sourceDraftVersion: 2,
        baseContentHash: 'base-hash',
        validationRunId: 'validation-a',
        status: 'passed_with_warnings',
        must: [],
        should: [{ constraintId: 'should-a', severity: 'should', code: 'STYLE', status: 'failed', message: '建议加强章末悬念。' }],
        forbid: [],
        blockingCount: 0,
        warningCount: 1,
        validatorVersion: 'test',
        validatedAt: '2026-07-13T00:00:00.000Z',
      },
      diff: {
        status: 'ready',
        summary: {
          baseDraftId: 'draft-a',
          baseDraftVersion: 2,
          baseContentHash: 'base-hash',
          candidateArtifactId: 'artifact-a',
          addedBlocks: 1,
          removedBlocks: 0,
          modifiedBlocks: 1,
          unchangedBlocks: 2,
          baseCharacterCount: 12,
          candidateCharacterCount: 18,
          characterDelta: 6,
        },
        blocks: [{ kind: 'modified', baseText: '原稿段落。', candidateText: '候选正文第一段。' }],
      },
    },
    target: {
      resultId: 'artifact-a',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      sourceDraftId: 'draft-a',
      sourceRevision: 2,
      baseContentHash: 'base-hash',
      contentHash: 'candidate-hash',
      source: 'ai_generate',
    },
  };
}

describe('workspace 8B UX', () => {
  it('shows the complete candidate in the editor-sized review surface and adopts that candidate explicitly', async () => {
    const adopt = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const record = createReviewRecord();
    const context = deriveCandidateLifecycle({
      record,
      currentNovelId: 'novel-a',
      currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 2 },
      currentEditorContent: '原稿段落。',
    });
    render(
      <CandidateReviewPane
        chapter={chapter}
        context={context}
        onAdopt={adopt}
        onClose={vi.fn()}
        onOpenGenerator={vi.fn()}
      />,
    );

    expect(screen.getByText(/候选正文第一段/)).toBeTruthy();
    expect(screen.getByText('需要复核')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: '正文差异' }));
    expect(screen.getByText('原稿段落。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /采用此候选/ }));
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it('keeps the default toolbar compact and moves engineering tools behind more', async () => {
    const user = userEvent.setup();
    render(<RightToolbar activePanel={null} onTogglePanel={vi.fn()} onRunCommand={vi.fn()} />);

    expect(screen.getByRole('button', { name: /AI创作/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /采用/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /高级工程/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /更多/ }));
    expect(screen.getByRole('button', { name: /高级工程/ })).toBeTruthy();
  });

  it('shows the frozen baseline warning and blocks direct overwrite after正文 changes', () => {
    const record = createReviewRecord();
    const context = deriveCandidateLifecycle({
      record,
      currentNovelId: 'novel-a',
      currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 2 },
      currentEditorContent: '用户已经修改正文。',
    });
    render(<CandidateReviewPane chapter={chapter} context={context} onAdopt={vi.fn()} onClose={vi.fn()} onOpenGenerator={vi.fn()} />);
    expect(screen.getAllByText('正文已变化').length).toBeGreaterThan(0);
    expect(screen.getByText(/差异仍对应生成时的草稿 v2/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /采用此候选/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a failed generation with an explicit recovery action instead of a blank surface', () => {
    const context = deriveCandidateLifecycle({
      record: null,
      currentNovelId: 'novel-a',
      currentChapterId: 'chapter-a',
      generation: { requestId: 'request-failed', taskId: 'task-failed', novelId: 'novel-a', chapterId: 'chapter-a', status: 'failed', message: 'Provider unavailable' },
    });
    render(<CandidateReviewPane chapter={chapter} context={context} onAdopt={vi.fn()} onClose={vi.fn()} onOpenGenerator={vi.fn()} />);
    expect(screen.getAllByText('生成失败').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider unavailable').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '调整生成设置' })).toBeTruthy();
  });
});
