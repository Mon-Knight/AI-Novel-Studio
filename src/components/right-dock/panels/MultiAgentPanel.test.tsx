import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  MultiAgentReviewParams,
  MultiAgentReviewResult,
  MultiAgentSessionBundle,
} from '../../../types/multiAgent';
import MultiAgentPanel, { type MultiAgentPanelService } from './MultiAgentPanel';

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

const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => cleanup());
after(() => dom.window.close());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const sourceDraft: ChapterDraft = {
  id: 'draft-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  title: '第一章',
  content: '原始正文',
  source: 'user_edited',
  versionNo: 1,
  wordCount: 4,
  isAdopted: false,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

const candidateDraft: ChapterDraft = {
  ...sourceDraft,
  id: 'draft-2',
  content: '修订候选正文',
  source: 'ai_regenerated',
  versionNo: 2,
  wordCount: 6,
};

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '完成第一次冲突',
  goal: '推动主角做出选择',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 4,
  currentWords: 4,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

const secondChapter: Chapter = {
  ...chapter,
  id: 'chapter-2',
  title: '第二章',
  chapterNumber: 2,
  orderIndex: 2,
  sortOrder: 2,
};

function completedBundle(): MultiAgentSessionBundle {
  return {
    session: {
      sessionId: 'session-1',
      operationId: 'operation-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      sourceDraftVersion: 1,
      sourceContentHash: 'a'.repeat(64),
      expertTypes: ['outline', 'character', 'setting', 'logic', 'polish', 'quality'],
      maxRounds: 2,
      acceptanceThreshold: 0.7,
      minimumAverageScore: 75,
      minimumSuccessfulExperts: 4,
      status: 'completed',
      currentRound: 2,
      accepted: true,
      finalAction: 'accept',
      finalDraftId: 'draft-2',
      totalTokensInput: 60,
      totalTokensOutput: 30,
      totalTokensUsed: 90,
      durationMs: 20,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:02.000Z',
      completedAt: '2026-07-27T00:00:02.000Z',
    },
    rounds: [
      {
        roundNumber: 2,
        inputDraftId: 'draft-2',
        inputDraftVersion: 2,
        inputContentHash: 'b'.repeat(64),
        expertOpinions: [
          {
            opinionId: 'opinion-1',
            expert: 'quality',
            status: 'succeeded',
            score: 82,
            accepted: true,
            summary: '整体质量达到候选稿标准。',
            issues: [],
            suggestions: ['确认结尾力度。'],
            tokensInput: 10,
            tokensOutput: 5,
            tokensUsed: 15,
            durationMs: 1,
          },
        ],
        consensus: {
          agreed: true,
          acceptanceRate: 1,
          averageScore: 82,
          successfulExperts: 1,
          failedExperts: 0,
          requiredSuccessfulExperts: 1,
          majorConcerns: [],
          mergedSuggestions: ['确认结尾力度。'],
          action: 'accept',
        },
        tokensInput: 10,
        tokensOutput: 5,
        tokensUsed: 15,
        durationMs: 5,
        startedAt: '2026-07-27T00:00:01.000Z',
        completedAt: '2026-07-27T00:00:02.000Z',
      },
    ],
  };
}

test('工作台提交六专家配置并展示持久结果', async () => {
  const bundle = completedBundle();
  const calls: MultiAgentReviewParams[] = [];
  const result: MultiAgentReviewResult = {
    success: true,
    accepted: true,
    finalAction: 'accept',
    finalDraft: candidateDraft,
    session: bundle,
    totalTokensUsed: 90,
    durationMs: 20,
  };
  const service: MultiAgentPanelService = {
    async review(params) {
      calls.push(params);
      return result;
    },
    async getSession() {
      return bundle;
    },
    async listSessionsByChapter() {
      return [];
    },
  };

  render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
    }),
  );

  fireEvent.click(screen.getByTestId('multi-agent-run'));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0].experts, [
    'outline',
    'character',
    'setting',
    'logic',
    'polish',
    'quality',
  ]);
  assert.equal(calls[0].maxRounds, 3);
  await waitFor(() => assert.ok(screen.getByText('82')));
  assert.ok(screen.getByText('整体质量达到候选稿标准。'));
});

test('候选草稿只在用户显式确认后载入', async () => {
  const bundle = completedBundle();
  const generated: ChapterDraft[] = [];
  let confirmed = 0;
  const service: MultiAgentPanelService = {
    async review() {
      throw new Error('not used');
    },
    async getSession() {
      return bundle;
    },
    async listSessionsByChapter() {
      return [bundle.session];
    },
  };

  render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
      onBeforeDocumentChange: async () => {
        confirmed += 1;
        return true;
      },
      onGenerated: (draft) => generated.push(draft),
      loadDrafts: async () => [sourceDraft, candidateDraft],
    }),
  );

  const button = await screen.findByRole('button', { name: '载入候选草稿' });
  assert.equal(generated.length, 0);
  fireEvent.click(button);
  await waitFor(() => assert.equal(generated.length, 1));
  assert.equal(confirmed, 1);
  assert.equal(generated[0].id, 'draft-2');
});

test('未保存正文先形成耐久快照再进入评审', async () => {
  const bundle = completedBundle();
  const calls: MultiAgentReviewParams[] = [];
  const metadata: unknown[] = [];
  const snapshotDraft: ChapterDraft = {
    ...sourceDraft,
    id: 'draft-snapshot',
    content: '编辑器中的未保存正文',
    versionNo: 2,
  };
  const service: MultiAgentPanelService = {
    async review(params) {
      calls.push(params);
      return {
        success: true,
        accepted: true,
        finalAction: 'accept',
        finalDraft: snapshotDraft,
        session: bundle,
        totalTokensUsed: 90,
        durationMs: 20,
      };
    },
    async getSession() {
      return bundle;
    },
    async listSessionsByChapter() {
      return [];
    },
  };

  render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: snapshotDraft.content,
      currentEditorDirty: true,
      currentContentHash: 'workspace-hash',
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
      createDraft: async (input) => {
        assert.equal(input.content, snapshotDraft.content);
        assert.match(input.operationId ?? '', /-source$/);
        return snapshotDraft;
      },
      onGenerated: (_draft, resultMetadata) => {
        metadata.push(resultMetadata);
        return true;
      },
    }),
  );

  fireEvent.click(screen.getByTestId('multi-agent-run'));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].draftId, snapshotDraft.id);
  assert.equal(calls[0].draftVersion, snapshotDraft.versionNo);
  assert.equal(calls[0].draftContent, snapshotDraft.content);
  assert.equal(metadata.length, 1);
  assert.equal((metadata[0] as { source?: string }).source, 'multi_agent');
});

test('running 历史可按原 operation 和冻结配置显式继续', async () => {
  const completed = completedBundle();
  const running: MultiAgentSessionBundle = {
    ...completed,
    session: {
      ...completed.session,
      status: 'running',
      accepted: false,
      finalAction: undefined,
      finalDraftId: undefined,
      completedAt: undefined,
    },
  };
  const calls: MultiAgentReviewParams[] = [];
  const service: MultiAgentPanelService = {
    async review(params) {
      calls.push(params);
      return {
        success: true,
        accepted: true,
        finalAction: 'accept',
        finalDraft: candidateDraft,
        session: completed,
        totalTokensUsed: 90,
        durationMs: 20,
      };
    },
    async getSession(sessionId) {
      return sessionId === running.session.sessionId ? running : null;
    },
    async listSessionsByChapter() {
      return [running.session];
    },
  };

  render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
      loadDrafts: async () => [sourceDraft, candidateDraft],
    }),
  );

  const button = await screen.findByRole('button', { name: '继续此评审' });
  fireEvent.click(button);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].operationId, running.session.operationId);
  assert.deepEqual(calls[0].experts, running.session.expertTypes);
  assert.equal(calls[0].contentHash, running.session.sourceContentHash);
});

test('卸载面板会中止在途评审且迟到结果不会写回界面', async () => {
  const pending = deferred<MultiAgentReviewResult>();
  let requestSignal: AbortSignal | undefined;
  const service: MultiAgentPanelService = {
    async review(params) {
      requestSignal = params.signal;
      return pending.promise;
    },
    async getSession() {
      return null;
    },
    async listSessionsByChapter() {
      return [];
    },
  };
  const rendered = render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
    }),
  );

  fireEvent.click(screen.getByTestId('multi-agent-run'));
  await waitFor(() => assert.ok(requestSignal));
  rendered.unmount();
  assert.equal(requestSignal?.aborted, true);
  pending.resolve({
    success: true,
    accepted: true,
    finalAction: 'accept',
    finalDraft: candidateDraft,
    session: completedBundle(),
    totalTokensUsed: 90,
    durationMs: 20,
  });
  await pending.promise;
});

test('切换章节后忽略旧评审迟到结果并恢复新章节操作状态', async () => {
  const pending = deferred<MultiAgentReviewResult>();
  let requestSignal: AbortSignal | undefined;
  const service: MultiAgentPanelService = {
    async review(params) {
      requestSignal = params.signal;
      return pending.promise;
    },
    async getSession() {
      return null;
    },
    async listSessionsByChapter() {
      return [];
    },
  };
  const rendered = render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
    }),
  );

  fireEvent.click(screen.getByTestId('multi-agent-run'));
  await waitFor(() => assert.ok(requestSignal));
  rendered.rerender(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter: secondChapter,
      currentEditorContent: '第二章正文',
      currentDraftId: 'draft-chapter-2',
      currentDraftVersion: 1,
    }),
  );
  await waitFor(() => assert.equal(requestSignal?.aborted, true));
  pending.resolve({
    success: true,
    accepted: true,
    finalAction: 'accept',
    finalDraft: candidateDraft,
    session: completedBundle(),
    totalTokensUsed: 90,
    durationMs: 20,
  });
  await pending.promise;
  await waitFor(() => assert.ok(screen.getByTestId('multi-agent-run')));
  assert.equal(screen.queryByText('整体质量达到候选稿标准。'), null);
});

test('候选确认等待期间切章不会把旧候选载入新编辑器', async () => {
  const beforeChange = deferred<boolean>();
  const generated: ChapterDraft[] = [];
  let draftLoads = 0;
  const bundle = completedBundle();
  const service: MultiAgentPanelService = {
    async review() {
      throw new Error('not used');
    },
    async getSession() {
      return bundle;
    },
    async listSessionsByChapter(chapterId) {
      return chapterId === chapter.id ? [bundle.session] : [];
    },
  };
  const rendered = render(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter,
      currentEditorContent: sourceDraft.content,
      currentDraftId: sourceDraft.id,
      currentDraftVersion: sourceDraft.versionNo,
      onBeforeDocumentChange: () => beforeChange.promise,
      onGenerated: (draft) => generated.push(draft),
      loadDrafts: async () => {
        draftLoads += 1;
        return [candidateDraft];
      },
    }),
  );

  fireEvent.click(await screen.findByRole('button', { name: '载入候选草稿' }));
  rendered.rerender(
    React.createElement(MultiAgentPanel, {
      service,
      novelId: 'novel-1',
      chapter: secondChapter,
      currentEditorContent: '第二章正文',
      currentDraftId: 'draft-chapter-2',
      currentDraftVersion: 1,
      onBeforeDocumentChange: () => beforeChange.promise,
      onGenerated: (draft) => generated.push(draft),
      loadDrafts: async () => {
        draftLoads += 1;
        return [candidateDraft];
      },
    }),
  );
  await act(async () => {
    beforeChange.resolve(true);
    await beforeChange.promise;
  });
  await waitFor(() => assert.equal(generated.length, 0));
  assert.equal(draftLoads, 0);
});
