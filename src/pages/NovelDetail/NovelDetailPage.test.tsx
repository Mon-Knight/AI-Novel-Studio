import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
import type { Novel } from '../../types/novel';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/novels/novel-focus',
  pretendToBeVisual: true,
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

Object.defineProperty(dom.window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: true }),
});

const scrolledTargets: string[] = [];
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value(this: HTMLElement) {
    scrolledTargets.push(this.id);
  },
});

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});
const { MemoryRouter, Route, Routes } = (await vite.ssrLoadModule(
  '/src/test/routerExports.ts',
)) as typeof import('react-router-dom');
const novelServiceModule = (await vite.ssrLoadModule(
  '/src/services/novels/novelService.ts',
)) as typeof import('../../services/novels/novelService');
const settingRepositoryModule = (await vite.ssrLoadModule(
  '/src/services/database/settingRepository.ts',
)) as typeof import('../../services/database/settingRepository');
const protagonistRepositoryModule = (await vite.ssrLoadModule(
  '/src/services/database/protagonistRepository.ts',
)) as typeof import('../../services/database/protagonistRepository');
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/NovelDetail/NovelDetailPage.tsx',
)) as typeof import('./NovelDetailPage');

const { novelService } = novelServiceModule;
const { settingRepository } = settingRepositoryModule;
const { protagonistRepository } = protagonistRepositoryModule;
const NovelDetailPage = pageModule.default;
const { default: ProtagonistCard } = (await vite.ssrLoadModule(
  '/src/components/novel-detail/ProtagonistCard.tsx',
)) as typeof import('../../components/novel-detail/ProtagonistCard');
const { getDefaultProtagonistProfile } = (await vite.ssrLoadModule(
  '/src/features/novels/novelNormalizer.ts',
)) as typeof import('../../features/novels/novelNormalizer');

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const originalGetNovelById = novelService.getNovelById;
const originalGetWorldSettings = settingRepository.getWorldSettings;
const originalGetRuleSystems = settingRepository.getRuleSystems;
const originalGetProtagonist = protagonistRepository.getByNovelId;
const originalPreview = settingRepository.previewWorldRuleChange;
const originalSaveWorld = settingRepository.saveWorldSetting;
const originalDeleteRule = settingRepository.deleteRuleSystem;

const novel: Novel = {
  id: 'novel-focus',
  title: '雾港回声',
  description: '用于验证核心资产补充回链。',
  outline: '',
  genre: '悬疑',
  protagonistMode: 'single',
  protagonists: [],
  dualProtagonistRelation: {
    type: 'partner',
    description: '',
    conflict: '',
    cooperation: '',
    emotionalProgression: '',
    narrativeWeight: 'balanced',
  },
  status: 'planning',
  totalWordCount: 0,
  totalWords: 0,
  targetWordCount: 60_000,
  targetWords: 60_000,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  volumes: [],
};

function renderFocusedPage(focus: string) {
  return render(
    React.createElement(
      MemoryRouter,
      {
        initialEntries: [`/novels/${novel.id}?focus=${focus}&returnTo=workbench`],
      },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/novels/:novelId/outline',
          element: React.createElement(
            'div',
            { 'data-testid': 'adopted-outline-route' },
            '采用章纲编辑器',
          ),
        }),
        React.createElement(Route, {
          path: '/novels/:novelId',
          element: React.createElement(NovelDetailPage),
        }),
        React.createElement(Route, {
          path: '/',
          element: React.createElement('div', { 'data-testid': 'workbench-route' }, '创作工作台'),
        }),
      ),
    ),
  );
}

beforeEach(() => {
  scrolledTargets.length = 0;
  novelService.getNovelById = async (id) => (id === novel.id ? novel : null);
  settingRepository.getWorldSettings = async () => [];
  settingRepository.getRuleSystems = async () => [];
  protagonistRepository.getByNovelId = async () => null;
});

afterEach(() => {
  cleanup();
  settingRepository.previewWorldRuleChange = originalPreview;
  settingRepository.saveWorldSetting = originalSaveWorld;
  settingRepository.deleteRuleSystem = originalDeleteRule;
});

after(async () => {
  novelService.getNovelById = originalGetNovelById;
  settingRepository.getWorldSettings = originalGetWorldSettings;
  settingRepository.getRuleSystems = originalGetRuleSystems;
  protagonistRepository.getByNovelId = originalGetProtagonist;
  await vite.close();
  dom.window.close();
});

test('core asset edit links focus the requested detail section', async () => {
  const cases = [
    ['world_setting', 'novel-detail-world-setting'],
    ['rule_system', 'novel-detail-rule-system'],
    ['protagonist', 'novel-detail-protagonist'],
    ['character', 'novel-detail-characters'],
    ['story_plan', 'novel-detail-outline'],
  ] as const;

  for (const [focus, targetId] of cases) {
    renderFocusedPage(focus);
    const target = await screen.findByTestId(targetId);
    await waitFor(() => {
      assert.ok(target.classList.contains('is-focused'));
      assert.ok(scrolledTargets.includes(targetId));
      assert.equal(document.activeElement, target);
    });
    cleanup();
    scrolledTargets.length = 0;
  }
});

test('chapter outline focus enters the versioned adopted outline editor', async () => {
  renderFocusedPage('chapter_outline');
  assert.ok(await screen.findByTestId('adopted-outline-route'));
  assert.equal(screen.queryByTestId('novel-detail-outline'), null);
});

test('focused detail view returns to the creative workbench', async () => {
  renderFocusedPage('world_setting');

  const back = await screen.findByTestId('novel-detail-return-workbench');
  fireEvent.click(back);

  assert.ok(await screen.findByTestId('workbench-route'));
});

test('every detail section uses the same bounded module including empty and outline sections', async () => {
  renderFocusedPage('world_setting');
  await screen.findByTestId('novel-detail-world-setting');
  const grid = document.querySelector('.detail-cards-grid');
  assert.ok(grid);
  assert.equal(grid.children.length, 8);
  for (const section of grid.children) assert.ok(section.classList.contains('detail-module'));
  assert.ok(screen.getByTestId('novel-detail-outline').classList.contains('detail-module--wide'));
});

test('long preparation and rule content can be fully reviewed inside their detail modules', async () => {
  const content = '背景与人物已经商定。\n'.repeat(80) + '完整模板末尾：等待用户确认。';
  const source = {
    novelId: novel.id,
    content,
    isActive: true,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
  };
  settingRepository.getWorldSettings = async () => [
    { ...source, id: 'preparation-template', title: '创作准备模板' },
  ];
  settingRepository.getRuleSystems = async () => [
    { ...source, id: 'long-rule', title: '叙事限制' },
  ];
  renderFocusedPage('world_setting');
  await screen.findByText('创作准备模板');
  for (const label of ['查看完整背景内容', '查看完整规则内容']) {
    const summary = screen.getByText(label);
    const disclosure = summary.closest('details');
    assert.ok(disclosure);
    assert.equal(disclosure.open, false);
    fireEvent.click(summary);
    assert.equal(disclosure.open, true);
    assert.ok(disclosure.textContent?.includes('完整模板末尾：等待用户确认。'));
    assert.ok(disclosure.closest('.detail-module'));
  }
});

test('persisted protagonist notes can be reviewed and corrected without changing other fields', async () => {
  const profile = {
    ...getDefaultProtagonistProfile('primary'),
    name: '沈知微',
    identity: '档案修复师',
    notes: '全书第一人称视角叙事核心。',
  };
  const saved: Array<Parameters<React.ComponentProps<typeof ProtagonistCard>['onSave']>[0]> = [];
  render(
    React.createElement(ProtagonistCard, {
      novelId: novel.id,
      novel: { ...novel, protagonists: [profile] },
      protagonist: null,
      onSave: async (data) => {
        saved.push(data);
      },
    }),
  );
  assert.ok(screen.getByText(profile.notes));
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  const notes = screen.getByPlaceholderText('补充人物设定或叙事要求...');
  assert.equal((notes as HTMLTextAreaElement).value, profile.notes);
  const corrected = '全书第三人称限知视角。\n遵守正式世界规则，不提前揭示真凶。';
  fireEvent.change(notes, { target: { value: corrected } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(saved[0].protagonists[0].notes, corrected);
  assert.equal(saved[0].protagonists[0].identity, profile.identity);
  assert.equal(saved[0].protagonists[0].name, profile.name);
  assert.equal(saved[0].protagonistMode, 'single');
});

test('default detail view shows back to novels list and empty state placeholders', async () => {
  render(
    React.createElement(
      MemoryRouter,
      {
        initialEntries: [`/novels/${novel.id}`],
      },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/novels/:novelId',
          element: React.createElement(NovelDetailPage),
        }),
        React.createElement(Route, {
          path: '/novels',
          element: React.createElement('div', { 'data-testid': 'novels-route' }, '小说作品列表'),
        }),
      ),
    ),
  );

  const back = await screen.findByTestId('novel-detail-back-novels');
  assert.ok(back);
  fireEvent.click(back);
  assert.ok(await screen.findByTestId('novels-route'));
});

function ruleImpact(): Awaited<ReturnType<typeof settingRepository.previewWorldRuleChange>> {
  return {
    novelId: novel.id,
    ruleSetFingerprint: 'rule-set-1',
    previewHash: 'preview-1',
    sources: [],
    affectedChapters: [],
    dependentRules: [],
    uncertainty: ['未证明语义一致'],
    blockingConflicts: [],
    requiresConfirmation: true,
  };
}

test('world metadata requires fresh impact confirmation and survives closing before save', async () => {
  const inputs: import('../../types/setting').SaveWorldSettingInput[] = [];
  settingRepository.previewWorldRuleChange = async () => ruleImpact();
  settingRepository.saveWorldSetting = async (_id, input) => {
    inputs.push(input);
    return {
      ...input,
      id: 'saved-world',
      isActive: true,
      createdAt: novel.createdAt,
      updatedAt: novel.updatedAt,
    };
  };
  renderFocusedPage('world_setting');
  fireEvent.click(await screen.findByTestId('world-setting-edit'));
  const editor = screen.getByTestId('setting-editor-world-new');
  const field = (id: string) => {
    const node = editor.querySelector<HTMLInputElement>('[data-testid="' + id + '"]');
    assert.ok(node);
    return node;
  };
  fireEvent.change(field('setting-title'), { target: { value: '河港背景' } });
  fireEvent.change(field('setting-content'), { target: { value: '河港在暴雨后实行供水配额。' } });
  fireEvent.change(field('world-parameter-economy_resources'), {
    target: { value: '每户每日三桶' },
  });
  fireEvent.compositionStart(field('setting-content'));
  fireEvent.keyDown(field('setting-content'), { key: 'Escape', isComposing: true, keyCode: 229 });
  assert.equal(editor.hidden, false);
  fireEvent.compositionEnd(field('setting-content'));
  fireEvent.click(field('setting-close'));
  fireEvent.click(screen.getByTestId('world-setting-edit'));
  assert.equal(field('world-parameter-economy_resources').value, '每户每日三桶');
  fireEvent.click(field('setting-impact-preview'));
  await waitFor(() => assert.ok(editor.querySelector('[data-testid="setting-author-confirm"]')));
  fireEvent.click(field('setting-author-confirm'));
  fireEvent.change(field('setting-content'), { target: { value: '河港实行配额，医院优先。' } });
  assert.equal(field('setting-save').disabled, true);
  assert.equal(inputs.length, 0);
  fireEvent.click(field('setting-impact-preview'));
  await waitFor(() => assert.ok(editor.querySelector('[data-testid="setting-author-confirm"]')));
  fireEvent.click(field('setting-author-confirm'));
  fireEvent.click(field('setting-save'));
  await waitFor(() => assert.equal(inputs.length, 1));
  assert.equal(inputs[0].expectedRuleSetFingerprint, 'rule-set-1');
  assert.equal(inputs[0].changeAuthorization?.previewHash, 'preview-1');
  const metadata = JSON.parse(inputs[0].structuredJson!);
  assert.equal(metadata.worldParameters.economy_resources, '每户每日三桶');
  assert.equal(metadata.authority, 'confirmed');
});

test('permanent rule deletion retains its action but requires explicit preview-bound author consent', async () => {
  const rule = {
    id: 'rule-delete',
    novelId: novel.id,
    title: '旧配额规则',
    content: '每户三桶。',
    isActive: true,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
  };
  settingRepository.getRuleSystems = async () => [rule];
  const deleted: Array<import('../../types/setting').DeleteRuleSystemInput | undefined> = [];
  settingRepository.previewWorldRuleChange = async (_novel, changes) => {
    assert.equal(changes[0].operation, 'delete');
    return ruleImpact();
  };
  settingRepository.deleteRuleSystem = async (_id, input) => {
    deleted.push(input);
  };
  renderFocusedPage('rule_system');
  fireEvent.click(await screen.findByLabelText('删除规则 旧配额规则'));
  await screen.findByTestId('world-rule-change-confirmation');
  assert.equal(deleted.length, 0);
  assert.equal(
    (screen.getByTestId('world-rule-change-confirm') as HTMLButtonElement).disabled,
    true,
  );
  fireEvent.click(screen.getByTestId('setting-author-confirm'));
  fireEvent.click(screen.getByTestId('world-rule-change-confirm'));
  await waitFor(() => assert.equal(deleted.length, 1));
  assert.equal(deleted[0]?.expectedUpdatedAt, rule.updatedAt);
  assert.equal(deleted[0]?.changeAuthorization?.previewHash, 'preview-1');
});
