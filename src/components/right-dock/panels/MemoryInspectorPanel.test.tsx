import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import MemoryInspectorPanel from './MemoryInspectorPanel';
import { novelMemoryManager } from '../../../services/memory/novelMemoryManager';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { act, cleanup, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => cleanup());
after(() => dom.window.close());

test('MemoryInspectorPanel renders empty state when no memory exists', async () => {
  novelMemoryManager.reset('novel-empty');

  await act(async () => {
    render(<MemoryInspectorPanel novelId="novel-empty" />);
  });

  await waitFor(() => {
    const emptyElement = screen.getByTestId('memory-inspector-empty');
    assert.ok(emptyElement);
    assert.equal(emptyElement.textContent?.includes('No memory context available'), true);
  });
});

test('MemoryInspectorPanel renders scene, POV, and retrieved fragments when memory exists', async () => {
  const novelId = 'novel-inspector-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '修真界三大禁令：不可私开山门、不可屠戮凡俗、不可妄引天劫。',
    relatedEntities: ['char-ye'],
  });

  await novelMemoryManager.updateCharacterState(novelId, 'char-ye', {
    characterName: '叶凡',
    currentEmotion: '战意昂扬',
    currentGoal: '破除上古阵法',
  });

  await act(async () => {
    render(
      <MemoryInspectorPanel
        novelId={novelId}
        sceneId="scene-01"
        taskInput={{
          sceneTitle: '破阵前夕',
          povCharacterId: 'char-ye',
        }}
      />,
    );
  });

  await waitFor(() => {
    const povEl = screen.getByTestId('inspector-pov-name');
    assert.ok(povEl);
    assert.equal(povEl.textContent?.includes('叶凡'), true);

    const versionEl = screen.getByTestId('inspector-memory-version');
    assert.ok(versionEl);
    assert.equal(versionEl.textContent?.includes('v1'), true);

    const fragmentsEl = screen.getByTestId('inspector-retrieved-fragments');
    assert.ok(fragmentsEl);
    assert.equal(fragmentsEl.textContent?.includes('修真界三大禁令'), true);
  });

  novelMemoryManager.reset(novelId);
});
