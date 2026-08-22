import assert from 'node:assert/strict';
import test from 'node:test';
import type { QualityCheckItem } from '../../types/qualityCheck';
import {
  applyLowRiskPatches,
  buildPatchCandidates,
  passesChapterQualityGate,
  shouldAttemptExternalQualityRepair,
} from './qualityGateRunner';

function mockQualityItem(overrides: Partial<QualityCheckItem>): QualityCheckItem {
  return {
    id: overrides.id || 'item-1',
    reportId: overrides.reportId || 'rep-1',
    novelId: overrides.novelId || 'novel-1',
    chapterId: overrides.chapterId || 'chapter-1',
    draftId: overrides.draftId || 'draft-1',
    issueType: overrides.issueType || 'logic',
    severity: overrides.severity || 'low',
    status: overrides.status || 'pending',
    title: overrides.title || '问题标题',
    description: overrides.description || '问题描述',
    issueKey: overrides.issueKey || 'key-1',
    quote: overrides.quote,
    suggestion: overrides.suggestion,
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
    ...overrides,
  };
}

test('buildPatchCandidates extracts quotes, suggestions and calculates risk levels', () => {
  const items: QualityCheckItem[] = [
    mockQualityItem({
      id: 'item-1',
      severity: 'low',
      status: 'pending',
      quote: '错别字',
      suggestion: '正字',
      title: '错字修正',
      description: '将错别字修正为正字',
    }),
    mockQualityItem({
      id: 'item-2',
      severity: 'critical',
      status: 'pending',
      quote: '严重设定冲突段落...',
      suggestion: '修改后的段落',
      title: '设定冲突',
      description: '重大违规',
    }),
    mockQualityItem({
      id: 'item-3',
      severity: 'low',
      status: 'resolved',
      quote: '已解决问题',
      suggestion: '已解决建议',
    }),
  ];

  const patches = buildPatchCandidates(items);
  assert.equal(patches.length, 2);
  assert.equal(patches[0].issueId, 'item-1');
  assert.equal(patches[0].riskLevel, 'low');
  assert.equal(patches[0].replacementText, '正字');

  assert.equal(patches[1].issueId, 'item-2');
  assert.equal(patches[1].riskLevel, 'high');
});

test('applyLowRiskPatches only applies low-risk patches and ignores high-risk ones', () => {
  const content = '这是一个包含错别字的测试段落，另外还有严重问题。';
  const patches = [
    {
      issueId: '1',
      severity: 'low',
      riskLevel: 'low' as const,
      quote: '错别字',
      replacementText: '正字',
      rationale: '修错字',
    },
    {
      issueId: '2',
      severity: 'high',
      riskLevel: 'high' as const,
      quote: '严重问题',
      replacementText: '安全内容',
      rationale: '重写',
    },
  ];

  const result = applyLowRiskPatches(content, patches);
  assert.equal(result.content, '这是一个包含正字的测试段落，另外还有严重问题。');
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].issueId, '1');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].issueId, '2');
});

test('passesChapterQualityGate checks score and critical/high items', () => {
  const itemsOk: QualityCheckItem[] = [
    mockQualityItem({ id: '1', severity: 'low', status: 'pending', title: '小问题' }),
  ];
  assert.equal(passesChapterQualityGate(85, itemsOk), true);
  assert.equal(passesChapterQualityGate(75, itemsOk), false);

  const itemsCritical: QualityCheckItem[] = [
    mockQualityItem({ id: '2', severity: 'critical', status: 'pending', title: '致命冲突' }),
  ];
  assert.equal(passesChapterQualityGate(90, itemsCritical), false);
});

test('shouldAttemptExternalQualityRepair enables repair only when conditions meet', () => {
  const items: QualityCheckItem[] = [
    mockQualityItem({ id: '1', severity: 'high', status: 'pending', title: '待修复' }),
  ];

  assert.equal(
    shouldAttemptExternalQualityRepair({
      beatOrchestrationEnabled: true,
      runtimeMode: 'api',
      manualReviewRequired: true,
      qualityItems: items,
      externalBeatRepairUsed: false,
    }),
    true,
  );

  assert.equal(
    shouldAttemptExternalQualityRepair({
      beatOrchestrationEnabled: false,
      runtimeMode: 'api',
      manualReviewRequired: true,
      qualityItems: items,
      externalBeatRepairUsed: false,
    }),
    false,
  );

  assert.equal(
    shouldAttemptExternalQualityRepair({
      beatOrchestrationEnabled: true,
      runtimeMode: 'mock',
      manualReviewRequired: true,
      qualityItems: items,
      externalBeatRepairUsed: false,
    }),
    false,
  );
});
