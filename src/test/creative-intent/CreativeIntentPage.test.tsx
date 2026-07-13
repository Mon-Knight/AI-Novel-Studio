import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreativeIntentRecordV1 } from '../../types/creativeIntent';

const mocks = vi.hoisted(() => ({
  getNovelById: vi.fn(),
  getLatest: vi.fn(),
  freeze: vi.fn(),
}));

vi.mock('../../services/novels/novelService', () => ({
  novelService: { getNovelById: mocks.getNovelById },
}));

vi.mock('../../services/ai-tasks/creativeIntentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai-tasks/creativeIntentService')>();
  return {
    ...actual,
    creativeIntentService: { getLatest: mocks.getLatest, freeze: mocks.freeze },
  };
});

import CreativeIntentPage from '../../pages/CreativeIntent/CreativeIntentPage';

function frozenRecord(revision = 1, value = '原始创作目标'): CreativeIntentRecordV1 {
  return {
    taskId: `task-${revision}`,
    idempotentReplay: false,
    intent: {
      schemaVersion: 1,
      intentId: `intent-${revision}`,
      novelId: 'novel-1',
      revision,
      parentIntentId: revision > 1 ? `intent-${revision - 1}` : undefined,
      status: 'frozen',
      statements: [{
        statementId: 'goal-1',
        kind: 'goal',
        knowledgeClass: 'author_explicit',
        value,
        confidence: 1,
        evidence: [],
        confirmation: {
          status: 'confirmed',
          confirmedBy: 'author',
          confirmedAt: '2026-07-13T00:00:00.000Z',
        },
        statementHash: 'a'.repeat(64),
      }],
      createdAt: '2026-07-13T00:00:00.000Z',
      frozenAt: '2026-07-13T00:00:00.000Z',
      contentHash: String(revision).repeat(64),
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/novels/novel-1/creative-intent']}>
      <Routes>
        <Route path="/novels/:novelId/creative-intent" element={<CreativeIntentPage />} />
        <Route path="/novels/:novelId" element={<div>作品详情</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function SwitchableCreativeIntentPage() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/novels/novel-2/creative-intent')}>
        切换到作品 B
      </button>
      <CreativeIntentPage />
    </>
  );
}

function renderSwitchablePage() {
  return render(
    <MemoryRouter initialEntries={['/novels/novel-1/creative-intent']}>
      <Routes>
        <Route path="/novels/:novelId/creative-intent" element={<SwitchableCreativeIntentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CreativeIntentPage', () => {
  beforeEach(() => {
    mocks.getNovelById.mockReset().mockResolvedValue({ id: 'novel-1', title: '测试作品' });
    mocks.getLatest.mockReset().mockResolvedValue(null);
    mocks.freeze.mockReset();
  });

  it('creates, confirms and freezes the first author statement once', async () => {
    const user = userEvent.setup();
    let resolveFreeze: ((record: CreativeIntentRecordV1) => void) | undefined;
    mocks.freeze.mockImplementation(() => new Promise<CreativeIntentRecordV1>((resolve) => {
      resolveFreeze = resolve;
    }));
    renderPage();

    await screen.findByText('还没有创作意图');
    await user.click(screen.getByRole('button', { name: '添加第一项' }));
    await user.type(screen.getByRole('textbox', { name: '第 1 项内容' }), '写一部克制的长篇成长小说');
    await user.click(screen.getByRole('button', { name: '确认此项' }));
    const freezeButton = screen.getByRole('button', { name: '冻结为 r1' });
    expect((freezeButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(freezeButton);
    await user.click(freezeButton);
    expect(mocks.freeze).toHaveBeenCalledTimes(1);
    expect((mocks.freeze.mock.calls[0][0] as { statements: unknown[] }).statements).toHaveLength(1);

    resolveFreeze?.(frozenRecord(1, '写一部克制的长篇成长小说'));
    expect(await screen.findByText('第 1 版创作意图已冻结。')).toBeTruthy();
  });

  it('invalidates confirmation after editing and requires an explicit reconfirmation', async () => {
    const user = userEvent.setup();
    mocks.getLatest.mockResolvedValue(frozenRecord());
    mocks.freeze.mockResolvedValue(frozenRecord(2, '修改后的目标'));
    renderPage();

    const textarea = await screen.findByRole('textbox', { name: '第 1 项内容' });
    await user.clear(textarea);
    await user.type(textarea, '修改后的目标');
    const freezeButton = screen.getByRole('button', { name: '冻结为 r2' });
    expect((freezeButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('待确认')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '确认此项' }));
    expect((freezeButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(freezeButton);
    await waitFor(() => expect(mocks.freeze).toHaveBeenCalledTimes(1));
  });

  it('offers authoritative reload after a concurrent revision conflict', async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error('创作意图已在其他窗口更新，请重新读取'), {
      code: 'DOCUMENT_VERSION_CONFLICT',
    });
    mocks.freeze.mockRejectedValue(conflict);
    renderPage();

    await screen.findByText('还没有创作意图');
    await user.click(screen.getByRole('button', { name: '添加第一项' }));
    await user.type(screen.getByRole('textbox', { name: '第 1 项内容' }), '并发测试目标');
    await user.click(screen.getByRole('button', { name: '确认此项' }));
    await user.click(screen.getByRole('button', { name: '冻结为 r1' }));

    const reload = await screen.findByRole('button', { name: '重新读取最新版本' });
    mocks.getLatest.mockResolvedValue(frozenRecord());
    await user.click(reload);
    await waitFor(() => expect(mocks.getLatest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('r1')).toBeTruthy();
  });

  it('invalidates a rejected decision when the rejected content is edited', async () => {
    const user = userEvent.setup();
    const rejected = frozenRecord();
    rejected.intent.statements[0].knowledgeClass = 'inferred_preference';
    rejected.intent.statements[0].evidence = [{
      evidenceId: 'evidence-1',
      sourceType: 'author_input',
      excerpt: '作者曾强调克制',
    }];
    rejected.intent.statements[0].confirmation = {
      status: 'rejected',
      confirmedBy: 'author',
      confirmedAt: '2026-07-13T00:00:00.000Z',
    };
    mocks.getLatest.mockResolvedValue(rejected);
    mocks.freeze.mockResolvedValue(frozenRecord(2, '新的推断偏好'));
    renderPage();

    const textarea = await screen.findByRole('textbox', { name: '第 1 项内容' });
    await user.clear(textarea);
    await user.type(textarea, '新的推断偏好');
    expect(screen.getByText('待确认')).toBeTruthy();
    expect(screen.queryByText('作者已拒绝')).toBeNull();

    await user.click(screen.getByRole('button', { name: '冻结为 r2' }));
    await waitFor(() => expect(mocks.freeze).toHaveBeenCalledTimes(1));
    expect(mocks.freeze.mock.calls[0][0].statements[0].confirmation).toEqual({ status: 'pending' });
  });

  it('ignores a stale response after switching to another novel route', async () => {
    const user = userEvent.setup();
    let resolveNovelA: ((novel: { id: string; title: string }) => void) | undefined;
    mocks.getNovelById.mockImplementation((id: string) => (
      id === 'novel-1'
        ? new Promise((resolve) => { resolveNovelA = resolve; })
        : Promise.resolve({ id: 'novel-2', title: '作品 B' })
    ));
    mocks.getLatest.mockResolvedValue(null);
    renderSwitchablePage();

    await user.click(screen.getByRole('button', { name: '切换到作品 B' }));
    expect(await screen.findByText('作品 B')).toBeTruthy();
    resolveNovelA?.({ id: 'novel-1', title: '作品 A' });
    await waitFor(() => expect(screen.queryByText('作品 A')).toBeNull());
    expect(screen.getByText('作品 B')).toBeTruthy();
  });
});
