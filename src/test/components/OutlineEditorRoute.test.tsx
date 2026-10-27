import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ chapters: vi.fn(), volumes: vi.fn() }));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: mocks.chapters },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: mocks.volumes },
}));
vi.mock('../../components/outline/OutlineEditor', () => ({
  default: (props: { projectId: string; outlineType: string; targetId: string }) => (
    <div data-testid="outline-scope">
      {props.projectId}/{props.outlineType}/{props.targetId}
    </div>
  ),
}));
import OutlineEditorPage from '../../pages/OutlineEditor/OutlineEditorPage';

function open(id: string) {
  render(
    <MemoryRouter initialEntries={[`/novels/n/outline?type=chapter&chapterId=${id}`]}>
      <Routes>
        <Route path="/novels/:novelId/outline" element={<OutlineEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('opens the exact chapter and its volume using the versioned outline editor', async () => {
  mocks.volumes.mockResolvedValue([{ id: 'v', novelId: 'n', title: '卷一' }]);
  mocks.chapters.mockResolvedValue([
    { id: 'c', novelId: 'n', volumeId: 'v', title: '第二章', orderIndex: 1 },
  ]);
  open('c');
  expect(await screen.findByText('n/chapter/c')).toBeTruthy();
  expect(screen.getByRole('option', { name: '第二章' })).toBeTruthy();
});
it('rejects a chapter belonging to another project without selecting a different chapter', async () => {
  mocks.volumes.mockResolvedValue([]);
  mocks.chapters.mockResolvedValue([{ id: 'c', novelId: 'other', title: '别人的章节' }]);
  open('c');
  expect((await screen.findByRole('alert')).textContent).toContain(
    '指定章节不存在或不属于当前作品',
  );
  expect(screen.queryByTestId('outline-scope')).toBeNull();
});
