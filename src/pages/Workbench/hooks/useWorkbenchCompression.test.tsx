import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { NovelContextCompressionCandidate } from '../../../services/context/novelContextCompressionProvider';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});
const { act, cleanup, renderHook } = await import('@testing-library/react');
const { useWorkbenchCompression } = await import('./useWorkbenchCompression');
const { useConversationScopedState } = await import('./useConversationScopedState');
const { novelContextCompressionProvider } =
  await import('../../../services/context/novelContextCompressionProvider');
const { taskConversationService } =
  await import('../../../services/conversation/taskConversationService');
const original = {
  propose: novelContextCompressionProvider.propose,
  publish: taskConversationService.publishStructuredCandidate,
};

function candidate(novelId = 'novel-a'): NovelContextCompressionCandidate {
  const bucket = { required: [], present: [], missing: [] };
  return {
    providerId: 'ans.novel-context.extractive-v1',
    version: '1.1.0',
    config: { tokenBudget: 4000 },
    novelId,
    sourceRevision: 'revision-1',
    compressedText: '待检查的压缩预览',
    valid: false,
    coverage: {
      characters: bucket,
      plot: bucket,
      foreshadow: bucket,
      timeline: bucket,
      world: bucket,
      rules: bucket,
      outlines: bucket,
      style: bucket,
      output: bucket,
      tokens: { budget: 4000, used: 20, withinBudget: true },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function renderCompression(refreshBundle: (id: string) => Promise<void> = async () => undefined) {
  return renderHook(
    ({ conversationId, novelId }: { conversationId: string; novelId: string }) => {
      const errors = useConversationScopedState(conversationId, '');
      const compression = useWorkbenchCompression({
        selectedConversationId: conversationId,
        selectedNovelId: novelId,
        refreshBundle,
        beginComposerErrorOperation: errors.beginOperation,
        commitComposerErrorOperation: errors.commitOperation,
      });
      return { ...compression, error: errors.value };
    },
    { initialProps: { conversationId: 'conversation-a', novelId: 'novel-a' } },
  );
}
let publications = 0;
beforeEach(() => {
  localStorage.clear();
  publications = 0;
  novelContextCompressionProvider.propose = async (novelId) => candidate(novelId);
  taskConversationService.publishStructuredCandidate = async (input) => {
    publications += 1;
    return {
      cardId: 'compression-card',
      conversationId: input.conversationId,
      artifactId: 'compression-artifact',
      artifactType: input.artifactType,
      title: input.title,
      summary: input.summary,
      status: 'candidate',
      createdAt: new Date().toISOString(),
    };
  };
});
afterEach(() => {
  cleanup();
  novelContextCompressionProvider.propose = original.propose;
  taskConversationService.publishStructuredCandidate = original.publish;
});

test('preview metadata names the originating action and stays paired through refresh, switch and dismissal', async () => {
  const { result, rerender } = renderCompression();
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  const metadata = result.current.compressionPresentation;
  assert.ok(metadata?.actionId);
  assert.equal(metadata.conversationId, 'conversation-a');
  assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
  assert.equal(publications, 0);
  rerender({ conversationId: 'conversation-b', novelId: 'novel-b' });
  const switchedCandidate = result.current.compressionCandidate;
  const switchedPresentation = result.current.compressionPresentation;
  assert.equal(switchedCandidate, null);
  assert.equal(switchedPresentation, null);
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  assert.notEqual(result.current.compressionPresentation?.actionId, metadata.actionId);
  rerender({ conversationId: 'conversation-a', novelId: 'novel-a' });
  const restoredPresentation = result.current.compressionPresentation;
  assert.deepEqual(restoredPresentation, metadata);
  assert.equal(restoredPresentation?.actionId, metadata.actionId);
  assert.equal(result.current.compressionCandidate?.novelId, 'novel-a');
  act(() => result.current.setCompressionCandidate(null));
  const dismissedCandidate = result.current.compressionCandidate;
  const dismissedPresentation = result.current.compressionPresentation;
  assert.equal(dismissedCandidate, null);
  assert.equal(dismissedPresentation, null);
});

test('out-of-order compression completion cannot replace a newer candidate or action identity', async () => {
  const first = deferred<NovelContextCompressionCandidate>();
  const second = deferred<NovelContextCompressionCandidate>();
  let invocation = 0;
  novelContextCompressionProvider.propose = async () =>
    ++invocation === 1 ? first.promise : second.promise;
  const { result } = renderCompression();
  let firstOperation!: Promise<void>;
  let secondOperation!: Promise<void>;
  act(() => {
    firstOperation = result.current.proposeContextCompression();
  });
  act(() => {
    secondOperation = result.current.proposeContextCompression();
  });
  await act(async () => {
    second.resolve({ ...candidate(), sourceRevision: 'newer' });
    await secondOperation;
  });
  const metadata = result.current.compressionPresentation;
  await act(async () => {
    first.resolve({ ...candidate(), sourceRevision: 'older' });
    await firstOperation;
  });
  assert.equal(result.current.compressionCandidate?.sourceRevision, 'newer');
  assert.deepEqual(result.current.compressionPresentation, metadata);
  assert.equal(result.current.compressionBusy, false);
});

test('late completion belongs to the originating conversation without stealing another task preview', async () => {
  const delayed = deferred<NovelContextCompressionCandidate>();
  novelContextCompressionProvider.propose = async (novelId) =>
    novelId === 'novel-a' ? delayed.promise : candidate(novelId);
  const { result, rerender } = renderCompression();
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.proposeContextCompression();
  });
  rerender({ conversationId: 'conversation-b', novelId: 'novel-b' });
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  const taskB = result.current.compressionPresentation;
  await act(async () => {
    delayed.resolve(candidate());
    await operation;
  });
  assert.equal(result.current.compressionCandidate?.novelId, 'novel-b');
  assert.deepEqual(result.current.compressionPresentation, taskB);
  rerender({ conversationId: 'conversation-a', novelId: 'novel-a' });
  assert.equal(result.current.compressionPresentation?.conversationId, 'conversation-a');
  assert.equal(result.current.compressionCandidate?.novelId, 'novel-a');
});

test('a failed new compression retains the prior preview with its original action time', async () => {
  const { result } = renderCompression();
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  const metadata = result.current.compressionPresentation;
  novelContextCompressionProvider.propose = async () => {
    throw new Error('fixture compression failure');
  };
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  assert.deepEqual(result.current.compressionPresentation, metadata);
  assert.ok(result.current.compressionCandidate);
  assert.equal(result.current.error, 'fixture compression failure');
});

test('publication followed by refresh failure does not resurrect an old invalid preview', async () => {
  const { result } = renderCompression(async () => {
    throw new Error('fixture refresh failure');
  });
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  assert.ok(result.current.compressionPresentation);
  novelContextCompressionProvider.propose = async () => ({ ...candidate(), valid: true });
  await act(async () => {
    await result.current.proposeContextCompression();
  });
  assert.equal(publications, 1);
  assert.equal(result.current.compressionCandidate, null);
  assert.equal(result.current.compressionPresentation, null);
  assert.equal(result.current.compressionBusy, false);
  assert.equal(result.current.error, 'fixture refresh failure');
});
