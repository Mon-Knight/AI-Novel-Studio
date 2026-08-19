import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterDraft } from '../../types/ai';
import type {
  GetQualityCheckIssuesResult,
  QualityCheckItem,
  QualityCheckReport,
} from '../../types/qualityCheck';
import { hashTextContent } from '../../utils/contentHash';
import { draftVersionService } from '../database/draftVersionService';
import { qualityCheckService } from '../quality/qualityCheckService';
import { chapterQualityGateService } from './chapterQualityGateService';
import { qualityCheckAiService } from './qualityCheckAiService';
import { fixRunStore } from './fixRunStore';
import { qualityFixService, type QualityFixRun } from './qualityFixService';

const now = '2026-08-04T00:00:00.000Z';
const sourceContent = '林舟进入诊所，前台完成登记。\n\n他再次进入诊所，造成场景边界重复。';

function sourceDraft(): ChapterDraft {
  return {
    id: 'draft-source',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    title: '第二章',
    content: sourceContent,
    source: 'ai_generated',
    versionNo: 6,
    wordCount: 30,
    isAdopted: false,
    createdAt: now,
    updatedAt: now,
  };
}

function sourceReport(): QualityCheckReport {
  return {
    id: 'report-source',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-source',
    scope: 'current_draft',
    status: 'completed',
    overallScore: 78,
    contentHash: hashTextContent(sourceContent),
    contentLength: sourceContent.length,
    createdAt: now,
    updatedAt: now,
  };
}

function sourceIssue(): QualityCheckItem {
  const quote = '他再次进入诊所，造成场景边界重复。';
  const startOffset = sourceContent.indexOf(quote);
  return {
    id: 'item-1',
    reportId: 'report-source',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-source',
    issueType: 'continuity',
    severity: 'high',
    title: '重复进入诊所',
    description: '场景边界重复了已经完成的入诊动作。',
    quote,
    startOffset,
    endOffset: startOffset + quote.length,
    issueKey: 'qc-repeat-entry',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

function fixRun(overrides: Partial<QualityFixRun> = {}): QualityFixRun {
  return {
    id: 'fix-run-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    sourceDraftId: 'draft-source',
    sourceDraftVersion: 6,
    sourceContentHash: hashTextContent(sourceContent),
    beforeReportId: 'report-source',
    beforeScore: 78,
    beforePendingCount: 1,
    beforeSeriousCount: 1,
    fixedIssueIds: ['item-1'],
    newIssueIds: [],
    mode: 'conservative',
    status: 'success',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function completedQualityResult(target: ChapterDraft): GetQualityCheckIssuesResult {
  return {
    report: {
      id: 'report-after',
      novelId: target.novelId,
      chapterId: target.chapterId,
      draftId: target.id,
      scope: 'current_draft',
      status: 'completed',
      overallScore: 86,
      contentHash: hashTextContent(target.content),
      contentLength: target.content.length,
      createdAt: now,
      updatedAt: now,
    },
    items: [],
    statistics: {
      total: 0,
      pending: 0,
      resolved: 0,
      ignored: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };
}

test('quality gate repairs an existing scored draft without running chapter prose again', async () => {
  const originals = {
    getRuns: fixRunStore.getByChapterId,
    saveRun: fixRunStore.save,
    runFix: qualityFixService.runFix,
    createDraft: draftVersionService.create,
    runCheck: qualityCheckAiService.runCheck,
    createReport: qualityCheckService.createReport,
    saveResult: qualityCheckService.saveResult,
  };
  const savedRuns: QualityFixRun[] = [];
  let externalRepairCalls = 0;
  let draftCreates = 0;
  const quote = sourceIssue().quote as string;
  const replacement = '他沿着检查室走廊继续观察，没有重复办理入诊。';
  const revisedContent = sourceContent.replace(quote, replacement);
  const run = fixRun({ targetContentHash: hashTextContent(revisedContent) });
  try {
    fixRunStore.getByChapterId = async () => [];
    fixRunStore.save = async (item) => {
      savedRuns.push({ ...item });
      return item;
    };
    qualityFixService.runFix = async () => {
      externalRepairCalls += 1;
      return {
        fixRun: run,
        aiTaskId: 'task-quality-fix',
        scopeValidation: {
          passed: true,
          riskLevel: 'low',
          changedParagraphCount: 1,
          totalParagraphCount: 2,
          unrelatedChangedCount: 0,
          warnings: [],
        },
        fixResult: {
          mode: 'targeted_fix',
          applicationMode: 'deterministic_ranges',
          fixedIssueKeys: ['qc-repeat-entry'],
          revisionSummary: '删除重复入诊动作',
          changedRanges: [
            {
              issue_key: 'qc-repeat-entry',
              before: quote,
              after: replacement,
              reason: '消除场景边界重复',
              start_offset: sourceContent.indexOf(quote),
              end_offset: sourceContent.indexOf(quote) + quote.length,
            },
          ],
          revisedContent,
        },
      };
    };
    let target: ChapterDraft | undefined;
    draftVersionService.create = async (input) => {
      draftCreates += 1;
      assert.equal(input.operationId, 'quality-fix-draft:fix-run-1');
      assert.equal(input.aiTaskId, 'task-quality-fix');
      target = {
        ...sourceDraft(),
        id: 'draft-target',
        versionNo: 7,
        content: input.content,
        source: input.source,
        aiTaskId: input.aiTaskId,
        isAdopted: false,
      };
      return target;
    };
    qualityCheckAiService.runCheck = async () => ({
      overallScore: 86,
      summary: '重复已消除。',
      items: [],
      aiTaskId: 'task-recheck',
    });
    qualityCheckService.createReport = async (input) => ({
      id: 'report-after-placeholder',
      ...input,
      scope: input.scope ?? 'current_draft',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    qualityCheckService.saveResult = async () => completedQualityResult(target as ChapterDraft);

    const result = await chapterQualityGateService.runRepairAndRecheck({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      chapterTitle: '第二章',
      draft: sourceDraft(),
      report: sourceReport(),
      items: [sourceIssue()],
    });

    assert.equal(externalRepairCalls, 1);
    assert.equal(draftCreates, 1);
    assert.equal(result.finalDraft.id, 'draft-target');
    assert.equal(result.finalDraft.isAdopted, false);
    assert.equal(result.finalScore, 86);
    assert.equal(result.qualityGatePassed, true);
    assert.equal(result.repairResumed, false);
    assert.equal(savedRuns[savedRuns.length - 1]?.afterReportId, 'report-after');
  } finally {
    fixRunStore.getByChapterId = originals.getRuns;
    fixRunStore.save = originals.saveRun;
    qualityFixService.runFix = originals.runFix;
    draftVersionService.create = originals.createDraft;
    qualityCheckAiService.runCheck = originals.runCheck;
    qualityCheckService.createReport = originals.createReport;
    qualityCheckService.saveResult = originals.saveResult;
  }
});

test('persisted changed ranges resume locally without a second external repair call', async () => {
  const originals = {
    getRuns: fixRunStore.getByChapterId,
    saveRun: fixRunStore.save,
    runFix: qualityFixService.runFix,
    createDraft: draftVersionService.create,
    runCheck: qualityCheckAiService.runCheck,
    createReport: qualityCheckService.createReport,
    saveResult: qualityCheckService.saveResult,
  };
  const issue = sourceIssue();
  const quote = issue.quote as string;
  const replacement = '他沿着检查室走廊继续观察，没有重复办理入诊。';
  const startOffset = sourceContent.indexOf(quote);
  const run = fixRun({
    changedRangesJson: JSON.stringify([
      {
        issue_key: issue.issueKey,
        before: quote,
        after: replacement,
        reason: '消除场景边界重复',
        start_offset: startOffset,
        end_offset: startOffset + quote.length,
      },
    ]),
    targetContentHash: hashTextContent(sourceContent.replace(quote, replacement)),
  });
  let externalRepairCalls = 0;
  try {
    fixRunStore.getByChapterId = async () => [run];
    fixRunStore.save = async (item) => item;
    qualityFixService.runFix = async () => {
      externalRepairCalls += 1;
      throw new Error('must not call external repair');
    };
    let target: ChapterDraft | undefined;
    draftVersionService.create = async (input) => {
      target = {
        ...sourceDraft(),
        id: 'draft-restored',
        versionNo: 7,
        content: input.content,
        source: input.source,
        isAdopted: false,
      };
      return target;
    };
    qualityCheckAiService.runCheck = async () => ({
      overallScore: 84,
      summary: '恢复补丁后复评通过。',
      items: [],
      aiTaskId: 'task-recheck-restored',
    });
    qualityCheckService.createReport = async (input) => ({
      id: 'report-restored-placeholder',
      ...input,
      scope: input.scope ?? 'current_draft',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    qualityCheckService.saveResult = async () => completedQualityResult(target as ChapterDraft);

    const result = await chapterQualityGateService.runRepairAndRecheck({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      chapterTitle: '第二章',
      draft: sourceDraft(),
      report: sourceReport(),
      items: [issue],
    });

    assert.equal(externalRepairCalls, 0);
    assert.equal(result.repairResumed, true);
    assert.equal(result.finalDraft.content, sourceContent.replace(quote, replacement));
    assert.equal(result.finalDraft.isAdopted, false);
  } finally {
    fixRunStore.getByChapterId = originals.getRuns;
    fixRunStore.save = originals.saveRun;
    qualityFixService.runFix = originals.runFix;
    draftVersionService.create = originals.createDraft;
    qualityCheckAiService.runCheck = originals.runCheck;
    qualityCheckService.createReport = originals.createReport;
    qualityCheckService.saveResult = originals.saveResult;
  }
});

test('recheck failure keeps a durable repair candidate resumable without another repair call', async () => {
  const originals = {
    getRuns: fixRunStore.getByChapterId,
    saveRun: fixRunStore.save,
    runFix: qualityFixService.runFix,
    getDraft: draftVersionService.getById,
    createDraft: draftVersionService.create,
    runCheck: qualityCheckAiService.runCheck,
    createReport: qualityCheckService.createReport,
    saveResult: qualityCheckService.saveResult,
  };
  const quote = sourceIssue().quote as string;
  const targetContent = sourceContent.replace(
    quote,
    '他沿着检查室走廊继续观察，没有重复办理入诊。',
  );
  const target: ChapterDraft = {
    ...sourceDraft(),
    id: 'draft-durable-target',
    versionNo: 7,
    content: targetContent,
    source: 'ai_regenerated',
    isAdopted: false,
  };
  let persisted = fixRun({
    status: 'running',
    targetDraftId: target.id,
    targetDraftVersion: target.versionNo,
    targetContentHash: hashTextContent(target.content),
  });
  let repairCalls = 0;
  let draftCreates = 0;
  let checkCalls = 0;
  try {
    fixRunStore.getByChapterId = async () => [persisted];
    fixRunStore.save = async (item) => {
      persisted = { ...item };
      return persisted;
    };
    qualityFixService.runFix = async () => {
      repairCalls += 1;
      throw new Error('must not call external repair');
    };
    draftVersionService.getById = async (_chapterId, draftId) =>
      draftId === target.id ? target : null;
    draftVersionService.create = async () => {
      draftCreates += 1;
      return target;
    };
    qualityCheckAiService.runCheck = async () => {
      checkCalls += 1;
      if (checkCalls === 1) throw new Error('AI 调用失败：请求超时（300 秒）');
      return {
        overallScore: 85,
        summary: '恢复后复评通过。',
        items: [],
        aiTaskId: 'task-recheck-resumed',
      };
    };
    qualityCheckService.createReport = async (input) => ({
      id: 'report-resumed-placeholder',
      ...input,
      scope: input.scope ?? 'current_draft',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    qualityCheckService.saveResult = async () => completedQualityResult(target);

    const source = {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      chapterTitle: '第二章',
      draft: sourceDraft(),
      report: sourceReport(),
      items: [sourceIssue()],
    };
    await assert.rejects(chapterQualityGateService.runRepairAndRecheck(source), /请求超时/);
    assert.equal(persisted.status, 'running');
    assert.equal(persisted.targetDraftId, target.id);
    assert.match(persisted.failureReason ?? '', /质量复评失败/);

    const result = await chapterQualityGateService.runRepairAndRecheck(source);
    assert.equal(result.repairResumed, true);
    assert.equal(result.finalDraft.id, target.id);
    assert.equal(result.finalScore, 86);
    assert.equal(repairCalls, 0);
    assert.equal(draftCreates, 0);
    assert.equal(checkCalls, 2);
    assert.equal(persisted.status, 'success');
    assert.equal(persisted.failureReason, undefined);
  } finally {
    fixRunStore.getByChapterId = originals.getRuns;
    fixRunStore.save = originals.saveRun;
    qualityFixService.runFix = originals.runFix;
    draftVersionService.getById = originals.getDraft;
    draftVersionService.create = originals.createDraft;
    qualityCheckAiService.runCheck = originals.runCheck;
    qualityCheckService.createReport = originals.createReport;
    qualityCheckService.saveResult = originals.saveResult;
  }
});
