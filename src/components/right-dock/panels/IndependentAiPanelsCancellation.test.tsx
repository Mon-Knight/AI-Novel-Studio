import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import type { Chapter } from '../../../types/chapter';
import type { CharacterCandidate } from '../../../types/character';
import type { EventSuggestion } from '../../../services/ai/eventSuggestService';
import type { SettingSuggestion } from '../../../services/ai/settingExpandService';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  CustomEvent: { value: dom.window.CustomEvent, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const settingPanelModule = (await vite.ssrLoadModule(
  '/src/components/right-dock/panels/SettingPanel.tsx',
)) as typeof import('./SettingPanel');
const eventsPanelModule = (await vite.ssrLoadModule(
  '/src/components/right-dock/panels/EventsPanel.tsx',
)) as typeof import('./EventsPanel');
const charactersPanelModule = (await vite.ssrLoadModule(
  '/src/components/right-dock/panels/CharactersPanel.tsx',
)) as typeof import('./CharactersPanel');
const settingExpandModule = (await vite.ssrLoadModule(
  '/src/services/ai/settingExpandService.ts',
)) as typeof import('../../../services/ai/settingExpandService');
const eventSuggestModule = (await vite.ssrLoadModule(
  '/src/services/ai/eventSuggestService.ts',
)) as typeof import('../../../services/ai/eventSuggestService');
const characterGenerateModule = (await vite.ssrLoadModule(
  '/src/services/ai/characterGenerateService.ts',
)) as typeof import('../../../services/ai/characterGenerateService');
const settingRepositoryModule = (await vite.ssrLoadModule(
  '/src/services/database/settingRepository.ts',
)) as typeof import('../../../services/database/settingRepository');
const protagonistRepositoryModule = (await vite.ssrLoadModule(
  '/src/services/database/protagonistRepository.ts',
)) as typeof import('../../../services/database/protagonistRepository');
const characterServiceModule = (await vite.ssrLoadModule(
  '/src/services/characters/characterService.ts',
)) as typeof import('../../../services/characters/characterService');
const chapterCharacterServiceModule = (await vite.ssrLoadModule(
  '/src/services/characters/chapterCharacterService.ts',
)) as typeof import('../../../services/characters/chapterCharacterService');
const chapterEventServiceModule = (await vite.ssrLoadModule(
  '/src/services/characters/chapterEventService.ts',
)) as typeof import('../../../services/characters/chapterEventService');

const SettingPanel = settingPanelModule.default;
const EventsPanel = eventsPanelModule.default;
const CharactersPanel = charactersPanelModule.default;
const { settingExpandService } = settingExpandModule;
const { eventSuggestService } = eventSuggestModule;
const { characterGenerateService } = characterGenerateModule;
const { settingRepository } = settingRepositoryModule;
const { protagonistRepository } = protagonistRepositoryModule;
const { characterService } = characterServiceModule;
const { chapterCharacterService } = chapterCharacterServiceModule;
const { chapterEventService } = chapterEventServiceModule;

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const originals = {
  suggestSettings: settingExpandService.suggestSettings,
  suggestEvents: eventSuggestService.suggestEvents,
  generateCandidates: characterGenerateService.generateCandidates,
  getWorldSettings: settingRepository.getWorldSettings,
  getRuleSystems: settingRepository.getRuleSystems,
  getProtagonist: protagonistRepository.getByNovelId,
  getCharacters: characterService.getByNovelId,
  syncProtagonists: characterService.syncProtagonists,
  getChapterCharacters: chapterCharacterService.getByChapterId,
  getChapterEvents: chapterEventService.getByChapterId,
};

afterEach(() => {
  cleanup();
  settingExpandService.suggestSettings = originals.suggestSettings;
  eventSuggestService.suggestEvents = originals.suggestEvents;
  characterGenerateService.generateCandidates = originals.generateCandidates;
  settingRepository.getWorldSettings = originals.getWorldSettings;
  settingRepository.getRuleSystems = originals.getRuleSystems;
  protagonistRepository.getByNovelId = originals.getProtagonist;
  characterService.getByNovelId = originals.getCharacters;
  characterService.syncProtagonists = originals.syncProtagonists;
  chapterCharacterService.getByChapterId = originals.getChapterCharacters;
  chapterEventService.getByChapterId = originals.getChapterEvents;
});

after(async () => {
  await vite.close();
  dom.window.close();
});

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '主角第一次进入冲突中心。',
  goal: '推动主角做出选择',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 0,
  currentWords: 0,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stubSettingLoads() {
  settingRepository.getWorldSettings = async () => [];
  settingRepository.getRuleSystems = async () => [];
  protagonistRepository.getByNovelId = async () => null;
}

function stubChapterLoads() {
  characterService.getByNovelId = async () => [];
  characterService.syncProtagonists = async () => [];
  chapterCharacterService.getByChapterId = async () => [];
  chapterEventService.getByChapterId = async () => [];
}

test('设定建议停止后中止 signal 且忽略迟到候选', async () => {
  stubSettingLoads();
  const pending = deferred<SettingSuggestion[]>();
  let signal: AbortSignal | undefined;
  settingExpandService.suggestSettings = async (input) => {
    signal = input.signal;
    return pending.promise;
  };

  render(<SettingPanel novelId="novel-1" chapter={chapter} />);
  fireEvent.click(screen.getByTestId('setting-suggest'));
  await waitFor(() => assert.ok(signal));

  fireEvent.click(screen.getByTestId('setting-suggest-stop'));
  assert.equal(signal?.aborted, true);
  pending.resolve([{ name: '迟到设定', description: '不应进入候选列表' }]);

  await screen.findByText('已停止生成设定建议');
  assert.equal(screen.queryByText('迟到设定'), null);
});

test('事件建议停止后中止 signal 且忽略迟到候选', async () => {
  stubChapterLoads();
  const pending = deferred<EventSuggestion[]>();
  let signal: AbortSignal | undefined;
  eventSuggestService.suggestEvents = async (_input, options) => {
    signal = options?.signal;
    return pending.promise;
  };

  render(<EventsPanel novelId="novel-1" chapter={chapter} />);
  fireEvent.click(screen.getByRole('button', { name: /生成本章事件建议/ }));
  await waitFor(() => assert.ok(signal));

  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  assert.equal(signal?.aborted, true);
  pending.resolve([{ title: '迟到事件', description: '不应进入候选列表' }]);

  await screen.findByText('已停止生成事件建议');
  assert.equal(screen.queryByText('迟到事件'), null);
});

test('角色候选停止后中止 signal 且忽略迟到候选', async () => {
  stubChapterLoads();
  const pending = deferred<CharacterCandidate[]>();
  let signal: AbortSignal | undefined;
  characterGenerateService.generateCandidates = async (_input, options) => {
    signal = options?.signal;
    return pending.promise;
  };

  render(<CharactersPanel novelId="novel-1" chapter={chapter} />);
  fireEvent.click(screen.getByRole('button', { name: /生成本章候选角色/ }));
  await waitFor(() => assert.ok(signal));

  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  assert.equal(signal?.aborted, true);
  pending.resolve([{ name: '迟到角色', roleType: 'supporting' }]);

  await screen.findByText('已停止生成候选角色');
  assert.equal(screen.queryByText('迟到角色'), null);
});

test('卸载设定面板会中止在途 AI 请求', async () => {
  stubSettingLoads();
  const pending = deferred<SettingSuggestion[]>();
  let signal: AbortSignal | undefined;
  settingExpandService.suggestSettings = async (input) => {
    signal = input.signal;
    return pending.promise;
  };

  const view = render(<SettingPanel novelId="novel-1" chapter={chapter} />);
  fireEvent.click(screen.getByTestId('setting-suggest'));
  await waitFor(() => assert.ok(signal));
  view.unmount();

  assert.equal(signal?.aborted, true);
  pending.resolve([]);
});
