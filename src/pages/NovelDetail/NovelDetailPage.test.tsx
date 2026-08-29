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

const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});
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

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const originalGetNovelById = novelService.getNovelById;
const originalGetWorldSettings = settingRepository.getWorldSettings;
const originalGetRuleSystems = settingRepository.getRuleSystems;
const originalGetProtagonist = protagonistRepository.getByNovelId;

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
        future: { v7_startTransition: true, v7_relativeSplatPath: true },
      },
      React.createElement(
        Routes,
        null,
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

afterEach(() => cleanup());

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
    ['story_plan', 'novel-detail-outline'],
    ['chapter_outline', 'novel-detail-outline'],
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

test('focused detail view returns to the creative workbench', async () => {
  renderFocusedPage('world_setting');

  const back = await screen.findByTestId('novel-detail-return-workbench');
  fireEvent.click(back);

  assert.ok(await screen.findByTestId('workbench-route'));
});
