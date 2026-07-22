import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import type { QualityCheckResult } from '../../types/qualityCheck';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const qualityModule = await vite.ssrLoadModule('/src/services/quality/qualityCheckService.ts');
const qualityCheckService = qualityModule.qualityCheckService as typeof import('./qualityCheckService').qualityCheckService;

after(async () => {
  await vite.close();
});

beforeEach(() => {
  storage.clear();
});

const result: QualityCheckResult = {
  overallScore: 78,
  summary: '固定质量检查结果',
  items: [{
    issueType: 'continuity',
    severity: 'high',
    category: '连续性',
    title: '同一问题',
    description: '这个问题会在复检时再次出现。',
    quote: '固定引用',
    suggestion: '固定建议',
  }],
};

async function saveCompletedReport(draftId: string, checkedAt: string) {
  const report = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId,
    contentHash: `hash-${draftId}`,
    contentLength: 1200,
    checkedAt,
  });
  const reports = JSON.parse(storage.getItem('ai_novel_studio_quality_reports') || '[]');
  reports.find((item: { id: string }) => item.id === report.id).createdAt = checkedAt;
  storage.setItem('ai_novel_studio_quality_reports', JSON.stringify(reports));
  const saved = await qualityCheckService.saveResult({
    reportId: report.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId,
    result,
    draftVersion: Number(draftId.slice(-1)),
    contentHash: `hash-${draftId}`,
    contentLength: 1200,
    checkedAt,
    aiTaskId: 'quality-task-local',
  });
  return saved;
}

test('a repeated issue creates a new immutable item without moving the old snapshot', async () => {
  const first = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(first.report);
  assert.equal(first.items.length, 1);
  const before = structuredClone(first.items);

  const second = await saveCompletedReport('draft-2', '2026-01-02T00:00:00.000Z');
  assert.ok(second.report);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]?.issueKey, first.items[0]?.issueKey);
  assert.notEqual(second.items[0]?.id, first.items[0]?.id);

  const replay = await qualityCheckService.getItemsByReportId(first.report.id);
  assert.deepEqual(replay, before);
});

test('a newer pending report does not hide the latest completed report', async () => {
  const completed = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(completed.report);
  await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-2',
    contentHash: 'hash-draft-2',
    contentLength: 1200,
    checkedAt: '2099-01-01T00:00:00.000Z',
  });
  const reports = JSON.parse(storage.getItem('ai_novel_studio_quality_reports') || '[]');
  const pending = reports.find((report: { status: string }) => report.status === 'pending');
  pending.createdAt = '2099-01-01T00:00:00.000Z';
  storage.setItem('ai_novel_studio_quality_reports', JSON.stringify(reports));

  const latest = await qualityCheckService.getChapterIssues('chapter-1');
  assert.equal(latest.report?.id, completed.report.id);
  assert.equal(latest.report?.status, 'completed');
  assert.deepEqual(latest.items, completed.items);
});

test('superseded report issue state is read-only', async () => {
  const first = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(first.report);
  await saveCompletedReport('draft-2', '2026-01-02T00:00:00.000Z');

  await assert.rejects(
    qualityCheckService.updateIssueStatus(first.items[0].id, 'ignored'),
    /quality_issue_history_read_only/,
  );
});

test('workflow status updates do not rewrite the immutable report snapshot', async () => {
  const saved = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(saved.report);
  assert.equal(saved.items[0]?.status, 'pending');

  await qualityCheckService.updateIssueStatus(saved.items[0].id, 'resolved', '已经处理');

  const current = await qualityCheckService.getChapterIssues('chapter-1');
  assert.equal(current.items[0]?.status, 'resolved');
  assert.equal(current.items[0]?.resolutionNote, '已经处理');

  const replay = await qualityCheckService.getReportSnapshot(saved.report.id);
  assert.equal(replay.items[0]?.status, 'pending');
  assert.equal(replay.items[0]?.resolutionNote, undefined);
  assert.equal(replay.items[0]?.resolvedAt, undefined);
});

test('legacy item state is synthesized without leaking into old or new snapshots', async () => {
  const first = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(first.report);
  const second = await saveCompletedReport('draft-2', '2026-01-02T00:00:00.000Z');
  assert.ok(second.report);
  storage.removeItem('ai_novel_studio_quality_issue_states');
  const legacyItems = JSON.parse(storage.getItem('ai_novel_studio_quality_items') || '[]');
  const olderItem = legacyItems.find((item: { reportId: string }) => item.reportId === first.report?.id);
  const newerItem = legacyItems.find((item: { reportId: string }) => item.reportId === second.report?.id);
  olderItem.status = 'ignored';
  olderItem.resolutionNote = '旧版忽略原因';
  olderItem.updatedAt = '2099-01-01T00:00:00.000Z';
  newerItem.status = 'pending';
  newerItem.updatedAt = '2026-01-02T00:00:00.000Z';
  storage.setItem('ai_novel_studio_quality_items', JSON.stringify(legacyItems));

  const currentBeforeRecheck = await qualityCheckService.getChapterIssues('chapter-1');
  assert.equal(currentBeforeRecheck.items[0]?.status, 'ignored');
  assert.equal((await qualityCheckService.getReportSnapshot(first.report.id)).items[0]?.status, 'ignored');
  assert.equal((await qualityCheckService.getReportSnapshot(second.report.id)).items[0]?.status, 'pending');
  assert.equal((await qualityCheckService.getChapterIssues('chapter-1')).items[0]?.resolutionNote, '旧版忽略原因');
});

test('completed result retries require the same AI task and respect current-versus-history reads', async () => {
  const first = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  assert.ok(first.report);
  await qualityCheckService.updateIssueStatus(first.items[0].id, 'resolved');

  await assert.rejects(
    qualityCheckService.saveResult({
      reportId: first.report.id,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      draftId: 'draft-1',
      result,
      aiTaskId: 'different-quality-task',
    }),
    /quality_check_report_ai_task_mismatch/,
  );

  const currentRetry = await qualityCheckService.saveResult({
    reportId: first.report.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    result,
    aiTaskId: 'quality-task-local',
  });
  assert.equal(currentRetry.items[0]?.status, 'resolved');

  await saveCompletedReport('draft-2', '2026-01-02T00:00:00.000Z');
  const historyRetry = await qualityCheckService.saveResult({
    reportId: first.report.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    result,
    aiTaskId: 'quality-task-local',
  });
  assert.equal(historyRetry.items[0]?.status, 'pending');
});

test('a late older report cannot reset the current issue workflow state', async () => {
  const older = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    checkedAt: '2026-01-01T00:00:00.000Z',
  });
  const newer = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-2',
    checkedAt: '2026-01-02T00:00:00.000Z',
  });
  const reports = JSON.parse(storage.getItem('ai_novel_studio_quality_reports') || '[]');
  reports.find((report: { id: string }) => report.id === older.id).createdAt = '2026-01-01T00:00:00.000Z';
  reports.find((report: { id: string }) => report.id === newer.id).createdAt = '2026-01-02T00:00:00.000Z';
  storage.setItem('ai_novel_studio_quality_reports', JSON.stringify(reports));

  const savedNewer = await qualityCheckService.saveResult({
    reportId: newer.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-2',
    result,
    checkedAt: '2026-01-02T00:00:00.000Z',
    aiTaskId: 'quality-task-local-newer',
  });
  await qualityCheckService.updateIssueStatus(savedNewer.items[0].id, 'resolved');

  const savedOlder = await qualityCheckService.saveResult({
    reportId: older.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    result,
    checkedAt: '2026-01-01T00:00:00.000Z',
    aiTaskId: 'quality-task-local-older',
  });

  assert.equal(savedOlder.items[0]?.status, 'pending');
  const current = await qualityCheckService.getChapterIssues('chapter-1');
  assert.equal(current.report?.id, newer.id);
  assert.equal(current.items[0]?.status, 'resolved');
});

test('newer incomplete reports do not block the current completed workflow state', async () => {
  const baseline = await saveCompletedReport('draft-1', '2026-01-01T00:00:00.000Z');
  await qualityCheckService.updateIssueStatus(baseline.items[0].id, 'resolved');

  const current = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-2',
  });
  const newerPending = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-3',
  });
  const reports = JSON.parse(storage.getItem('ai_novel_studio_quality_reports') || '[]');
  reports.find((report: { id: string }) => report.id === current.id).createdAt = '2026-01-02T00:00:00.000Z';
  reports.find((report: { id: string }) => report.id === newerPending.id).createdAt = '2026-01-03T00:00:00.000Z';
  storage.setItem('ai_novel_studio_quality_reports', JSON.stringify(reports));

  const saved = await qualityCheckService.saveResult({
    reportId: current.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-2',
    result,
    aiTaskId: 'quality-task-local-current',
  });

  assert.equal(saved.items[0]?.status, 'pending');
  const latest = await qualityCheckService.getChapterIssues('chapter-1');
  assert.equal(latest.report?.id, current.id);
  assert.equal(latest.items[0]?.status, 'pending');
});

test('saving a result requires the persisted AI task identity', async () => {
  const report = await qualityCheckService.createReport({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
  });

  await assert.rejects(
    qualityCheckService.saveResult({
      reportId: report.id,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      draftId: 'draft-1',
      result,
      aiTaskId: '   ',
    }),
    /quality_check_ai_task_required/,
  );
  assert.equal((await qualityCheckService.getReportById(report.id))?.status, 'pending');
});
