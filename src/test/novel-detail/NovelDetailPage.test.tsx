import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Novel } from '../../types/novel';

const mocks = vi.hoisted(() => ({
  getNovelById: vi.fn(),
  updateNovel: vi.fn(),
  getWorldSettings: vi.fn(),
  getRuleSystems: vi.fn(),
  getProtagonist: vi.fn(),
}));

vi.mock('../../services/novels/novelService', () => ({
  novelService: {
    getNovelById: mocks.getNovelById,
    updateNovel: mocks.updateNovel,
  },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: {
    getWorldSettings: mocks.getWorldSettings,
    getRuleSystems: mocks.getRuleSystems,
  },
}));
vi.mock('../../services/database/protagonistRepository', () => ({
  protagonistRepository: { getByNovelId: mocks.getProtagonist },
}));
vi.mock('../../components/novel-detail/NovelDetailCards', () => ({
  NovelBasicInfoCard: ({ novel, onSave }: {
    novel: Novel;
    onSave: (data: {
      title: string;
      subtitle: string;
      genre: string;
      description: string;
      status: string;
      targetWordCount: number;
    }) => Promise<void>;
  }) => (
    <section>
      <span data-testid="card-title">{novel.title}</span>
      <span data-testid="card-total">{novel.totalWordCount}</span>
      <button type="button" onClick={() => void onSave({
        title: '保存后的标题', subtitle: '', genre: '科幻', description: '新简介',
        status: 'writing', targetWordCount: 2000,
      })}>保存测试</button>
    </section>
  ),
  WorldSettingCard: () => null,
  RuleSystemCard: () => null,
  ProtagonistCard: () => null,
}));
vi.mock('../../components/outline/OutlineManager', () => ({ default: () => null }));
vi.mock('../../components/novel-card/CharacterLibraryCard', () => ({ default: () => null }));
vi.mock('../../components/novel-card/ContextOverviewCard', () => ({ default: () => null }));
vi.mock('../../components/novel-card/ExportCard', () => ({ default: () => null }));

import NovelDetailPage from '../../pages/NovelDetail/NovelDetailPage';

function novel(title: string, totalWordCount: number): Novel {
  return {
    id: 'novel-1',
    title,
    description: '作品简介',
    outline: '',
    genre: '科幻',
    protagonistMode: 'single',
    protagonists: [],
    dualProtagonistRelation: {
      type: 'partner', description: '', conflict: '', cooperation: '',
      emotionalProgression: '', narrativeWeight: 'balanced',
    },
    status: 'writing',
    totalWordCount,
    totalWords: totalWordCount,
    targetWordCount: 2000,
    targetWords: 2000,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    volumes: [],
  };
}

describe('NovelDetailPage authoritative refresh', () => {
  beforeEach(() => {
    mocks.getNovelById.mockReset();
    mocks.updateNovel.mockReset();
    mocks.getWorldSettings.mockReset().mockResolvedValue([]);
    mocks.getRuleSystems.mockReset().mockResolvedValue([]);
    mocks.getProtagonist.mockReset().mockResolvedValue(null);
  });

  it('re-reads the novel after saving and renders the latest title and adopted total', async () => {
    const before = novel('保存前标题', 0);
    const after = novel('保存后的标题', 321);
    mocks.getNovelById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    mocks.updateNovel.mockResolvedValue(after);

    render(
      <MemoryRouter initialEntries={['/novels/novel-1']}>
        <Routes>
          <Route path="/novels/:novelId" element={<NovelDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('card-title')).textContent).toContain('保存前标题');
    fireEvent.click(screen.getByRole('button', { name: '保存测试' }));

    await waitFor(() => expect(mocks.updateNovel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getNovelById).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('card-title').textContent).toContain('保存后的标题');
    expect(screen.getByTestId('card-total').textContent).toContain('321');
  });
});
