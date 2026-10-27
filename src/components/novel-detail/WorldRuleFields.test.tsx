import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { WorldRuleDocument } from '../../types/worldRules';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { useState } = await import('react');
const { createElement } = await import('react');
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createWorldRuleDocument } = await import('../../services/worldRules/worldRuleSchema');
const { default: WorldRuleFields } = await import('./WorldRuleFields');
const { WORLD_PARAMETER_EXAMPLES, CHARACTER_BELIEF_HINT } = await import('./worldRulePresentation');

afterEach(() => {
  cleanup();
});

function Harness({ world = true, initial }: { world?: boolean; initial?: WorldRuleDocument }) {
  const [value, setValue] = useState(
    () => initial ?? createWorldRuleDocument('rule-1', '渡船须等待可通航潮位。'),
  );
  return createElement(WorldRuleFields, { world, value, onChange: setValue });
}

test('first screen shows nature, scope and cost, and keeps values when kind changes', () => {
  render(createElement(Harness));
  const kind = screen.getByTestId('world-rule-kind') as HTMLSelectElement;
  const scope = screen.getByTestId('world-rule-scope') as HTMLTextAreaElement;
  const cost = screen.getByTestId('world-rule-cost') as HTMLTextAreaElement;
  assert.ok(screen.getByTestId('world-rule-conditions'));
  assert.equal(kind.value, 'world_fact');
  fireEvent.change(scope, { target: { value: '只约束普通民船' } });
  fireEvent.change(cost, { target: { value: 'N/A' } });
  fireEvent.change(kind, { target: { value: 'character_belief' } });
  assert.equal(
    (screen.getByTestId('world-rule-scope') as HTMLTextAreaElement).value,
    '只约束普通民船',
  );
  assert.equal((screen.getByTestId('world-rule-cost') as HTMLTextAreaElement).value, 'N/A');
  assert.equal(
    (screen.getByTestId('world-rule-kind') as HTMLSelectElement).value,
    'character_belief',
  );
  assert.equal(screen.getByTestId('world-rule-belief-hint').textContent, CHARACTER_BELIEF_HINT);
  const status = screen.getByDisplayValue('未定') as HTMLSelectElement;
  assert.equal(status.value, 'uncertain');
});

test('world, knowledge and source groups stay separate and eight parameters keep concrete examples', () => {
  render(createElement(Harness, { world: true }));
  assert.match(screen.getByTestId('world-rule-group-world').textContent ?? '', /世界中成立什么/);
  assert.match(
    screen.getByTestId('world-rule-knowledge-toggle').textContent ?? '',
    /角色知道或相信什么/,
  );
  assert.match(screen.getByTestId('world-rule-group-source').textContent ?? '', /来源与依赖/);
  assert.notEqual(
    screen.getByTestId('world-rule-group-world').textContent,
    screen.getByTestId('world-rule-knowledge-toggle').textContent,
  );
  const power = screen.getByTestId('world-parameter-institutions_power') as HTMLTextAreaElement;
  const time = screen.getByTestId('world-parameter-time_history') as HTMLTextAreaElement;
  const knowledge = screen.getByTestId(
    'world-parameter-information_knowledge',
  ) as HTMLTextAreaElement;
  assert.equal(power.placeholder, WORLD_PARAMETER_EXAMPLES.institutions_power);
  assert.equal(time.placeholder, WORLD_PARAMETER_EXAMPLES.time_history);
  assert.equal(knowledge.placeholder, WORLD_PARAMETER_EXAMPLES.information_knowledge);
  assert.notEqual(power.placeholder, time.placeholder);
  fireEvent.change(screen.getByTestId('world-rule-limitations'), { target: { value: '未知' } });
  assert.equal((screen.getByTestId('world-rule-limitations') as HTMLTextAreaElement).value, '未知');
});
