import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearToolOutput,
  closePanel,
  createEmptyToolState,
  createInitialSidebarState,
  getOrCreateToolState,
  isToolOutputStale,
  switchTool,
  toggleCollapse,
  updateToolState,
} from './rightSidebarStore';
import type { RightSidebarState } from './rightSidebarStore';

function populatedState(): RightSidebarState {
  return {
    activeTool: 'style',
    collapsed: false,
    lastActiveTool: 'outline',
    toolStates: {
      style: {
        output: 'generated style notes',
        error: 'old error',
        loading: true,
        relatedContentHash: 'hash-before-edit',
        relatedDraftVersion: 3,
        lastRunAt: '2026-07-28T00:00:00.000Z',
        metadata: '{"source":"test"}',
      },
      check: {
        output: 'quality result',
        error: '',
        loading: false,
      },
    },
  };
}

test('state factories and tool lookup return safe defaults without mutating state', () => {
  const initial = createInitialSidebarState();
  assert.deepEqual(initial, {
    activeTool: null,
    collapsed: true,
    lastActiveTool: null,
    toolStates: {},
  });
  assert.deepEqual(createEmptyToolState(), {
    output: '',
    error: '',
    loading: false,
  });

  const state = populatedState();
  assert.equal(getOrCreateToolState(state, 'style'), state.toolStates.style);
  assert.deepEqual(getOrCreateToolState(state, 'characters'), createEmptyToolState());
  assert.equal(state.toolStates.characters, undefined);
});

test('updateToolState creates and merges tool state immutably', () => {
  const initial = createInitialSidebarState();
  const created = updateToolState(initial, 'outline', {
    output: 'outline result',
    relatedDraftVersion: 2,
  });

  assert.notEqual(created, initial);
  assert.notEqual(created.toolStates, initial.toolStates);
  assert.deepEqual(created.toolStates.outline, {
    output: 'outline result',
    error: '',
    loading: false,
    relatedDraftVersion: 2,
  });
  assert.deepEqual(initial, createInitialSidebarState());

  const state = populatedState();
  const originalStyle = state.toolStates.style;
  const originalCheck = state.toolStates.check;
  const updated = updateToolState(state, 'style', {
    error: '',
    loading: false,
    metadata: 'updated metadata',
  });

  assert.notEqual(updated, state);
  assert.notEqual(updated.toolStates, state.toolStates);
  assert.notEqual(updated.toolStates.style, originalStyle);
  assert.equal(updated.toolStates.check, originalCheck);
  assert.deepEqual(updated.toolStates.style, {
    ...originalStyle,
    error: '',
    loading: false,
    metadata: 'updated metadata',
  });
  assert.equal(state.toolStates.style, originalStyle);
});

test('clearToolOutput removes output ownership fields and preserves runtime metadata', () => {
  const state = populatedState();
  const cleared = clearToolOutput(state, 'style');

  assert.deepEqual(cleared.toolStates.style, {
    output: '',
    error: '',
    loading: true,
    relatedContentHash: undefined,
    relatedDraftVersion: undefined,
    lastRunAt: undefined,
    metadata: '{"source":"test"}',
  });
  assert.equal(cleared.toolStates.check, state.toolStates.check);
  assert.equal(state.toolStates.style.output, 'generated style notes');
  assert.equal(state.toolStates.style.relatedContentHash, 'hash-before-edit');
});

test('isToolOutputStale only flags owned output whose content hash changed', () => {
  const state = populatedState();

  assert.equal(isToolOutputStale(state, 'style'), false);
  assert.equal(isToolOutputStale(state, 'missing', 'hash-after-edit'), false);
  assert.equal(isToolOutputStale(state, 'check', 'hash-after-edit'), false);
  assert.equal(isToolOutputStale(state, 'style', 'hash-before-edit'), false);
  assert.equal(isToolOutputStale(state, 'style', 'hash-after-edit'), true);
});

test('toggleCollapse preserves tool state and round-trips the active tool', () => {
  const expanded = populatedState();
  const collapsed = toggleCollapse(expanded);

  assert.deepEqual(collapsed, {
    ...expanded,
    activeTool: null,
    collapsed: true,
    lastActiveTool: 'style',
  });
  assert.equal(collapsed.toolStates, expanded.toolStates);

  const reopened = toggleCollapse(collapsed);
  assert.deepEqual(reopened, {
    ...collapsed,
    activeTool: 'style',
    collapsed: false,
  });
  assert.equal(reopened.toolStates, expanded.toolStates);
  assert.equal(expanded.activeTool, 'style');
});

test('switchTool opens a different tool and collapses an already active tool', () => {
  const collapsed = createInitialSidebarState();
  const opened = switchTool(collapsed, 'characters');
  assert.deepEqual(opened, {
    ...collapsed,
    activeTool: 'characters',
    collapsed: false,
    lastActiveTool: null,
  });

  const switched = switchTool(opened, 'check');
  assert.deepEqual(switched, {
    ...opened,
    activeTool: 'check',
    collapsed: false,
    lastActiveTool: 'characters',
  });

  const closedByRepeat = switchTool(switched, 'check');
  assert.deepEqual(closedByRepeat, {
    ...switched,
    activeTool: null,
    collapsed: true,
    lastActiveTool: 'check',
  });
  assert.deepEqual(collapsed, createInitialSidebarState());
});

test('closePanel is an identity operation when collapsed and preserves the active tool when open', () => {
  const collapsed = createInitialSidebarState();
  assert.equal(closePanel(collapsed), collapsed);

  const expanded = populatedState();
  const closed = closePanel(expanded);
  assert.deepEqual(closed, {
    ...expanded,
    activeTool: null,
    collapsed: true,
    lastActiveTool: 'style',
  });
  assert.notEqual(closed, expanded);
  assert.equal(closed.toolStates, expanded.toolStates);
});
