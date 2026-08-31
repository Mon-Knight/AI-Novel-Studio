import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, countTextWords, sha256 } from './analyze-real-conversation-manuscript.mjs';

const MODEL = { providerId: 'openai_compatible', modelId: 'gpt-5.6-luna' };
const CONVERSATION_ID = 'conversation-full';
const FIRST_INSTRUCTION = '写个六万字左右的悬疑故事。';
const REQUIRED_SPARSE_SOURCES = [
  'chapter_outline',
  'novel',
  'output_profile',
  'protagonist',
  'rule_system',
  'style_profile',
  'world_setting',
];

function providerEvidence(chapterNumber) {
  const statuses = Object.fromEntries(
    [
      ...REQUIRED_SPARSE_SOURCES,
      'user_instruction',
      ...(chapterNumber > 1 ? ['adopted_chapter'] : []),
    ].map((sourceType) => [sourceType, 'included']),
  );
  statuses.chapter_event = 'omitted_empty';
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
    generationSourceStatuses: statuses,
  };
}

function chapterEvidence(chapterNumber, priorAdoptedHash = '') {
  const instruction = chapterNumber === 1 ? FIRST_INSTRUCTION : '继续写';
  const candidateContent = `第${chapterNumber}章正文。线索继续推进，人物作出新的选择。`;
  const adoptedContent = `${candidateContent}\n`;
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
    instructionHash: sha256(instruction),
    snapshotSourceTypes: [
      ...REQUIRED_SPARSE_SOURCES,
      ...(chapterNumber > 1 ? ['adopted_chapter'] : []),
    ],
    continuitySourceHash: priorAdoptedHash,
    providerRequestEvidence: providerEvidence(chapterNumber),
    targetWordCount: 3_000,
    originalWordCount: countTextWords(adoptedContent),
    lengthRepairCount: 0,
    integrityRepairCount: 0,
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
    memorySourceTypes: ['adopted_draft', 'chapter_summary', 'context_record'],
  };
}

function fullEvidence() {
  const first = chapterEvidence(1);
  const second = chapterEvidence(2, first.adoptedHash);
  const chapters = [first, second];
  const totalWordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const instructionHash = sha256(FIRST_INSTRUCTION);
  return {
    evidenceSchemaVersion: 'real_conversation_acceptance_evidence_v6',
    candidateIntegrityContractVersion: 'chapter_candidate_integrity_v4',
    status: 'passed',
    failureStage: null,
    failureReason: '',
    model: MODEL,
    scenario: 'sparse-idea',
    conversationId: CONVERSATION_ID,
    userInstructions: [FIRST_INSTRUCTION, '继续写'],
    plannedChapterCount: chapters.length,
    plannedTargetWordCount: 6_000,
    chapterCount: chapters.length,
    completedChapterCount: chapters.length,
    totalWordCount,
    independentWordCount: totalWordCount,
    chapterWordCountSum: totalWordCount,
    novelWordCount: totalWordCount,
    bookWordGoal: {
      sourceContentSha256: instructionHash,
      targetWords: 6_000,
    },
    storyPlanApplyEvidence: {
      frozenSource: { contentSha256: instructionHash },
      applyResult: 'applied',
      rootTargetWordCount: 6_000,
      chapterTargetWordCountSum: 6_000,
    },
    analysisMaterial: {
      schemaVersion: 'real_conversation_analysis_material_v1',
      formalAssets: {
        primaryWorldSettingId: 'world-1',
        worldSettings: [{ id: 'world-1', title: '雾港', content: '雾港的旧钟记录每次退潮时刻。' }],
        ruleSystems: [
          { id: 'rule-1', title: '潮汐规则', content: '只有退潮后才能进入旧港档案室。' },
        ],
        protagonists: [{ name: '沈岚', identity: '档案修复师' }],
      },
      chapters: chapters.map((chapter) => ({
        chapter: chapter.chapter,
        chapterId: chapter.chapterId,
        summary: {
          id: chapter.summaryId,
          summary: `第 ${chapter.chapter} 章线索继续推进。`,
          protagonistStateChange: JSON.stringify(`沈岚完成第 ${chapter.chapter} 次调查。`),
          newItemsOrAbilities: JSON.stringify([`线索物件 ${chapter.chapter}`]),
          newForeshadows: JSON.stringify([`伏笔 ${chapter.chapter}`]),
          resolvedForeshadows: JSON.stringify([]),
        },
        contextRecords: [
          {
            id: `context-${chapter.chapter}`,
            contextType: 'chapter_summary',
            title: `第 ${chapter.chapter} 章摘要`,
            content: `第 ${chapter.chapter} 章的正式上下文。`,
            importance: 5,
          },
        ],
      })),
    },
    chapters,
  };
}

test('accepts complete Full v6 evidence and allows omitted optional Provider sources', () => {
  const report = analyze(fullEvidence(), 'real-conversation-evidence.json');

  assert.equal(report.evidenceSummary.fullBookEvidence, true);
  assert.equal(report.sourceChain.passed, true);
  assert.deepEqual(report.sourceChain.chapters[0].optionalOmittedProviderSources, [
    { type: 'chapter_event', status: 'omitted_empty' },
  ]);
  assert.equal(report.sourceChain.chapters[0].checks.criticalProviderSourcesIncluded, true);
  const coverage = new Map(
    report.coverage.dimensions.map((dimension) => [dimension.dimension, dimension.status]),
  );
  assert.equal(coverage.get('source_hash_chain'), 'verified');
  assert.equal(coverage.get('timeline'), 'heuristic_candidate');
  assert.equal(coverage.get('world_rules'), 'heuristic_candidate');
  assert.equal(coverage.get('character_state'), 'structured_summary_candidate');
  assert.equal(coverage.get('object_lifecycle'), 'structured_summary_candidate');
  assert.equal(coverage.get('foreshadowing'), 'structured_summary_candidate');
  assert.equal(report.semanticEvidence.formalAssets.primaryWorldSettingId, 'world-1');
  assert.equal(report.semanticEvidence.chapterStateTimeline.length, 2);
  assert.ok(report.limitations.some((item) => item.code === 'provider_payload_opaque'));
});

test('uses the prepared-assets v6 critical-source contract without sparse-plan checks', () => {
  const evidence = fullEvidence();
  evidence.scenario = 'prepared-assets';
  evidence.userInstructions[0] = '生成本章正文';
  evidence.chapters[0].instructionHash = sha256(evidence.userInstructions[0]);
  delete evidence.bookWordGoal;
  delete evidence.storyPlanApplyEvidence;
  for (const chapter of evidence.chapters) {
    chapter.snapshotSourceTypes = chapter.snapshotSourceTypes.map((sourceType) =>
      sourceType === 'rule_system' ? 'reference_material' : sourceType,
    );
    delete chapter.providerRequestEvidence.generationSourceStatuses.rule_system;
    chapter.providerRequestEvidence.generationSourceStatuses.reference_material = 'included';
  }

  const report = analyze(evidence, 'real-conversation-evidence.json');
  assert.equal(report.sourceChain.passed, true);
  assert.ok(
    report.sourceChain.chapters.every((chapter) =>
      chapter.requiredProviderSources.includes('reference_material'),
    ),
  );
  assert.equal(
    Object.hasOwn(report.sourceChain.planning.checks, 'firstInstructionMatchesBookGoalHash'),
    false,
  );
});

test('rejects evidence that is not a complete passing v6 Full run', async (context) => {
  const cases = [
    {
      name: 'evidence schema',
      mutate: (evidence) => {
        evidence.evidenceSchemaVersion = 'real_conversation_acceptance_evidence_v5';
      },
      error: /EVIDENCE_FINAL_SCHEMA_UNSUPPORTED/,
    },
    {
      name: 'candidate contract',
      mutate: (evidence) => {
        evidence.candidateIntegrityContractVersion = 'chapter_candidate_integrity_v3';
      },
      error: /EVIDENCE_FINAL_CANDIDATE_CONTRACT_UNSUPPORTED/,
    },
    {
      name: 'failed outcome',
      mutate: (evidence) => {
        evidence.status = 'failed';
      },
      error: /EVIDENCE_FINAL_NOT_PASSED/,
    },
    {
      name: 'incomplete chapter count',
      mutate: (evidence) => {
        evidence.plannedChapterCount += 1;
      },
      error: /EVIDENCE_FINAL_INCOMPLETE/,
    },
    {
      name: 'non-contiguous chapter numbers',
      mutate: (evidence) => {
        evidence.chapters[1].chapter = 3;
      },
      error: /EVIDENCE_FINAL_CHAPTER_SEQUENCE_INVALID/,
    },
    {
      name: 'duplicate chapter identity',
      mutate: (evidence) => {
        evidence.chapters[1].chapterId = evidence.chapters[0].chapterId;
      },
      error: /EVIDENCE_FINAL_ID_DUPLICATE/,
    },
    {
      name: 'top-level word ledger mismatch',
      mutate: (evidence) => {
        evidence.novelWordCount += 1;
      },
      error: /EVIDENCE_FINAL_WORD_LEDGER_MISMATCH/,
    },
  ];

  for (const item of cases) {
    await context.test(item.name, () => {
      const evidence = fullEvidence();
      item.mutate(evidence);
      assert.throws(() => analyze(evidence, 'evidence.json'), item.error);
    });
  }
});

test('reports a source-chain failure when a critical Provider source is omitted', () => {
  const evidence = fullEvidence();
  evidence.chapters[1].providerRequestEvidence.generationSourceStatuses.adopted_chapter =
    'omitted_budget';

  const report = analyze(evidence, 'real-conversation-evidence.json');
  assert.equal(report.sourceChain.passed, false);
  assert.deepEqual(report.sourceChain.chapters[1].criticalProviderSourceFailures, [
    { type: 'adopted_chapter', status: 'omitted_budget' },
  ]);
  assert.ok(
    report.sourceChain.issues.some(
      (issue) => issue.chapter === 2 && issue.check === 'criticalProviderSourcesIncluded',
    ),
  );
});

test('reports a source-chain failure when a critical snapshot source is missing', () => {
  const evidence = fullEvidence();
  evidence.chapters[1].snapshotSourceTypes = evidence.chapters[1].snapshotSourceTypes.filter(
    (sourceType) => sourceType !== 'adopted_chapter',
  );

  const report = analyze(evidence, 'real-conversation-evidence.json');
  assert.equal(report.sourceChain.passed, false);
  assert.deepEqual(report.sourceChain.chapters[1].missingSnapshotSources, ['adopted_chapter']);
  assert.ok(
    report.sourceChain.issues.some(
      (issue) => issue.chapter === 2 && issue.check === 'requiredSnapshotSourcesPresent',
    ),
  );
});
