import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCheckpointReport,
  candidateCompatibility,
  renderCheckpointManuscript,
  writeCheckpointArtifacts,
} from './analyze-real-conversation-checkpoint.mjs';
import { countTextWords, sha256 } from './analyze-real-conversation-manuscript.mjs';

const MODEL = { providerId: 'openai_compatible', modelId: 'gpt-5.6-luna' };
const CONVERSATION_ID = 'conversation-checkpoint';
const FIRST_INSTRUCTION = '写个六万字左右的悬疑故事。';
const REQUIRED_SOURCES = [
  'chapter_outline',
  'novel',
  'output_profile',
  'protagonist',
  'rule_system',
  'style_profile',
  'world_setting',
];

function providerEvidence(chapterNumber) {
  const sourceTypes = [
    ...REQUIRED_SOURCES,
    'user_instruction',
    ...(chapterNumber > 1 ? ['adopted_chapter'] : []),
  ];
  return {
    schemaVersion: 'workbench_provider_request_evidence_v1',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    taskId: `task-${chapterNumber}`,
    attemptId: `attempt-${chapterNumber}`,
    messageCount: 2,
    messagesSha256: 'a'.repeat(64),
    compiledContextSha256: 'b'.repeat(64),
    snapshotContextHash: 'txt_12345678',
    snapshotCompiledPromptSha256: 'c'.repeat(64),
    snapshotRequestSourceSha256: 'd'.repeat(64),
    includedSnapshotRequestSourceSha256: 'd'.repeat(64),
    snapshotRequestSourceStatus: 'included',
    providerSourceStatus: 'included',
    generationSourceStatuses: Object.fromEntries(
      [...sourceTypes, ['chapter_event', 'omitted_empty']].map((row) =>
        Array.isArray(row) ? row : [row, 'included'],
      ),
    ),
  };
}

function passedChapter(chapterNumber, priorAdoptedHash = '', trailingLfOnly = false) {
  const candidateContent = `第${chapterNumber}章正文包含足够多的线索、档案和人物选择。`;
  const adoptedContent = trailingLfOnly ? `${candidateContent}\n` : candidateContent;
  const candidateHash = sha256(candidateContent);
  const adoptedHash = sha256(adoptedContent);
  const artifactId = `artifact-${chapterNumber}`;
  return {
    chapter: chapterNumber,
    status: 'passed',
    model: MODEL,
    chapterId: `chapter-${chapterNumber}`,
    chapterTitle: `第 ${chapterNumber} 章`,
    chapterOutline: `推进第 ${chapterNumber} 章线索`,
    chapterGoal: `完成第 ${chapterNumber} 章目标`,
    conversationId: CONVERSATION_ID,
    artifactId,
    instructionHash: sha256(chapterNumber === 1 ? FIRST_INSTRUCTION : '继续写'),
    snapshotSourceTypes: [...REQUIRED_SOURCES, ...(chapterNumber > 1 ? ['adopted_chapter'] : [])],
    continuitySourceHash: priorAdoptedHash,
    providerRequestEvidence: providerEvidence(chapterNumber),
    targetWordCount: 3_000,
    artifactCandidateIntegrityCheck: {
      checker: 'inspectChapterCandidateIntegrity',
      source: 'persisted_result_artifact',
      executed: true,
      passed: true,
      artifactId,
      artifactContentSha256: candidateHash,
      issueCodes: [],
    },
    wordCount: countTextWords(adoptedContent),
    candidateHash,
    adoptedHash,
    adoptedContent,
    summaryTurnId: `summary-turn-${chapterNumber}`,
    summaryRunId: `summary-run-${chapterNumber}`,
    summaryArtifactId: `summary-artifact-${chapterNumber}`,
    summaryApplyTransactionId: `summary-transaction-${chapterNumber}`,
    summaryId: `summary-${chapterNumber}`,
    summaryExecutionEvidence: {
      sessionId: `session-summary-${chapterNumber}`,
      messageCounts: [2, 5, 7],
      providerUsage: { unit: 'tokens', input: 100 + chapterNumber },
    },
    contextRecordCount: 3,
    memorySourceTypes: ['adopted_draft', 'chapter_summary', 'context_record'],
    error: '',
  };
}

function fixture() {
  const first = passedChapter(1);
  const second = passedChapter(2, first.adoptedHash, true);
  const failed = {
    chapter: 3,
    status: 'failed',
    chapterTitle: '第 3 章',
    wordCount: 12,
    adoptedContent: '失败章不应进入正文。',
    error: 'summary timeout',
  };
  const chapters = [first, second, failed];
  const totalWordCount = first.wordCount + second.wordCount;
  const instructionHash = sha256(FIRST_INSTRUCTION);
  return {
    evidenceSchemaVersion: 'real_conversation_acceptance_evidence_v6',
    candidateIntegrityContractVersion: 'chapter_candidate_integrity_v4',
    status: 'failed',
    failureStage: 'chapter_execution',
    failureReason: 'renderer timeout',
    model: MODEL,
    scenario: 'sparse-idea',
    conversationId: CONVERSATION_ID,
    userInstructions: [FIRST_INSTRUCTION, '继续写', '继续写'],
    plannedChapterCount: 20,
    plannedTargetWordCount: 60_000,
    completedChapterCount: 2,
    totalWordCount,
    independentWordCount: 0,
    chapterWordCountSum: 0,
    novelWordCount: 0,
    bookWordGoal: { sourceContentSha256: instructionHash, targetWords: 60_000 },
    storyPlanApplyEvidence: {
      frozenSource: { contentSha256: instructionHash },
      applyResult: 'applied',
      rootTargetWordCount: 60_000,
      chapterTargetWordCountSum: 60_000,
    },
    analysisMaterial: null,
    chapterCount: 20,
    chapters,
  };
}

test('builds an honest failed-after-checkpoint report from the contiguous passed prefix', () => {
  const evidence = fixture();
  const targetWords = evidence.totalWordCount;
  const sourceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const report = buildCheckpointReport(
    evidence,
    'real-conversation-evidence.json',
    targetWords,
    sourceText,
  );

  assert.equal(report.sourceEvidenceStatus, 'failed_after_checkpoint');
  assert.equal(report.sourceEvidence.originalStatus, 'failed');
  assert.equal(report.sourceEvidence.originalEvidenceWasModified, false);
  assert.equal(report.checkpoint.completedChapterCount, 2);
  assert.equal(report.checkpoint.wordCount, targetWords);
  assert.deepEqual(report.checkpoint.includedChapterNumbers, [1, 2]);
  assert.deepEqual(
    report.checkpoint.excludedChapters.map((row) => row.chapter),
    [3],
  );
  assert.equal(report.validation.passed, true);
  assert.equal(report.validation.legacyAnalyzerDiagnostic.trailingLfOnlyIssueCount, 1);
  assert.equal(report.validation.legacyAnalyzerDiagnostic.otherIssueCount, 0);
});

test('distinguishes exact candidate identity from a trailing-LF-only adoption', () => {
  const evidence = fixture();
  assert.equal(candidateCompatibility(evidence.chapters[0]).mode, 'exact_match');
  assert.equal(candidateCompatibility(evidence.chapters[1]).mode, 'trailing_lf_only');
});

test('rejects a failed run whose completed prefix is below the requested target', () => {
  const evidence = fixture();
  assert.throws(
    () => buildCheckpointReport(evidence, 'evidence.json', evidence.totalWordCount + 1),
    /CHECKPOINT_TARGET_NOT_REACHED/u,
  );
});

test('renders and writes only passed chapters while preserving the source evidence', () => {
  const evidence = fixture();
  const targetWords = evidence.totalWordCount;
  const sourceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const report = buildCheckpointReport(
    evidence,
    'real-conversation-evidence.json',
    targetWords,
    sourceText,
  );
  const manuscript = renderCheckpointManuscript(report, evidence.chapters.slice(0, 2));
  assert.match(manuscript, /sourceEvidenceStatus: failed_after_checkpoint/u);
  assert.match(manuscript, /# 第 1 章/u);
  assert.doesNotMatch(manuscript, /失败章不应进入正文/u);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-checkpoint-'));
  const evidencePath = path.join(outDir, 'real-conversation-evidence.json');
  fs.writeFileSync(evidencePath, sourceText, 'utf8');
  const originalSha256 = sha256(fs.readFileSync(evidencePath, 'utf8'));
  const result = writeCheckpointArtifacts({ evidencePath, outDir, targetWords });
  assert.equal(sha256(fs.readFileSync(evidencePath, 'utf8')), originalSha256);
  assert.equal(result.report.validation.sourceEvidenceSha256Unchanged, true);
  assert.equal(fs.existsSync(result.manuscriptPath), true);
  assert.equal(fs.existsSync(result.analysisPath), true);
  assert.doesNotMatch(fs.readFileSync(result.manuscriptPath, 'utf8'), /失败章不应进入正文/u);
});
