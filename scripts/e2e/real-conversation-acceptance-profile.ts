import { createHash } from 'node:crypto';
import { countTextWords } from '../../src/utils/contentHash.ts';
import { isRealAcceptanceLengthControlEvidenceConsistent } from './real-conversation-chapter-word-count-contract.ts';

export const REAL_ACCEPTANCE_ENV = {
  enabled: 'AI_NOVEL_STUDIO_REAL_E2E',
  baseUrl: 'AI_NOVEL_STUDIO_REAL_E2E_BASE_URL',
  model: 'AI_NOVEL_STUDIO_REAL_E2E_MODEL',
  apiKey: 'AI_NOVEL_STUDIO_REAL_E2E_API_KEY',
  mode: 'AI_NOVEL_STUDIO_REAL_E2E_MODE',
  scenario: 'AI_NOVEL_STUDIO_REAL_E2E_SCENARIO',
  app: 'AI_NOVEL_STUDIO_REAL_E2E_APP',
  artifacts: 'AI_NOVEL_STUDIO_REAL_E2E_ARTIFACTS',
  driver: 'AI_NOVEL_STUDIO_REAL_E2E_DRIVER',
  nativeDriver: 'AI_NOVEL_STUDIO_REAL_E2E_NATIVE_DRIVER',
  driverPort: 'AI_NOVEL_STUDIO_REAL_E2E_DRIVER_PORT',
  chapterTimeoutMs: 'AI_NOVEL_STUDIO_REAL_E2E_CHAPTER_TIMEOUT_MS',
  evidenceDirectory: 'AI_NOVEL_STUDIO_REAL_E2E_EVIDENCE_DIR',
  providerEvidenceDirectory: 'AI_NOVEL_STUDIO_REAL_E2E_PROVIDER_EVIDENCE_DIR',
  preparedFixtureCanaries: 'AI_NOVEL_STUDIO_REAL_E2E_PREPARED_FIXTURE_CANARIES_JSON',
} as const;

export type RealConversationAcceptanceMode = 'gate' | 'full';
export type RealConversationAcceptanceScenario = 'prepared-assets' | 'sparse-idea';

export const REAL_ACCEPTANCE_GATE_INSTRUCTIONS = [
  '生成本章正文',
  '继续写',
  '继续写',
  '继续写',
] as const;
export const REAL_ACCEPTANCE_SPARSE_IDEA = '写个六万字左右的悬疑故事。';
export const REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION =
  'real_conversation_provider_request_evidence_v1' as const;
export const REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES = [
  {
    id: 'prepared_world_setting',
    value: '近未来海港城临雾依靠“回声档案”保存市民记忆。',
  },
  {
    id: 'prepared_protagonist_motivation',
    value: '查明哥哥沈砚在十年前港口事故中失踪的真相',
  },
  {
    id: 'prepared_research_reference',
    value: '潮汐港口的旧式机械钟可通过齿轮停摆位置保留断电时刻。',
  },
  {
    id: 'prepared_chapter_outline',
    value: '暴雨夜，沈岚修复一份空白航海日志，听见哥哥留下的求救回声',
  },
] as const;
export const REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT = 4;
export const REAL_ACCEPTANCE_PREPARED_FULL_CHAPTER_COUNT = 15;
export const REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES = 2;
export const REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS = REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES + 1;
export const REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_RECOVERY_ERROR_CODES = [
  'DSH_REQUIRED_CONTEXT_READ_MISSING',
  'DSH_REQUIRED_CANDIDATE_TOOL_MISSING',
] as const;
export const REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION =
  'real_conversation_acceptance_evidence_v4' as const;
export const REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION =
  'chapter_candidate_integrity_v4' as const;

export const REAL_ACCEPTANCE_FAILURE_STAGES = [
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
] as const;

export type RealConversationAcceptanceFailureStage =
  (typeof REAL_ACCEPTANCE_FAILURE_STAGES)[number];

export function isAutomaticSummaryProtocolRecoveryError(error?: string): boolean {
  return REAL_ACCEPTANCE_AUTOMATIC_SUMMARY_RECOVERY_ERROR_CODES.some(
    (code) => error === code || error?.startsWith(`${code}:`) === true,
  );
}

export type RealConversationAcceptanceEvidenceOutcome =
  | {
      status: 'passed';
      failureStage: null;
      failureReason: '';
    }
  | {
      status: 'failed';
      failureStage: RealConversationAcceptanceFailureStage;
      failureReason: string;
    };

const REAL_ACCEPTANCE_FAILURE_STAGE_SET: ReadonlySet<string> = new Set(
  REAL_ACCEPTANCE_FAILURE_STAGES,
);

export function isRealConversationAcceptanceFailureStage(
  value: unknown,
): value is RealConversationAcceptanceFailureStage {
  return typeof value === 'string' && REAL_ACCEPTANCE_FAILURE_STAGE_SET.has(value);
}

export function assertRealConversationAcceptanceEvidenceOutcome(
  value: unknown,
): asserts value is RealConversationAcceptanceEvidenceOutcome & Record<string, unknown> {
  if (!isRecord(value) || (value.status !== 'passed' && value.status !== 'failed')) {
    throw new Error('Real conversation evidence must report passed or failed status.');
  }
  if (typeof value.failureReason !== 'string') {
    throw new Error('Real conversation evidence failureReason must be a string.');
  }
  if (value.status === 'passed') {
    if (value.failureStage !== null || value.failureReason !== '') {
      throw new Error('Passing real conversation evidence must have no failure stage or reason.');
    }
    return;
  }
  if (!isRealConversationAcceptanceFailureStage(value.failureStage)) {
    throw new Error('Failed real conversation evidence must report a known failureStage.');
  }
  if (!value.failureReason.trim()) {
    throw new Error('Failed real conversation evidence must report a failureReason.');
  }
}

export interface RealConversationArtifactCandidateIntegrityCheck {
  checker: 'inspectChapterCandidateIntegrity';
  source: 'persisted_result_artifact';
  executed: boolean;
  passed: boolean;
  artifactId: string;
  artifactContentSha256: string;
  issueCodes: string[];
}

export interface RealConversationIntegrityRepairAttemptEvidence {
  attempt: number;
  issueCodes: string[];
  sourceContentHash: string;
}

export type RealConversationSparseAssetKind =
  'story_plan' | 'world_setting' | 'rule_system' | 'protagonist' | 'chapter_outline';

export interface RealConversationCreativeUserTurnEvidence {
  sequence: number;
  turnId: string;
  source: 'user';
  classification:
    'initial_creative_brief' | 'chapter_generation_instruction' | 'continuation_instruction';
  contentSha256: string;
  contentLength: number;
}

export interface RealConversationAutomaticAssetPostRunProjectionEvidence {
  schemaVersion: 'workbench_dsh_post_run_projection_evidence_v1';
  scope: 'post_run_artifact_projection';
  hashAlgorithm: 'sha256';
  messagesSerialization: 'json_stringify_messages_v1';
  taskId: string;
  attemptId: string;
  providerRequestIdSha256: string;
  inputType: 'workbench_dsh_messages_v1';
  bodySha256: string;
  messagesSha256: string;
  messageCount: 1;
  projectedTurnContentSha256: string;
  decodedGoalSha256: string;
  turnOrigin: 'workbench_asset_preparation';
}

export interface RealConversationAutomaticAssetProviderRequestEvidence {
  schemaVersion: typeof REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION;
  captureMode: 'hash_only';
  hashAlgorithm: 'sha256';
  messagesSerialization: 'json_stringify_messages_v1';
  providerRequestIdSha256: string;
  requestBodySha256: string;
  messagesSha256: string;
  messageCount: number;
  messageTextSha256: string;
  messageTextCount: number;
  latestUserMessageSha256: string;
  latestUserMessageLength: number;
  classification: 'automatic_asset_preparation';
  turnOrigin: 'workbench_asset_preparation';
  assetKind: RealConversationSparseAssetKind;
  creativeBriefParseStatus: 'valid';
  creativeBrief: {
    schema: 'ans_core_asset_creative_brief_v1';
    source: 'original_user_goal';
    contentSha256: string;
    contentLength: number;
  };
  creativeBriefMarkerCount: number;
  latestUserCreativeBriefMarkerCount: 1;
  configuredPreparedFixtureCanaryIds: string[];
  matchedPreparedFixtureCanaryIds: string[];
  rawMessageContentPersisted: false;
}

export interface RealConversationAutomaticAssetPreparationEvidence {
  chapter: number;
  asset: RealConversationSparseAssetKind;
  goal: string;
  goalSha256: string;
  goalLength: number;
  turnId: string;
  turnOrigin: 'workbench_asset_preparation';
  runId: string;
  artifactId: string;
  artifactType: 'setting_candidates' | 'character_candidates' | 'outline';
  toolName: 'expand_settings' | 'generate_characters' | 'generate_outline';
  toolAttemptCount: number;
  failedToolAttemptCount: number;
  applyTransactionId: string;
  conflictCode: '';
  postRunProjectionEvidence: RealConversationAutomaticAssetPostRunProjectionEvidence;
  actualProviderRequestEvidence: RealConversationAutomaticAssetProviderRequestEvidence;
}

export interface CurrentRealConversationPassingEvidence {
  evidenceSchemaVersion: typeof REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION;
  candidateIntegrityContractVersion: typeof REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION;
  status: 'passed';
  failureStage: null;
  failureReason: '';
  model: { providerId: string; modelId: string };
  scenario: unknown;
  conversationId: string;
  userInstructions: string[];
  creativeUserTurns: RealConversationCreativeUserTurnEvidence[];
  userTurnCount: number;
  automaticAssetPreparationTurnCount: number;
  automaticAssetPreparations?: RealConversationAutomaticAssetPreparationEvidence[];
  automaticChapterSummaryTurnCount: number;
  runCount: number;
  artifactCount: number;
  plannedChapterCount: unknown;
  plannedTargetWordCount: number;
  chapterCount: unknown;
  completedChapterCount: number;
  totalWordCount: number;
  independentWordCount: number;
  chapterWordCountSum: number;
  novelWordCount: number;
  storyPlanApplyEvidence?: RealConversationStoryPlanApplyEvidence | null;
  chapters: Array<{
    chapter: number;
    status: 'passed';
    model: { providerId: string; modelId: string };
    chapterId: string;
    conversationId: string;
    chapterTitle: string;
    chapterOutline: string;
    chapterGoal: string;
    artifactId: string;
    candidateHash: string;
    adoptedHash: string;
    adoptedContent: string;
    continuitySourceHash: string;
    targetWordCount: number;
    originalWordCount: number;
    wordCount: number;
    lengthRepairCount: number;
    integrityRepairCount: number;
    integrityRepairAttempts: RealConversationIntegrityRepairAttemptEvidence[];
    summaryTurnId: string;
    summaryRunId: string;
    summaryArtifactId: string;
    summaryApplyTransactionId: string;
    summaryId: string;
    contextRecordCount: number;
    memorySourceTypes: string[];
    snapshotSourceTypes: string[];
    providerRequestEvidence: {
      schemaVersion: 'workbench_provider_request_evidence_v1';
      hashAlgorithm: 'sha256';
      messagesSerialization: 'json_stringify_messages_v1';
      taskId: string;
      attemptId: string;
      messageCount: number;
      messagesSha256: string;
      compiledContextSha256: string;
      snapshotContextHash: string;
      snapshotCompiledPromptSha256: string;
      snapshotRequestSourceSha256: string;
      includedSnapshotRequestSourceSha256: string;
      snapshotRequestSourceStatus: 'included';
      providerSourceStatus: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
      generationSourceStatuses: Record<string, string>;
    };
    artifactCandidateIntegrityCheck: RealConversationArtifactCandidateIntegrityCheck;
  }>;
}

export function assertCurrentRealConversationPassingEvidence(
  value: unknown,
): asserts value is CurrentRealConversationPassingEvidence {
  if (!isRecord(value) || value.status !== 'passed') {
    throw new Error('The real conversation evidence does not report a passing run.');
  }
  assertRealConversationAcceptanceEvidenceOutcome(value);
  if (value.evidenceSchemaVersion !== REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `The real conversation evidence schema is not ${REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION}.`,
    );
  }
  if (
    value.candidateIntegrityContractVersion !== REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION
  ) {
    throw new Error(
      `The candidate-integrity contract is not ${REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION}.`,
    );
  }
  if (!Array.isArray(value.chapters) || value.chapters.length === 0) {
    throw new Error('Passing real conversation evidence must contain chapter evidence.');
  }
  if (value.scenario !== 'prepared-assets' && value.scenario !== 'sparse-idea') {
    throw new Error('Passing real conversation evidence must report a supported scenario.');
  }
  const scenario: RealConversationAcceptanceScenario = value.scenario;
  if (
    typeof value.chapterCount !== 'number' ||
    !Number.isSafeInteger(value.chapterCount) ||
    value.chapterCount !== value.chapters.length
  ) {
    throw new Error(
      'Passing real conversation chapterCount must match every chapter evidence row.',
    );
  }
  const chapterCount = value.chapterCount;
  const topLevelModel = isRecord(value.model) ? value.model : undefined;
  const conversationId = typeof value.conversationId === 'string' ? value.conversationId : '';
  const expectedInstructions = buildRealConversationInstructions(
    { scenario: value.scenario },
    chapterCount,
  );
  if (
    !topLevelModel ||
    topLevelModel.providerId !== 'openai_compatible' ||
    typeof topLevelModel.modelId !== 'string' ||
    !topLevelModel.modelId.trim() ||
    !conversationId.trim() ||
    !Array.isArray(value.userInstructions) ||
    value.userInstructions.length !== expectedInstructions.length ||
    value.userInstructions.some(
      (instruction, index) => instruction !== expectedInstructions[index],
    ) ||
    value.userTurnCount !== chapterCount ||
    value.automaticChapterSummaryTurnCount !== chapterCount ||
    typeof value.runCount !== 'number' ||
    !Number.isSafeInteger(value.runCount) ||
    value.runCount < chapterCount ||
    typeof value.artifactCount !== 'number' ||
    !Number.isSafeInteger(value.artifactCount) ||
    value.artifactCount < chapterCount ||
    typeof value.plannedChapterCount !== 'number' ||
    !Number.isSafeInteger(value.plannedChapterCount) ||
    value.plannedChapterCount < chapterCount ||
    typeof value.plannedTargetWordCount !== 'number' ||
    !Number.isSafeInteger(value.plannedTargetWordCount) ||
    value.plannedTargetWordCount <= 0 ||
    value.completedChapterCount !== chapterCount
  ) {
    throw new Error(
      'Passing real conversation evidence does not retain one continuous short-instruction task and its planning counts.',
    );
  }
  const creativeUserTurns = Array.isArray(value.creativeUserTurns) ? value.creativeUserTurns : [];
  if (
    creativeUserTurns.length !== chapterCount ||
    new Set(
      creativeUserTurns.map((turn) =>
        isRecord(turn) && typeof turn.turnId === 'string' ? turn.turnId : '',
      ),
    ).size !== chapterCount ||
    creativeUserTurns.some((turn, index) => {
      if (!isRecord(turn)) return true;
      const instruction = expectedInstructions[index] ?? '';
      const expectedClassification =
        index > 0
          ? 'continuation_instruction'
          : scenario === 'sparse-idea'
            ? 'initial_creative_brief'
            : 'chapter_generation_instruction';
      return (
        turn.sequence !== index + 1 ||
        typeof turn.turnId !== 'string' ||
        !turn.turnId.trim() ||
        turn.source !== 'user' ||
        turn.classification !== expectedClassification ||
        safeSha256(turn.contentSha256) !==
          createHash('sha256').update(instruction, 'utf8').digest('hex') ||
        turn.contentLength !== instruction.length
      );
    })
  ) {
    throw new Error(
      'Passing real conversation evidence does not distinguish persisted creative user turns from automatic turns.',
    );
  }
  if (
    value.scenario === 'sparse-idea' &&
    (typeof value.automaticAssetPreparationTurnCount !== 'number' ||
      !Number.isSafeInteger(value.automaticAssetPreparationTurnCount) ||
      value.automaticAssetPreparationTurnCount < 3)
  ) {
    throw new Error(
      'Sparse-idea evidence does not retain its automatic formal-asset preparation turns.',
    );
  }
  if (value.scenario === 'sparse-idea') {
    assertSparseAutomaticAssetProviderEvidence(value);
  }
  if (value.scenario === 'sparse-idea') {
    const storyPlan = value.storyPlanApplyEvidence;
    if (
      !isRecord(storyPlan) ||
      storyPlan.applyResult !== 'applied' ||
      typeof storyPlan.applyTransactionId !== 'string' ||
      !storyPlan.applyTransactionId.trim() ||
      storyPlan.rootTargetWordCount !== value.plannedTargetWordCount ||
      storyPlan.chapterTargetWordCountSum !== value.plannedTargetWordCount
    ) {
      throw new Error(
        'Sparse-idea evidence does not retain an applied, word-consistent story plan.',
      );
    }
  }

  let chapterWordTotal = 0;
  let previousAdoptedHash = '';
  value.chapters.forEach((chapter, index) => {
    if (!isRecord(chapter) || chapter.status !== 'passed') {
      throw new Error(`Chapter ${index + 1} is not recorded as passed evidence.`);
    }
    if (
      typeof chapter.chapterTitle !== 'string' ||
      !chapter.chapterTitle.trim() ||
      typeof chapter.chapterOutline !== 'string' ||
      !chapter.chapterOutline.trim() ||
      typeof chapter.chapterGoal !== 'string' ||
      !chapter.chapterGoal.trim()
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain a reviewable formal title, outline, and goal.`,
      );
    }
    const chapterModel = isRecord(chapter.model) ? chapter.model : undefined;
    const adoptedHash = safeSha256(chapter.adoptedHash);
    const adoptedContent = typeof chapter.adoptedContent === 'string' ? chapter.adoptedContent : '';
    const calculatedAdoptedHash = adoptedContent
      ? createHash('sha256').update(adoptedContent, 'utf8').digest('hex')
      : '';
    if (
      !Object.prototype.hasOwnProperty.call(chapter, 'integrityRepairCount') ||
      typeof chapter.integrityRepairCount !== 'number' ||
      !Number.isSafeInteger(chapter.integrityRepairCount) ||
      chapter.integrityRepairCount < 0 ||
      chapter.integrityRepairCount > 2
    ) {
      throw new Error(
        `Chapter ${index + 1} does not explicitly record a bounded non-negative integrityRepairCount.`,
      );
    }
    if (
      chapter.chapter !== index + 1 ||
      typeof chapter.chapterId !== 'string' ||
      !chapter.chapterId.trim() ||
      chapter.conversationId !== conversationId ||
      !chapterModel ||
      chapterModel.providerId !== topLevelModel.providerId ||
      chapterModel.modelId !== topLevelModel.modelId ||
      !adoptedHash ||
      calculatedAdoptedHash !== adoptedHash ||
      (index === 0
        ? chapter.continuitySourceHash !== ''
        : chapter.continuitySourceHash !== previousAdoptedHash)
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain consistent task identity, model, adopted text, and continuity evidence.`,
      );
    }
    const targetWordCount = chapter.targetWordCount;
    const originalWordCount = chapter.originalWordCount;
    const finalWordCount = chapter.wordCount;
    const lengthRepairCount = chapter.lengthRepairCount;
    if (
      typeof targetWordCount !== 'number' ||
      !Number.isSafeInteger(targetWordCount) ||
      targetWordCount < 500 ||
      targetWordCount > 10_000 ||
      typeof originalWordCount !== 'number' ||
      !Number.isSafeInteger(originalWordCount) ||
      originalWordCount <= 0 ||
      typeof finalWordCount !== 'number' ||
      !Number.isSafeInteger(finalWordCount) ||
      finalWordCount <= 0 ||
      typeof lengthRepairCount !== 'number' ||
      !Number.isSafeInteger(lengthRepairCount) ||
      countTextWords(adoptedContent) !== finalWordCount ||
      !isRealAcceptanceLengthControlEvidenceConsistent({
        scenario,
        targetWordCount,
        originalWordCount,
        finalWordCount,
        lengthRepairCount,
        integrityRepairCount: chapter.integrityRepairCount,
      })
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain internally consistent length-control evidence.`,
      );
    }
    chapterWordTotal += finalWordCount;
    previousAdoptedHash = adoptedHash;
    const requiredMemorySourceTypes = ['adopted_draft', 'chapter_summary', 'context_record'];
    const memorySourceTypes = Array.isArray(chapter.memorySourceTypes)
      ? chapter.memorySourceTypes.filter(
          (sourceType): sourceType is string => typeof sourceType === 'string',
        )
      : [];
    if (
      typeof chapter.summaryTurnId !== 'string' ||
      !chapter.summaryTurnId.trim() ||
      typeof chapter.summaryRunId !== 'string' ||
      !chapter.summaryRunId.trim() ||
      typeof chapter.summaryArtifactId !== 'string' ||
      !chapter.summaryArtifactId.trim() ||
      typeof chapter.summaryApplyTransactionId !== 'string' ||
      !chapter.summaryApplyTransactionId.trim() ||
      typeof chapter.summaryId !== 'string' ||
      !chapter.summaryId.trim() ||
      typeof chapter.contextRecordCount !== 'number' ||
      !Number.isSafeInteger(chapter.contextRecordCount) ||
      chapter.contextRecordCount <= 0 ||
      memorySourceTypes.length !==
        (Array.isArray(chapter.memorySourceTypes) ? chapter.memorySourceTypes.length : -1) ||
      !requiredMemorySourceTypes.every((sourceType) => memorySourceTypes.includes(sourceType))
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain summary, Context, and Memory evidence.`,
      );
    }
    const integrityRepairAttempts = Array.isArray(chapter.integrityRepairAttempts)
      ? chapter.integrityRepairAttempts
      : [];
    if (
      !Object.prototype.hasOwnProperty.call(chapter, 'integrityRepairAttempts') ||
      !Array.isArray(chapter.integrityRepairAttempts) ||
      integrityRepairAttempts.length !== chapter.integrityRepairCount ||
      integrityRepairAttempts.some((attempt, attemptIndex) => {
        if (!isRecord(attempt)) return true;
        const issueCodes = Array.isArray(attempt.issueCodes) ? attempt.issueCodes : [];
        return (
          attempt.attempt !== attemptIndex + 1 ||
          issueCodes.length === 0 ||
          issueCodes.some((code) => typeof code !== 'string' || !/^chapter_[a-z_]+$/.test(code)) ||
          new Set(issueCodes).size !== issueCodes.length ||
          !safeSha256(attempt.sourceContentHash)
        );
      })
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain one hash-only issue record per integrity repair.`,
      );
    }

    const artifactId = typeof chapter.artifactId === 'string' ? chapter.artifactId : '';
    const candidateHash = safeSha256(chapter.candidateHash);
    const check = chapter.artifactCandidateIntegrityCheck;
    if (
      !artifactId ||
      !candidateHash ||
      !isRecord(check) ||
      check.checker !== 'inspectChapterCandidateIntegrity' ||
      check.source !== 'persisted_result_artifact' ||
      check.executed !== true ||
      check.passed !== true ||
      check.artifactId !== artifactId ||
      safeSha256(check.artifactContentSha256) !== candidateHash ||
      !Array.isArray(check.issueCodes) ||
      check.issueCodes.length !== 0
    ) {
      throw new Error(
        `Chapter ${index + 1} does not prove an independent passing integrity check of its persisted artifact.`,
      );
    }

    const requiredSourceTypes = [
      'novel',
      'world_setting',
      'protagonist',
      'chapter_outline',
      'style_profile',
      'output_profile',
      'user_instruction',
      ...(value.scenario === 'sparse-idea' ? ['rule_system'] : ['reference_material']),
      ...(index > 0 ? ['adopted_chapter'] : []),
    ];
    const rawSnapshotSourceTypes = chapter.snapshotSourceTypes;
    const snapshotSourceTypes = Array.isArray(rawSnapshotSourceTypes)
      ? rawSnapshotSourceTypes.filter(
          (sourceType): sourceType is string => typeof sourceType === 'string',
        )
      : [];
    if (
      !Array.isArray(rawSnapshotSourceTypes) ||
      snapshotSourceTypes.length !== rawSnapshotSourceTypes.length ||
      !requiredSourceTypes
        .filter((sourceType) => sourceType !== 'user_instruction')
        .every((sourceType) => snapshotSourceTypes.includes(sourceType))
    ) {
      throw new Error(`Chapter ${index + 1} does not retain every required snapshot source.`);
    }

    const provider = chapter.providerRequestEvidence;
    const providerSourceStatuses =
      isRecord(provider) && isRecord(provider.generationSourceStatuses)
        ? provider.generationSourceStatuses
        : {};
    const requiredProviderSourceTypes = [
      ...requiredSourceTypes,
      ...(lengthRepairCount > 0 || chapter.integrityRepairCount > 0 ? ['current_editor'] : []),
    ];
    const validProviderStatuses = ['included', 'truncated', 'omitted_empty', 'omitted_budget'];
    if (
      !isRecord(provider) ||
      provider.schemaVersion !== 'workbench_provider_request_evidence_v1' ||
      provider.hashAlgorithm !== 'sha256' ||
      provider.messagesSerialization !== 'json_stringify_messages_v1' ||
      typeof provider.taskId !== 'string' ||
      !provider.taskId.trim() ||
      typeof provider.attemptId !== 'string' ||
      !provider.attemptId.trim() ||
      typeof provider.messageCount !== 'number' ||
      !Number.isSafeInteger(provider.messageCount) ||
      provider.messageCount <= 0 ||
      !safeSha256(provider.messagesSha256) ||
      !safeSha256(provider.compiledContextSha256) ||
      !safeSha256(provider.snapshotCompiledPromptSha256) ||
      !safeSha256(provider.snapshotRequestSourceSha256) ||
      safeSha256(provider.includedSnapshotRequestSourceSha256) !==
        provider.snapshotRequestSourceSha256 ||
      provider.snapshotRequestSourceStatus !== 'included' ||
      !validProviderStatuses.includes(String(provider.providerSourceStatus)) ||
      typeof provider.snapshotContextHash !== 'string' ||
      !/^(?:txt_[0-9a-f]{8}|[0-9a-f]{64})$/.test(provider.snapshotContextHash) ||
      Object.values(providerSourceStatuses).some(
        (status) => !validProviderStatuses.includes(String(status)),
      ) ||
      !requiredProviderSourceTypes.every(
        (sourceType) => providerSourceStatuses[sourceType] === 'included',
      )
    ) {
      throw new Error(
        `Chapter ${index + 1} does not retain independently reviewable Provider source evidence.`,
      );
    }
  });
  if (
    value.totalWordCount !== chapterWordTotal ||
    value.independentWordCount !== chapterWordTotal ||
    value.chapterWordCountSum !== chapterWordTotal ||
    value.novelWordCount !== chapterWordTotal
  ) {
    throw new Error(
      'Passing real conversation evidence has inconsistent authoritative word ledgers.',
    );
  }
}

function assertSparseAutomaticAssetProviderEvidence(value: Record<string, unknown>): void {
  const preparations = Array.isArray(value.automaticAssetPreparations)
    ? value.automaticAssetPreparations
    : [];
  const preparationCount = value.automaticAssetPreparationTurnCount;
  const expectedCanaryIds = REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES.map((canary) => canary.id);
  const automaticTurnIds = preparations.map((preparation) =>
    isRecord(preparation) && typeof preparation.turnId === 'string' ? preparation.turnId : '',
  );
  const creativeTurnIds = new Set(
    (Array.isArray(value.creativeUserTurns) ? value.creativeUserTurns : []).map((turn) =>
      isRecord(turn) && typeof turn.turnId === 'string' ? turn.turnId : '',
    ),
  );
  const sparseIdeaHash = createHash('sha256')
    .update(REAL_ACCEPTANCE_SPARSE_IDEA, 'utf8')
    .digest('hex');
  if (
    typeof preparationCount !== 'number' ||
    preparations.length !== preparationCount ||
    preparations.length < 3 ||
    new Set(automaticTurnIds).size !== preparations.length ||
    automaticTurnIds.some((turnId) => !turnId || creativeTurnIds.has(turnId)) ||
    !preparations.some(
      (preparation) => isRecord(preparation) && preparation.asset === 'world_setting',
    ) ||
    preparations.some((preparation) => {
      if (!isRecord(preparation)) return true;
      const goal = typeof preparation.goal === 'string' ? preparation.goal : '';
      const projection = preparation.postRunProjectionEvidence;
      const provider = preparation.actualProviderRequestEvidence;
      if (!isRecord(projection) || !isRecord(provider)) return true;
      const brief = provider.creativeBrief;
      const configuredCanaryIds = Array.isArray(provider.configuredPreparedFixtureCanaryIds)
        ? provider.configuredPreparedFixtureCanaryIds
        : [];
      const matchedCanaryIds = Array.isArray(provider.matchedPreparedFixtureCanaryIds)
        ? provider.matchedPreparedFixtureCanaryIds
        : [];
      return (
        preparation.turnOrigin !== 'workbench_asset_preparation' ||
        typeof preparation.turnId !== 'string' ||
        !preparation.turnId.trim() ||
        typeof preparation.runId !== 'string' ||
        !preparation.runId.trim() ||
        !goal ||
        safeSha256(preparation.goalSha256) !==
          createHash('sha256').update(goal, 'utf8').digest('hex') ||
        preparation.goalLength !== goal.length ||
        projection.schemaVersion !== 'workbench_dsh_post_run_projection_evidence_v1' ||
        projection.scope !== 'post_run_artifact_projection' ||
        projection.hashAlgorithm !== 'sha256' ||
        projection.messagesSerialization !== 'json_stringify_messages_v1' ||
        projection.inputType !== 'workbench_dsh_messages_v1' ||
        typeof projection.taskId !== 'string' ||
        !projection.taskId.trim() ||
        typeof projection.attemptId !== 'string' ||
        !projection.attemptId.trim() ||
        !safeSha256(projection.providerRequestIdSha256) ||
        !safeSha256(projection.bodySha256) ||
        !safeSha256(projection.messagesSha256) ||
        projection.messageCount !== 1 ||
        !safeSha256(projection.projectedTurnContentSha256) ||
        projection.projectedTurnContentSha256 === preparation.goalSha256 ||
        projection.decodedGoalSha256 !== preparation.goalSha256 ||
        projection.turnOrigin !== 'workbench_asset_preparation' ||
        provider.schemaVersion !== REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION ||
        provider.captureMode !== 'hash_only' ||
        provider.hashAlgorithm !== 'sha256' ||
        provider.messagesSerialization !== 'json_stringify_messages_v1' ||
        provider.providerRequestIdSha256 !== projection.providerRequestIdSha256 ||
        !safeSha256(provider.requestBodySha256) ||
        !safeSha256(provider.messagesSha256) ||
        provider.messagesSha256 === projection.messagesSha256 ||
        typeof provider.messageCount !== 'number' ||
        !Number.isSafeInteger(provider.messageCount) ||
        provider.messageCount <= projection.messageCount ||
        !safeSha256(provider.messageTextSha256) ||
        typeof provider.messageTextCount !== 'number' ||
        !Number.isSafeInteger(provider.messageTextCount) ||
        provider.messageTextCount < provider.messageCount ||
        !safeSha256(provider.latestUserMessageSha256) ||
        typeof provider.latestUserMessageLength !== 'number' ||
        !Number.isSafeInteger(provider.latestUserMessageLength) ||
        provider.latestUserMessageLength <= goal.length ||
        provider.classification !== 'automatic_asset_preparation' ||
        provider.turnOrigin !== 'workbench_asset_preparation' ||
        provider.assetKind !== preparation.asset ||
        provider.creativeBriefParseStatus !== 'valid' ||
        !isRecord(brief) ||
        brief.schema !== 'ans_core_asset_creative_brief_v1' ||
        brief.source !== 'original_user_goal' ||
        brief.contentSha256 !== sparseIdeaHash ||
        brief.contentLength !== REAL_ACCEPTANCE_SPARSE_IDEA.length ||
        typeof provider.creativeBriefMarkerCount !== 'number' ||
        !Number.isSafeInteger(provider.creativeBriefMarkerCount) ||
        provider.creativeBriefMarkerCount < 1 ||
        provider.latestUserCreativeBriefMarkerCount !== 1 ||
        configuredCanaryIds.length !== expectedCanaryIds.length ||
        configuredCanaryIds.some((id, index) => id !== expectedCanaryIds[index]) ||
        matchedCanaryIds.length !== 0 ||
        provider.rawMessageContentPersisted !== false
      );
    })
  ) {
    throw new Error(
      'Sparse-idea automatic asset evidence does not prove the original creative brief reached the actual Provider request without prepared fixture injection.',
    );
  }
}

export interface RealConversationAcceptanceProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: RealConversationAcceptanceMode;
  scenario: RealConversationAcceptanceScenario;
  chapterTimeoutMs: number;
}

export interface RealConversationStoryPlanChapter {
  title: string;
  outline: string;
  goal: string;
  targetWordCount: number;
}

export interface RealConversationStoryPlanExpectation {
  targetWordCount: number;
  chapters: RealConversationStoryPlanChapter[];
}

export interface RealConversationStoryPlanApplyEvidence {
  artifactId: string | null;
  rootTargetWordCount: number | null;
  chapterTargetWordCountSum: number | null;
  frozenTarget: {
    target: number | null;
    minimum: number | null;
    maximum: number | null;
  };
  frozenSource: {
    turnId: string | null;
    turnSequence: number | null;
    contentSha256: string | null;
  };
  applyResult: 'pending' | 'applied' | 'failed';
  applyTransactionId: string | null;
  applyErrorCode: string | null;
}

export function createRealConversationStoryPlanApplyEvidence(input: {
  artifactId: string;
  candidateText: string;
  frozenTarget?: {
    target?: unknown;
    minimum?: unknown;
    maximum?: unknown;
    sourceTurnId?: unknown;
    sourceTurnSequence?: unknown;
    sourceContentSha256?: unknown;
  };
}): RealConversationStoryPlanApplyEvidence {
  let plan: RealConversationStoryPlanExpectation | undefined;
  try {
    plan = parseRealConversationStoryPlan(input.candidateText);
  } catch {
    // Diagnostics must not replace the production artifact validation/apply flow.
  }
  return {
    artifactId: safeEvidenceIdentifier(input.artifactId),
    rootTargetWordCount: plan?.targetWordCount ?? null,
    chapterTargetWordCountSum:
      plan?.chapters.reduce((sum, chapter) => sum + chapter.targetWordCount, 0) ?? null,
    frozenTarget: {
      target: positiveEvidenceInteger(input.frozenTarget?.target),
      minimum: positiveEvidenceInteger(input.frozenTarget?.minimum),
      maximum: positiveEvidenceInteger(input.frozenTarget?.maximum),
    },
    frozenSource: {
      turnId:
        typeof input.frozenTarget?.sourceTurnId === 'string'
          ? safeEvidenceIdentifier(input.frozenTarget.sourceTurnId)
          : null,
      turnSequence: nonNegativeEvidenceInteger(input.frozenTarget?.sourceTurnSequence),
      contentSha256: safeSha256(input.frozenTarget?.sourceContentSha256),
    },
    applyResult: 'pending',
    applyTransactionId: null,
    applyErrorCode: null,
  };
}

export function recordRealConversationStoryPlanApplySuccess(
  evidence: RealConversationStoryPlanApplyEvidence,
  applyTransactionId: string,
): RealConversationStoryPlanApplyEvidence {
  return {
    ...evidence,
    applyResult: 'applied',
    applyTransactionId: safeEvidenceIdentifier(applyTransactionId),
    applyErrorCode: null,
  };
}

export function recordRealConversationStoryPlanApplyFailure(
  evidence: RealConversationStoryPlanApplyEvidence,
  applyErrorCode: string,
): RealConversationStoryPlanApplyEvidence {
  return {
    ...evidence,
    applyResult: 'failed',
    applyTransactionId: null,
    applyErrorCode: safeApplyErrorCode(applyErrorCode),
  };
}

export interface RealConversationGenerationSnapshotBridgeRecord {
  id: string;
  novelId: string;
  volumeId: string | null;
  chapterId: string;
  engineeringStateId: string | null;
  styleProfileId: string | null;
  outputProfileId: string | null;
  compiledContextJson: string;
  compiledPromptText: string;
  promptSummary: string;
  contextHash: string;
  sourcesJson: string;
  createdAt: string;
}

export interface RealConversationGenerationSnapshotSection {
  key: string;
  title: string;
  content: string;
  sourceTypes: string[];
}

export interface RealConversationGenerationSnapshotSource {
  type: string;
  title: string;
  sourceId?: string;
  status: 'used' | 'missing' | 'fallback';
  summary?: string;
}

export interface RealConversationGenerationSnapshot extends Omit<
  RealConversationGenerationSnapshotBridgeRecord,
  'compiledContextJson' | 'sourcesJson'
> {
  compiledContext: {
    sections: RealConversationGenerationSnapshotSection[];
  };
  sources: RealConversationGenerationSnapshotSource[];
}

export interface RealConversationFixtureCanary {
  label: string;
  value: string;
}

export interface RealConversationFixtureSurface {
  label: string;
  content: string;
}

export interface RealConversationFixtureLeak {
  canaryLabel: string;
  surfaceLabel: string;
}

export const REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE = {
  name: '默认小说风格',
  sourceType: 'system_default',
  narrativePerspective: '第三人称有限视角',
  tone: '中性偏沉稳',
  pace: '中等',
  dialogueRatio: 0.35,
  descriptionRatio: 0.4,
  styleSummary: '适合大多数小说的通用风格配置。',
  isActive: true,
} as const;

export const REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE = {
  name: '默认章节配置',
  targetWordCount: 4_000,
  minWordCount: 3_000,
  maxWordCount: 6_000,
  paragraphLength: 'medium',
  povType: 'third_person_limited',
  tenseType: 'past',
  paceLevel: 'medium',
  dialogueRatio: 0.35,
  descriptionRatio: 0.4,
  endingHookRequired: true,
  isDefault: true,
} as const;

const REAL_ACCEPTANCE_BUILT_IN_STYLE_PROJECTION = [
  '叙事人称：第三人称有限视角',
  '文风语气：中性偏沉稳',
  '节奏：中等',
  '对话比例：35%，描写比例：40%',
  `风格总结：${REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE.styleSummary}`,
] as const;

const REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROJECTION = [
  `方案名称：${REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE.name}`,
  '最少字数：3000 字',
  '最多字数：6000 字',
  '段落长度：中等段落',
  '叙事视角：第三人称限知',
  '叙事时态：过去时',
  '节奏等级：中等',
  '结尾必须有钩子',
] as const;

export function findRealConversationFixtureLeaks(
  surfaces: readonly RealConversationFixtureSurface[],
  canaries: readonly RealConversationFixtureCanary[],
): RealConversationFixtureLeak[] {
  const leaks: RealConversationFixtureLeak[] = [];
  for (const surface of surfaces) {
    for (const canary of canaries) {
      const value = canary.value.trim();
      if (value && surface.content.includes(value)) {
        leaks.push({ canaryLabel: canary.label, surfaceLabel: surface.label });
      }
    }
  }
  return leaks;
}

export function assertRealConversationBuiltInProfileSelection(input: {
  styleProfileId: string | null;
  outputProfileId: string | null;
  styleProfiles: readonly unknown[];
  outputProfiles: readonly unknown[];
  styleOutputSection: string;
}): void {
  const style = input.styleProfiles.find(
    (candidate) => isRecord(candidate) && candidate.id === input.styleProfileId,
  );
  const output = input.outputProfiles.find(
    (candidate) => isRecord(candidate) && candidate.id === input.outputProfileId,
  );
  if (!isRecord(style) || !isRecord(output)) {
    throw new Error('Sparse generation did not retain resolvable built-in style/output profiles.');
  }
  if (profileOwner(style) || !recordMatches(style, REAL_ACCEPTANCE_BUILT_IN_STYLE_PROFILE)) {
    throw new Error('Sparse generation did not select the global built-in default style profile.');
  }
  if (profileOwner(output) || !recordMatches(output, REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROFILE)) {
    throw new Error('Sparse generation did not select the global built-in default output profile.');
  }
  const missingProjection = [
    ...REAL_ACCEPTANCE_BUILT_IN_STYLE_PROJECTION,
    ...REAL_ACCEPTANCE_BUILT_IN_OUTPUT_PROJECTION,
  ].filter((canary) => !input.styleOutputSection.includes(canary));
  if (missingProjection.length > 0) {
    throw new Error(
      `Sparse generation style/output projection is incomplete: ${missingProjection.join(', ')}.`,
    );
  }
}

export function buildRealConversationInstructions(
  profile: Pick<RealConversationAcceptanceProfile, 'scenario'>,
  chapterCount: number,
): string[] {
  assertPositiveChapterCount(chapterCount);
  return Array.from({ length: chapterCount }, (_, index) =>
    index === 0
      ? profile.scenario === 'sparse-idea'
        ? REAL_ACCEPTANCE_SPARSE_IDEA
        : REAL_ACCEPTANCE_GATE_INSTRUCTIONS[0]
      : REAL_ACCEPTANCE_GATE_INSTRUCTIONS[1],
  );
}

export function assertGateInstructionContract(
  profile: Pick<RealConversationAcceptanceProfile, 'mode' | 'scenario'>,
  plannedChapterCount: number,
  instructions: readonly string[],
): void {
  if (profile.mode !== 'gate') return;
  const expectedInstructions = buildRealConversationInstructions(
    profile,
    resolveRealConversationRunChapterCount(profile, plannedChapterCount),
  );
  if (
    instructions.length !== expectedInstructions.length ||
    instructions.some((instruction, index) => instruction !== expectedInstructions[index])
  ) {
    throw new Error(
      profile.scenario === 'sparse-idea'
        ? 'Sparse-idea gate must contain exactly one ordinary creative brief followed by 继续写.'
        : 'Prepared-assets gate must contain exactly: 生成本章正文, 继续写.',
    );
  }
}

export function preparedRealConversationChapterCount(
  profile: Pick<RealConversationAcceptanceProfile, 'mode'>,
): 4 | 15 {
  return profile.mode === 'full'
    ? REAL_ACCEPTANCE_PREPARED_FULL_CHAPTER_COUNT
    : REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT;
}

export function resolveRealConversationRunChapterCount(
  profile: Pick<RealConversationAcceptanceProfile, 'mode'>,
  plannedChapterCount: number,
): number {
  assertPositiveChapterCount(plannedChapterCount);
  return profile.mode === 'gate'
    ? Math.min(REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT, plannedChapterCount)
    : plannedChapterCount;
}

export function parseRealConversationStoryPlan(
  candidateText: string,
): RealConversationStoryPlanExpectation {
  let value: unknown;
  try {
    value = JSON.parse(candidateText);
  } catch (error) {
    throw new Error(
      `Story plan artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value) || value.planKind !== 'story_plan') {
    throw new Error('Story plan artifact must declare planKind=story_plan.');
  }
  const targetWordCount = positiveInteger(value.targetWordCount, 'targetWordCount');
  if (!Array.isArray(value.volumes) || value.volumes.length === 0) {
    throw new Error('Story plan artifact must contain at least one volume.');
  }
  const chapters: RealConversationStoryPlanChapter[] = [];
  value.volumes.forEach((volume, volumeIndex) => {
    if (!isRecord(volume) || !Array.isArray(volume.chapters) || volume.chapters.length === 0) {
      throw new Error(`Story plan volumes[${volumeIndex}].chapters is empty or invalid.`);
    }
    volume.chapters.forEach((chapter, chapterIndex) => {
      if (!isRecord(chapter)) {
        throw new Error(
          `Story plan volumes[${volumeIndex}].chapters[${chapterIndex}] is not an object.`,
        );
      }
      chapters.push({
        title: requiredStoryPlanText(
          chapter.title,
          `volumes[${volumeIndex}].chapters[${chapterIndex}].title`,
        ),
        outline: requiredStoryPlanText(
          chapter.outline,
          `volumes[${volumeIndex}].chapters[${chapterIndex}].outline`,
        ),
        goal: requiredStoryPlanText(
          chapter.goal,
          `volumes[${volumeIndex}].chapters[${chapterIndex}].goal`,
        ),
        targetWordCount: positiveInteger(
          chapter.targetWordCount,
          `volumes[${volumeIndex}].chapters[${chapterIndex}].targetWordCount`,
        ),
      });
    });
  });
  assertPositiveChapterCount(chapters.length);
  const chapterTargetTotal = chapters.reduce((sum, chapter) => sum + chapter.targetWordCount, 0);
  if (
    targetWordCount < Math.floor(chapterTargetTotal * 0.8) ||
    targetWordCount > Math.ceil(chapterTargetTotal * 1.2)
  ) {
    throw new Error('Story plan targetWordCount is inconsistent with its chapter targets.');
  }
  return { targetWordCount, chapters };
}

export function shouldPreseedRealAcceptanceStoryAssets(
  profile: Pick<RealConversationAcceptanceProfile, 'scenario'>,
): boolean {
  return profile.scenario === 'prepared-assets';
}

export function parseRealConversationGenerationSnapshot(
  snapshot: RealConversationGenerationSnapshotBridgeRecord,
  chapterNumber: number,
): RealConversationGenerationSnapshot {
  try {
    const compiledContext = parseSnapshotContext(JSON.parse(snapshot.compiledContextJson));
    const sources = parseSnapshotSources(JSON.parse(snapshot.sourcesJson));
    return {
      id: snapshot.id,
      novelId: snapshot.novelId,
      volumeId: snapshot.volumeId,
      chapterId: snapshot.chapterId,
      engineeringStateId: snapshot.engineeringStateId,
      styleProfileId: snapshot.styleProfileId,
      outputProfileId: snapshot.outputProfileId,
      compiledPromptText: snapshot.compiledPromptText,
      promptSummary: snapshot.promptSummary,
      contextHash: snapshot.contextHash,
      createdAt: snapshot.createdAt,
      compiledContext,
      sources,
    };
  } catch (error) {
    throw new Error(
      `Chapter ${chapterNumber} snapshot JSON is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSnapshotContext(
  value: unknown,
): RealConversationGenerationSnapshot['compiledContext'] {
  if (!isRecord(value) || !Array.isArray(value.sections)) {
    throw new Error('compiledContextJson.sections is not an array.');
  }
  return {
    sections: value.sections.map((section, index) => {
      if (
        !isRecord(section) ||
        typeof section.key !== 'string' ||
        typeof section.title !== 'string' ||
        typeof section.content !== 'string' ||
        !Array.isArray(section.sourceTypes) ||
        section.sourceTypes.some((sourceType) => typeof sourceType !== 'string')
      ) {
        throw new Error(`compiledContextJson.sections[${index}] has an invalid shape.`);
      }
      return {
        key: section.key,
        title: section.title,
        content: section.content,
        sourceTypes: section.sourceTypes,
      };
    }),
  };
}

function parseSnapshotSources(value: unknown): RealConversationGenerationSnapshotSource[] {
  if (!Array.isArray(value)) throw new Error('sourcesJson is not an array.');
  return value.map((source, index) => {
    if (
      !isRecord(source) ||
      typeof source.type !== 'string' ||
      typeof source.title !== 'string' ||
      !['used', 'missing', 'fallback'].includes(String(source.status)) ||
      (source.sourceId !== undefined && typeof source.sourceId !== 'string') ||
      (source.summary !== undefined && typeof source.summary !== 'string')
    ) {
      throw new Error(`sourcesJson[${index}] has an invalid shape.`);
    }
    return {
      type: source.type,
      title: source.title,
      sourceId: source.sourceId as string | undefined,
      status: source.status as RealConversationGenerationSnapshotSource['status'],
      summary: source.summary as string | undefined,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function profileOwner(profile: Record<string, unknown>): string {
  const owner =
    typeof profile.novelId === 'string'
      ? profile.novelId
      : typeof profile.projectId === 'string'
        ? profile.projectId
        : '';
  return owner.trim();
}

function recordMatches(
  record: Record<string, unknown>,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(expected).every(([key, value]) => record[key] === value);
}

const MIN_CHAPTER_TIMEOUT_MS = 60_000;
const MAX_CHAPTER_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_CHAPTER_TIMEOUT_MS = 12 * 60_000;

export function readRealConversationAcceptanceProfile(
  env: NodeJS.ProcessEnv,
): RealConversationAcceptanceProfile {
  if (env[REAL_ACCEPTANCE_ENV.enabled] !== '1') {
    throw new Error(
      `${REAL_ACCEPTANCE_ENV.enabled}=1 is required to opt in to real-model acceptance costs.`,
    );
  }

  const baseUrl = requireLoopbackBaseUrl(env[REAL_ACCEPTANCE_ENV.baseUrl]);
  const model = requiredSingleLine(env[REAL_ACCEPTANCE_ENV.model], 'real-model identifier', 200);
  const apiKey = requiredSingleLine(
    env[REAL_ACCEPTANCE_ENV.apiKey],
    'real-model credential',
    16_384,
  );
  const mode = parseMode(env[REAL_ACCEPTANCE_ENV.mode]);
  const scenario = parseScenario(env[REAL_ACCEPTANCE_ENV.scenario]);
  const chapterTimeoutMs = parseChapterTimeout(env[REAL_ACCEPTANCE_ENV.chapterTimeoutMs]);

  return {
    baseUrl,
    model,
    apiKey,
    mode,
    scenario,
    chapterTimeoutMs,
  };
}

function parseScenario(value: string | undefined): RealConversationAcceptanceScenario {
  const scenario = value?.trim().toLowerCase() || 'sparse-idea';
  if (scenario !== 'prepared-assets' && scenario !== 'sparse-idea') {
    throw new Error(`${REAL_ACCEPTANCE_ENV.scenario} must be prepared-assets or sparse-idea.`);
  }
  return scenario;
}

function assertPositiveChapterCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new Error('Story plan chapter count must be an integer from 1 to 200.');
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Story plan ${field} must be a positive integer.`);
  }
  return value;
}

function requiredStoryPlanText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Story plan ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveEvidenceInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeEvidenceInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeSha256(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function safeEvidenceIdentifier(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized) &&
    !/^(?:sk[-_]|agt_)/i.test(normalized)
    ? normalized
    : null;
}

function safeApplyErrorCode(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(normalized) &&
    !/^(?:sk[-_]|agt_)/i.test(normalized)
    ? normalized
    : 'REAL_ACCEPTANCE_APPLY_FAILED';
}

export function environmentWithoutRealCredential(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safeEnvironment = { ...env };
  delete safeEnvironment[REAL_ACCEPTANCE_ENV.apiKey];
  return safeEnvironment;
}

export function assertSecretAbsent(
  value: string | Uint8Array,
  secret: string,
  label: string,
): void {
  if (!secret) throw new Error('Cannot audit an empty real-model credential.');
  const source = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  if (source.includes(Buffer.from(secret, 'utf8'))) {
    throw new Error(`${label} contained the real-model credential and was rejected.`);
  }
}

export function isTransientRealAcceptanceProviderFailure(error: string): boolean {
  return /\b(?:http(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(?:408|429|5\d\d)\b/i.test(error);
}

export function isRetryableRealAcceptanceRunFailure(error: string): boolean {
  return (
    isTransientRealAcceptanceProviderFailure(error) ||
    /章节候选在\s*\d+\s*次长度收敛后仍为\s*\d+\s*字，(?:超过允许上限\s*\d+\s*字|未落入允许范围\s*\d+\s*-\s*\d+\s*字)。请重试本回合/.test(
      error,
    ) ||
    /章节候选在\s*\d+\s*次完整性修复后仍未通过：(?:chapter_opening_rollback|chapter_tail_pollution|chapter_meta_reasoning_leakage)(?:,\s*(?:chapter_opening_rollback|chapter_tail_pollution|chapter_meta_reasoning_leakage))*。请重试本回合/.test(
      error,
    )
  );
}

export function persistedGenerationArtifactCountForFailedRun(error: string): number {
  const convergence = error.match(
    /章节候选在\s*(\d+)\s*次(?:长度收敛|完整性修复)后仍(?:为\s*\d+\s*字，(?:超过允许上限\s*\d+\s*字|未落入允许范围\s*\d+\s*-\s*\d+\s*字)|未通过：)/,
  );
  if (!convergence) return 0;
  const repairCount = Number(convergence[1]);
  return Number.isSafeInteger(repairCount) && repairCount >= 0 ? repairCount + 1 : 0;
}

function parseMode(value: string | undefined): RealConversationAcceptanceMode {
  const mode = value?.trim().toLowerCase() || 'gate';
  if (mode !== 'gate' && mode !== 'full') {
    throw new Error(`${REAL_ACCEPTANCE_ENV.mode} must be gate or full.`);
  }
  return mode;
}

function parseChapterTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_CHAPTER_TIMEOUT_MS;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CHAPTER_TIMEOUT_MS ||
    parsed > MAX_CHAPTER_TIMEOUT_MS
  ) {
    throw new Error(
      `${REAL_ACCEPTANCE_ENV.chapterTimeoutMs} must be an integer from ${MIN_CHAPTER_TIMEOUT_MS} to ${MAX_CHAPTER_TIMEOUT_MS}.`,
    );
  }
  return parsed;
}

function requiredSingleLine(
  value: string | undefined,
  label: string,
  maximumLength: number,
): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximumLength || /[\r\n]/.test(normalized)) {
    throw new Error(`${label} must be a single line of at most ${maximumLength} characters.`);
  }
  return normalized;
}

function requireLoopbackBaseUrl(value: string | undefined): string {
  const raw = requiredSingleLine(value, 'real-model Base URL', 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('real-model Base URL must be an absolute URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('real-model Base URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('real-model Base URL must not contain credentials, query, or fragment data.');
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error('real-model Base URL is restricted to an explicit loopback host.');
  }
  return url.href.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}
