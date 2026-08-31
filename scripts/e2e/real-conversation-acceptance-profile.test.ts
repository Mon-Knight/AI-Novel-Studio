import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  assertRealConversationBuiltInProfileSelection,
  assertCurrentRealConversationPassingEvidence,
  assertGateInstructionContract,
  assertRealConversationAcceptanceEvidenceOutcome,
  assertSecretAbsent,
  buildRealConversationInstructions,
  createRealConversationStoryPlanApplyEvidence,
  environmentWithoutRealCredential,
  findRealConversationLocalDecisionReply,
  findRealConversationFixtureLeaks,
  isAutomaticSummaryProtocolRecoveryError,
  isRealConversationAcceptanceFailureStage,
  isRetryableAutomaticAssetPreflightFailure,
  isRetryableRealAcceptanceRunFailure,
  isTransientRealAcceptanceProviderFailure,
  parseRealConversationStoryPlan,
  parseRealConversationGenerationSnapshot,
  persistedGenerationArtifactCountForFailedRun,
  preparedRealConversationChapterCount,
  readRealConversationAcceptanceProfile,
  recordRealConversationStoryPlanApplyFailure,
  recordRealConversationStoryPlanApplySuccess,
  REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
  REAL_ACCEPTANCE_AUTOMATIC_ASSET_PREFLIGHT_RETRY_ERROR_CODE,
  REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR,
  REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE,
  REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE,
  REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
  REAL_ACCEPTANCE_FAILURE_STAGES,
  REAL_ACCEPTANCE_GATE_INSTRUCTIONS,
  REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT,
  REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES,
  REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS,
  REAL_ACCEPTANCE_PREPARED_FULL_CHAPTER_COUNT,
  REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES,
  REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION,
  REAL_ACCEPTANCE_SPARSE_IDEA,
  REAL_ACCEPTANCE_ENV,
  resolveRealConversationRunChapterCount,
  shouldPreseedRealAcceptanceStoryAssets,
  type RealConversationAcceptanceEvidenceOutcome,
  type RealConversationAcceptanceFailureStage,
  type RealConversationAutomaticAssetPreflightRetryEvidence,
} from './real-conversation-acceptance-profile.ts';

const validEnvironment = (): NodeJS.ProcessEnv => ({
  [REAL_ACCEPTANCE_ENV.enabled]: '1',
  [REAL_ACCEPTANCE_ENV.baseUrl]: 'http://localhost:12074/v1',
  [REAL_ACCEPTANCE_ENV.model]: 'acceptance-model',
  [REAL_ACCEPTANCE_ENV.apiKey]: 'acceptance-credential-value',
});

test('attributes a local decision reply across an atomic automatic-summary follow-up', () => {
  const reply = findRealConversationLocalDecisionReply(
    [
      {
        turnId: 'decision-turn',
        role: 'user',
        content: '采用本章正文候选',
        createdAt: '2026-08-31T00:00:00.000Z',
      },
      {
        turnId: 'summary-follow-up',
        role: 'user',
        content: '总结本章',
        createdAt: '2026-08-31T00:00:00.010Z',
      },
      {
        turnId: 'decision-reply',
        role: 'assistant',
        content: '本章候选已采用为正式正文，系统正在准备章节总结。',
        createdAt: '2026-08-31T00:00:00.020Z',
      },
      {
        turnId: 'provider-reply',
        role: 'assistant',
        content: '章节总结候选已生成。',
        createdAt: '2026-08-31T00:00:01.000Z',
      },
    ],
    'decision-turn',
    '2026-08-31T00:00:00.030Z',
  );

  assert.equal(reply?.turnId, 'decision-reply');
});

test('does not attribute a provider reply created after the local decision completed', () => {
  const reply = findRealConversationLocalDecisionReply(
    [
      {
        turnId: 'decision-turn',
        role: 'user',
        content: '采用本章正文候选',
        createdAt: '2026-08-31T00:00:00.000Z',
      },
      {
        turnId: 'provider-reply',
        role: 'assistant',
        content: '章节总结候选已生成。',
        createdAt: '2026-08-31T00:00:01.000Z',
      },
    ],
    'decision-turn',
    '2026-08-31T00:00:00.030Z',
  );

  assert.equal(reply, undefined);
});

function automaticAssetPreparationEvidence(
  asset: 'world_setting' | 'protagonist' | 'story_plan',
  index: number,
) {
  const instructions = {
    world_setting: '生成世界与规则设定候选',
    protagonist: '生成主角候选',
    story_plan: '生成全书规划候选',
  } as const;
  const goals = {
    world_setting: `${instructions.world_setting}。`,
    protagonist: `${instructions.protagonist}。`,
    story_plan: `${instructions.story_plan}。`,
  } as const;
  const artifactTypes = {
    world_setting: 'setting_candidates',
    protagonist: 'character_candidates',
    story_plan: 'outline',
  } as const;
  const toolNames = {
    world_setting: 'expand_settings',
    protagonist: 'generate_characters',
    story_plan: 'generate_outline',
  } as const;
  const goal = goals[asset];
  const goalHash = createHash('sha256').update(goal, 'utf8').digest('hex');
  const requestIdHash = createHash('sha256')
    .update(`provider-request-${index}`, 'utf8')
    .digest('hex');
  const projectionMessagesHash = createHash('sha256')
    .update(`projection-${asset}`, 'utf8')
    .digest('hex');
  const providerMessagesHash = createHash('sha256')
    .update(`provider-${asset}`, 'utf8')
    .digest('hex');
  const sparseHash = createHash('sha256').update(REAL_ACCEPTANCE_SPARSE_IDEA, 'utf8').digest('hex');
  return {
    chapter: 1,
    asset,
    goal,
    goalSha256: goalHash,
    goalLength: goal.length,
    turnId: `automatic-turn-${index}`,
    turnOrigin: 'workbench_asset_preparation' as const,
    runId: `automatic-run-${index}`,
    artifactId: `automatic-artifact-${index}`,
    artifactType: artifactTypes[asset],
    toolName: toolNames[asset],
    toolAttemptCount: 1,
    failedToolAttemptCount: 0,
    retryCount: 0,
    attempts: [
      {
        attempt: 1,
        runId: `automatic-run-${index}`,
        status: 'completed' as const,
        error: '',
      },
    ],
    applyTransactionId: `automatic-apply-${index}`,
    conflictCode: '' as const,
    postRunProjectionEvidence: {
      schemaVersion: 'workbench_dsh_post_run_projection_evidence_v1' as const,
      scope: 'post_run_artifact_projection' as const,
      hashAlgorithm: 'sha256' as const,
      messagesSerialization: 'json_stringify_messages_v1' as const,
      taskId: `task-${index}`,
      attemptId: `attempt-${index}`,
      providerRequestIdSha256: requestIdHash,
      inputType: 'workbench_dsh_messages_v1' as const,
      bodySha256: createHash('sha256').update(`body-${index}`, 'utf8').digest('hex'),
      messagesSha256: projectionMessagesHash,
      messageCount: 1 as const,
      projectedTurnContentSha256: createHash('sha256')
        .update(`${goal}:workbench_asset_preparation`, 'utf8')
        .digest('hex'),
      decodedGoalSha256: goalHash,
      turnOrigin: 'workbench_asset_preparation' as const,
    },
    actualProviderRequestEvidence: {
      schemaVersion: REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION,
      captureMode: 'hash_only' as const,
      hashAlgorithm: 'sha256' as const,
      messagesSerialization: 'json_stringify_messages_v1' as const,
      providerRequestIdSha256: requestIdHash,
      requestBodySha256: createHash('sha256').update(`request-body-${index}`, 'utf8').digest('hex'),
      messagesSha256: providerMessagesHash,
      messageCount: 2,
      messageTextSha256: createHash('sha256').update(`message-text-${index}`, 'utf8').digest('hex'),
      messageTextCount: 4,
      latestUserMessageSha256: createHash('sha256')
        .update(`latest-user-${index}`, 'utf8')
        .digest('hex'),
      latestUserMessageLength: goal.length + 100,
      classification: 'automatic_asset_preparation' as const,
      turnOrigin: 'workbench_asset_preparation' as const,
      assetKind: asset,
      creativeBriefParseStatus: 'valid' as const,
      creativeBrief: {
        schema: 'ans_core_asset_creative_brief_v1' as const,
        source: 'original_user_goal' as const,
        contentSha256: sparseHash,
        contentLength: REAL_ACCEPTANCE_SPARSE_IDEA.length,
      },
      creativeBriefMarkerCount: 1,
      latestUserCreativeBriefMarkerCount: 1 as const,
      configuredPreparedFixtureCanaryIds: REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES.map(
        (canary) => canary.id,
      ),
      matchedPreparedFixtureCanaryIds: [] as string[],
      rawMessageContentPersisted: false as const,
    },
  };
}

function automaticAssetPreflightRetryEvidence(
  preparation: ReturnType<typeof automaticAssetPreparationEvidence>,
  _index: number,
  retryAttempt: 1 | 2,
): RealConversationAutomaticAssetPreflightRetryEvidence {
  return {
    chapter: preparation.chapter,
    asset: preparation.asset,
    goalSha256: preparation.goalSha256,
    turnId: preparation.turnId,
    turnOrigin: 'workbench_asset_preparation',
    model: { providerId: 'openai_compatible', modelId: 'acceptance-model' },
    retryAttempt,
    errorCode: REAL_ACCEPTANCE_AUTOMATIC_ASSET_PREFLIGHT_RETRY_ERROR_CODE,
    runId: null,
  };
}

const currentPassingEvidence = () => {
  const candidateHash = 'a'.repeat(64);
  const providerHash = 'b'.repeat(64);
  const adoptedContent = '潮'.repeat(800);
  const adoptedHash = createHash('sha256').update(adoptedContent, 'utf8').digest('hex');
  return {
    evidenceSchemaVersion: REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
    candidateIntegrityContractVersion: REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
    status: 'passed' as const,
    failureStage: null,
    failureReason: '' as const,
    model: { providerId: 'openai_compatible', modelId: 'acceptance-model' },
    scenario: 'sparse-idea',
    conversationId: 'conversation-1',
    userInstructions: [REAL_ACCEPTANCE_SPARSE_IDEA],
    creativeUserTurns: [
      {
        sequence: 1,
        turnId: 'turn-1',
        source: 'user' as const,
        classification: 'initial_creative_brief' as const,
        contentSha256: createHash('sha256')
          .update(REAL_ACCEPTANCE_SPARSE_IDEA, 'utf8')
          .digest('hex'),
        contentLength: REAL_ACCEPTANCE_SPARSE_IDEA.length,
      },
    ],
    userTurnCount: 1,
    automaticAssetPreparationTurnCount: 3,
    automaticAssetPreparations: [
      automaticAssetPreparationEvidence('world_setting', 1),
      automaticAssetPreparationEvidence('protagonist', 2),
      automaticAssetPreparationEvidence('story_plan', 3),
    ],
    automaticAssetPreflightRetries: [] as RealConversationAutomaticAssetPreflightRetryEvidence[],
    automaticChapterSummaryTurnCount: 1,
    runCount: 5,
    artifactCount: 5,
    plannedChapterCount: 14,
    plannedTargetWordCount: 60_000,
    chapterCount: 1,
    completedChapterCount: 1,
    totalWordCount: 800,
    independentWordCount: 800,
    chapterWordCountSum: 800,
    novelWordCount: 800,
    storyPlanApplyEvidence: {
      artifactId: 'story-plan-1',
      rootTargetWordCount: 60_000,
      chapterTargetWordCountSum: 60_000,
      frozenTarget: { target: 60_000, minimum: 54_000, maximum: 66_000 },
      frozenSource: {
        turnId: 'turn-1',
        turnSequence: 0,
        contentSha256: providerHash,
      },
      applyResult: 'applied' as const,
      applyTransactionId: 'apply-story-plan-1',
      applyErrorCode: null,
    },
    analysisMaterial: {
      schemaVersion: 'real_conversation_analysis_material_v1',
      formalAssets: {
        primaryWorldSettingId: 'world-1',
        worldSettings: [{ id: 'world-1', title: '潮港', content: '潮汐决定旧港开放时间。' }],
        ruleSystems: [{ id: 'rule-1', title: '潮汐规则', content: '退潮后才能进入旧港。' }],
        protagonists: [{ name: '沈岚', identity: '档案修复师' }],
      },
      chapters: [
        {
          chapter: 1,
          chapterId: 'chapter-1',
          summary: { id: 'summary-1', summary: '沈岚在旧港发现时间记录矛盾。' },
          contextRecords: [
            {
              id: 'context-1',
              contextType: 'chapter_summary',
              title: '第一章摘要',
              content: '沈岚发现潮汐记录异常。',
              importance: 5,
            },
          ],
        },
      ],
    },
    chapters: [
      {
        chapter: 1,
        status: 'passed' as const,
        model: { providerId: 'openai_compatible', modelId: 'acceptance-model' },
        chapterId: 'chapter-1',
        conversationId: 'conversation-1',
        chapterTitle: '第一章 潮声',
        chapterOutline: '主角在旧港发现时间记录矛盾。',
        chapterGoal: '建立核心悬念。',
        artifactId: 'artifact-1',
        candidateHash,
        adoptedHash,
        adoptedContent,
        continuitySourceHash: '',
        targetWordCount: 800,
        originalWordCount: 800,
        wordCount: 800,
        lengthRepairCount: 0,
        integrityRepairCount: 0,
        integrityRepairAttempts: [],
        summaryTurnId: 'summary-turn-1',
        summaryRunId: 'summary-run-1',
        summaryArtifactId: 'summary-artifact-1',
        summaryApplyTransactionId: 'summary-apply-1',
        summaryId: 'summary-1',
        summaryStartRetryCount: 0,
        summaryStartRecoveries: [],
        summaryRetryCount: 0,
        summaryAttempts: [
          {
            attempt: 1,
            runId: 'summary-run-1',
            status: 'completed' as const,
            error: '',
          },
        ],
        summaryExecutionEvidence: {
          sessionId: `session-summary-${'1'.repeat(32)}`,
          messageCounts: [2, 5, 5, 7],
          providerUsage: { unit: 'tokens' as const, input: 1_024 },
        },
        contextRecordCount: 3,
        memorySourceTypes: ['adopted_draft', 'chapter_summary', 'context_record'],
        snapshotSourceTypes: [
          'novel',
          'world_setting',
          'rule_system',
          'protagonist',
          'chapter_outline',
          'style_profile',
          'output_profile',
        ],
        providerRequestEvidence: {
          schemaVersion: 'workbench_provider_request_evidence_v1' as const,
          hashAlgorithm: 'sha256' as const,
          messagesSerialization: 'json_stringify_messages_v1' as const,
          taskId: 'provider-task-1',
          attemptId: 'provider-attempt-1',
          messageCount: 2,
          messagesSha256: providerHash,
          compiledContextSha256: providerHash,
          snapshotContextHash: 'txt_deadbeef',
          snapshotCompiledPromptSha256: providerHash,
          snapshotRequestSourceSha256: providerHash,
          includedSnapshotRequestSourceSha256: providerHash,
          snapshotRequestSourceStatus: 'included' as const,
          providerSourceStatus: 'included' as const,
          generationSourceStatuses: {
            novel: 'included',
            world_setting: 'included',
            rule_system: 'included',
            protagonist: 'included',
            chapter_outline: 'included',
            style_profile: 'included',
            output_profile: 'included',
            user_instruction: 'included',
          },
        },
        artifactCandidateIntegrityCheck: {
          checker: 'inspectChapterCandidateIntegrity' as const,
          source: 'persisted_result_artifact' as const,
          executed: true,
          passed: true,
          artifactId: 'artifact-1',
          artifactContentSha256: candidateHash,
          issueCodes: [] as string[],
        },
      },
    ],
  };
};

const currentTwoChapterPassingEvidence = () => {
  const evidence = currentPassingEvidence();
  const firstChapter = evidence.chapters[0]!;
  const secondChapter = structuredClone(firstChapter);
  const adoptedContent = '汐'.repeat(800);
  const adoptedHash = createHash('sha256').update(adoptedContent, 'utf8').digest('hex');
  const candidateHash = 'c'.repeat(64);
  Object.assign(secondChapter, {
    chapter: 2,
    chapterId: 'chapter-2',
    chapterTitle: '第二章 旧钟',
    chapterOutline: '主角沿着时间记录追查旧钟。',
    chapterGoal: '推进核心悬念。',
    artifactId: 'artifact-2',
    candidateHash,
    adoptedHash,
    adoptedContent,
    continuitySourceHash: firstChapter.adoptedHash,
    summaryTurnId: 'summary-turn-2',
    summaryRunId: 'summary-run-2',
    summaryArtifactId: 'summary-artifact-2',
    summaryApplyTransactionId: 'summary-apply-2',
    summaryId: 'summary-2',
    summaryAttempts: [
      { attempt: 1, runId: 'summary-run-2', status: 'completed' as const, error: '' },
    ],
    summaryExecutionEvidence: {
      sessionId: `session-summary-${'2'.repeat(32)}`,
      messageCounts: [2, 5, 7],
      providerUsage: { unit: 'tokens' as const, input: 1_080 },
    },
  });
  Object.assign(secondChapter.artifactCandidateIntegrityCheck, {
    artifactId: 'artifact-2',
    artifactContentSha256: candidateHash,
  });
  Object.assign(secondChapter.providerRequestEvidence, {
    taskId: 'provider-task-2',
    attemptId: 'provider-attempt-2',
  });
  secondChapter.snapshotSourceTypes.push('adopted_chapter');
  Object.assign(secondChapter.providerRequestEvidence.generationSourceStatuses, {
    adopted_chapter: 'included',
  });
  evidence.chapters.push(secondChapter);
  evidence.analysisMaterial.chapters.push({
    chapter: 2,
    chapterId: 'chapter-2',
    summary: { id: 'summary-2', summary: '沈岚沿时间记录追查旧钟。' },
    contextRecords: [
      {
        id: 'context-2',
        contextType: 'chapter_summary',
        title: '第二章摘要',
        content: '沈岚发现旧钟记录异常。',
        importance: 5,
      },
    ],
  });
  const continuationInstruction = '继续写';
  Reflect.set(evidence, 'userInstructions', [REAL_ACCEPTANCE_SPARSE_IDEA, continuationInstruction]);
  Reflect.set(evidence, 'creativeUserTurns', [
    ...evidence.creativeUserTurns,
    {
      sequence: 2,
      turnId: 'turn-2',
      source: 'user',
      classification: 'continuation_instruction',
      contentSha256: createHash('sha256').update(continuationInstruction, 'utf8').digest('hex'),
      contentLength: continuationInstruction.length,
    },
  ]);
  for (const [key, value] of [
    ['userTurnCount', 2],
    ['automaticChapterSummaryTurnCount', 2],
    ['chapterCount', 2],
    ['completedChapterCount', 2],
    ['totalWordCount', 1_600],
    ['independentWordCount', 1_600],
    ['chapterWordCountSum', 1_600],
    ['novelWordCount', 1_600],
  ] as const) {
    Reflect.set(evidence, key, value);
  }
  return evidence;
};

test('real conversation acceptance defaults to the sparse-idea loopback gate', () => {
  const profile = readRealConversationAcceptanceProfile(validEnvironment());

  assert.equal(profile.baseUrl, 'http://localhost:12074/v1');
  assert.equal(profile.mode, 'gate');
  assert.equal(profile.scenario, 'sparse-idea');
  assert.equal(profile.model, 'acceptance-model');
  assert.equal(shouldPreseedRealAcceptanceStoryAssets(profile), false);
});

test('current passing evidence accepts an explicit zero repair count and persisted-artifact check', () => {
  const evidence = currentPassingEvidence();

  assert.doesNotThrow(() => assertCurrentRealConversationPassingEvidence(evidence));
  assert.equal(evidence.chapters[0]?.integrityRepairCount, 0);
  assert.deepEqual(evidence.automaticAssetPreflightRetries, []);
});

test('passing evidence requires isolated automatic-summary Sessions and reset Provider input', () => {
  const passing = currentTwoChapterPassingEvidence();
  assert.doesNotThrow(() => assertCurrentRealConversationPassingEvidence(passing));

  const legacySchema = currentPassingEvidence();
  (legacySchema as { evidenceSchemaVersion: string }).evidenceSchemaVersion =
    'real_conversation_acceptance_evidence_v5';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(legacySchema),
    /evidence schema is not real_conversation_acceptance_evidence_v6/i,
  );

  const missingExecutionEvidence = currentPassingEvidence();
  delete (
    missingExecutionEvidence.chapters[0] as {
      summaryExecutionEvidence?: unknown;
    }
  ).summaryExecutionEvidence;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(missingExecutionEvidence),
    /fresh automatic-summary Session/i,
  );

  const reusedSession = currentTwoChapterPassingEvidence();
  reusedSession.chapters[1]!.summaryExecutionEvidence.sessionId =
    reusedSession.chapters[0]!.summaryExecutionEvidence.sessionId;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(reusedSession),
    /reused a DSH Session across chapters/i,
  );

  for (const messageCounts of [
    [2, 5],
    [2, 5, 8],
    [23, 30, 37],
  ]) {
    const invalidCounts = currentPassingEvidence();
    invalidCounts.chapters[0]!.summaryExecutionEvidence.messageCounts = messageCounts;
    assert.throws(
      () => assertCurrentRealConversationPassingEvidence(invalidCounts),
      /reset 2\/5\/7 Provider input/i,
    );
  }

  for (const input of [0, 1.5]) {
    const invalidUsage = currentPassingEvidence();
    invalidUsage.chapters[0]!.summaryExecutionEvidence.providerUsage.input = input;
    assert.throws(
      () => assertCurrentRealConversationPassingEvidence(invalidUsage),
      /positive token usage/i,
    );
  }

  const ordinarySession = currentPassingEvidence();
  ordinarySession.chapters[0]!.summaryExecutionEvidence.sessionId = 'session-task-ordinary';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(ordinarySession),
    /fresh automatic-summary Session/i,
  );
});

test('automatic asset preflight retries only the exact model attestation code', () => {
  assert.equal(
    isRetryableAutomaticAssetPreflightFailure(
      REAL_ACCEPTANCE_AUTOMATIC_ASSET_PREFLIGHT_RETRY_ERROR_CODE,
    ),
    true,
  );
  for (const errorCode of [
    'MODEL_TOOL_CALLING_NOT_VERIFIED: PROBE_TRANSPORT_FAILED',
    'model_tool_calling_not_verified',
    'WORKBENCH_SERVICE_FAILED',
    '',
    undefined,
  ]) {
    assert.equal(isRetryableAutomaticAssetPreflightFailure(errorCode), false, String(errorCode));
  }
});

test('sparse passing evidence distinguishes creative turns and actual Provider asset requests', () => {
  const withoutCreativeTurnEvidence = currentPassingEvidence();
  withoutCreativeTurnEvidence.creativeUserTurns = [];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutCreativeTurnEvidence),
    /distinguish persisted creative user turns/i,
  );

  const automaticTurnReusesCreativeIdentity = currentPassingEvidence();
  automaticTurnReusesCreativeIdentity.automaticAssetPreparations[0]!.turnId = 'turn-1';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(automaticTurnReusesCreativeIdentity),
    /actual Provider request/i,
  );

  const projectionSubstitutedForProvider = currentPassingEvidence();
  const substituted = projectionSubstitutedForProvider.automaticAssetPreparations[0]!;
  substituted.actualProviderRequestEvidence.messagesSha256 =
    substituted.postRunProjectionEvidence.messagesSha256;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(projectionSubstitutedForProvider),
    /actual Provider request/i,
  );

  const creativeBriefDrift = currentPassingEvidence();
  creativeBriefDrift.automaticAssetPreparations[0]!.actualProviderRequestEvidence.creativeBrief.contentSha256 =
    'f'.repeat(64);
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(creativeBriefDrift),
    /original creative brief/i,
  );

  const fixtureLeak = currentPassingEvidence();
  fixtureLeak.automaticAssetPreparations[0]!.actualProviderRequestEvidence.matchedPreparedFixtureCanaryIds =
    [REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES[0].id];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(fixtureLeak),
    /prepared fixture injection/i,
  );
});

test('sparse passing evidence accounts for bounded same-turn automatic asset preflight retries', () => {
  const evidenceWithRetry = () => {
    const evidence = currentPassingEvidence();
    const preparation = evidence.automaticAssetPreparations[0]!;
    const retry = automaticAssetPreflightRetryEvidence(preparation, 1, 1);
    evidence.automaticAssetPreflightRetries = [retry];
    return { evidence, preparation, retry };
  };

  const passing = evidenceWithRetry();
  assert.doesNotThrow(() => assertCurrentRealConversationPassingEvidence(passing.evidence));

  const withoutExplicitRetryLedger = currentPassingEvidence();
  delete (withoutExplicitRetryLedger as { automaticAssetPreflightRetries?: unknown })
    .automaticAssetPreflightRetries;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutExplicitRetryLedger),
    /explicitly report its preflight retries/i,
  );

  const countMismatch = evidenceWithRetry();
  countMismatch.evidence.automaticAssetPreparationTurnCount += 1;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(countMismatch.evidence),
    /turn count must equal successful preparations because preflight retries reuse the same turn/i,
  );

  const tooManyRetries = evidenceWithRetry();
  tooManyRetries.evidence.automaticAssetPreflightRetries = [
    tooManyRetries.retry,
    automaticAssetPreflightRetryEvidence(tooManyRetries.preparation, 2, 2),
    automaticAssetPreflightRetryEvidence(tooManyRetries.preparation, 3, 2),
  ];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(tooManyRetries.evidence),
    /bounded to two exact no-Run-at-failure model-attestation failures/i,
  );

  const changedTurn = evidenceWithRetry();
  changedTurn.retry.turnId = 'different-automatic-turn';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(changedTurn.evidence),
    /preflight retry evidence/i,
  );

  const changedModel = evidenceWithRetry();
  changedModel.retry.model.modelId = 'different-model';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(changedModel.evidence),
    /preflight retry evidence/i,
  );

  const changedGoal = evidenceWithRetry();
  changedGoal.retry.goalSha256 = 'f'.repeat(64);
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(changedGoal.evidence),
    /preflight retry evidence/i,
  );

  const inexactError = evidenceWithRetry();
  (inexactError.retry as { errorCode: string }).errorCode =
    'MODEL_TOOL_CALLING_NOT_VERIFIED: PROBE_TRANSPORT_FAILED';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(inexactError.evidence),
    /preflight retry evidence/i,
  );

  const runWasCreated = evidenceWithRetry();
  (runWasCreated.retry as { runId: string | null }).runId = 'unexpected-run';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(runWasCreated.evidence),
    /no-Run-at-failure model-attestation failures/i,
  );
});

test('sparse passing evidence bounds persistent asset retries to transient Provider failures', () => {
  const withRetry = () => {
    const evidence = currentPassingEvidence();
    const preparation = evidence.automaticAssetPreparations[0]!;
    preparation.runId = 'automatic-run-1-retry';
    preparation.retryCount = 1;
    preparation.attempts = [
      {
        attempt: 1,
        runId: 'automatic-run-1',
        status: 'failed' as const,
        error: 'DSH 回合以错误结束: HTTP_408',
      },
      {
        attempt: 2,
        runId: preparation.runId,
        status: 'completed' as const,
        error: '',
      },
    ];
    return { evidence, preparation };
  };

  const passing = withRetry();
  assert.doesNotThrow(() => assertCurrentRealConversationPassingEvidence(passing.evidence));

  const nonTransient = withRetry();
  nonTransient.preparation.attempts[0]!.error = 'HTTP_400 invalid request';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(nonTransient.evidence),
    /actual Provider request/i,
  );

  const wrongFinalRun = withRetry();
  wrongFinalRun.preparation.runId = 'another-run';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(wrongFinalRun.evidence),
    /actual Provider request/i,
  );

  const beyondBudget = withRetry();
  beyondBudget.preparation.retryCount = 3;
  beyondBudget.preparation.attempts = [
    ...beyondBudget.preparation.attempts.slice(0, 1),
    {
      attempt: 2,
      runId: 'automatic-run-1-retry-2',
      status: 'failed' as const,
      error: 'HTTP status: 503',
    },
    {
      attempt: 3,
      runId: 'automatic-run-1-retry-3',
      status: 'failed' as const,
      error: 'HTTP status: 503',
    },
    {
      attempt: 4,
      runId: beyondBudget.preparation.runId,
      status: 'completed' as const,
      error: '',
    },
  ];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(beyondBudget.evidence),
    /actual Provider request/i,
  );
});

test('real conversation evidence outcome uses a finite status-coupled failure stage', () => {
  const typedStages: readonly RealConversationAcceptanceFailureStage[] =
    REAL_ACCEPTANCE_FAILURE_STAGES;
  const failedOutcome = {
    status: 'failed',
    failureStage: 'closed_loop',
    failureReason: 'Closed-loop counts did not match.',
  } satisfies RealConversationAcceptanceEvidenceOutcome;
  const passedOutcome = {
    status: 'passed',
    failureStage: null,
    failureReason: '',
  } satisfies RealConversationAcceptanceEvidenceOutcome;

  assert.deepEqual(typedStages, [
    'setup',
    'chapter_execution',
    'word_counts',
    'closed_loop',
    'final_conversation',
    'diagnostics',
    'runner_preparation',
    'test_execution',
    'artifact_audit',
    'evidence_validation',
  ]);
  assert.doesNotThrow(() => assertRealConversationAcceptanceEvidenceOutcome(failedOutcome));
  assert.doesNotThrow(() => assertRealConversationAcceptanceEvidenceOutcome(passedOutcome));
  assert.equal(isRealConversationAcceptanceFailureStage('word_counts'), true);
  assert.equal(isRealConversationAcceptanceFailureStage('arbitrary_error_text'), false);
  assert.throws(
    () =>
      assertRealConversationAcceptanceEvidenceOutcome({
        status: 'failed',
        failureStage: 'arbitrary_error_text',
        failureReason: 'sanitized failure',
      }),
    /known failureStage/i,
  );
  assert.throws(
    () =>
      assertRealConversationAcceptanceEvidenceOutcome({
        status: 'passed',
        failureStage: 'diagnostics',
        failureReason: 'must not survive a passing run',
      }),
    /no failure stage or reason/i,
  );
});

test('legacy or incomplete passing evidence cannot satisfy the current evidence contract', () => {
  const withoutSchema = currentPassingEvidence();
  delete (withoutSchema as { evidenceSchemaVersion?: unknown }).evidenceSchemaVersion;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutSchema),
    /evidence schema/i,
  );

  const withoutIntegrityVersion = currentPassingEvidence();
  delete (withoutIntegrityVersion as { candidateIntegrityContractVersion?: unknown })
    .candidateIntegrityContractVersion;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutIntegrityVersion),
    /candidate-integrity contract/i,
  );

  const previousIntegrityVersion = currentPassingEvidence();
  (
    previousIntegrityVersion as {
      candidateIntegrityContractVersion: string;
    }
  ).candidateIntegrityContractVersion = 'chapter_candidate_integrity_v1';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(previousIntegrityVersion),
    /chapter_candidate_integrity_v4/i,
  );

  const withoutFailureStage = currentPassingEvidence();
  delete (withoutFailureStage as { failureStage?: unknown }).failureStage;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutFailureStage),
    /failure stage/i,
  );

  const withoutRepairCount = currentPassingEvidence();
  delete (withoutRepairCount.chapters[0] as { integrityRepairCount?: unknown })
    .integrityRepairCount;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutRepairCount),
    /integrityRepairCount/i,
  );

  const withoutOriginalWordCount = currentPassingEvidence();
  delete (withoutOriginalWordCount.chapters[0] as { originalWordCount?: unknown })
    .originalWordCount;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutOriginalWordCount),
    /length-control evidence/i,
  );

  const withoutLengthRepairCount = currentPassingEvidence();
  delete (withoutLengthRepairCount.chapters[0] as { lengthRepairCount?: unknown })
    .lengthRepairCount;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutLengthRepairCount),
    /length-control evidence/i,
  );

  const outOfRangeChapter = currentPassingEvidence();
  outOfRangeChapter.chapters[0]!.targetWordCount = 2_000;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(outOfRangeChapter),
    /length-control evidence/i,
  );

  const adoptedWordCountDrift = currentPassingEvidence();
  adoptedWordCountDrift.chapters[0]!.wordCount += 1;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(adoptedWordCountDrift),
    /length-control evidence/i,
  );

  const withoutRepairHistory = currentPassingEvidence();
  delete (withoutRepairHistory.chapters[0] as { integrityRepairAttempts?: unknown })
    .integrityRepairAttempts;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutRepairHistory),
    /issue record per integrity repair/i,
  );

  const withoutReviewableOutline = currentPassingEvidence();
  withoutReviewableOutline.chapters[0]!.chapterOutline = '';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutReviewableOutline),
    /formal title, outline, and goal/i,
  );

  const incompleteChapterRows = currentPassingEvidence();
  incompleteChapterRows.chapterCount = 2;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(incompleteChapterRows),
    /chapterCount/i,
  );

  const inconsistentWordLedgers = currentPassingEvidence();
  inconsistentWordLedgers.novelWordCount += 1;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(inconsistentWordLedgers),
    /word ledgers/i,
  );

  const missingSummaryMemory = currentPassingEvidence();
  missingSummaryMemory.chapters[0]!.memorySourceTypes = ['adopted_draft'];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(missingSummaryMemory),
    /summary, Context, and Memory/i,
  );

  const withoutSummaryStartLedger = currentPassingEvidence();
  delete (withoutSummaryStartLedger.chapters[0] as { summaryStartRecoveries?: unknown })
    .summaryStartRecoveries;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(withoutSummaryStartLedger),
    /automatic-summary start recovery ledger/i,
  );

  const exhaustedSummaryStartRecovery = currentPassingEvidence();
  exhaustedSummaryStartRecovery.chapters[0]!.summaryStartRetryCount = 1;
  exhaustedSummaryStartRecovery.chapters[0]!.summaryStartRecoveries = [
    {
      attempt: 1,
      turnId: 'summary-turn-1',
      trigger: 'workbench-retry-summary-start',
      observedPhase: 'failed',
      runCountBefore: 0,
      runtimeActiveBefore: false,
      model: { providerId: 'openai_compatible', modelId: 'acceptance-model' },
      outcome: 'exhausted',
      firstPersistedRunId: null,
    },
  ];
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(exhaustedSummaryStartRecovery),
    /automatic-summary start recovery ledger/i,
  );

  const uncheckedArtifact = currentPassingEvidence();
  uncheckedArtifact.chapters[0]!.artifactCandidateIntegrityCheck.executed = false;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(uncheckedArtifact),
    /independent passing integrity check/i,
  );

  const mismatchedArtifact = currentPassingEvidence();
  mismatchedArtifact.chapters[0]!.artifactCandidateIntegrityCheck.artifactContentSha256 =
    'b'.repeat(64);
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(mismatchedArtifact),
    /persisted artifact/i,
  );

  const redactedPromptHash = currentPassingEvidence();
  redactedPromptHash.chapters[0]!.providerRequestEvidence.snapshotCompiledPromptSha256 =
    '[REDACTED]';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(redactedPromptHash),
    /Provider source evidence/i,
  );

  const missingWorldProviderSource = currentPassingEvidence();
  delete missingWorldProviderSource.chapters[0]!.providerRequestEvidence.generationSourceStatuses
    .world_setting;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(missingWorldProviderSource),
    /Provider source evidence/i,
  );

  const missingProviderAttempt = currentPassingEvidence();
  missingProviderAttempt.chapters[0]!.providerRequestEvidence.attemptId = '';
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(missingProviderAttempt),
    /Provider source evidence/i,
  );

  const repairedChapter = currentPassingEvidence();
  repairedChapter.chapters[0]!.originalWordCount = 1_000;
  repairedChapter.chapters[0]!.lengthRepairCount = 1;
  assert.throws(
    () => assertCurrentRealConversationPassingEvidence(repairedChapter),
    /Provider source evidence/i,
  );
  repairedChapter.chapters[0]!.providerRequestEvidence.generationSourceStatuses.current_editor =
    'included';
  assert.doesNotThrow(() => assertCurrentRealConversationPassingEvidence(repairedChapter));
});

test('sparse-idea scenario uses one minimal ordinary brief without prewriting story facts', () => {
  const profile = readRealConversationAcceptanceProfile(validEnvironment());
  const instructions = buildRealConversationInstructions(
    profile,
    REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT,
  );

  assert.equal(profile.scenario, 'sparse-idea');
  assert.equal(shouldPreseedRealAcceptanceStoryAssets(profile), false);
  assert.deepEqual(instructions, [REAL_ACCEPTANCE_SPARSE_IDEA, '继续写', '继续写', '继续写']);
  assert.equal(instructions[0], '写个六万字左右的悬疑故事。');
  assert.ok(!instructions[0].includes('15章'));
  assert.ok(instructions[0].length < 20);
  assert.ok(!instructions[0].includes('世界背景'));
  assert.ok(!instructions[0].includes('主角'));
  assert.ok(!instructions[0].includes('冲突'));
  assert.ok(!instructions[0].includes('章节大纲'));
  assertGateInstructionContract(profile, 12, instructions);
  assert.throws(
    () => assertGateInstructionContract(profile, 12, ['生成本章正文', '继续写']),
    /sparse-idea/i,
  );
});

test('prepared fixture leak audit reports every matching sparse context surface', () => {
  const leaks = findRealConversationFixtureLeaks(
    [
      { label: 'protagonist', content: '主角是二十七岁的档案修复师' },
      { label: 'outline', content: '固定章纲：空白航海日志' },
      { label: 'reference_materials', content: '沿岸灯塔通常设有维护井' },
      { label: 'clean', content: '稀疏流程自主生成的全新内容' },
    ],
    [
      { label: 'protagonist_identity', value: '档案修复师' },
      { label: 'chapter_outline_1', value: '空白航海日志' },
      { label: 'research_lighthouse', value: '灯塔通常设有维护井' },
      { label: 'ignored_empty', value: '   ' },
    ],
  );

  assert.deepEqual(leaks, [
    { canaryLabel: 'protagonist_identity', surfaceLabel: 'protagonist' },
    { canaryLabel: 'chapter_outline_1', surfaceLabel: 'outline' },
    { canaryLabel: 'research_lighthouse', surfaceLabel: 'reference_materials' },
  ]);
});

test('sparse generation proves the selected profiles are the global built-in defaults', () => {
  const validSelection = {
    styleProfileId: 'style-generated-id',
    outputProfileId: 'output-generated-id',
    styleProfiles: [
      {
        id: 'style-generated-id',
        ...REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE,
      },
    ],
    outputProfiles: [
      {
        id: 'output-generated-id',
        ...REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE,
      },
    ],
    styleOutputSection: [
      '叙事人称：第三人称有限视角',
      '文风语气：中性偏沉稳',
      '节奏：中等',
      '对话比例：35%，描写比例：40%',
      `风格总结：${REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE.styleSummary}`,
      `方案名称：${REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE.name}`,
      '最少字数：3000 字（输出方案参考值）',
      '最多字数：6000 字（输出方案参考值）',
      '段落长度：中等段落',
      '叙事视角：第三人称限知',
      '叙事时态：过去时',
      '节奏等级：中等',
      '结尾必须有钩子',
    ].join('\n'),
  };

  assert.doesNotThrow(() => assertRealConversationBuiltInProfileSelection(validSelection));
  assert.throws(
    () =>
      assertRealConversationBuiltInProfileSelection({
        ...validSelection,
        styleProfiles: [{ ...validSelection.styleProfiles[0], novelId: 'novel-1' }],
      }),
    /global built-in default style/i,
  );
  assert.throws(
    () =>
      assertRealConversationBuiltInProfileSelection({
        ...validSelection,
        outputProfiles: [{ ...validSelection.outputProfiles[0], name: '自定义方案' }],
      }),
    /global built-in default output/i,
  );
  assert.throws(
    () =>
      assertRealConversationBuiltInProfileSelection({
        ...validSelection,
        styleOutputSection: validSelection.styleOutputSection.replace('结尾必须有钩子', ''),
      }),
    /projection is incomplete/i,
  );
});

test('full sparse-idea scenario derives its turn count from the formal story plan', () => {
  const profile = readRealConversationAcceptanceProfile({
    ...validEnvironment(),
    [REAL_ACCEPTANCE_ENV.mode]: 'full',
  });
  const plannedChapterCount = 12;
  const runChapterCount = resolveRealConversationRunChapterCount(profile, plannedChapterCount);
  const instructions = buildRealConversationInstructions(profile, runChapterCount);

  assert.equal(runChapterCount, plannedChapterCount);
  assert.equal(instructions.length, plannedChapterCount);
  assert.equal(instructions[0], REAL_ACCEPTANCE_SPARSE_IDEA);
  assert.ok(instructions.slice(1).every((instruction) => instruction === '继续写'));
});

test('prepared-assets remains an explicit fixed four/fifteen chapter fixture', () => {
  const gate = readRealConversationAcceptanceProfile({
    ...validEnvironment(),
    [REAL_ACCEPTANCE_ENV.scenario]: 'prepared-assets',
  });
  const profile = readRealConversationAcceptanceProfile({
    ...validEnvironment(),
    [REAL_ACCEPTANCE_ENV.mode]: 'full',
    [REAL_ACCEPTANCE_ENV.scenario]: 'prepared-assets',
  });

  assert.equal(shouldPreseedRealAcceptanceStoryAssets(profile), true);
  assert.equal(preparedRealConversationChapterCount(gate), 4);
  assert.equal(profile.mode, 'full');
  assert.equal(
    preparedRealConversationChapterCount(profile),
    REAL_ACCEPTANCE_PREPARED_FULL_CHAPTER_COUNT,
  );
});

test('prepared-assets gate user turns remain exactly four short instructions', () => {
  const profile = readRealConversationAcceptanceProfile({
    ...validEnvironment(),
    [REAL_ACCEPTANCE_ENV.scenario]: 'prepared-assets',
  });
  const plannedChapterCount = preparedRealConversationChapterCount(profile);
  const instructions = buildRealConversationInstructions(profile, plannedChapterCount);

  assert.deepEqual(instructions, [...REAL_ACCEPTANCE_GATE_INSTRUCTIONS]);
  assertGateInstructionContract(profile, plannedChapterCount, instructions);
  assert.throws(
    () =>
      assertGateInstructionContract(profile, plannedChapterCount, [
        '生成本章正文',
        '继续写',
        '请按以下详细节拍继续写',
        '继续写',
      ]),
    /exactly/i,
  );
  assert.throws(
    () => assertGateInstructionContract(profile, plannedChapterCount, ['生成本章正文', '继续写']),
    /exactly/i,
  );
});

test('full prepared-assets mode keeps its fifteen short fixture turns', () => {
  const profile = readRealConversationAcceptanceProfile({
    ...validEnvironment(),
    [REAL_ACCEPTANCE_ENV.mode]: 'full',
    [REAL_ACCEPTANCE_ENV.scenario]: 'prepared-assets',
  });
  const instructions = buildRealConversationInstructions(
    profile,
    preparedRealConversationChapterCount(profile),
  );

  assert.equal(instructions.length, 15);
  assert.equal(instructions[0], '生成本章正文');
  assert.ok(instructions.slice(1).every((instruction) => instruction === '继续写'));
  assert.ok(instructions.every((instruction) => instruction.length <= 8));
});

test('story plan expectation preserves artifact order and supplies the dynamic chapter count', () => {
  const plan = parseRealConversationStoryPlan(
    JSON.stringify({
      planKind: 'story_plan',
      title: '总纲',
      content: '完整主线',
      targetWordCount: 12_000,
      volumes: [
        {
          title: '第一卷',
          summary: '摘要',
          goal: '目标',
          mainConflict: '冲突',
          outline: '卷纲',
          chapters: [
            { title: '第一章', outline: '发现异常', goal: '建立悬念', targetWordCount: 4_000 },
            { title: '第二章', outline: '追查线索', goal: '升级冲突', targetWordCount: 4_000 },
          ],
        },
        {
          title: '第二卷',
          summary: '摘要',
          goal: '目标',
          mainConflict: '冲突',
          outline: '卷纲',
          chapters: [
            { title: '第三章', outline: '完成选择', goal: '收束主线', targetWordCount: 4_000 },
          ],
        },
      ],
    }),
  );

  assert.equal(plan.chapters.length, 3);
  assert.deepEqual(
    plan.chapters.map((chapter) => chapter.title),
    ['第一章', '第二章', '第三章'],
  );
  assert.equal(plan.targetWordCount, 12_000);
  assert.equal(
    resolveRealConversationRunChapterCount({ mode: 'gate' }, plan.chapters.length),
    Math.min(REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT, plan.chapters.length),
  );
  assert.throws(
    () => parseRealConversationStoryPlan('{"planKind":"story_plan","volumes":[]}'),
    /targetWordCount|volume/i,
  );
});

test('story-plan apply evidence keeps only safe scalar planning diagnostics', () => {
  const sensitiveCandidateText = JSON.stringify({
    planKind: 'story_plan',
    title: '不得进入 evidence 的总纲',
    content: '完整候选正文 sk-sensitive-candidate-value',
    targetWordCount: 12_000,
    volumes: [
      {
        title: '第一卷',
        chapters: [
          {
            title: '第一章',
            outline: '不得保存的章节大纲',
            goal: '不得保存的章节目标',
            targetWordCount: 4_000,
          },
          {
            title: '第二章',
            outline: '继续推进',
            goal: '升级冲突',
            targetWordCount: 3_500,
          },
          {
            title: '第三章',
            outline: '完成选择',
            goal: '收束主线',
            targetWordCount: 4_500,
          },
        ],
      },
    ],
  });

  const evidence = createRealConversationStoryPlanApplyEvidence({
    artifactId: 'artifact-story-plan-1',
    candidateText: sensitiveCandidateText,
    frozenTarget: {
      target: 60_000,
      minimum: 54_000,
      maximum: 66_000,
      sourceTurnId: 'turn-sparse-idea-1',
      sourceTurnSequence: 0,
      sourceContentSha256: 'a'.repeat(64),
    },
  });
  const serialized = JSON.stringify(evidence);

  assert.deepEqual(evidence, {
    artifactId: 'artifact-story-plan-1',
    rootTargetWordCount: 12_000,
    chapterTargetWordCountSum: 12_000,
    frozenTarget: { target: 60_000, minimum: 54_000, maximum: 66_000 },
    frozenSource: {
      turnId: 'turn-sparse-idea-1',
      turnSequence: 0,
      contentSha256: 'a'.repeat(64),
    },
    applyResult: 'pending',
    applyTransactionId: null,
    applyErrorCode: null,
  });
  assert.doesNotMatch(serialized, /不得进入|不得保存|完整候选|sk-sensitive/i);
  assert.equal(
    createRealConversationStoryPlanApplyEvidence({
      artifactId: 'sk_sensitive-artifact-value',
      candidateText: sensitiveCandidateText,
    }).artifactId,
    null,
  );
  assert.deepEqual(
    createRealConversationStoryPlanApplyEvidence({
      artifactId: 'artifact-story-plan-unsafe-source',
      candidateText: sensitiveCandidateText,
      frozenTarget: {
        sourceTurnId: 'sk-sensitive-turn',
        sourceTurnSequence: -1,
        sourceContentSha256: 'A'.repeat(64),
      },
    }).frozenSource,
    { turnId: null, turnSequence: null, contentSha256: null },
  );
});

test('story-plan apply evidence remains useful for both success and failure', () => {
  const pending = createRealConversationStoryPlanApplyEvidence({
    artifactId: 'artifact-story-plan-2',
    candidateText: JSON.stringify({
      planKind: 'story_plan',
      targetWordCount: 4_000,
      volumes: [
        {
          chapters: [
            { title: '第一章', outline: '发现线索', goal: '建立悬念', targetWordCount: 4_000 },
          ],
        },
      ],
    }),
    frozenTarget: { target: 60_000, minimum: 54_000, maximum: 66_000 },
  });

  assert.deepEqual(recordRealConversationStoryPlanApplySuccess(pending, 'apply-transaction-1'), {
    ...pending,
    applyResult: 'applied',
    applyTransactionId: 'apply-transaction-1',
    applyErrorCode: null,
  });
  assert.deepEqual(
    recordRealConversationStoryPlanApplyFailure(pending, 'STRUCTURED_BASE_REVISION_CONFLICT'),
    {
      ...pending,
      applyResult: 'failed',
      applyTransactionId: null,
      applyErrorCode: 'STRUCTURED_BASE_REVISION_CONFLICT',
    },
  );
  assert.equal(
    recordRealConversationStoryPlanApplyFailure(pending, 'sk-sensitive-error-value').applyErrorCode,
    'REAL_ACCEPTANCE_APPLY_FAILED',
  );
  assert.equal(
    recordRealConversationStoryPlanApplyFailure(pending, 'UNSUPPORTED_APPLY:story_plan')
      .applyErrorCode,
    'UNSUPPORTED_APPLY:story_plan',
  );
});

test('real snapshot DTO parses camelCase JSON and maps canaries by section key', () => {
  const rawSnapshot = {
    id: 'snapshot-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
    chapterId: 'chapter-1',
    engineeringStateId: null,
    styleProfileId: 'style-system-default',
    outputProfileId: 'output-system-default',
    compiledContextJson: JSON.stringify({
      chapterId: 'chapter-1',
      novelId: 'novel-1',
      sections: [
        {
          key: 'novel',
          title: '作品与世界',
          content: '世界背景 canary',
          sourceTypes: ['novel', 'world_setting'],
        },
        {
          key: 'protagonist',
          title: '主角',
          content: '沈岚 canary',
          sourceTypes: ['protagonist'],
        },
        {
          key: 'outline',
          title: '章节大纲',
          content: '章纲 canary',
          sourceTypes: ['chapter_outline'],
        },
        {
          key: 'style_output',
          title: '风格与输出',
          content: '默认风格 canary',
          sourceTypes: ['style_profile', 'output_profile'],
        },
        {
          key: 'reference_materials',
          title: '参考资料',
          content: '机械钟 canary',
          sourceTypes: ['reference_material'],
        },
      ],
      sources: [],
      warnings: [],
      compiledAt: '2026-08-28T00:00:00.000Z',
    }),
    compiledPromptText: 'compiled prompt',
    promptSummary: 'prompt summary',
    contextHash: 'context-hash',
    sourcesJson: JSON.stringify([
      {
        type: 'world_setting',
        title: '世界背景',
        sourceId: 'world-1',
        status: 'used',
        summary: 'active world',
      },
    ]),
    createdAt: '2026-08-28T00:00:00.000Z',
  };
  const snapshot = parseRealConversationGenerationSnapshot(rawSnapshot, 1);
  const sections = new Map(
    snapshot.compiledContext.sections.map((section) => [section.key, section.content]),
  );

  assert.equal(sections.get('novel'), '世界背景 canary');
  assert.equal(sections.get('protagonist'), '沈岚 canary');
  assert.equal(sections.get('outline'), '章纲 canary');
  assert.equal(sections.get('style_output'), '默认风格 canary');
  assert.equal(sections.get('reference_materials'), '机械钟 canary');
  assert.equal(snapshot.styleProfileId, 'style-system-default');
  assert.equal(snapshot.sources[0]?.status, 'used');

  assert.throws(
    () =>
      parseRealConversationGenerationSnapshot(
        {
          ...rawSnapshot,
          compiledContextJson: JSON.stringify({
            sections: [
              {
                id: 'novel',
                title: 'legacy wrong shape',
                content: 'must not pass',
                sourceTypes: ['novel'],
              },
            ],
          }),
        },
        1,
      ),
    /invalid shape/i,
  );
});

test('profile requires explicit opt-in and rejects non-loopback or credential-shaped URLs', () => {
  const withoutOptIn = validEnvironment();
  delete withoutOptIn[REAL_ACCEPTANCE_ENV.enabled];
  assert.throws(() => readRealConversationAcceptanceProfile(withoutOptIn), /opt in/i);

  assert.throws(
    () =>
      readRealConversationAcceptanceProfile({
        ...validEnvironment(),
        [REAL_ACCEPTANCE_ENV.baseUrl]: 'https://example.com/v1',
      }),
    /loopback/i,
  );
  assert.throws(
    () =>
      readRealConversationAcceptanceProfile({
        ...validEnvironment(),
        [REAL_ACCEPTANCE_ENV.baseUrl]: 'http://user:password@127.0.0.1:12074/v1',
      }),
    /credentials/i,
  );
  assert.throws(
    () =>
      readRealConversationAcceptanceProfile({
        ...validEnvironment(),
        [REAL_ACCEPTANCE_ENV.baseUrl]: 'http://localhost:12074/v1?key=secret',
      }),
    /query/i,
  );
  assert.throws(
    () =>
      readRealConversationAcceptanceProfile({
        ...validEnvironment(),
        [REAL_ACCEPTANCE_ENV.scenario]: 'unknown-scenario',
      }),
    /prepared-assets or sparse-idea/i,
  );
});

test('all IPv4 loopback addresses and IPv6 loopback are accepted', () => {
  for (const baseUrl of ['http://127.0.0.1:12074/v1/', 'http://127.9.8.7/v1', 'http://[::1]/v1']) {
    const profile = readRealConversationAcceptanceProfile({
      ...validEnvironment(),
      [REAL_ACCEPTANCE_ENV.baseUrl]: baseUrl,
    });
    assert.match(profile.baseUrl, /^http:/);
  }
});

test('credential is removed from child environments and rejected from evidence', () => {
  const env = validEnvironment();
  const credential = env[REAL_ACCEPTANCE_ENV.apiKey]!;
  const childEnvironment = environmentWithoutRealCredential(env);

  assert.equal(childEnvironment[REAL_ACCEPTANCE_ENV.apiKey], undefined);
  assert.equal(env[REAL_ACCEPTANCE_ENV.apiKey], credential);
  assert.doesNotThrow(() => assertSecretAbsent('{"status":"passed"}', credential, 'evidence'));
  assert.throws(
    () => assertSecretAbsent(`{"status":"passed","value":"${credential}"}`, credential, 'evidence'),
    /rejected/i,
  );
});

test('real acceptance only retries explicit transient HTTP provider failures', () => {
  for (const message of [
    'upstream returned HTTP 408',
    'DSH 回合以错误结束: HTTP_408',
    'HTTP status: 429',
    'provider status code=500',
    'generate_chapter: HTTP 503 Service Unavailable',
    '【model】AI 调用失败：模型服务错误（502），请稍后重试。',
    'AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。',
    'AI 调用失败：模型服务当前过载（overloaded_error），请稍后重试。',
  ]) {
    assert.equal(isTransientRealAcceptanceProviderFailure(message), true, message);
  }
  for (const message of [
    'HTTP 400 invalid request',
    'HTTP 401 unauthorized',
    'DSH 回合以错误结束: HTTP_404',
    'NOT_HTTP_408',
    'artifact validation failed',
    'chapter timed out without an HTTP status',
    'AI 调用失败：请求参数不合法（400 Bad Request）。',
    'AI 调用失败：模型服务错误（5020），请稍后重试。',
  ]) {
    assert.equal(isTransientRealAcceptanceProviderFailure(message), false, message);
  }
});

test('real acceptance retries only explicit Provider timeout failures', () => {
  for (const message of [
    'AI_PROVIDER_TIMEOUT',
    'provider failed with code=AI_PROVIDER_TIMEOUT',
    '【service】AI 调用失败：请求超时（600 秒），请检查网络或增加超时时间。',
    '请求超时，请稍后重试。',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), true, message);
  }
  for (const message of [
    'AI_PROVIDER_TIMEOUT_EXTRA',
    'NOT_AI_PROVIDER_TIMEOUT',
    '章节等待超时，请检查任务状态。',
    '操作超时',
    '请求超时配置无效',
    'HTTP 400 request timeout setting is invalid',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), false, message);
  }
});

test('real acceptance retries only explicit safe Provider transport codes', () => {
  for (const message of [
    'AI_PROVIDER_CONNECT_FAILED',
    'provider failed with code=AI_PROVIDER_CONNECT_FAILED',
    '【service】AI_PROVIDER_TRANSPORT_INTERRUPTED: AI 调用失败：与模型服务的传输在完成前中断，请重试。',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), true, message);
  }
  for (const message of [
    'AI_PROVIDER_CONNECT_FAILED_EXTRA',
    'NOT_AI_PROVIDER_TRANSPORT_INTERRUPTED',
    'AI_PROVIDER_REQUEST_BUILD_FAILED',
    'AI_PROVIDER_REDIRECT_FAILED',
    'AI_PROVIDER_RESPONSE_DECODE_FAILED',
    'AI_PROVIDER_RESPONSE_BODY_FAILED',
    'AI_PROVIDER_REQUEST_FAILED',
    'AI 调用失败：网络请求失败。',
    'AI 调用失败：模型服务响应读取失败，请重试。',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), false, message);
  }
  assert.equal(REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES, 2);
});

test('real acceptance retries only the exact legacy and current renderer recovery errors', () => {
  for (const message of [
    '应用重新启动，上一轮运行已中断，请重新发送任务。',
    '工作台已重新加载，上一轮运行已中断。请重试本回合。',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), true, message);
  }
  for (const message of [
    '应用重新启动，上一轮运行已中断。',
    '工作台已重新加载，其他运行已中断。请重试本回合。',
    '上一轮运行已中断。请重试本回合。',
    '工作台已重新加载，上一轮运行已中断。请重新发送任务。',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), false, message);
  }
});

test('real acceptance also retries the explicit Writer length-convergence failure', () => {
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '【model】章节候选在 2 次长度收敛后仍为 4749 字，超过允许上限 4715 字。请重试本回合。',
    ),
    true,
  );
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '章节候选在 3 次长度收敛后仍为 4749 字，未落入允许范围 3200-4600 字。请重试本回合。',
    ),
    true,
  );
  for (const message of [
    '章节候选太长',
    'artifact validation failed',
    'HTTP 400 invalid request',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), false, message);
  }
});

test('real acceptance retries only explicit bounded Writer integrity failures', () => {
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '章节候选在 2 次完整性修复后仍未通过：chapter_opening_rollback, chapter_tail_pollution。请重试本回合。',
    ),
    true,
  );
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '章节候选在 2 次完整性修复后仍未通过：chapter_meta_reasoning_leakage。请重试本回合。',
    ),
    true,
  );
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '【model】章节候选在 2 次完整性修复后仍未通过：chapter_audit_voice_leakage。请重试本回合。',
    ),
    true,
  );
  assert.equal(
    isRetryableRealAcceptanceRunFailure(
      '章节候选在 2 次完整性修复后仍未通过：chapter_boundary_action_replay, chapter_source_chain_break, chapter_temporal_semantics_conflict。请重试本回合。',
    ),
    true,
  );
  for (const message of [
    '章节连续性有问题，请重试',
    '章节候选在 2 次完整性修复后仍未通过：unknown_issue。请重试本回合。',
    'HTTP 400 invalid request',
  ]) {
    assert.equal(isRetryableRealAcceptanceRunFailure(message), false, message);
  }
});

test('failed Writer convergence attempts contribute every persisted generation artifact', () => {
  assert.equal(
    persistedGenerationArtifactCountForFailedRun(
      '章节候选在 2 次完整性修复后仍未通过：chapter_meta_reasoning_leakage。请重试本回合。',
    ),
    3,
  );
  assert.equal(
    persistedGenerationArtifactCountForFailedRun(
      '章节候选在 3 次长度收敛后仍为 4749 字，未落入允许范围 3200-4600 字。请重试本回合。',
    ),
    4,
  );
  assert.equal(persistedGenerationArtifactCountForFailedRun('AI 调用失败：HTTP 408。'), 0);
});

test('retryable-run budget exposes two retries and exactly three total attempts', () => {
  assert.equal(REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES, 2);
  assert.equal(REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS, REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES + 1);
});

test('automatic chapter summary recovery accepts only exact protocol or verified-probe errors', () => {
  for (const error of [
    'DSH_REQUIRED_CONTEXT_READ_MISSING',
    'DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states',
    'DSH_REQUIRED_CANDIDATE_TOOL_MISSING',
    'DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter',
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR,
  ]) {
    assert.equal(isAutomaticSummaryProtocolRecoveryError(error), true);
  }
  for (const error of [
    undefined,
    '',
    'DSH_REQUIRED_CONTEXT_READ_MISSING_EXTRA',
    'prefix DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter',
    'DSH_CANDIDATE_TOOL_COUNT_INVALID',
    'DSH 回合以错误结束: STREAM_CLOSED',
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR.replace(
      'status=200',
      'status=500',
    ),
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR.replace(
      'ans_runtime_attest_tool_call_v1',
      'summarize_chapter',
    ),
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR.replace(
      'finish=tool_calls',
      'finish=stop',
    ),
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR.replace(
      'done=true',
      'done=false',
    ),
    REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR.replace(
      'probe done status=200',
      'probe done status=500',
    ),
    `prefix ${REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR}`,
    `${REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_ERROR}: extra`,
  ]) {
    assert.equal(isAutomaticSummaryProtocolRecoveryError(error), false);
  }
});
