import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/workspace',
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

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const styleServiceModule = (await vite.ssrLoadModule(
  '/src/services/styles/styleProfileService.ts',
)) as typeof import('../../../services/styles/styleProfileService');
const outputServiceModule = (await vite.ssrLoadModule(
  '/src/services/styles/outputProfileService.ts',
)) as typeof import('../../../services/styles/outputProfileService');
const panelModule = (await vite.ssrLoadModule(
  '/src/components/right-dock/panels/StylePanel.tsx',
)) as typeof import('./StylePanel');
const styleAnalyzeModule = (await vite.ssrLoadModule(
  '/src/services/styles/styleAnalyzeService.ts',
)) as typeof import('../../../services/styles/styleAnalyzeService');

const { styleProfileService } = styleServiceModule;
const { outputProfileService } = outputServiceModule;
const StylePanel = panelModule.default;
const { renderStyleAnalyzePrompt } = styleAnalyzeModule;
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

const originalStyleGetAll = styleProfileService.getAll;
const originalOutputGetAll = outputProfileService.getAll;

beforeEach(() => {
  styleProfileService.getAll = async () => [];
  outputProfileService.getAll = async () => [];
});

afterEach(() => {
  cleanup();
  styleProfileService.getAll = originalStyleGetAll;
  outputProfileService.getAll = originalOutputGetAll;
});

after(async () => {
  await vite.close();
  dom.window.close();
});

test('style analysis can be stopped and an in-flight request is aborted on unmount', async () => {
  const OriginalAbortController = globalThis.AbortController;
  const controllers: AbortController[] = [];

  class TrackingAbortController extends OriginalAbortController {
    constructor() {
      super();
      controllers.push(this);
    }
  }

  Object.defineProperty(globalThis, 'AbortController', {
    value: TrackingAbortController,
    configurable: true,
    writable: true,
  });

  try {
    const view = render(React.createElement(StylePanel, { novelId: 'novel-1' }));
    fireEvent.change(
      screen.getByPlaceholderText('在此粘贴需要分析的参考文本（建议 500-20000 字）...'),
      { target: { value: '风格分析取消测试文本，需要验证结果不会在停止后回写。' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '开始风格分析' }));

    const firstStop = await screen.findByRole('button', { name: '停止分析' });
    assert.equal(controllers.length, 1);
    fireEvent.click(firstStop);
    assert.equal(controllers[0].signal.aborted, true);
    assert.ok(await screen.findByText('风格分析已停止'));
    assert.equal(screen.queryByText('分析结果'), null);

    fireEvent.click(screen.getByRole('button', { name: '开始风格分析' }));
    await screen.findByRole('button', { name: '停止分析' });
    assert.equal(controllers.length, 2);
    view.unmount();
    assert.equal(controllers[1].signal.aborted, true);
  } finally {
    Object.defineProperty(globalThis, 'AbortController', {
      value: OriginalAbortController,
      configurable: true,
      writable: true,
    });
  }
});

test('style analysis uses the complete build-time prompt contract', () => {
  const prompt = renderStyleAnalyzePrompt('参考文本内容');
  for (const field of [
    'name',
    'narrativePerspective',
    'tone',
    'pace',
    'sentenceStyle',
    'dialogueRatio',
    'descriptionRatio',
    'psychologicalRatio',
    'battleStyle',
    'battleIntensity',
    'emotionTendency',
    'chapterEnding',
    'forbiddenStyles',
    'styleSummary',
  ]) {
    assert.match(prompt, new RegExp(`"${field}"`));
  }
  assert.match(prompt, /参考文本内容/);
  assert.doesNotMatch(prompt, /\{\{reference_text\}\}/);
});
