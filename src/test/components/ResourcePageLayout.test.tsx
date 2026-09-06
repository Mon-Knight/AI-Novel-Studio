import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import TemplatesPage from '../../pages/Templates/TemplatesPage';
import ImportExportPage from '../../pages/ImportExport/ImportExportPage';
import { StyleProfilesContent } from '../../pages/StyleProfiles/StyleProfilesContent';
import type { StyleProfilesTab } from '../../pages/StyleProfiles/styleProfilesPageTypes';

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getAll: vi.fn(async () => []) },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: vi.fn(async () => []) },
}));
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Resource layout test must not call network');
    }),
  );
});

function StyleHarness() {
  const [tab, setTab] = useState<StyleProfilesTab>('styles');
  return (
    <StyleProfilesContent
      tab={tab}
      setTab={setTab}
      tabs={[
        { key: 'styles', label: '风格方案' },
        { key: 'outputs', label: '输出控制' },
        { key: 'imports', label: '导入记录' },
      ]}
      styles={[]}
      outputs={[]}
      assets={[]}
      setAssets={vi.fn()}
      msg=""
      flash={vi.fn()}
      setEditingStyle={vi.fn()}
      setStyleForm={vi.fn()}
      setShowStyleForm={vi.fn()}
      setAnalyzeText={vi.fn()}
      setAnalyzeResult={vi.fn()}
      setAnalyzeError={vi.fn()}
      setShowAnalyze={vi.fn()}
      setEditingOutput={vi.fn()}
      setOutputForm={vi.fn()}
      setShowOutputForm={vi.fn()}
      editStyle={vi.fn()}
      activateStyle={vi.fn(async () => undefined)}
      activatingStyleId={null}
      deleteStyle={vi.fn(async () => undefined)}
      makeOutputDefault={vi.fn(async () => undefined)}
      defaultingOutputId={null}
      deleteOutput={vi.fn(async () => undefined)}
      onBack={vi.fn()}
    />
  );
}

it('uses semantic style tabs with keyboard switching and keeps create actions outside the tablist', () => {
  render(
    <MemoryRouter>
      <StyleHarness />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: '风格方案管理' })).toBeTruthy();
  const tabs = screen.getByRole('tablist', { name: '风格资源分类' });
  expect(within(tabs).queryByRole('button')).toBeNull();
  expect(screen.getByRole('button', { name: '新建风格' }).closest('[role="tablist"]')).toBeNull();
  const first = screen.getByRole('tab', { name: '风格方案 (0)' });
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('tab', { name: '输出控制 (0)' });
  expect(second.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(second);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(second.id);
  expect(screen.getByRole('button', { name: '新建方案' })).toBeTruthy();
  fireEvent.keyDown(second, { key: 'End' });
  expect(screen.getByText('暂无导入记录')).toBeTruthy();
});

it('keeps template counts and card filtering connected to accessible tabs', () => {
  render(
    <MemoryRouter>
      <TemplatesPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: '模板中心' })).toBeTruthy();
  const tabs = screen.getByRole('tablist', { name: '模板分类' });
  expect(within(tabs).getAllByRole('tab')).toHaveLength(7);
  expect(screen.getByRole('button', { name: '新建模板' }).closest('[role="tablist"]')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '我的模板 (0)' }));
  expect(screen.getByRole('tabpanel').textContent).toContain('该分类下暂无模板');
  fireEvent.keyDown(screen.getByRole('tab', { name: '我的模板 (0)' }), { key: 'Home' });
  expect(within(tabs).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
});

it('preserves the import tab test ID and separates import actions from navigation', async () => {
  render(
    <MemoryRouter>
      <ImportExportPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: '导入导出中心' })).toBeTruthy();
  const tab = screen.getByTestId('project-import-tab');
  expect(tab.getAttribute('role')).toBe('tab');
  fireEvent.click(tab);
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id);
  const importAction = (await screen.findAllByRole('button', { name: '导入 TXT' }))[0];
  expect(importAction.closest('[role="tablist"]')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
