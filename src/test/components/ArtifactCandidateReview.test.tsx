import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useArtifactReviewStore } from '../../store/artifactReviewStore';
import { ArtifactCard } from '../../pages/Workbench/WorkbenchComponents';
import { WorkbenchMessageStream } from '../../pages/Workbench/WorkbenchMessageStream';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  TaskConversationBundle,
} from '../../types/conversation';

const createdAt = '2026-09-05T00:00:00.000Z';
const originalCharacters = [
  { id: 'character-a', name: '岑舟', summary: '调查港口失踪案的船医。' },
  { id: 'character-b', name: '白榆', summary: '保管旧航图的守塔人。' },
];

function characterArtifact(
  patch: Partial<ConversationArtifactCard> = {},
): ConversationArtifactCard {
  return {
    cardId: 'card-character-review',
    artifactId: 'artifact-character-review',
    conversationId: 'conversation-character-review',
    artifactType: 'character_candidates',
    title: '港口人物候选',
    summary: '两位人物等待审阅。',
    content: JSON.stringify({ characters: originalCharacters }),
    status: 'candidate',
    createdAt,
    ...patch,
  };
}

function decisionCallback() {
  return vi.fn<(decision: ArtifactDecisionKind, notes?: string) => void>();
}

function candidate(index = 0) {
  return screen.getAllByTestId('workbench-artifact-candidate')[index];
}

function titleField(row: HTMLElement) {
  return within(row).getByRole('textbox', { name: '建议标题' }) as HTMLInputElement;
}

function summaryField(row: HTMLElement) {
  return within(row).getByRole('textbox', { name: '建议摘要' }) as HTMLTextAreaElement;
}

function notesField(row: HTMLElement) {
  return within(row).getByRole('textbox', { name: '补充要求' }) as HTMLTextAreaElement;
}

describe('structured artifact candidate review semantics', () => {
  beforeEach(() => useArtifactReviewStore.getState().reset());
  it('keeps review marks local and applies the complete original artifact without notes', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    const artifact = characterArtifact();
    const originalContent = artifact.content;
    render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);

    const checkboxes = screen.getAllByRole('checkbox', { name: /已审阅/ });
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    }

    await user.click(checkboxes[0]);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
    await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(candidate()), '先补充船医的行医动机。');
    expect(onDecide).not.toHaveBeenCalled();

    const scopeNotice = screen.getByText(/整份.*原始候选/);
    expect(scopeNotice.textContent).toMatch(/标记/);
    expect(scopeNotice.textContent).toMatch(/意见/);
    expect(scopeNotice.closest('details')).toBeNull();

    const applyButton = screen.getByTestId('workbench-artifact-apply');
    expect(applyButton.textContent).toBe('应用到作品');
    await user.click(applyButton);
    expect(onDecide.mock.calls).toEqual([['request_apply']]);
    expect(artifact.content).toBe(originalContent);
    expect(screen.getAllByTestId('workbench-artifact-candidate')).toHaveLength(2);
  });

  it('keeps the original title and summary visible while separate revision fields are edited', async () => {
    const user = userEvent.setup();
    const artifact = characterArtifact();
    const originalContent = artifact.content;
    render(<ArtifactCard artifact={artifact} onDecide={decisionCallback()} />);

    const row = candidate();
    await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
    expect(titleField(row).value).toBe('');
    expect(summaryField(row).value).toBe('');
    expect(notesField(row).value).toBe('');

    await user.type(titleField(row), '建议改名为岑远');
    await user.type(summaryField(row), '建议转为追查旧案的药师。');
    await user.type(notesField(row), '保留医者身份，不直接揭示秘密。');

    expect(row.querySelector('.workbench-artifact-candidate-title')?.textContent).toBe('岑舟');
    expect(row.querySelector('.workbench-artifact-candidate-summary')?.textContent).toBe(
      '调查港口失踪案的船医。',
    );
    expect(artifact.content).toBe(originalContent);
  });

  it('offers one central action that carries every written note without repeated row actions', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    render(<ArtifactCard artifact={characterArtifact()} onDecide={onDecide} />);

    const first = candidate();
    await user.click(within(first).getByRole('button', { name: '填写修订意见' }));
    await user.type(titleField(first), '岑远');
    await user.type(notesField(first), '补充为何留在港口。');

    const second = candidate(1);
    await user.click(within(second).getByRole('button', { name: '填写修订意见' }));
    await user.type(summaryField(second), '另一条待处理的修订意见。');
    await user.click(screen.getByTestId('workbench-artifact-revise'));

    expect(onDecide).toHaveBeenCalledTimes(1);
    const [decision, notes] = onDecide.mock.calls[0];
    expect(decision).toBe('request_revision');
    expect(notes).toContain('岑舟');
    expect(notes).toContain('建议标题');
    expect(notes).toContain('岑远');
    expect(notes).toContain('补充为何留在港口。');
    expect(notes).toContain('白榆');
    expect(notes).toContain('建议摘要');
    expect(notes).toContain('另一条待处理的修订意见。');
  });

  it('carries all written item notes into the outer revision action regardless of review marks', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    render(<ArtifactCard artifact={characterArtifact()} onDecide={onDecide} />);

    const first = candidate();
    await user.click(within(first).getByRole('checkbox', { name: /已审阅/ }));
    await user.click(within(first).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(first), '保留船医的旧伤。');

    const second = candidate(1);
    await user.click(within(second).getByRole('button', { name: '填写修订意见' }));
    await user.type(summaryField(second), '先隐去守塔人与旧船长的关系。');
    expect((within(second).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);

    await user.click(screen.getByTestId('workbench-artifact-revise'));
    expect(onDecide).toHaveBeenCalledTimes(1);
    const [decision, notes] = onDecide.mock.calls[0];
    expect(decision).toBe('request_revision');
    expect(notes).toContain('岑舟');
    expect(notes).toContain('保留船医的旧伤。');
    expect(notes).toContain('白榆');
    expect(notes).toContain('先隐去守塔人与旧船长的关系。');
  });

  it('disables existing note fields and all revision actions while a decision is busy', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    const artifact = characterArtifact();
    const view = render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
    await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(candidate()), '忙碌前的意见');

    view.rerender(<ArtifactCard artifact={artifact} onDecide={onDecide} busy />);
    for (const field of screen.getAllByRole('textbox')) {
      expect((field as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(true);
    }
    for (const button of screen.getAllByRole('button', {
      name: /填写修订意见|带出全部意见|要求修改|应用到作品/,
    })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await user.click(button);
    }
    await user.type(notesField(candidate()), '不能追加');
    expect(notesField(candidate()).value).toBe('忙碌前的意见');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('does not allow local note editing or another revision after an artifact is decided', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    const artifact = characterArtifact();
    const view = render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
    await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(candidate()), '本轮已经提交的意见');

    view.rerender(
      <ArtifactCard
        artifact={{
          ...artifact,
          latestDecision: {
            decisionId: 'decision-character-revision',
            artifactId: artifact.artifactId!,
            artifactHash: 'hash-character-review',
            cardId: artifact.cardId,
            conversationId: artifact.conversationId,
            decision: 'request_revision',
            idempotencyKey: 'character-review:revision',
            actor: 'user',
            targetType: 'asset',
            targetId: 'novel-character-review',
            createdAt,
          },
        }}
        onDecide={onDecide}
      />,
    );

    for (const field of screen.queryAllByRole('textbox')) {
      expect((field as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(true);
    }
    for (const button of screen.queryAllByRole('button', {
      name: /填写修订意见|带出全部意见|要求修改/,
    })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await user.click(button);
    }
    expect(screen.queryByTestId('workbench-artifact-apply')).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('locks candidate note editing and application when evidence becomes invalid', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    const artifact = characterArtifact();
    const originalContent = artifact.content;
    const view = render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
    await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(candidate()), '校验失败前的本地意见');

    view.rerender(
      <ArtifactCard
        artifact={{
          ...artifact,
          artifactEvidence: {
            sourceNovelId: 'novel-character-review',
            processingStatus: 'invalid',
            validationIssues: [],
          },
        }}
        onDecide={onDecide}
      />,
    );

    for (const field of screen.getAllByRole('textbox')) {
      expect((field as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(true);
    }
    for (const button of within(candidate()).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await user.click(button);
    }
    const applyButton = screen.getByTestId('workbench-artifact-apply') as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    await user.click(applyButton);
    await user.type(notesField(candidate()), '不能追加');
    expect(notesField(candidate()).value).toBe('校验失败前的本地意见');
    expect(within(candidate()).getByRole('heading', { name: '岑舟' })).toBeTruthy();
    expect(within(candidate()).getByText('调查港口失踪案的船医。')).toBeTruthy();
    expect(artifact.content).toBe(originalContent);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('preserves in-progress review notes when the same artifact is rerendered without a content change', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    const artifact = characterArtifact();
    const view = render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
    await user.click(within(candidate()).getByRole('checkbox', { name: /已审阅/ }));
    await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
    await user.type(notesField(candidate()), '正在整理的修订要求');

    view.rerender(
      <ArtifactCard artifact={{ ...artifact, summary: '状态投影已刷新。' }} onDecide={onDecide} />,
    );

    expect((within(candidate()).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(notesField(candidate()).value).toBe('正在整理的修订要求');
  });

  it.each(['content changes', 'artifact changes with identical content'] as const)(
    'clears old local review state across a round trip when %s',
    async (change) => {
      const user = userEvent.setup();
      const onDecide = decisionCallback();
      const artifact = characterArtifact();
      const view = render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
      await user.click(within(candidate()).getByRole('checkbox', { name: /已审阅/ }));
      await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
      await user.type(titleField(candidate()), '上一份候选的建议标题');
      await user.type(notesField(candidate()), '上一份候选的补充要求');

      const nextArtifact =
        change === 'content changes'
          ? {
              ...artifact,
              content: JSON.stringify({
                characters: [
                  { ...originalCharacters[0], summary: '新原始摘要：船医已经离开港口。' },
                  originalCharacters[1],
                ],
              }),
            }
          : { ...artifact, artifactId: 'artifact-character-next' };
      view.rerender(<ArtifactCard artifact={nextArtifact} onDecide={onDecide} />);

      expect((within(candidate()).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect(screen.queryByDisplayValue('上一份候选的建议标题')).toBeNull();
      expect(screen.queryByDisplayValue('上一份候选的补充要求')).toBeNull();
      if (change === 'content changes') {
        expect(within(candidate()).getByText('新原始摘要：船医已经离开港口。')).toBeTruthy();
      }

      view.rerender(<ArtifactCard artifact={artifact} onDecide={onDecide} />);
      expect((within(candidate()).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect(screen.queryByDisplayValue('上一份候选的建议标题')).toBeNull();
      expect(screen.queryByDisplayValue('上一份候选的补充要求')).toBeNull();
      await user.click(within(candidate()).getByRole('button', { name: '填写修订意见' }));
      expect(titleField(candidate()).value).toBe('');
      expect(notesField(candidate()).value).toBe('');

      await user.click(screen.getByTestId('workbench-artifact-revise'));
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide.mock.calls[0][0]).toBe('request_revision');
      expect(onDecide.mock.calls[0][1] ?? '').not.toContain('上一份候选');
    },
  );

  it('keeps chapter summaries in paragraph mode while passing separate revision suggestions', async () => {
    const user = userEvent.setup();
    const onDecide = decisionCallback();
    render(
      <ArtifactCard
        artifact={characterArtifact({
          artifactType: 'chapter_summary',
          title: '章节总结候选',
          content: JSON.stringify({ summary: '原始总结：船医在灯塔发现航图。' }),
        })}
        onDecide={onDecide}
      />,
    );

    expect(screen.queryByRole('checkbox')).toBeNull();
    const row = candidate();
    await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
    await user.type(summaryField(row), '建议改为只记录已经确认的航图线索。');
    expect(within(row).getByRole('heading', { name: '章节摘要' })).toBeTruthy();
    expect(within(row).getByText('原始总结：船医在灯塔发现航图。')).toBeTruthy();
    await user.click(screen.getByTestId('workbench-artifact-revise'));

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[0][0]).toBe('request_revision');
    expect(onDecide.mock.calls[0][1]).toContain('章节摘要');
    expect(onDecide.mock.calls[0][1]).toContain('建议改为只记录已经确认的航图线索。');
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'treats the candidate ID %s as an own review key rather than an inherited draft',
    async (id) => {
      const user = userEvent.setup();
      const onDecide = decisionCallback();
      const artifact = characterArtifact({
        content: JSON.stringify({ characters: [{ ...originalCharacters[0], id }] }),
      });
      const originalContent = artifact.content;
      render(<ArtifactCard artifact={artifact} onDecide={onDecide} />);

      const row = candidate();
      expect(row.getAttribute('data-candidate-id')).toBe(id);
      expect(within(row).getByRole('heading', { name: '岑舟' })).toBeTruthy();
      await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
      expect(titleField(row).value).toBe('');
      expect(summaryField(row).value).toBe('');
      expect(notesField(row).value).toBe('');
      await user.type(titleField(row), '岑远');
      await user.type(notesField(row), '保留船医身份');
      await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
      await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
      expect(titleField(row).value).toBe('岑远');
      expect(notesField(row).value).toBe('保留船医身份');
      await user.click(screen.getByTestId('workbench-artifact-revise'));
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide.mock.calls[0][0]).toBe('request_revision');
      expect(onDecide.mock.calls[0][1]).toContain('岑舟');
      expect(onDecide.mock.calls[0][1]).toContain('岑远');
      expect(onDecide.mock.calls[0][1]).toContain('保留船医身份');
      expect(artifact.content).toBe(originalContent);
    },
  );

  it('keeps both run-attached and orphan candidate controls locked until the pending decision settles', async () => {
    const user = userEvent.setup();
    const attached = characterArtifact({ runId: 'run-review-attached' });
    const orphan = characterArtifact({
      cardId: 'card-review-orphan',
      artifactId: 'artifact-review-orphan',
    });
    const bundle: TaskConversationBundle = {
      conversation: {
        conversationId: attached.conversationId,
        novelId: 'novel-character-review',
        title: '候选决定串行验证',
        status: 'waiting_user',
        createdAt,
        updatedAt: createdAt,
      },
      turns: [
        {
          turnId: 'turn-review-attached',
          conversationId: attached.conversationId,
          sequence: 1,
          role: 'user',
          content: '生成人物候选',
          createdAt,
        },
      ],
      runs: [
        {
          runId: attached.runId!,
          turnId: 'turn-review-attached',
          conversationId: attached.conversationId,
          status: 'completed',
          modelSnapshot: {
            providerId: 'isolated-provider',
            modelId: 'isolated-model',
            runtimeMode: 'mock',
            capabilities: [],
            options: {},
            capturedAt: createdAt,
          },
          workerId: 'worker-review-attached',
          createdAt,
          updatedAt: createdAt,
          finishedAt: createdAt,
        },
      ],
      toolEvents: [],
      artifacts: [attached, orphan],
    };
    const onDecideArtifact =
      vi.fn<
        (artifact: ConversationArtifactCard, decision: ArtifactDecisionKind, notes?: string) => void
      >();
    const stream = (busyCardId: string) => (
      <WorkbenchMessageStream
        bundle={bundle}
        compressionCandidate={null}
        compressionBusy={false}
        decisionBusyCardId={busyCardId}
        assetRecovery={null}
        assetReadinessBusy={false}
        selectedConversationRunning={false}
        chapterSummaryOrchestration={{ phase: 'none' }}
        onDismissCompression={() => undefined}
        onDecideArtifact={onDecideArtifact}
        onRetry={() => undefined}
        onGenerateMissingAsset={() => undefined}
        onEditMissingAsset={() => undefined}
        onRefreshAssetReadiness={() => undefined}
        onResumeChapterGoal={() => undefined}
        onDismissAssetReadiness={() => undefined}
      />
    );
    const view = render(stream(''));
    const cards = screen.getAllByTestId('workbench-artifact-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].closest('[data-testid="workbench-turn"]')).not.toBeNull();
    expect(cards[1].closest('[data-testid="workbench-turn"]')).toBeNull();
    for (const [index, card] of cards.entries()) {
      const row = within(card).getAllByTestId('workbench-artifact-candidate')[0];
      await user.click(within(row).getByRole('button', { name: '填写修订意见' }));
      await user.type(notesField(row), `第${index + 1}张卡的完整意见`);
    }

    await user.click(within(cards[0]).getByTestId('workbench-artifact-revise'));
    expect(onDecideArtifact).toHaveBeenCalledWith(
      attached,
      'request_revision',
      expect.stringContaining('第1张卡的完整意见'),
    );
    view.rerender(stream(attached.cardId));
    for (const card of cards) {
      for (const field of within(card).getAllByRole('textbox')) {
        expect((field as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(true);
      }
      for (const button of within(card).getAllByRole('button', {
        name: /填写修订意见|带出全部意见|要求修改|应用到作品/,
      })) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        await user.click(button);
      }
    }
    expect(onDecideArtifact).toHaveBeenCalledTimes(1);

    view.rerender(stream(''));
    for (const card of cards) {
      for (const field of within(card).getAllByRole('textbox')) {
        expect((field as HTMLInputElement | HTMLTextAreaElement).disabled).toBe(false);
      }
      for (const button of within(card).getAllByRole('button', {
        name: /填写修订意见|带出全部意见|要求修改|应用到作品/,
      })) {
        expect((button as HTMLButtonElement).disabled).toBe(false);
      }
    }
    await user.click(within(cards[1]).getByTestId('workbench-artifact-revise'));
    expect(onDecideArtifact).toHaveBeenCalledTimes(2);
    expect(onDecideArtifact).toHaveBeenLastCalledWith(
      orphan,
      'request_revision',
      expect.stringContaining('第2张卡的完整意见'),
    );
  });
});
