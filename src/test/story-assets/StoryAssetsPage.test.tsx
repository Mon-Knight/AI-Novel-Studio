import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplyContentTransactionInput,
  ApplyContentTransactionResult,
  ContentTransaction,
  PrepareContentTargetInput,
  PrepareContentTransactionInput,
} from '../../types/contentTransaction';
import CrossChapterBatchPanel from '../../pages/StoryAssets/CrossChapterBatchPanel';
import StoryAssetForms from '../../pages/StoryAssets/StoryAssetForms';
import StoryAssetsPage from '../../pages/StoryAssets/StoryAssetsPage';
import TransactionReview from '../../pages/StoryAssets/TransactionReview';

const mocks = vi.hoisted(() => ({
  dbMode: vi.fn<() => 'tauri' | 'localstorage'>(),
  getNovel: vi.fn<(id: string) => Promise<{ title: string } | null>>(),
  getChapters: vi.fn<(novelId: string) => Promise<unknown[]>>(),
  createOperationId: vi.fn<(prefix?: string) => string>(),
  prepare: vi.fn<(input: PrepareContentTransactionInput) => Promise<ContentTransaction>>(),
  apply: vi.fn<(input: ApplyContentTransactionInput) => Promise<ApplyContentTransactionResult>>(),
  listFactions: vi.fn<(novelId: string) => Promise<unknown[]>>(),
  listLocations: vi.fn<(novelId: string) => Promise<unknown[]>>(),
  listTransactions: vi.fn<(novelId: string, limit?: number) => Promise<ContentTransaction[]>>(),
}));

vi.mock('../../services/database/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/database/db')>();
  return { ...actual, getDbMode: mocks.dbMode };
});

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: mocks.getChapters },
}));

vi.mock('../../services/content-transactions/contentTransactionService', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../services/content-transactions/contentTransactionService')
    >();
  return {
    ...actual,
    contentTransactionService: {
      createOperationId: mocks.createOperationId,
      prepare: mocks.prepare,
      apply: mocks.apply,
      listFactions: mocks.listFactions,
      listLocations: mocks.listLocations,
      list: mocks.listTransactions,
    },
  };
});

const timestamp = '2026-07-28T00:00:00.000Z';

function transactionFromInput(input: PrepareContentTransactionInput): ContentTransaction {
  return {
    transactionId: 'transaction-fixture',
    operationId: input.operationId,
    requestHash: 'request-hash',
    novelId: input.novelId,
    strategy: input.strategy,
    targetSet: input.targets.map((target) => ({
      targetType: target.targetType,
      targetId: target.targetId,
    })),
    targetSetHash: 'target-set-hash',
    transactionHash: 'transaction-hash-fixture',
    status: 'prepared',
    revision: 1,
    createdAt: timestamp,
    targets: input.targets.map((target, ordinal) => ({
      ordinal,
      targetType: target.targetType,
      targetId: target.targetId,
      effectType: target.effectType,
      baseRevision: 0,
      baseHash: `base-${ordinal}`,
      candidatePayload: target.payload,
      candidateHash: `candidate-${ordinal}`,
    })),
  };
}

function chapter(id: string, chapterNumber: number) {
  return {
    id,
    novelId: 'novel-fixture',
    volumeId: 'volume-fixture',
    title: `Chapter ${chapterNumber}`,
    outline: '',
    goal: '',
    chapterNumber,
    orderIndex: chapterNumber - 1,
    sortOrder: chapterNumber - 1,
    status: 'editing' as const,
    wordCount: 0,
    currentWords: 0,
    targetWords: 3_000,
    drafts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/novels/novel-fixture/story-assets']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/novels/:novelId/story-assets" element={<StoryAssetsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForPage(): Promise<HTMLElement> {
  return waitFor(() => {
    const page = document.querySelector<HTMLElement>('.story-assets-page');
    expect(page).not.toBeNull();
    return page as HTMLElement;
  });
}

beforeEach(() => {
  mocks.dbMode.mockReturnValue('tauri');
  mocks.getNovel.mockResolvedValue({ title: 'Fixture novel' });
  mocks.getChapters.mockResolvedValue([chapter('chapter-1', 1), chapter('chapter-2', 2)]);
  mocks.createOperationId.mockImplementation((prefix = 'content') => `${prefix}-fixture`);
  mocks.prepare.mockImplementation(async (input) => transactionFromInput(input));
  mocks.apply.mockImplementation(async (input) => {
    const prepared = transactionFromInput({
      operationId: input.operationId,
      novelId: 'novel-fixture',
      strategy: input.approvedTargets?.length ? 'reviewed_partial' : 'all_or_nothing',
      targets: [],
    });
    return {
      transaction: { ...prepared, status: 'applied', appliedAt: timestamp },
      replayed: false,
    };
  });
  mocks.listFactions.mockResolvedValue([]);
  mocks.listLocations.mockResolvedValue([]);
  mocks.listTransactions.mockResolvedValue([]);
});

describe('StoryAssets browser and desktop boundaries', () => {
  it('keeps browser development mode read-only without fabricating SQLite assets', async () => {
    mocks.dbMode.mockReturnValue('localstorage');

    const { container } = renderPage();
    await waitForPage();

    expect(container.querySelector('.story-assets-notice')).not.toBeNull();
    expect(mocks.listFactions).not.toHaveBeenCalled();
    expect(mocks.listLocations).not.toHaveBeenCalled();
    expect(mocks.listTransactions).not.toHaveBeenCalled();

    const assetSubmit = container.querySelector<HTMLButtonElement>(
      '.story-assets-form button[type="submit"]',
    );
    expect(assetSubmit?.disabled).toBe(true);
    fireEvent.click(assetSubmit as HTMLButtonElement);
    expect(mocks.prepare).not.toHaveBeenCalled();

    const pageTabs = container.querySelectorAll<HTMLButtonElement>(
      '.story-assets-page-tabs button',
    );
    fireEvent.click(pageTabs[1]);
    const batchSubmit = container.querySelector<HTMLButtonElement>(
      '.story-assets-card button[type="submit"]',
    );
    expect(batchSubmit?.disabled).toBe(true);
  });

  it('prepares a desktop cross-chapter candidate and applies only the approved subset', async () => {
    const { container } = renderPage();
    await waitForPage();

    const pageTabs = container.querySelectorAll<HTMLButtonElement>(
      '.story-assets-page-tabs button',
    );
    fireEvent.click(pageTabs[1]);

    const batch = container.querySelector<HTMLElement>('.story-assets-card');
    expect(batch).not.toBeNull();
    const toolbarButtons = batch?.querySelectorAll<HTMLButtonElement>(
      '.story-assets-batch-toolbar button',
    );
    fireEvent.click(toolbarButtons?.[0] as HTMLButtonElement);
    const goalInput = batch?.querySelector<HTMLInputElement>('.story-assets-batch-fields input');
    fireEvent.change(goalInput as HTMLInputElement, {
      target: { value: 'Advance the main conflict' },
    });
    fireEvent.submit(batch?.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
    const preparedInput = mocks.prepare.mock.calls[0][0];
    expect(preparedInput).toMatchObject({
      operationId: 'prepare-fixture',
      novelId: 'novel-fixture',
      strategy: 'reviewed_partial',
    });
    expect(preparedInput.targets.map((target) => target.targetId)).toEqual([
      'chapter-1',
      'chapter-2',
    ]);

    const review = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.story-assets-review');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    const targetCheckboxes = review.querySelectorAll<HTMLInputElement>(
      '.story-assets-review-row input[type="checkbox"]',
    );
    fireEvent.click(targetCheckboxes[0]);
    const applyButton = review.querySelector<HTMLButtonElement>(
      '.story-assets-review-actions .btn-primary',
    );
    expect(applyButton?.disabled).toBe(false);
    fireEvent.click(applyButton as HTMLButtonElement);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    expect(mocks.apply).toHaveBeenCalledWith({
      transactionId: 'transaction-fixture',
      operationId: 'prepare-fixture',
      expectedTransactionHash: 'transaction-hash-fixture',
      approvedTargets: [{ targetType: 'chapter_metadata', targetId: 'chapter-1' }],
    });
    await waitFor(() => expect(container.querySelector('.story-assets-review')).toBeNull());
    expect(mocks.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('surfaces both prepare and apply failures while preserving the review candidate', async () => {
    const { container } = renderPage();
    await waitForPage();

    mocks.prepare.mockRejectedValueOnce(new Error('prepare fixture failed'));
    const form = container.querySelector<HTMLFormElement>('.story-assets-form');
    const nameInput = form?.querySelector<HTMLInputElement>('input');
    fireEvent.change(nameInput as HTMLInputElement, { target: { value: 'Northern council' } });
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('prepare fixture failed');
    });

    fireEvent.change(nameInput as HTMLInputElement, { target: { value: 'Northern council' } });
    fireEvent.submit(form as HTMLFormElement);
    const review = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.story-assets-review');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    mocks.apply.mockRejectedValueOnce(new Error('apply fixture failed'));
    const applyButton = review.querySelector<HTMLButtonElement>(
      '.story-assets-review-actions .btn-primary',
    );
    fireEvent.click(applyButton as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('apply fixture failed');
    });
    expect(container.querySelector('.story-assets-review')).not.toBeNull();
  });
});

describe('StoryAssets forms and transaction review', () => {
  it('normalizes a faction form into a review target and resets after preparation', async () => {
    const onPrepare = vi.fn<(targets: PrepareContentTargetInput[]) => Promise<void>>(
      async () => undefined,
    );
    const { container } = render(
      <StoryAssetForms
        factions={[]}
        locations={[]}
        busy={false}
        createId={(prefix) => `${prefix}-fixture`}
        onPrepare={onPrepare}
      />,
    );
    const form = container.querySelector<HTMLFormElement>('.story-assets-form');
    const inputs = form?.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs?.[0] as HTMLInputElement, {
      target: { value: '  Northern council  ' },
    });
    fireEvent.change(inputs?.[1] as HTMLInputElement, { target: { value: '  alliance  ' } });
    fireEvent.change(inputs?.[2] as HTMLInputElement, { target: { value: '  defend the pass  ' } });
    fireEvent.change(form?.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '  frontier coalition  ' },
    });
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    expect(onPrepare).toHaveBeenCalledWith([
      {
        targetType: 'faction',
        targetId: 'faction-fixture',
        effectType: 'create',
        payload: {
          name: 'Northern council',
          kind: 'alliance',
          description: 'frontier coalition',
          goals: 'defend the pass',
        },
      },
    ]);
    await waitFor(() => expect((inputs?.[0] as HTMLInputElement).value).toBe(''));
  });

  it('requires an explicit reviewed-partial approval before dispatching apply', () => {
    const transaction = transactionFromInput({
      operationId: 'review-operation',
      novelId: 'novel-fixture',
      strategy: 'reviewed_partial',
      targets: [
        {
          targetType: 'chapter_metadata',
          targetId: 'chapter-1',
          effectType: 'update',
          payload: { goal: 'A' },
        },
        {
          targetType: 'chapter_metadata',
          targetId: 'chapter-2',
          effectType: 'update',
          payload: { goal: 'B' },
        },
      ],
    });
    const onToggle = vi.fn();
    const onApply = vi.fn();
    const view = render(
      <TransactionReview
        transaction={transaction}
        approved={new Set()}
        busy={false}
        onToggle={onToggle}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    const review = screen.getByRole('region');
    const applyButton = within(review).getAllByRole('button')[1] as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    fireEvent.click(within(review).getAllByRole('checkbox')[0]);
    expect(onToggle).toHaveBeenCalledWith('chapter_metadata\u0000chapter-1');
    view.rerender(
      <TransactionReview
        transaction={transaction}
        approved={new Set(['chapter_metadata\u0000chapter-1'])}
        busy={false}
        onToggle={onToggle}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    const enabledApply = within(screen.getByRole('region')).getAllByRole('button')[1];
    fireEvent.click(enabledApply);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('builds one batch target per selected chapter in chapter order', async () => {
    const onPrepare = vi.fn<(targets: PrepareContentTargetInput[]) => Promise<void>>(
      async () => undefined,
    );
    const { container } = render(
      <CrossChapterBatchPanel
        chapters={[chapter('chapter-2', 2), chapter('chapter-1', 1)]}
        busy={false}
        onPrepare={onPrepare}
      />,
    );
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      '.story-assets-chapter-row input[type="checkbox"]',
    );
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    const goalInput = container.querySelector<HTMLInputElement>('.story-assets-batch-fields input');
    fireEvent.change(goalInput as HTMLInputElement, { target: { value: 'Shared goal' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    expect(onPrepare.mock.calls[0][0].map((target) => target.targetId)).toEqual([
      'chapter-1',
      'chapter-2',
    ]);
  });
});
