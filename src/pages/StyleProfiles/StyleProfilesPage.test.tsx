import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
import type { OutputProfile } from '../../types/output';
import type { StyleProfile } from '../../types/style';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/styles',
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

const { MemoryRouter } = await import('react-router-dom');

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const styleServiceModule = (await vite.ssrLoadModule(
  '/src/services/styles/styleProfileService.ts',
)) as typeof import('../../services/styles/styleProfileService');
const outputServiceModule = (await vite.ssrLoadModule(
  '/src/services/styles/outputProfileService.ts',
)) as typeof import('../../services/styles/outputProfileService');
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/StyleProfiles/StyleProfilesPage.tsx',
)) as typeof import('./StyleProfilesPage');

const { styleProfileService } = styleServiceModule;
const { outputProfileService } = outputServiceModule;
const StyleProfilesPage = pageModule.default;

const { cleanup, fireEvent, render, screen, waitFor, within } =
  await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;

const originalStyleService = { ...styleProfileService };
const originalOutputService = { ...outputProfileService };
const originalConfirm = dom.window.confirm;
const originalConsoleWarn = console.warn;

const timestamp = '2026-07-28T00:00:00.000Z';

function makeStyle(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    id: 'style-1',
    name: '夜色叙事',
    sourceType: 'manual',
    targetWordsPerChapter: 4000,
    rhythmPreference: 'moderate',
    narrativePerspective: '第三人称有限视角',
    tone: '冷静克制',
    pace: '中等',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    prohibitedStyles: [],
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeOutput(overrides: Partial<OutputProfile> = {}): OutputProfile {
  return {
    id: 'output-1',
    name: '冲突章节',
    chapterWordRange: { min: 3000, max: 6000, default: 4200 },
    targetWordCount: 4200,
    paragraphLength: 'medium',
    povType: 'third_person_limited',
    tenseType: 'past',
    paceLevel: 'fast',
    endingHookRequired: true,
    isDefault: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function renderPage() {
  return render(
    React.createElement(
      MemoryRouter,
      {
        initialEntries: ['/styles'],
        future: { v7_startTransition: true, v7_relativeSplatPath: true },
      },
      React.createElement(StyleProfilesPage),
    ),
  );
}

function getCardByTitle(title: string): HTMLElement {
  const titleElement = screen.getByText(title);
  const card = titleElement.parentElement?.parentElement;
  assert.ok(card);
  return card;
}

function getOpenDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('.modal-dialog');
  assert.ok(dialog);
  return dialog;
}

beforeEach(() => {
  styleProfileService.getAll = async () => [];
  outputProfileService.getAll = async () => [];
  dom.window.confirm = () => false;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).startsWith('[nativeDialog] Tauri dialog failed')) return;
    originalConsoleWarn(...args);
  };
});

afterEach(() => {
  cleanup();
  Object.assign(styleProfileService, originalStyleService);
  Object.assign(outputProfileService, originalOutputService);
  dom.window.confirm = originalConfirm;
  console.warn = originalConsoleWarn;
});

after(async () => {
  await vite.close();
  dom.window.close();
});

test('initial load renders persisted styles and output profiles with accurate counts', async () => {
  styleProfileService.getAll = async () => [makeStyle()];
  outputProfileService.getAll = async () => [makeOutput()];

  renderPage();

  assert.ok(await screen.findByText('夜色叙事'));
  assert.ok(screen.getByRole('button', { name: /风格方案\s*\(1\)/ }));

  await waitFor(() => {
    assert.ok(screen.getByRole('button', { name: /输出控制\s*\(1\)/ }));
  });
  fireEvent.click(screen.getByRole('button', { name: /输出控制\s*\(1\)/ }));

  assert.ok(await screen.findByText('冲突章节'));
  assert.ok(screen.getByText(/4,200\s*字/));
  assert.ok(screen.getByText(/快/));
});

test('a custom style can be made current and the refreshed state is visible immediately', async () => {
  let styles = [
    makeStyle({ id: 'style-current', name: '默认叙事', sourceType: 'system_default' }),
    makeStyle({ id: 'style-custom', name: '自定义冷峻风', isActive: false }),
  ];
  const calls: Array<{ projectId: string; styleProfileId: string }> = [];
  styleProfileService.getAll = async () => [...styles];
  styleProfileService.setActive = async (projectId, styleProfileId) => {
    calls.push({ projectId, styleProfileId });
    styles = styles.map((style) => ({
      ...style,
      isActive: style.id === styleProfileId,
    }));
  };

  renderPage();
  await screen.findByText('自定义冷峻风');
  const customCard = getCardByTitle('自定义冷峻风');
  assert.equal(within(customCard).queryByText('当前'), null);

  fireEvent.click(within(customCard).getByRole('button', { name: '设为当前' }));

  await waitFor(() => assert.deepEqual(calls, [{ projectId: '', styleProfileId: 'style-custom' }]));
  assert.ok(await within(customCard).findByText('当前'));
  assert.equal(within(customCard).queryByRole('button', { name: '设为当前' }), null);
  assert.ok(within(getCardByTitle('默认叙事')).getByRole('button', { name: '设为当前' }));
  assert.ok(screen.getByText('已将「自定义冷峻风」设为当前风格'));
});

test('a custom output profile can be made default without weakening default deletion protection', async () => {
  let outputs = [
    makeOutput({ id: 'output-default', name: '默认章节', isDefault: true }),
    makeOutput({ id: 'output-custom', name: '自定义长章', isDefault: false }),
  ];
  const calls: Array<{ novelId: string | undefined; outputProfileId: string }> = [];
  outputProfileService.getAll = async () => [...outputs];
  outputProfileService.setDefault = async (novelId, outputProfileId) => {
    calls.push({ novelId, outputProfileId });
    outputs = outputs.map((output) => ({
      ...output,
      isDefault: output.id === outputProfileId,
    }));
  };

  renderPage();
  const outputTab = await screen.findByRole('button', { name: /输出控制\s*\(2\)/ });
  fireEvent.click(outputTab);

  const previousDefaultCard = getCardByTitle('默认章节');
  const customCard = getCardByTitle('自定义长章');
  assert.ok(within(previousDefaultCard).getByText('默认'));
  assert.equal(within(previousDefaultCard).queryByRole('button', { name: /🗑/ }), null);

  fireEvent.click(within(customCard).getByRole('button', { name: '设为默认' }));

  await waitFor(() =>
    assert.deepEqual(calls, [{ novelId: undefined, outputProfileId: 'output-custom' }]),
  );
  assert.ok(await within(customCard).findByText('默认'));
  assert.equal(within(customCard).queryByRole('button', { name: '设为默认' }), null);
  assert.equal(within(customCard).queryByRole('button', { name: /🗑/ }), null);
  assert.ok(within(previousDefaultCard).getByRole('button', { name: /🗑/ }));
  assert.ok(screen.getByText('已将「自定义长章」设为默认输出方案'));
});

test('a failed current-style switch keeps the previous state and shows the service error', async () => {
  styleProfileService.getAll = async () => [
    makeStyle({ id: 'style-current', name: '当前风格' }),
    makeStyle({ id: 'style-target', name: '待切换风格', isActive: false }),
  ];
  styleProfileService.setActive = async () => {
    throw new Error('风格方案不属于当前作品');
  };

  renderPage();
  await screen.findByText('待切换风格');
  fireEvent.click(within(getCardByTitle('待切换风格')).getByRole('button', { name: '设为当前' }));

  assert.ok(await screen.findByText('风格方案不属于当前作品'));
  assert.ok(within(getCardByTitle('当前风格')).getByText('当前'));
  assert.equal(within(getCardByTitle('待切换风格')).queryByText('当前'), null);
});

test('browser storage keeps one active shared style and rejects cross-scope activation', async () => {
  Object.assign(styleProfileService, originalStyleService);
  localStorage.clear();
  try {
    const seeded = await styleProfileService.getAll();
    assert.equal(seeded.filter((profile) => profile.isActive).length, 1);
    const custom = await styleProfileService.create({
      name: '共享自定义风格',
      sourceType: 'manual',
      narrativePerspective: '第一人称',
    });
    const projectStyle = await styleProfileService.create({
      novelId: 'novel-a',
      name: '作品风格',
      sourceType: 'manual',
    });
    assert.equal(custom.isActive, false);
    assert.equal(projectStyle.isActive, false);

    await styleProfileService.setActive('', custom.id);
    const shared = await styleProfileService.getAll();
    assert.deepEqual(
      shared.filter((profile) => !profile.novelId && profile.isActive).map((profile) => profile.id),
      [custom.id],
    );

    const beforeRejectedSwitch = localStorage.getItem('ai_novel_studio_style_profiles');
    await assert.rejects(
      styleProfileService.setActive('novel-b', projectStyle.id),
      /不存在或不属于当前作品/,
    );
    await assert.rejects(
      styleProfileService.setActive('', 'missing-style'),
      /不存在或不属于当前作品/,
    );
    assert.equal(localStorage.getItem('ai_novel_studio_style_profiles'), beforeRejectedSwitch);
  } finally {
    localStorage.clear();
  }
});

test('layered profiles expose available, outdated and missing source provenance', async () => {
  const hash = 'a'.repeat(64);
  const makeLayered = (
    id: string,
    name: string,
    sourceState: 'available' | 'outdated' | 'missing',
  ) =>
    makeStyle({
      id,
      name,
      sourceType: 'ai_analyzed',
      sourceState,
      sourceReferenceWorkId: `reference-work-${id}`,
      sourceReferenceImportId: `reference-import-${id}`,
      sourceContentHash: hash,
      analysisMetadataJson: JSON.stringify({
        analyzerVersion: 'layered_style_analyzer_v1',
        promptVersion: 'style_analyze_layered_v1',
        sourceWorkId: `reference-work-${id}`,
        sourceImportId: `reference-import-${id}`,
        sourceHash: hash,
        model: { provider: 'provider-a', modelName: 'model-a' },
        confidence: { overall: 0.88 },
        samples: [
          {
            sectionId: `section-${id}`,
            sectionOrderIndex: 1,
            startUtf16: 0,
            endUtf16: 240,
            contentHash: 'b'.repeat(64),
            layers: ['opening'],
          },
        ],
      }),
    });
  styleProfileService.getAll = async () => [
    makeLayered('available', '可用画像', 'available'),
    makeLayered('outdated', '过期画像', 'outdated'),
    {
      ...makeLayered('missing', '缺失画像', 'missing'),
      sourceReferenceWorkId: undefined,
      sourceReferenceImportId: undefined,
    },
  ];

  renderPage();

  for (const [name, state, label] of [
    ['可用画像', 'available', '来源可用'],
    ['过期画像', 'outdated', '来源已过期'],
    ['缺失画像', 'missing', '来源缺失'],
  ] as const) {
    await screen.findByText(name);
    const trace = within(getCardByTitle(name)).getByLabelText(`${name} 来源追溯`);
    assert.equal(trace.dataset.sourceState, state);
    assert.match(trace.textContent ?? '', new RegExp(label));
    assert.match(trace.textContent ?? '', new RegExp(`reference-work-${state}`));
    assert.match(trace.textContent ?? '', new RegExp(`reference-import-${state}`));
    assert.match(trace.textContent ?? '', /layered_style_analyzer_v1/);
    assert.match(trace.textContent ?? '', /总体置信度：88%/);
    assert.match(trace.textContent ?? '', /可重放采样范围：1 个/);
    assert.ok(within(getCardByTitle(name)).getByText('AI分层分析'));
  }
});

test('creating a style submits normalized ratios and refreshes the visible list', async () => {
  let styles = [makeStyle()];
  const createCalls: Parameters<typeof styleProfileService.create>[0][] = [];
  styleProfileService.getAll = async () => [...styles];
  styleProfileService.create = async (input) => {
    createCalls.push(input);
    const created = makeStyle({
      id: 'style-created',
      name: input.name,
      sourceType: input.sourceType,
      narrativePerspective: input.narrativePerspective,
      tone: input.tone,
      pace: input.pace,
      dialogueRatio: input.dialogueRatio ?? 0.35,
      descriptionRatio: input.descriptionRatio ?? 0.4,
    });
    styles = [...styles, created];
    return created;
  };

  renderPage();
  await screen.findByText('夜色叙事');
  fireEvent.click(screen.getByRole('button', { name: '+ 新建风格' }));

  const dialog = getOpenDialog();
  assert.ok(within(dialog).getByText('新建风格方案'));
  const textInputs = dialog.querySelectorAll<HTMLInputElement>('input.form-input');
  const rangeInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="range"]');
  assert.equal(textInputs.length, 4);
  assert.equal(rangeInputs.length, 2);
  const user = userEvent.setup();
  await user.type(textInputs[0], '雨夜悬疑风');
  await user.type(textInputs[1], '第一人称');
  await user.type(textInputs[2], '压抑紧张');
  fireEvent.change(rangeInputs[0], { target: { value: '60' } });
  fireEvent.change(rangeInputs[1], { target: { value: '25' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

  await waitFor(() => assert.equal(createCalls.length, 1));
  assert.equal(createCalls[0].name, '雨夜悬疑风');
  assert.equal(createCalls[0].sourceType, 'manual');
  assert.equal(createCalls[0].dialogueRatio, 0.6);
  assert.equal(createCalls[0].descriptionRatio, 0.25);
  assert.ok(await screen.findByText('雨夜悬疑风'));
  assert.ok(screen.getByText('已创建'));
});

test('style deletion is denied on cancel and performed only after confirmation', async () => {
  let styles = [makeStyle()];
  const removeCalls: string[] = [];
  const prompts: string[] = [];
  let allowDelete = false;
  styleProfileService.getAll = async () => [...styles];
  styleProfileService.remove = async (id) => {
    removeCalls.push(id);
    styles = styles.filter((style) => style.id !== id);
  };
  dom.window.confirm = (message?: string) => {
    prompts.push(String(message));
    return allowDelete;
  };

  renderPage();
  await screen.findByText('夜色叙事');
  const deleteButton = within(getCardByTitle('夜色叙事')).getByRole('button', { name: /🗑/ });

  fireEvent.click(deleteButton);
  await waitFor(() => assert.equal(prompts.length, 1));
  assert.equal(removeCalls.length, 0);
  assert.ok(screen.getByText('夜色叙事'));
  assert.match(prompts[0], /删除风格/);
  assert.match(prompts[0], /夜色叙事/);

  allowDelete = true;
  fireEvent.click(deleteButton);
  await waitFor(() => assert.deepEqual(removeCalls, ['style-1']));
  await waitFor(() => assert.equal(screen.queryByText('夜色叙事'), null));
  assert.ok(screen.getByText('已删除'));
});

test('output deletion is denied on cancel and performed only after confirmation', async () => {
  let outputs = [makeOutput()];
  const removeCalls: string[] = [];
  const prompts: string[] = [];
  let allowDelete = false;
  outputProfileService.getAll = async () => [...outputs];
  outputProfileService.remove = async (id) => {
    removeCalls.push(id);
    outputs = outputs.filter((output) => output.id !== id);
  };
  dom.window.confirm = (message?: string) => {
    prompts.push(String(message));
    return allowDelete;
  };

  renderPage();
  const outputTab = await screen.findByRole('button', { name: /输出控制\s*\(1\)/ });
  fireEvent.click(outputTab);
  await screen.findByText('冲突章节');
  const deleteButton = within(getCardByTitle('冲突章节')).getByRole('button', { name: /🗑/ });

  fireEvent.click(deleteButton);
  await waitFor(() => assert.equal(prompts.length, 1));
  assert.equal(removeCalls.length, 0);
  assert.ok(screen.getByText('冲突章节'));
  assert.match(prompts[0], /删除方案/);
  assert.match(prompts[0], /冲突章节/);

  allowDelete = true;
  fireEvent.click(deleteButton);
  await waitFor(() => assert.deepEqual(removeCalls, ['output-1']));
  await waitFor(() => assert.equal(screen.queryByText('冲突章节'), null));
  assert.ok(screen.getByText('已删除'));
});

test('a failed deletion keeps the style visible and shows the service error', async () => {
  styleProfileService.getAll = async () => [makeStyle()];
  styleProfileService.remove = async () => {
    throw new Error('SQLite 写入失败，请稍后重试');
  };
  dom.window.confirm = () => true;

  renderPage();
  await screen.findByText('夜色叙事');
  fireEvent.click(within(getCardByTitle('夜色叙事')).getByRole('button', { name: /🗑/ }));

  assert.ok(await screen.findByText('SQLite 写入失败，请稍后重试'));
  assert.ok(screen.getByText('夜色叙事'));
});

test('TXT analysis exposes validation feedback before attempting an AI request', async () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: /TXT分析/ }));

  const dialog = getOpenDialog();
  assert.ok(within(dialog).getByText('📄 TXT 风格分析'));
  fireEvent.click(within(dialog).getByRole('button', { name: /分析$/ }));

  assert.ok(await within(dialog).findByText('请输入参考文本'));
});

test('TXT analysis exposes a stop action and does not display a cancelled result', async () => {
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
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /TXT分析/ }));

    const dialog = getOpenDialog();
    fireEvent.change(dialog.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '这是一段用于验证取消行为的风格参考文本。' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /分析$/ }));

    const stopButton = await within(dialog).findByRole('button', { name: '停止分析' });
    assert.equal(controllers.length, 1);
    fireEvent.click(stopButton);

    assert.equal(controllers[0].signal.aborted, true);
    assert.ok(await within(dialog).findByText('分析已停止'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(within(dialog).queryByText(/分析完成/), null);
  } finally {
    Object.defineProperty(globalThis, 'AbortController', {
      value: OriginalAbortController,
      configurable: true,
      writable: true,
    });
  }
});
