import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { QualityCheckResult } from '../../../types/qualityCheck';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const vite = await createServer({
  appType: 'custom',
  define: {
    'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
  },
  server: { middlewareMode: true, hmr: false },
});
const panelModule = (await vite.ssrLoadModule(
  '/src/components/right-dock/panels/CheckPanel.tsx',
)) as typeof import('./CheckPanel');
const qualityAiModule = (await vite.ssrLoadModule(
  '/src/services/ai/qualityCheckAiService.ts',
)) as typeof import('../../../services/ai/qualityCheckAiService');
const draftModule = (await vite.ssrLoadModule(
  '/src/services/database/draftVersionService.ts',
)) as typeof import('../../../services/database/draftVersionService');
const qualityModule = (await vite.ssrLoadModule(
  '/src/services/quality/qualityCheckService.ts',
)) as typeof import('../../../services/quality/qualityCheckService');
const CheckPanel = panelModule.default;
const { qualityCheckAiService } = qualityAiModule;
const { draftVersionService } = draftModule;
const { computeStatistics, qualityCheckService } = qualityModule;

const originalServices = {
  getLatestByChapterId: draftVersionService.getLatestByChapterId,
  createDraft: draftVersionService.create,
  getChapterIssues: qualityCheckService.getChapterIssues,
  listReports: qualityCheckService.listReports,
  createReport: qualityCheckService.createReport,
  saveResult: qualityCheckService.saveResult,
  runCheck: qualityCheckAiService.runCheck,
};

afterEach(() => {
  cleanup();
  draftVersionService.getLatestByChapterId = originalServices.getLatestByChapterId;
  draftVersionService.create = originalServices.createDraft;
  qualityCheckService.getChapterIssues = originalServices.getChapterIssues;
  qualityCheckService.listReports = originalServices.listReports;
  qualityCheckService.createReport = originalServices.createReport;
  qualityCheckService.saveResult = originalServices.saveResult;
  qualityCheckAiService.runCheck = originalServices.runCheck;
});
after(async () => {
  await vite.close();
  dom.window.close();
});

const content = Array.from({ length: 320 }, (_, index) => `word${index}`).join(' ');
const draft: ChapterDraft = {
  id: 'draft-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  title: '第一章',
  content,
  source: 'user_edited',
  versionNo: 1,
  wordCount: 320,
  isAdopted: false,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};
const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '冲突升级',
  goal: '推动情节',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 320,
  currentWords: 320,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

test('停止按钮中止真实检查 signal，迟到结果不会创建报告或草稿', async () => {
  let capturedSignal: AbortSignal | undefined;
  let resolveCheck!: (result: QualityCheckResult & { aiTaskId: string }) => void;
  const pendingCheck = new Promise<QualityCheckResult & { aiTaskId: string }>((resolve) => {
    resolveCheck = resolve;
  });
  let draftCreates = 0;
  let reportCreates = 0;
  let resultSaves = 0;
  let modalHides = 0;
  const publishedReports: unknown[] = [];

  draftVersionService.getLatestByChapterId = async () => draft;
  draftVersionService.create = (async () => {
    draftCreates += 1;
    return draft;
  }) as typeof draftVersionService.create;
  qualityCheckService.getChapterIssues = async () => ({
    report: null,
    items: [],
    statistics: computeStatistics([]),
  });
  qualityCheckService.listReports = async () => [];
  qualityCheckService.createReport = (async () => {
    reportCreates += 1;
    throw new Error('cancelled checks must not create a report');
  }) as typeof qualityCheckService.createReport;
  qualityCheckService.saveResult = (async () => {
    resultSaves += 1;
    throw new Error('cancelled checks must not save a report');
  }) as typeof qualityCheckService.saveResult;
  qualityCheckAiService.runCheck = (async (_input, options = {}) => {
    capturedSignal = options.signal;
    return pendingCheck;
  }) as typeof qualityCheckAiService.runCheck;

  render(
    React.createElement(CheckPanel, {
      novelId: 'novel-1',
      chapter,
      currentEditorContent: content,
      currentEditorWordCount: 320,
      currentEditorDirty: false,
      currentContentHash: 'content-hash',
      currentDraftId: draft.id,
      currentDraftVersion: draft.versionNo,
      onQcChange: (report) => publishedReports.push(report),
      hideAiModal: () => {
        modalHides += 1;
      },
    }),
  );

  await screen.findByText(/草稿 v1/);
  fireEvent.click(screen.getByTestId('quality-check-run'));
  await waitFor(() => assert.ok(capturedSignal));

  const stopButton = screen.getByTestId('quality-operation-stop');
  assert.equal(stopButton.textContent?.includes('停止当前操作'), true);
  fireEvent.click(stopButton);

  assert.equal(capturedSignal?.aborted, true);
  assert.ok(modalHides > 0);
  assert.equal(screen.queryByText(/质量检查失败/), null);
  assert.equal(reportCreates, 0);
  assert.equal(resultSaves, 0);
  assert.equal(draftCreates, 0);

  await act(async () => {
    resolveCheck({ overallScore: 88, summary: '迟到结果', items: [], aiTaskId: 'task-late' });
    await pendingCheck;
  });
  await waitFor(() => assert.equal(screen.queryByTestId('quality-operation-stop'), null));

  assert.equal(reportCreates, 0);
  assert.equal(resultSaves, 0);
  assert.equal(draftCreates, 0);
  assert.equal(screen.queryByTestId('quality-report'), null);
  assert.equal(publishedReports.some(Boolean), false);
});
