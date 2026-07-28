import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
import type { Novel } from '../../types/novel';
import type { SettingSuggestionRecord } from '../../types/settingSuggestion';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/setting-suggestions',
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
const novelRepositoryModule = (await vite.ssrLoadModule(
  '/src/services/database/novelRepository.ts',
)) as typeof import('../../services/database/novelRepository');
const suggestionServiceModule = (await vite.ssrLoadModule(
  '/src/services/settingSuggestions/settingSuggestionService.ts',
)) as typeof import('../../services/settingSuggestions/settingSuggestionService');
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/SettingSuggestions/SettingSuggestionsPage.tsx',
)) as typeof import('./SettingSuggestionsPage');

const { novelRepository } = novelRepositoryModule;
const { settingSuggestionService } = suggestionServiceModule;
const SettingSuggestionsPage = pageModule.default;
const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const originalNovelGetAll = novelRepository.getAll;
const originalGetByNovelId = settingSuggestionService.getByNovelId;
const originalGenerate = settingSuggestionService.generate;
const originalAdopt = settingSuggestionService.adopt;
const originalDiscard = settingSuggestionService.discard;

const novel = {
  id: 'novel-1',
  title: '取消测试作品',
  description: '',
  outline: '',
  protagonistMode: 'single',
  protagonists: [],
  dualProtagonistRelation: {
    type: 'parallel',
    description: '',
    conflict: '',
    cooperation: '',
    emotionalProgression: '',
    narrativeWeight: 'balanced',
  },
  status: 'writing',
  totalWordCount: 0,
  totalWords: 0,
  targetWords: 100000,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  volumes: [],
} satisfies Novel;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(
    React.createElement(
      MemoryRouter,
      {
        initialEntries: ['/setting-suggestions'],
        future: { v7_startTransition: true, v7_relativeSplatPath: true },
      },
      React.createElement(SettingSuggestionsPage),
    ),
  );
}

beforeEach(() => {
  novelRepository.getAll = async () => [novel];
  settingSuggestionService.getByNovelId = async () => [];
});

afterEach(() => {
  cleanup();
  novelRepository.getAll = originalNovelGetAll;
  settingSuggestionService.getByNovelId = originalGetByNovelId;
  settingSuggestionService.generate = originalGenerate;
  settingSuggestionService.adopt = originalAdopt;
  settingSuggestionService.discard = originalDiscard;
});

after(async () => {
  await vite.close();
  dom.window.close();
});

test('stopping candidate generation aborts the request and ignores its late result', async () => {
  const pending = deferred<SettingSuggestionRecord[]>();
  let signal: AbortSignal | undefined;
  settingSuggestionService.generate = async (_input, options) => {
    signal = options?.signal;
    return pending.promise;
  };

  renderPage();
  const generateButton = await screen.findByRole('button', { name: '生成角色候选' });
  await waitFor(() => assert.equal((generateButton as HTMLButtonElement).disabled, false));
  fireEvent.click(generateButton);
  await waitFor(() => assert.ok(signal));

  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  assert.equal(signal?.aborted, true);
  assert.ok(await screen.findByText('生成已取消'));

  pending.resolve([
    {
      id: 'late-record',
      novelId: novel.id,
      suggestionType: 'character',
      worldType: '西方奇幻',
      referenceStyle: '王国战争',
      prompt: 'late',
      resultJson: '{}',
      item: { name: '迟到候选' },
      status: 'pending',
      createdAt: novel.createdAt,
      updatedAt: novel.updatedAt,
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(screen.queryByText('迟到候选'), null);
});

test('unmounting the page aborts candidate generation', async () => {
  const pending = deferred<SettingSuggestionRecord[]>();
  let signal: AbortSignal | undefined;
  settingSuggestionService.generate = async (_input, options) => {
    signal = options?.signal;
    return pending.promise;
  };

  const view = renderPage();
  const generateButton = await screen.findByRole('button', { name: '生成角色候选' });
  await waitFor(() => assert.equal((generateButton as HTMLButtonElement).disabled, false));
  fireEvent.click(generateButton);
  await waitFor(() => assert.ok(signal));

  view.unmount();
  assert.equal(signal?.aborted, true);
  pending.resolve([]);
});

test('candidate review actions update, discard, expand, and edit-adopt records', async () => {
  const makeRecord = (id: string, name: string): SettingSuggestionRecord => ({
    id,
    novelId: novel.id,
    suggestionType: 'character',
    worldType: 'fantasy',
    referenceStyle: 'epic',
    prompt: `prompt-${id}`,
    resultJson: JSON.stringify({ name }),
    item: { name, role: 'supporting' },
    status: 'pending',
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
  });
  const records = [
    makeRecord('adopt-record', 'Adopt Candidate'),
    makeRecord('discard-record', 'Discard Candidate'),
    makeRecord('edit-record', 'Edit Candidate'),
  ];
  settingSuggestionService.getByNovelId = async () => records;
  settingSuggestionService.adopt = async (id, editedItem) => {
    const source = records.find((item) => item.id === id);
    assert.ok(source);
    return {
      record: {
        ...source,
        item: editedItem ?? source.item,
        status: editedItem ? 'edited_adopted' : 'adopted',
        adoptedTargetId: `target-${id}`,
      },
      targetId: `target-${id}`,
      targetType: 'character',
    };
  };
  settingSuggestionService.discard = async (id) => {
    const source = records.find((item) => item.id === id);
    assert.ok(source);
    return { ...source, status: 'discarded' };
  };

  const view = renderPage();
  await waitFor(() =>
    assert.equal(view.container.querySelectorAll('.setting-suggestion-card').length, 3),
  );
  const findCard = (name: string) => {
    const card = Array.from(
      view.container.querySelectorAll<HTMLElement>('.setting-suggestion-card'),
    ).find((item) => item.textContent?.includes(name));
    assert.ok(card);
    return card;
  };
  const actionButtons = (name: string) =>
    Array.from(
      findCard(name).querySelectorAll<HTMLButtonElement>('.setting-suggestion-actions button'),
    );

  fireEvent.click(actionButtons('Adopt Candidate')[3]);
  assert.ok(findCard('Adopt Candidate').querySelector('.setting-suggestion-raw'));
  fireEvent.click(actionButtons('Adopt Candidate')[3]);
  assert.equal(findCard('Adopt Candidate').querySelector('.setting-suggestion-raw'), null);

  await act(async () => {
    fireEvent.click(actionButtons('Adopt Candidate')[0]);
    await Promise.resolve();
  });
  assert.equal(actionButtons('Adopt Candidate').length, 2);

  await act(async () => {
    fireEvent.click(actionButtons('Discard Candidate')[2]);
    await Promise.resolve();
  });
  assert.equal(actionButtons('Discard Candidate').length, 1);

  fireEvent.click(actionButtons('Edit Candidate')[1]);
  const editor = view.container.querySelector<HTMLTextAreaElement>(
    '.setting-suggestions-json-editor',
  );
  assert.ok(editor);
  fireEvent.change(editor, { target: { value: '{"name":"Edited Candidate"}' } });
  const confirmButton = view.container.querySelector<HTMLButtonElement>(
    '.setting-suggestions-modal-actions .btn-primary',
  );
  assert.ok(confirmButton);
  fireEvent.change(editor, { target: { value: '{' } });
  await act(async () => {
    fireEvent.click(confirmButton);
    await Promise.resolve();
  });
  assert.ok(view.container.querySelector('.modal-overlay'));
  assert.ok(view.container.querySelector('.setting-suggestions-error'));

  fireEvent.change(editor, { target: { value: '{"name":"Edited Candidate"}' } });
  await act(async () => {
    fireEvent.click(confirmButton);
    await Promise.resolve();
  });
  assert.equal(view.container.querySelector('.modal-overlay'), null);
  assert.ok(findCard('Edited Candidate'));
});
