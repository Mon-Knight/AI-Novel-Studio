import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import GenerationTracePanel from './GenerationTracePanel';
import type { RouteDecision } from '../../../types/modelRuntime';

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

test('GenerationTracePanel renders empty state when no trace exists', async () => {
  await act(async () => {
    render(<GenerationTracePanel />);
  });

  await waitFor(() => {
    const emptyElement = screen.getByTestId('generation-trace-empty');
    assert.ok(emptyElement);
    assert.equal(emptyElement.textContent?.includes('No generation trace available'), true);
  });
});

test('GenerationTracePanel renders full trace details with model, contract and tokens', async () => {
  await act(async () => {
    render(
      <GenerationTracePanel
        traceData={{
          taskType: 'chapter_scene_generate',
          operationId: 'op-trace-01',
          providerId: 'openai_compatible',
          modelId: 'qwen3.8-27b-writer',
          memoryVersion: 2,
          compilationHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
          promptTemplate: 'chapter/scene_generation_local',
          tokenUsage: {
            inputTokens: 1200,
            outputTokens: 450,
            totalTokens: 1650,
          },
          durationMs: 380,
          executedAt: '2026-08-23T10:00:00Z',
        }}
      />,
    );
  });

  await waitFor(() => {
    const taskEl = screen.getByTestId('trace-task-type');
    assert.ok(taskEl);
    assert.equal(taskEl.textContent?.includes('chapter_scene_generate'), true);

    const providerEl = screen.getByTestId('trace-provider-id');
    assert.ok(providerEl);
    assert.equal(providerEl.textContent?.includes('openai_compatible'), true);

    const modelEl = screen.getByTestId('trace-model-id');
    assert.ok(modelEl);
    assert.equal(modelEl.textContent?.includes('qwen3.8-27b-writer'), true);

    const memoryEl = screen.getByTestId('trace-memory-version');
    assert.ok(memoryEl);
    assert.equal(memoryEl.textContent?.includes('v2'), true);

    const hashEl = screen.getByTestId('trace-compilation-hash');
    assert.ok(hashEl);
    assert.equal(hashEl.textContent?.includes('a1b2c3d4e5f60718293a4b5c6d7e8f90'), true);

    const durationEl = screen.getByTestId('trace-duration');
    assert.ok(durationEl);
    assert.equal(durationEl.textContent?.includes('380 ms'), true);

    const tokensEl = screen.getByTestId('trace-token-usage');
    assert.ok(tokensEl);
    assert.equal(tokensEl.textContent?.includes('1650'), true);
  });
});

test('GenerationTracePanel renders fallback alert when fallback route is used', async () => {
  const fallbackRoute: RouteDecision = {
    schemaVersion: 1,
    role: 'writer.beat_prose',
    taskType: 'chapter_scene_generate',
    primary: {
      endpointId: 'local_endpoint',
      providerId: 'local_llama_cpp',
      modelId: 'qwen-local',
      kind: 'local',
    },
    selected: {
      endpointId: 'remote_endpoint',
      providerId: 'ai_gateway',
      modelId: 'deepseek-chat',
      kind: 'remote',
    },
    reason: 'local_unhealthy',
    fallbackUsed: true,
    decidedAt: '2026-08-23T10:05:00Z',
  };

  await act(async () => {
    render(
      <GenerationTracePanel
        traceData={{
          taskType: 'chapter_scene_generate',
          routeDecision: fallbackRoute,
          providerId: 'ai_gateway',
          modelId: 'deepseek-chat',
          fallbackReason: 'local_unhealthy',
        }}
      />,
    );
  });

  await waitFor(() => {
    const alertEl = screen.getByTestId('trace-fallback-alert');
    assert.ok(alertEl);
    assert.equal(alertEl.textContent?.includes('local_unhealthy'), true);
  });
});
