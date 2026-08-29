/// <reference types="@wdio/globals/types" />
import { browser } from '@wdio/globals';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTextareaTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from '../e2e/helpers';
import {
  assertRealConversationBuiltInProfileSelection,
  assertGateInstructionContract,
  buildRealConversationInstructions,
  createRealConversationStoryPlanApplyEvidence,
  findRealConversationFixtureLeaks,
  isAutomaticSummaryProtocolRecoveryError,
  isRetryableRealAcceptanceRunFailure,
  parseRealConversationGenerationSnapshot,
  persistedGenerationArtifactCountForFailedRun,
  parseRealConversationStoryPlan,
  preparedRealConversationChapterCount,
  readRealConversationAcceptanceProfile,
  recordRealConversationStoryPlanApplyFailure,
  recordRealConversationStoryPlanApplySuccess,
  REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
  REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
  REAL_ACCEPTANCE_ENV,
  REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES,
  REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS,
  REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES,
  REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION,
  REAL_ACCEPTANCE_SPARSE_IDEA,
  resolveRealConversationRunChapterCount,
  shouldPreseedRealAcceptanceStoryAssets,
  type RealConversationAcceptanceEvidenceOutcome,
  type RealConversationAcceptanceFailureStage,
  type RealConversationAcceptanceScenario,
  type RealConversationAutomaticAssetPostRunProjectionEvidence,
  type RealConversationAutomaticAssetProviderRequestEvidence,
  type RealConversationArtifactCandidateIntegrityCheck,
  type RealConversationCreativeUserTurnEvidence,
  type RealConversationGenerationSnapshot,
  type RealConversationGenerationSnapshotBridgeRecord,
  type RealConversationStoryPlanApplyEvidence,
} from '../../scripts/e2e/real-conversation-acceptance-profile.ts';
import { decodeWorkbenchTurnContent } from '../../src/services/conversation/workbenchTurnOrigin.ts';
import {
  buildCoreAssetGenerationGoal,
  isCoreAssetGenerationGoal,
  type ChapterCoreAsset,
} from '../../src/services/conversation/chapterAssetReadiness.ts';
import { inspectChapterCandidateIntegrity } from '../../src/services/generation/chapterCandidateIntegrity.ts';
import {
  isRealAcceptanceLengthControlEvidenceConsistent,
  resolveRealAcceptanceChapterWordRange,
} from './chapter-word-count-contract.ts';

interface ResultArtifactBundle {
  artifact: {
    artifactId: string;
    taskId: string;
    artifactType: string;
    sourceNovelId: string;
    sourceChapterId?: string;
    sourceDraftId?: string;
    sourceDraftVersion?: number;
    sourceBaseContentHash?: string;
    contentHash: string;
    processingStatus: string;
  };
  rawContent: string;
}

interface BookWordGoalEvidence {
  contractVersion: 'ans_book_word_goal_v1';
  parserVersion: 'zh_book_words_v1';
  sourceTurnId: string;
  sourceTurnSequence: number;
  sourceContentSha256: string;
  targetWords: number;
  comparison: 'approximate' | 'exact';
  toleranceBps: number;
  minimumWords: number;
  maximumWords: number;
}

interface AiTaskDetail {
  task: {
    taskId: string;
    status: string;
    resultArtifactId?: string;
    targetHintJson?: { bookWordGoal?: BookWordGoalEvidence };
  };
  attempts: Array<{
    attemptId: string;
    providerRequestId?: string;
    status: string;
  }>;
  inputSnapshot: {
    inputType: string;
    payloadJson: unknown;
    body: string;
  };
  contextSnapshot: {
    sourceManifestJson: unknown;
    compiledContext: string;
  };
}

interface WorkbenchProviderRequestEvidence {
  schemaVersion: 'workbench_provider_request_evidence_v1';
  hashAlgorithm: 'sha256';
  messagesSerialization: 'json_stringify_messages_v1';
  taskId?: string;
  attemptId?: string;
  messagesSha256: string;
  messageCount: number;
  compiledContextSha256: string;
  snapshotContextHash: string;
  snapshotCompiledPromptSha256: string;
  snapshotRequestSourceSha256: string;
  includedSnapshotRequestSourceSha256?: string;
  snapshotRequestSourceStatus: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  providerSourceStatus?: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  generationSourceStatuses?: Record<
    string,
    'included' | 'truncated' | 'omitted_empty' | 'omitted_budget'
  >;
}

interface TaskConversationBundle {
  conversation: { conversationId: string; novelId: string; status: string };
  turns: Array<{ turnId: string; role: string; content?: string }>;
  runs: Array<{
    runId: string;
    turnId: string;
    status: string;
    error?: string;
    modelSnapshot: {
      providerId: string;
      modelId: string;
      runtimeMode: string;
      baseUrl?: string;
      options?: Record<string, unknown>;
    };
  }>;
  toolEvents: Array<{
    runId: string;
    toolName: string;
    status: string;
    error?: string;
    result?: {
      generationContext?: {
        contextHash?: string;
        continuitySourceHash?: string;
        continuitySourceChapterId?: string;
        sources?: Array<{
          type: string;
          title: string;
          status: 'used' | 'missing' | 'fallback';
        }>;
        targetWordCount?: number;
        originalWordCount?: number;
        finalWordCount?: number;
        lengthRepairCount?: number;
        integrityRepairCount?: number;
        integrityRepairAttempts?: IntegrityRepairAttemptEvidence[];
        providerRequestEvidence?: WorkbenchProviderRequestEvidence;
      };
    };
  }>;
  artifacts: Array<{
    artifactId: string;
    artifactType: string;
    cardId: string;
    turnId?: string;
    runId?: string;
  }>;
  decisions: Array<{
    decision: string;
    artifactId: string;
    applyTransactionId?: string;
    conflictCode?: string;
  }>;
  authorizations: Array<{
    authorizationId: string;
    artifactId: string;
    status: string;
    consumedByDraftId?: string;
  }>;
}

interface IntegrityRepairAttemptEvidence {
  attempt: number;
  issueCodes: string[];
  sourceContentHash: string;
}

interface DshTaskRuntimeStatus {
  runId: string;
  status: string;
}

interface ChapterRecord {
  id: string;
  novelId?: string;
  volumeId?: string;
  title?: string;
  outline?: string;
  goal?: string;
  targetWordCount?: number;
  orderIndex?: number;
  sortOrder?: number;
  status?: string;
  adoptedDraftId?: string;
  wordCount: number;
}

interface DraftRecord {
  id: string;
  content: string;
  isAdopted: boolean;
  wordCount: number;
  versionNo?: number;
}

interface ChapterSummaryRecord {
  id: string;
  novelId: string;
  chapterId: string;
  adoptedDraftId: string;
  summary: string;
  enabled: boolean;
  contentHash?: string;
  draftVersion?: number;
  isExpired: boolean;
}

interface ContextRecord {
  id: string;
  novelId: string;
  chapterId?: string;
  contextType: string;
  content: string;
  isActive: boolean;
  isExpired: boolean;
  contentHash?: string;
  draftVersion?: number;
}

interface MemoryDocumentPage {
  total: number;
  items: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    sourceHash: string;
    adoptedDraftId?: string;
    chapterId?: string;
    status: string;
  }>;
}

interface ReviewAuthorizationRecord {
  authorizationId: string;
  artifactId: string;
  status: string;
  consumedByDraftId?: string;
}

interface NovelRecord {
  totalWordCount: number;
  targetWordCount?: number;
  protagonists?: Array<{ name?: string; identity?: string; motivation?: string }>;
  protagonistsJson?: string;
}

interface WorldSettingRecord {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
}

interface RuleSystemRecord {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
}

interface ChapterAssetRecord {
  id: string;
  title: string;
  outline?: string;
  goal?: string;
}

interface ClosedLoopState {
  conversationsCount: number;
  runsCount: number;
  toolEventsCount: number;
  resultArtifactsCount: number;
  artifactDecisionsCount: number;
  reviewAuthorizationsCount: number;
  consumedAuthorizationsCount: number;
  adoptedDraftsCount: number;
}

interface ChapterEvidence {
  chapter: number;
  status: 'running' | 'passed' | 'failed';
  model: { providerId: string; modelId: string };
  chapterId: string;
  chapterTitle: string;
  chapterOutline: string;
  chapterGoal: string;
  conversationId: string;
  turnId: string;
  runId: string;
  artifactId: string;
  instructionHash: string;
  snapshotId: string;
  snapshotSourceTypes: string[];
  styleProfileId: string;
  outputProfileId: string;
  continuitySourceHash: string;
  providerRequestEvidence: WorkbenchProviderRequestEvidence | null;
  targetWordCount: number;
  originalWordCount: number;
  lengthRepairCount: number;
  integrityRepairCount: number;
  integrityRepairAttempts: IntegrityRepairAttemptEvidence[];
  artifactCandidateIntegrityCheck: RealConversationArtifactCandidateIntegrityCheck;
  wordCount: number;
  candidateHash: string;
  adoptedHash: string;
  adoptedContent: string;
  summaryTurnId: string;
  summaryRunId: string;
  summaryArtifactId: string;
  summaryApplyTransactionId: string;
  summaryId: string;
  summaryRetryCount: number;
  summaryAttempts: ChapterRunAttemptEvidence[];
  contextRecordCount: number;
  memorySourceTypes: string[];
  retryCount: number;
  attempts: ChapterRunAttemptEvidence[];
  error: string;
  durationMs: number;
}

interface ChapterRunAttemptEvidence {
  attempt: number;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  error: string;
}

type SparseAssetKind = 'story_plan' | 'world_setting' | 'protagonist' | 'chapter_outline';

interface SparseAssetPreparationEvidence {
  chapter: number;
  asset: SparseAssetKind;
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

interface AutomaticAssetResumeDiagnostic {
  goal: string;
  turnId: string;
  runId: string;
  runStatus: string;
  artifactCount: number;
}

const WORLD_BACKGROUND =
  '近未来海港城临雾依靠“回声档案”保存市民记忆。任何被系统删除的记忆都会在旧城区化作只有少数人能听见的声音；十年前的港口事故和旧灯塔是被官方改写的历史核心。';
const PROTAGONIST_NAME = '沈岚';
const PROTAGONIST_IDENTITY = '二十七岁的档案修复师';
const PROTAGONIST_MOTIVATION = '查明哥哥沈砚在十年前港口事故中失踪的真相';
const STYLE_PROFILE_NAME = '默认小说风格';
const STYLE_PROFILE_SUMMARY = '适合大多数小说的通用风格配置。';
const OUTPUT_PROFILE_NAME = '默认章节配置';
const RESEARCH_REFERENCE_TITLE = '临雾港口与灯塔研究资料';
const RESEARCH_REFERENCE_TEXT =
  '潮汐港口的旧式机械钟可通过齿轮停摆位置保留断电时刻。沿岸灯塔通常设有维护井、潮位刻度与独立机械日志，用于在主系统失效时核对航行时间。';
const CHAPTER_OUTLINES = [
  '暴雨夜，沈岚修复一份空白航海日志，听见哥哥留下的求救回声；她隐瞒异常，并在日志夹层发现旧灯塔坐标。结尾由档案馆的自动审计突然锁定她的工位。',
  '沈岚借设备故障脱身，前往封闭的旧灯塔；顾闻舟奉命跟踪却选择暂不逮捕她。两人在潮井里找到记录十年前事故时间的机械钟，确认官方时间线被改写。',
  '机械钟引出失踪船员家属名单。沈岚和顾闻舟走访沉默的修船匠，得知事故当晚有一艘没有编号的档案船离港；馆方追踪者逼近，修船匠为保护证据受伤。',
  '两人潜入废弃潮汐站读取档案船航迹。沈岚第一次主动使用回声能力，看见哥哥把一枚数据钥匙交给年幼的自己；她因记忆反噬险些溺水，顾闻舟救下她。',
  '数据钥匙藏在沈岚童年旧居。陆惟川公开宣布她窃取公民记忆，使两人成为通缉对象；他们在旧居找到钥匙，却发现其中一半认证属于顾闻舟失踪多年的母亲。',
  '顾闻舟坦白母亲曾参与回声档案的底层设计。二人因隐瞒发生冲突，仍决定合作破解钥匙；钥匙显示事故不是灾难，而是一次清除全城反对者记忆的实验。',
  '为取得服务器入口，两人混入海祭庆典。沈岚在人群回声中辨认出仍然活着的事故幸存者，并发现哥哥可能被困在离线档案层；身份暴露后，他们沿花车机械轨道逃离。',
  '幸存者带他们进入地下诊所，解释离线档案会逐渐吞噬被保存者的自我。沈岚必须在救哥哥和公开全部证据之间选择；顾闻舟提出先复制证据，但复制会触发全城警报。',
  '复制开始后，城市出现短暂记忆错位。普通人想起被删除的亲友，秩序濒临失控；沈岚停止粗暴复制，转而设计分批释放方案，却因此失去一次直接救出哥哥的机会。',
  '陆惟川主动联络沈岚，声称集体遗忘曾阻止更大规模冲突，并邀请她查看原始事故记录。沈岚赴约，发现哥哥当年也参与了系统启动，但在最后时刻试图终止实验。',
  '顾闻舟从外围寻找证据，识破陆惟川利用半真相离间他们。沈岚在馆长办公室留下暗号，两人隔着监控协作，取得原始授权链；陆惟川启动永久擦除倒计时。',
  '二人分头潜入中央档案塔。顾闻舟组织幸存者牵制巡查系统，沈岚进入离线层与哥哥的残存意识相遇；哥哥要求她放弃复原他，把权限用于归还全城记忆。',
  '沈岚接受告别，带着哥哥最后的授权离开离线层。陆惟川亲自阻拦，双方围绕“痛苦是否应被遗忘”展开行动与对话交锋；档案塔在风暴和过载中开始坍塌。',
  '沈岚和顾闻舟在倒计时结束前完成分批公开。市民逐步恢复真相而非瞬间混乱，陆惟川的命令链被公开；两人救出受困人员，陆惟川选择留下维护即将熄灭的核心。',
  '数月后，临雾建立由市民共同监督的新档案制度。沈岚整理哥哥留下的普通生活记忆，不再只追逐死亡真相；她与顾闻舟在修复后的灯塔听见最后一声回响，并决定让记忆保留被选择和讲述的权利。',
] as const;

const TARGET_CHAPTER_WORDS = 4100;
const SPARSE_BOOK_TARGET_WORDS = 60_000;
const SPARSE_BOOK_MIN_WORDS = 54_000;
const SPARSE_BOOK_MAX_WORDS = 66_000;
const SPARSE_ASSET_ORDER: SparseAssetKind[] = [
  'world_setting',
  'protagonist',
  'story_plan',
  'chapter_outline',
];
const SPARSE_ASSET_CONTRACT: Record<
  SparseAssetKind,
  {
    instruction: string;
    artifactType: SparseAssetPreparationEvidence['artifactType'];
    toolName: SparseAssetPreparationEvidence['toolName'];
  }
> = {
  story_plan: {
    instruction: '生成全书规划候选',
    artifactType: 'outline',
    toolName: 'generate_outline',
  },
  world_setting: {
    instruction: '生成世界与规则设定候选',
    artifactType: 'setting_candidates',
    toolName: 'expand_settings',
  },
  protagonist: {
    instruction: '生成主角候选',
    artifactType: 'character_candidates',
    toolName: 'generate_characters',
  },
  chapter_outline: {
    instruction: '生成本章大纲候选',
    artifactType: 'outline',
    toolName: 'generate_outline',
  },
};

describe('explicit real-model short-instruction conversation acceptance', () => {
  it('creates all chapter turns in one task and retains review/save/adopt gates', async () => {
    const profile = readRealConversationAcceptanceProfile(process.env);
    const preseedStoryAssets = shouldPreseedRealAcceptanceStoryAssets(profile);
    const evidenceDirectory = requiredEnvironment('AI_NOVEL_STUDIO_REAL_E2E_EVIDENCE_DIR');
    const evidencePath = path.join(evidenceDirectory, 'real-conversation-evidence.json');
    const chapters: ChapterEvidence[] = [];
    const assetPreparations: SparseAssetPreparationEvidence[] = [];
    let creativeTurnEvidence: RealConversationCreativeUserTurnEvidence[] = [];
    const automaticAssetResumeDiagnostics: AutomaticAssetResumeDiagnostic[] = [];
    let status: 'passed' | 'failed' = 'failed';
    let activeFailureStage: RealConversationAcceptanceFailureStage = 'setup';
    let failureStage: RealConversationAcceptanceFailureStage | null = null;
    let failureReason = '';
    let baseline: ClosedLoopState | undefined;
    let independentWordCount = 0;
    let chapterWordCountSum = 0;
    let novelWordCount = 0;
    let conversationId = '';
    let observedUserTurnCount = 0;
    let observedRunCount = 0;
    let observedArtifactCount = 0;
    let observedAutomaticAssetTurnCount = 0;
    let observedAutomaticSummaryTurnCount = 0;
    let plannedChapterCount = 0;
    let plannedTargetWordCount = 0;
    let bookWordGoal: BookWordGoalEvidence | undefined;
    let storyPlanApplyEvidence: RealConversationStoryPlanApplyEvidence | null = null;
    let runChapterCount = preseedStoryAssets ? preparedRealConversationChapterCount(profile) : 1;
    let instructions = buildRealConversationInstructions(profile, runChapterCount);
    const prompts: string[] = [];

    try {
      await waitForTestId('app-shell');
      await configureRealModelThroughSettings(profile);

      const novelId = await createProjectThroughUi(
        preseedStoryAssets ? '真实对话验收' : '稀疏创意真实对话验收',
      );
      const chapterIds: string[] = [];
      if (preseedStoryAssets) {
        await openWorkspace(novelId);
        const volumeId = await createVolumeThroughUi('正文');
        for (let index = 0; index < runChapterCount; index += 1) {
          chapterIds.push(await createTargetChapterThroughUi(`第 ${index + 1} 章`, volumeId));
        }
        await prepareRealAcceptanceAssetsThroughUi({
          novelId,
          chapterIds,
          chapterOutlines: CHAPTER_OUTLINES.slice(0, runChapterCount),
          evidenceDirectory,
        });
        plannedChapterCount = chapterIds.length;
        plannedTargetWordCount = plannedChapterCount * TARGET_CHAPTER_WORDS;
        runChapterCount = resolveRealConversationRunChapterCount(profile, plannedChapterCount);
        instructions = buildRealConversationInstructions(profile, runChapterCount);
        assertGateInstructionContract(profile, plannedChapterCount, instructions);
      } else {
        await assertSparseIdeaStartingState(novelId);
      }
      baseline = await bridgeCall<ClosedLoopState>('get_e2e_agent_closed_loop_state');

      activeFailureStage = 'chapter_execution';
      for (let index = 0; index < runChapterCount; index += 1) {
        const evidence: ChapterEvidence = {
          chapter: index + 1,
          status: 'running',
          model: { providerId: 'openai_compatible', modelId: profile.model },
          chapterId: '',
          chapterTitle: '',
          chapterOutline: '',
          chapterGoal: '',
          conversationId: '',
          turnId: '',
          runId: '',
          artifactId: '',
          instructionHash: '',
          snapshotId: '',
          snapshotSourceTypes: [],
          styleProfileId: '',
          outputProfileId: '',
          continuitySourceHash: '',
          providerRequestEvidence: null,
          targetWordCount: 0,
          originalWordCount: 0,
          lengthRepairCount: 0,
          integrityRepairCount: 0,
          integrityRepairAttempts: [],
          artifactCandidateIntegrityCheck: {
            checker: 'inspectChapterCandidateIntegrity',
            source: 'persisted_result_artifact',
            executed: false,
            passed: false,
            artifactId: '',
            artifactContentSha256: '',
            issueCodes: [],
          },
          wordCount: 0,
          candidateHash: '',
          adoptedHash: '',
          adoptedContent: '',
          summaryTurnId: '',
          summaryRunId: '',
          summaryArtifactId: '',
          summaryApplyTransactionId: '',
          summaryId: '',
          summaryRetryCount: 0,
          summaryAttempts: [],
          contextRecordCount: 0,
          memorySourceTypes: [],
          retryCount: 0,
          attempts: [],
          error: '',
          durationMs: 0,
        };
        chapters.push(evidence);
        const startedAt = Date.now();
        try {
          const chapterId = chapterIds[index] ?? '';
          const expectedContinuitySourceHash = chapters[index - 1]?.adoptedHash ?? '';
          const prompt = instructions[index];
          prompts.push(prompt);
          conversationId = await runChapterClosedLoop({
            chapterNumber: index + 1,
            novelId,
            chapterId,
            conversationId: conversationId || undefined,
            prompt,
            expectedPrompts: prompts,
            expectedContinuitySourceHash,
            previousAdoptedContent: chapters[index - 1]?.adoptedContent ?? '',
            profile,
            evidence,
            assetPreparations,
            automaticAssetResumeDiagnostics,
            recordStoryPlanApplyEvidence: (nextEvidence) => {
              storyPlanApplyEvidence = nextEvidence;
            },
          });
          if (!preseedStoryAssets && chapterIds.length === 0) {
            const planned = await readAndAssertPlannedChapterIds(novelId, assetPreparations);
            chapterIds.push(...planned.chapterIds);
            plannedChapterCount = planned.chapterIds.length;
            plannedTargetWordCount = planned.targetWordCount;
            bookWordGoal = planned.bookWordGoal;
            runChapterCount = resolveRealConversationRunChapterCount(profile, plannedChapterCount);
            instructions = buildRealConversationInstructions(profile, runChapterCount);
            assertGateInstructionContract(profile, plannedChapterCount, instructions);
          }
          requireCondition(
            evidence.chapterId === chapterIds[index],
            `Chapter ${index + 1} did not follow the planned full-book order.`,
          );
          const progressBundle = await bridgeCall<TaskConversationBundle | null>(
            'get_task_conversation',
            { conversationId },
          );
          requireCondition(
            Boolean(progressBundle),
            'The continuous task conversation disappeared.',
          );
          observedUserTurnCount = progressBundle!.turns.filter(
            (turn) => turn.role === 'user' && !isAutomaticWorkbenchTurn(turn),
          ).length;
          observedAutomaticAssetTurnCount = progressBundle!.turns.filter(
            (turn) => turn.role === 'user' && isAutomaticAssetPreparationTurn(turn),
          ).length;
          observedAutomaticSummaryTurnCount = progressBundle!.turns.filter(
            (turn) => turn.role === 'user' && isAutomaticChapterSummaryTurn(turn),
          ).length;
          observedRunCount = progressBundle!.runs.length;
          observedArtifactCount = progressBundle!.artifacts.length;
          evidence.status = 'passed';
          // eslint-disable-next-line no-console -- long real runs need chapter-level progress.
          console.log(
            `[REAL ACCEPTANCE] chapter ${index + 1}/${runChapterCount} passed; wordCount=${evidence.wordCount}; durationMs=${Date.now() - startedAt}`,
          );
        } catch (error) {
          evidence.status = 'failed';
          evidence.error = safeEvidenceError(error);
          conversationId = evidence.conversationId || conversationId;
          if (conversationId) {
            const progressBundle = await bridgeCall<TaskConversationBundle | null>(
              'get_task_conversation',
              { conversationId },
            );
            observedUserTurnCount =
              progressBundle?.turns.filter(
                (turn) => turn.role === 'user' && !isAutomaticWorkbenchTurn(turn),
              ).length ?? observedUserTurnCount;
            observedAutomaticAssetTurnCount =
              progressBundle?.turns.filter(
                (turn) => turn.role === 'user' && isAutomaticAssetPreparationTurn(turn),
              ).length ?? observedAutomaticAssetTurnCount;
            observedAutomaticSummaryTurnCount =
              progressBundle?.turns.filter(
                (turn) => turn.role === 'user' && isAutomaticChapterSummaryTurn(turn),
              ).length ?? observedAutomaticSummaryTurnCount;
            observedRunCount = progressBundle?.runs.length ?? observedRunCount;
            observedArtifactCount = progressBundle?.artifacts.length ?? observedArtifactCount;
          }
          throw error;
        } finally {
          evidence.durationMs = Date.now() - startedAt;
        }
      }

      activeFailureStage = 'word_counts';
      const totalWordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
      if (profile.mode === 'full') {
        const minimum = profile.scenario === 'sparse-idea' ? SPARSE_BOOK_MIN_WORDS : 60_000;
        const maximum = profile.scenario === 'sparse-idea' ? SPARSE_BOOK_MAX_WORDS : 75_000;
        requireCondition(
          totalWordCount >= minimum && totalWordCount <= maximum,
          `Full profile word count ${totalWordCount} is outside ${minimum}-${maximum}.`,
        );
      }

      const executedChapterIds = chapters.map((chapter) => chapter.chapterId);
      const authoritativeTotals = await readAuthoritativeWordCounts(novelId, executedChapterIds);
      independentWordCount = authoritativeTotals.independentWordCount;
      chapterWordCountSum = authoritativeTotals.chapterWordCountSum;
      novelWordCount = authoritativeTotals.novelWordCount;
      requireCondition(
        independentWordCount === chapterWordCountSum,
        `Independent adopted-text count ${independentWordCount} disagrees with chapter rows ${chapterWordCountSum}.`,
      );
      requireCondition(
        novelWordCount === chapterWordCountSum,
        `Novel cached word count ${novelWordCount} disagrees with chapter rows ${chapterWordCountSum}.`,
      );

      activeFailureStage = 'closed_loop';
      const finalState = await bridgeCall<ClosedLoopState>('get_e2e_agent_closed_loop_state');
      const failedRunArtifactCount = chapters.reduce(
        (chapterTotal, chapter) =>
          chapterTotal +
          chapter.attempts.reduce(
            (attemptTotal, attempt) =>
              attempt.status === 'failed'
                ? attemptTotal + persistedGenerationArtifactCountForFailedRun(attempt.error)
                : attemptTotal,
            0,
          ),
        0,
      );
      assertClosedLoopDeltas(
        baseline,
        finalState,
        chapters.length,
        chapters.reduce((sum, chapter) => sum + chapter.attempts.length, 0),
        chapters.length +
          chapters.reduce((sum, chapter) => sum + chapter.lengthRepairCount, 0) +
          chapters.reduce((sum, chapter) => sum + chapter.integrityRepairCount, 0) +
          failedRunArtifactCount +
          assetPreparations.length +
          chapters.length,
        assetPreparations.length,
        chapters.reduce((sum, chapter) => sum + chapter.summaryAttempts.length, 0),
      );
      activeFailureStage = 'final_conversation';
      const finalBundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId,
      });
      assertFinalContinuousConversation(
        finalBundle,
        prompts,
        chapters,
        assetPreparations,
        profile.scenario,
      );
      creativeTurnEvidence = buildCreativeUserTurnEvidence(
        creativeUserTurns(finalBundle),
        prompts,
        profile.scenario,
      );
      activeFailureStage = 'diagnostics';
      await assertCleanDiagnostics();
      status = 'passed';
    } catch (error) {
      failureStage = activeFailureStage;
      failureReason = safeEvidenceError(error);
      throw error;
    } finally {
      const completed = chapters.filter((chapter) => chapter.status === 'passed');
      const outcome: RealConversationAcceptanceEvidenceOutcome =
        status === 'passed'
          ? { status: 'passed', failureStage: null, failureReason: '' }
          : {
              status: 'failed',
              failureStage: failureStage ?? activeFailureStage,
              failureReason,
            };
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            evidenceSchemaVersion: REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
            candidateIntegrityContractVersion: REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
            ...outcome,
            model: { providerId: 'openai_compatible', modelId: profile.model },
            scenario: profile.scenario,
            preseededFormalStoryAssets: preseedStoryAssets,
            conversationId,
            userInstructions: prompts,
            creativeUserTurns: creativeTurnEvidence,
            userTurnCount: observedUserTurnCount,
            automaticAssetPreparationTurnCount: observedAutomaticAssetTurnCount,
            automaticAssetPreparations: assetPreparations,
            automaticAssetResumeDiagnostics,
            automaticChapterSummaryTurnCount: observedAutomaticSummaryTurnCount,
            runCount: observedRunCount,
            artifactCount: observedArtifactCount,
            plannedChapterCount,
            plannedTargetWordCount,
            bookWordGoal,
            storyPlanApplyEvidence,
            chapterCount: runChapterCount,
            completedChapterCount: completed.length,
            totalWordCount: completed.reduce((sum, chapter) => sum + chapter.wordCount, 0),
            independentWordCount,
            chapterWordCountSum,
            novelWordCount,
            totalDurationMs: chapters.reduce((sum, chapter) => sum + chapter.durationMs, 0),
            chapters,
          },
          null,
          2,
        ),
        { encoding: 'utf8', flag: 'wx' },
      );
    }
  });
});

async function configureRealModelThroughSettings(
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>,
): Promise<void> {
  await navigateHash('#/settings');
  await clickTestId('settings-nav-ai_models');
  await waitForTestId('settings-tab-pane-ai-models');

  const mockMode = await browser.$('#mockMode');
  if (await mockMode.isSelected()) await mockMode.click();
  const provider = await browser.$(
    '//label[normalize-space(.)="Provider"]/following-sibling::select',
  );
  await provider.selectByAttribute('value', 'openai_compatible');

  await setInputValue('input[placeholder*="api.deepseek.com/v1"]', profile.baseUrl);
  await setInputValue('input[type="password"][placeholder="sk-..."]', profile.apiKey);
  await setInputValue('input[placeholder*="deepseek-chat"]', profile.model);
  await setInputValue(
    '//label[contains(normalize-space(.), "最大输出 Token")]/following-sibling::input',
    '12000',
  );
  await setInputValue(
    '//label[contains(normalize-space(.), "超时时间")]/following-sibling::input',
    '600',
  );

  const providerSave = await browser.$('//button[contains(., "保存设置")]');
  await providerSave.waitForClickable({ timeout: 30_000 });
  await providerSave.click();
  await waitForSettingsMessage('AI 设置已保存');

  const credentialPersisted = await browser.execute((credential) => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (window.localStorage.getItem(key) ?? '').includes(credential)) return true;
    }
    return false;
  }, profile.apiKey);
  requireCondition(
    credentialPersisted === false,
    'The real-model credential reached LocalStorage.',
  );

  await clickTestId('settings-nav-governance');
  await waitForTestId('settings-tab-pane-governance');
  const requestLimit = await browser.$(
    '//span[normalize-space(.)="每分钟最多请求"]/following-sibling::input',
  );
  requireCondition(
    (await requestLimit.getValue()) === '60',
    'The real-model acceptance profile did not start from the production 60 RPM default.',
  );
  const save = await browser.$('//button[contains(., "保存调用保护")]');
  await save.waitForClickable({ timeout: 30_000 });
  await save.click();
  await waitForPersistedRealSettings(profile, 60);
  await clickTestId('settings-nav-ai_models');
  await waitForTestId('settings-tab-pane-ai-models');
  await assertSessionModelForm(profile);
}

async function waitForSettingsMessage(expected: string): Promise<void> {
  await browser.waitUntil(async () => (await browser.$('body').getText()).includes(expected), {
    timeout: 30_000,
    timeoutMsg: `Settings did not report: ${expected}`,
  });
}

async function waitForPersistedRealSettings(
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>,
  maxRequestsPerMinute: number,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (expected) => {
          const raw = window.localStorage.getItem('ai_novel_studio_ai_settings');
          if (!raw) return false;
          try {
            const settings = JSON.parse(raw) as Record<string, unknown>;
            return (
              settings.runtimeMode === 'api' &&
              settings.provider === 'openai_compatible' &&
              settings.baseUrl === expected.baseUrl &&
              settings.modelName === expected.model &&
              settings.maxTokens === 12_000 &&
              settings.timeoutSeconds === 600 &&
              settings.maxRequestsPerMinute === expected.maxRequestsPerMinute &&
              !Object.prototype.hasOwnProperty.call(settings, 'apiKey')
            );
          } catch {
            return false;
          }
        },
        { ...profile, apiKey: undefined, maxRequestsPerMinute },
      ),
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: 'The non-secret real-model settings snapshot did not persist.',
    },
  );
}

async function assertSessionModelForm(
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>,
): Promise<void> {
  const matches = await browser.execute((expected) => {
    const provider = document.querySelector(
      'label.panel-field-label + select.panel-select',
    ) as HTMLSelectElement | null;
    const baseUrl = document.querySelector(
      'input[placeholder*="api.deepseek.com/v1"]',
    ) as HTMLInputElement | null;
    const apiKey = document.querySelector(
      'input[type="password"][placeholder="sk-..."]',
    ) as HTMLInputElement | null;
    const model = document.querySelector(
      'input[placeholder*="deepseek-chat"]',
    ) as HTMLInputElement | null;
    return {
      provider: provider?.value === 'openai_compatible',
      baseUrl: baseUrl?.value === expected.baseUrl,
      credential: apiKey?.value === expected.apiKey,
      model: model?.value === expected.model,
    };
  }, profile);
  requireCondition(
    Object.values(matches).every(Boolean),
    `The session model form did not retain its exact identity: provider=${matches.provider}; baseUrl=${matches.baseUrl}; credential=${matches.credential}; model=${matches.model}.`,
  );
}

interface ChapterRunInput {
  chapterNumber: number;
  novelId: string;
  chapterId: string;
  conversationId?: string;
  prompt: string;
  expectedPrompts: readonly string[];
  expectedContinuitySourceHash: string;
  previousAdoptedContent: string;
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>;
  evidence: ChapterEvidence;
  assetPreparations: SparseAssetPreparationEvidence[];
  automaticAssetResumeDiagnostics: AutomaticAssetResumeDiagnostic[];
  recordStoryPlanApplyEvidence: (evidence: RealConversationStoryPlanApplyEvidence) => void;
}

async function createContinuousTask(input: ChapterRunInput): Promise<string> {
  const previousConversationId = await readVisibleConversationId();
  await clickTestId('workbench-create-task');
  await waitForTestId('workbench-task-creator');
  await fillControlledTaskGoal(input.prompt);
  if (input.chapterId) {
    const chapterSelect = await waitForTestId('workbench-new-task-chapter');
    await chapterSelect.selectByAttribute('value', input.chapterId);
    await waitForStableSelectValue(
      chapterSelect,
      input.chapterId,
      `Chapter ${input.chapterNumber} initial target selection did not settle.`,
    );
  }
  const selectedModel = await selectExactModel(input.profile.model);
  requireCondition(
    selectedModel === `openai_compatible:${input.profile.model}`,
    `Chapter ${input.chapterNumber} did not bind the requested model.`,
  );

  const start = await waitForTestId('workbench-create-and-start');
  try {
    await start.waitForEnabled({ timeout: 120_000 });
  } catch {
    const modelStatus = await browser.$('[data-testid="workbench-new-task-model-status"]');
    const contextPending = await browser.$('[data-testid="workbench-new-task-context-pending"]');
    throw new Error(
      `Chapter ${input.chapterNumber} task start remained disabled: button=${JSON.stringify(await start.getText())}; model=${JSON.stringify((await modelStatus.isExisting()) ? await modelStatus.getText() : '')}; contextPending=${await contextPending.isExisting()}.`,
    );
  }
  await assertTaskGoalValue(input.prompt);
  await start.click();
  const conversationId = await waitForNewConversationId(
    previousConversationId,
    input.chapterNumber,
  );
  await waitForPersistedConversationTurns(conversationId, input.expectedPrompts);
  return conversationId;
}

async function appendChapterTurn(input: ChapterRunInput): Promise<string> {
  const conversationId = input.conversationId!;
  const task = await findTestIdByAttribute(
    'workbench-task',
    'data-conversation-id',
    conversationId,
  );
  await task.click();
  await browser.waitUntil(async () => (await task.getAttribute('data-selected')) === 'true', {
    timeout: 30_000,
    timeoutMsg: `Chapter ${input.chapterNumber} did not restore the continuous task.`,
  });
  await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);

  await fillControlledTextareaTestId('workbench-composer-input', input.prompt);
  const send = await waitForTestId('workbench-send-task');
  await send.waitForEnabled({ timeout: 120_000 });
  await send.waitForClickable({ timeout: 30_000 });
  await send.click();
  await waitForPersistedConversationTurns(conversationId, input.expectedPrompts);
  if (input.chapterId) {
    await waitForWorkbenchTargetChapter(input.chapterId, input.chapterNumber);
  }
  return conversationId;
}

async function waitForWorkbenchTargetChapter(
  chapterId: string,
  chapterNumber: number,
): Promise<void> {
  const chapterSelect = await waitForTestId('workbench-chapter-select');
  await waitForStableSelectValue(
    chapterSelect,
    chapterId,
    `Chapter ${chapterNumber} workbench target selection did not settle.`,
  );
}

async function readSelectedWorkbenchChapterId(chapterNumber: number): Promise<string> {
  const chapterSelect = await waitForTestId('workbench-chapter-select');
  let selected = '';
  await browser.waitUntil(
    async () => {
      selected = String(await chapterSelect.getValue()).trim();
      return Boolean(selected);
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${chapterNumber} did not resolve a workbench target after planning.`,
    },
  );
  return selected;
}

async function runChapterClosedLoop(input: ChapterRunInput): Promise<string> {
  await navigateHash('#/');
  await waitForTestId('creative-workbench');
  const project = await findTestIdByAttribute('workbench-project', 'data-novel-id', input.novelId);
  await project.click();
  await browser.waitUntil(async () => (await project.getAttribute('data-selected')) === 'true', {
    timeout: 30_000,
    timeoutMsg: `Chapter ${input.chapterNumber} project selection did not settle.`,
  });
  const conversationId = input.conversationId
    ? await appendChapterTurn(input)
    : await createContinuousTask(input);
  input.evidence.conversationId = conversationId;
  if (input.profile.scenario === 'sparse-idea' && input.chapterNumber === 1) {
    await prepareSparseIdeaAssetsThroughUi({
      chapterNumber: input.chapterNumber,
      novelId: input.novelId,
      conversationId,
      originalGoal: input.prompt,
      expectedPrompts: input.expectedPrompts,
      profile: input.profile,
      evidence: input.assetPreparations,
      resumeDiagnostics: input.automaticAssetResumeDiagnostics,
      recordStoryPlanApplyEvidence: input.recordStoryPlanApplyEvidence,
    });
  }
  const resolvedChapterId = await readSelectedWorkbenchChapterId(input.chapterNumber);
  if (input.chapterId) {
    requireCondition(
      resolvedChapterId === input.chapterId,
      `Chapter ${input.chapterNumber} workbench selected ${resolvedChapterId || 'none'} instead of the planned target.`,
    );
  } else {
    input.chapterId = resolvedChapterId;
  }
  input.evidence.chapterId = input.chapterId;
  const currentTurnId = await waitForLatestTurnRun(conversationId, input.expectedPrompts);
  const fixedModel = await waitForTestId('workbench-model-select');
  requireCondition(
    (await fixedModel.getValue()) === `openai_compatible:${input.profile.model}` &&
      (await fixedModel.isEnabled()) === false &&
      (await fixedModel.getAttribute('data-model-locked')) === 'true',
    `Chapter ${input.chapterNumber} did not keep its task model fixed.`,
  );

  await waitForChapterRunWithTransientRecovery({
    chapterNumber: input.chapterNumber,
    conversationId,
    turnId: currentTurnId,
    chapterTimeoutMs: input.profile.chapterTimeoutMs,
    evidence: input.evidence,
  });

  const activeBundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
    conversationId,
  });
  const currentRun = assertActiveConversation(activeBundle, input);
  input.evidence.turnId = currentRun.turnId;
  input.evidence.runId = currentRun.runId;
  input.evidence.instructionHash = sha256(input.prompt);
  const writerEvent = activeBundle!.toolEvents.find(
    (event) =>
      event.runId === currentRun.runId &&
      event.toolName === 'generate_chapter' &&
      event.status === 'succeeded',
  );
  const generationContext = writerEvent?.result?.generationContext;
  const observedContinuitySourceHash = generationContext?.continuitySourceHash ?? '';
  requireCondition(
    Boolean(generationContext?.contextHash) &&
      observedContinuitySourceHash === input.expectedContinuitySourceHash &&
      (input.chapterNumber === 1 || Boolean(generationContext?.continuitySourceChapterId)),
    `Chapter ${input.chapterNumber} did not prove its production continuity source: expected=${input.expectedContinuitySourceHash || 'none'}; observed=${observedContinuitySourceHash || 'none'}.`,
  );
  input.evidence.continuitySourceHash = observedContinuitySourceHash;
  input.evidence.targetWordCount = generationContext?.targetWordCount ?? 0;
  input.evidence.originalWordCount = generationContext?.originalWordCount ?? 0;
  input.evidence.lengthRepairCount = generationContext?.lengthRepairCount ?? 0;
  const observedIntegrityRepairCount = generationContext?.integrityRepairCount;
  const observedIntegrityRepairAttempts = generationContext?.integrityRepairAttempts;
  requireCondition(
    typeof observedIntegrityRepairCount === 'number' &&
      Number.isSafeInteger(observedIntegrityRepairCount) &&
      observedIntegrityRepairCount >= 0 &&
      Array.isArray(observedIntegrityRepairAttempts) &&
      observedIntegrityRepairAttempts.length === observedIntegrityRepairCount &&
      observedIntegrityRepairAttempts.every(
        (attempt, index) =>
          attempt.attempt === index + 1 &&
          Array.isArray(attempt.issueCodes) &&
          attempt.issueCodes.length > 0 &&
          attempt.issueCodes.every(
            (code) => typeof code === 'string' && /^chapter_[a-z_]+$/.test(code),
          ) &&
          new Set(attempt.issueCodes).size === attempt.issueCodes.length &&
          isSha256(attempt.sourceContentHash),
      ),
    `Chapter ${input.chapterNumber} did not explicitly expose its integrity repair issue history, including an empty history for zero repairs.`,
  );
  input.evidence.integrityRepairCount = observedIntegrityRepairCount!;
  input.evidence.integrityRepairAttempts = observedIntegrityRepairAttempts!;
  const plannedChapter = await bridgeCall<ChapterRecord | null>('get_chapter_by_id', {
    id: input.chapterId,
  });
  requireCondition(
    Boolean(plannedChapter) &&
      input.evidence.targetWordCount === plannedChapter!.targetWordCount &&
      input.evidence.targetWordCount >= 500 &&
      input.evidence.targetWordCount <= 10_000 &&
      input.evidence.originalWordCount > 0 &&
      input.evidence.lengthRepairCount >= 0 &&
      input.evidence.integrityRepairCount >= 0,
    `Chapter ${input.chapterNumber} did not retain its Writer repair evidence.`,
  );
  input.evidence.chapterTitle = plannedChapter!.title?.trim() ?? '';
  input.evidence.chapterOutline = plannedChapter!.outline?.trim() ?? '';
  input.evidence.chapterGoal = plannedChapter!.goal?.trim() ?? '';
  requireCondition(
    Boolean(
      input.evidence.chapterTitle && input.evidence.chapterOutline && input.evidence.chapterGoal,
    ),
    `Chapter ${input.chapterNumber} did not retain a reviewable formal title, outline, and goal.`,
  );
  const snapshot = await readAndAssertGenerationSnapshot({
    chapterNumber: input.chapterNumber,
    chapterId: input.chapterId,
    expectedContextHash: generationContext!.contextHash!,
    expectedContinuitySourceHash: input.expectedContinuitySourceHash,
    scenario: input.profile.scenario,
  });
  input.evidence.snapshotId = snapshot.id;
  input.evidence.snapshotSourceTypes = snapshot.sources
    .filter((source) => source.status === 'used')
    .map((source) => source.type)
    .sort();
  input.evidence.styleProfileId = snapshot.styleProfileId ?? '';
  input.evidence.outputProfileId = snapshot.outputProfileId ?? '';
  input.evidence.providerRequestEvidence = await readAndAssertProviderRequestEvidence({
    chapterNumber: input.chapterNumber,
    snapshot,
    evidence: generationContext?.providerRequestEvidence,
    lengthRepairCount: input.evidence.lengthRepairCount,
    integrityRepairCount: input.evidence.integrityRepairCount,
    integrityRepairAttempts: input.evidence.integrityRepairAttempts,
  });

  const runBlock = await findTestIdByAttribute('workbench-run', 'data-run-id', currentRun.runId);
  const generationTool = await runBlock.$(
    '[data-testid="workbench-tool-event"][data-tool-name="generate_chapter"]',
  );
  await generationTool.waitForDisplayed({ timeout: 30_000 });
  let contextReceipt = await generationTool.$('[data-testid="workbench-context-receipt"]');
  if (!(await contextReceipt.isExisting()) || !(await contextReceipt.isDisplayed())) {
    const toolSummary = await generationTool.$('summary');
    await toolSummary.waitForClickable({ timeout: 30_000 });
    await toolSummary.click();
    contextReceipt = await generationTool.$('[data-testid="workbench-context-receipt"]');
  }
  await contextReceipt.waitForExist({ timeout: 30_000 });
  await contextReceipt.waitForDisplayed({ timeout: 30_000 });
  const usedContext = await contextReceipt.$('[data-context-status="used"]');
  await usedContext.waitForDisplayed({ timeout: 30_000 });
  const usedContextText = await usedContext.getText();
  const expectedContextTitles = [
    '世界设定',
    '规则设定',
    '主角设定',
    '章节大纲',
    '风格方案',
    '输出控制',
  ];
  if (input.profile.scenario === 'prepared-assets') expectedContextTitles.push('参考资料');
  for (const expectedTitle of expectedContextTitles) {
    requireCondition(
      usedContextText.includes(expectedTitle),
      `Chapter ${input.chapterNumber} context receipt did not prove ${expectedTitle} was used.`,
    );
  }
  if (input.chapterNumber === 1) {
    await contextReceipt.saveScreenshot(
      path.join(
        requiredEnvironment('AI_NOVEL_STUDIO_REAL_E2E_EVIDENCE_DIR'),
        'workbench-context-receipt.png',
      ),
    );
  }
  const cards = (await runBlock.$$(
    '[data-testid="workbench-artifact-card"]',
  )) as unknown as WebdriverIO.Element[];
  requireCondition(
    cards.length === 1,
    `Chapter ${input.chapterNumber} latest run produced an unexpected card count.`,
  );
  const currentCard = cards[0];
  const currentArtifactId = (await currentCard.getAttribute('data-artifact-id'))?.trim();
  requireCondition(
    Boolean(currentArtifactId),
    `Chapter ${input.chapterNumber} artifact has no identifier.`,
  );
  const artifactId = currentArtifactId!;
  const artifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
    input: { artifactId },
  });
  assertArtifact(artifact, input);
  input.evidence.artifactId = artifactId;
  input.evidence.candidateHash = artifact.artifact.contentHash;
  input.evidence.wordCount = countTextWords(artifact.rawContent);
  const integrityIssues = inspectChapterCandidateIntegrity({
    candidateText: artifact.rawContent,
    previousChapterText: input.previousAdoptedContent,
  });
  input.evidence.artifactCandidateIntegrityCheck = {
    checker: 'inspectChapterCandidateIntegrity',
    source: 'persisted_result_artifact',
    executed: true,
    passed: integrityIssues.length === 0,
    artifactId,
    artifactContentSha256: sha256(artifact.rawContent),
    issueCodes: integrityIssues.map((issue) => issue.code),
  };
  requireCondition(
    integrityIssues.length === 0,
    `Chapter ${input.chapterNumber} retained candidate-integrity issues: ${integrityIssues
      .map((issue) => issue.code)
      .join(', ')}.`,
  );
  requireCondition(
    generationContext?.finalWordCount === input.evidence.wordCount,
    `Chapter ${input.chapterNumber} final Writer word count evidence drifted from its artifact.`,
  );
  const acceptedWordRange = resolveRealAcceptanceChapterWordRange({
    scenario: input.profile.scenario,
    targetWordCount: plannedChapter!.targetWordCount,
  });
  requireCondition(
    input.evidence.wordCount >= acceptedWordRange.minimum &&
      input.evidence.wordCount <= acceptedWordRange.maximum,
    `Chapter ${input.chapterNumber} word count ${input.evidence.wordCount} is outside ${acceptedWordRange.minimum}-${acceptedWordRange.maximum} for target ${acceptedWordRange.target} (${acceptedWordRange.source}).`,
  );

  const confirm = await currentCard.$('[data-testid="workbench-artifact-confirm-review"]');
  await confirm.waitForClickable({ timeout: 30_000 });
  await confirm.click();
  await browser.waitUntil(
    async () => {
      const hash = await browser.execute(() => window.location.hash);
      return hash.includes(`chapterId=${input.chapterId}`) && hash.includes('authorizationId=');
    },
    { timeout: 30_000, timeoutMsg: `Chapter ${input.chapterNumber} did not enter review.` },
  );

  const route = await browser.execute(() => window.location.hash);
  const authorizationId = new URLSearchParams(route.split('?')[1] ?? '').get('authorizationId');
  requireCondition(Boolean(authorizationId), `Chapter ${input.chapterNumber} has no review grant.`);
  const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', input.chapterId);
  requireCondition(
    (await editor.getAttribute('data-review-locked')) === 'true',
    `Chapter ${input.chapterNumber} review was not initially locked.`,
  );
  await clickTestId('chapter-review-unlock');
  const candidateText = await editor.getValue();
  requireCondition(
    sha256(candidateText) === artifact.artifact.contentHash,
    `Chapter ${input.chapterNumber} review content hash changed before editing.`,
  );

  await fillTextareaTestId('chapter-editor', `${candidateText}\n`);
  await clickTestId('chapter-save');
  await browser.waitUntil(async () => (await editor.getAttribute('data-dirty')) === 'false', {
    timeout: 30_000,
    timeoutMsg: `Chapter ${input.chapterNumber} did not save.`,
  });
  const savedDraftId = await editor.getAttribute('data-draft-id');
  const savedContent = await editor.getValue();
  requireCondition(Boolean(savedDraftId), `Chapter ${input.chapterNumber} save has no draft.`);

  await clickTestId('chapter-adopt');
  await waitForTestId('apply-confirm');
  await clickTestId('dialog-confirm');
  await browser.waitUntil(async () => (await editor.getAttribute('data-adopted')) === 'true', {
    timeout: 30_000,
    timeoutMsg: `Chapter ${input.chapterNumber} was not adopted.`,
  });

  const completedBundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
    conversationId,
  });
  requireCondition(
    Boolean(completedBundle),
    `Chapter ${input.chapterNumber} conversation disappeared after adoption.`,
  );
  assertPersistedConversationTurns(completedBundle, input.expectedPrompts);
  requireCondition(
    completedBundle?.decisions.filter(
      (decision) => decision.artifactId === artifactId && decision.decision === 'confirm',
    ).length === 1,
    `Chapter ${input.chapterNumber} did not retain exactly one confirmation for its artifact.`,
  );

  const authorization = await bridgeCall<ReviewAuthorizationRecord | null>(
    'get_review_authorization',
    { authorizationId },
  );
  requireCondition(
    authorization?.status === 'consumed' && authorization.consumedByDraftId === savedDraftId,
    `Chapter ${input.chapterNumber} review grant was not consumed by the saved draft.`,
  );
  requireCondition(
    authorization?.artifactId === artifactId,
    `Chapter ${input.chapterNumber} review grant points at another artifact.`,
  );

  const chapterRows = await bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', {
    novelId: input.novelId,
  });
  const chapter = chapterRows.find((row) => row.id === input.chapterId);
  requireCondition(
    chapter?.adoptedDraftId === savedDraftId,
    `Chapter ${input.chapterNumber} authority pointer did not update.`,
  );
  const drafts = await bridgeCall<DraftRecord[]>('get_drafts_by_chapter_id', {
    chapterId: input.chapterId,
  });
  const adopted = drafts.find((draft) => draft.id === savedDraftId);
  requireCondition(
    adopted?.isAdopted === true && adopted.content === savedContent,
    `Chapter ${input.chapterNumber} adopted draft content did not round-trip.`,
  );
  const authoritativeWordCount = countTextWords(adopted!.content);
  requireCondition(
    authoritativeWordCount === adopted!.wordCount && authoritativeWordCount === chapter?.wordCount,
    `Chapter ${input.chapterNumber} word count facts disagree.`,
  );
  input.evidence.wordCount = authoritativeWordCount;
  input.evidence.adoptedHash = sha256(adopted!.content);
  input.evidence.adoptedContent = adopted!.content;
  const contextEvidence = await generateAndAssertChapterContextThroughWorkbench({
    chapterNumber: input.chapterNumber,
    novelId: input.novelId,
    chapterId: input.chapterId,
    conversationId,
    authorizationId: authorizationId!,
    profile: input.profile,
    adoptedDraftId: savedDraftId!,
    adoptedDraftVersion: adopted!.versionNo,
    adoptedHash: input.evidence.adoptedHash,
    timeoutMs: input.profile.chapterTimeoutMs,
  });
  input.evidence.summaryTurnId = contextEvidence.turnId;
  input.evidence.summaryRunId = contextEvidence.runId;
  input.evidence.summaryArtifactId = contextEvidence.artifactId;
  input.evidence.summaryApplyTransactionId = contextEvidence.applyTransactionId;
  input.evidence.summaryId = contextEvidence.summaryId;
  input.evidence.summaryRetryCount = contextEvidence.retryCount;
  input.evidence.summaryAttempts = contextEvidence.attempts;
  input.evidence.contextRecordCount = contextEvidence.contextRecordCount;
  input.evidence.memorySourceTypes = contextEvidence.memorySourceTypes;
  return conversationId;
}

async function generateAndAssertChapterContextThroughWorkbench(input: {
  chapterNumber: number;
  novelId: string;
  chapterId: string;
  conversationId: string;
  authorizationId: string;
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>;
  adoptedDraftId: string;
  adoptedDraftVersion?: number;
  adoptedHash: string;
  timeoutMs: number;
}): Promise<{
  turnId: string;
  runId: string;
  artifactId: string;
  applyTransactionId: string;
  summaryId: string;
  retryCount: number;
  attempts: ChapterRunAttemptEvidence[];
  contextRecordCount: number;
  memorySourceTypes: string[];
}> {
  await navigateHash('#/');
  await waitForTestId('creative-workbench');
  const project = await findTestIdByAttribute('workbench-project', 'data-novel-id', input.novelId);
  await project.click();
  const task = await findTestIdByAttribute(
    'workbench-task',
    'data-conversation-id',
    input.conversationId,
  );
  await task.click();
  await waitForTestIdAttribute(
    'workbench-task-header',
    'data-conversation-id',
    input.conversationId,
  );

  const turnId = `summary-generation-${input.authorizationId}`;
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId: input.conversationId,
      });
      const turn = bundle?.turns.find((item) => item.turnId === turnId);
      return Boolean(
        turn &&
        isAutomaticChapterSummaryTurn(turn) &&
        bundle?.runs.some((run) => run.turnId === turnId),
      );
    },
    {
      timeout: input.timeoutMs,
      interval: 250,
      timeoutMsg: `Chapter ${input.chapterNumber} did not start its persisted automatic summary turn.`,
    },
  );

  const terminalSummary = await waitForAutomaticSummaryTerminalRun({
    conversationId: input.conversationId,
    turnId,
    chapterNumber: input.chapterNumber,
    timeoutMs: input.timeoutMs,
  });
  const terminalRun = terminalSummary.run;
  if (terminalRun.status !== 'completed') {
    const error = await readChapterFailure(input.conversationId, terminalRun.runId);
    throw new Error(
      `Chapter ${input.chapterNumber} automatic summary failed${error ? `: ${error}` : '.'}`,
    );
  }

  const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
    conversationId: input.conversationId,
  });
  const run = bundle?.runs.find((item) => item.runId === terminalRun.runId);
  const summaryRuns = bundle?.runs.filter((item) => item.turnId === turnId) ?? [];
  const frozenModelSnapshot = JSON.stringify(summaryRuns[0]?.modelSnapshot);
  requireCondition(
    run?.turnId === turnId &&
      run.modelSnapshot.runtimeMode === 'api' &&
      run.modelSnapshot.providerId === 'openai_compatible' &&
      run.modelSnapshot.modelId === input.profile.model &&
      normalizeUrl(run.modelSnapshot.baseUrl) === input.profile.baseUrl &&
      summaryRuns.length === terminalSummary.attempts.length &&
      summaryRuns.length <= 3 &&
      summaryRuns.every((item) => JSON.stringify(item.modelSnapshot) === frozenModelSnapshot) &&
      summaryRuns
        .slice(0, -1)
        .every(
          (item) => item.status === 'failed' && isAutomaticSummaryProtocolRecoveryError(item.error),
        ) &&
      summaryRuns.at(-1)?.runId === terminalRun.runId &&
      summaryRuns.at(-1)?.status === 'completed',
    `Chapter ${input.chapterNumber} automatic summary did not retain its fixed real model.`,
  );
  requireCondition(
    bundle?.toolEvents.some(
      (event) =>
        event.runId === terminalRun.runId &&
        event.toolName === 'summarize_chapter' &&
        event.status === 'succeeded' &&
        !event.error,
    ),
    `Chapter ${input.chapterNumber} automatic summary has no successful summarize_chapter event.`,
  );
  const cards =
    bundle?.artifacts.filter(
      (artifact) => artifact.turnId === turnId && artifact.artifactType === 'chapter_summary',
    ) ?? [];
  requireCondition(
    cards.length === 1 && cards[0]?.runId === terminalRun.runId,
    `Chapter ${input.chapterNumber} automatic summary did not publish exactly one artifact.`,
  );
  const artifactId = cards[0]!.artifactId;
  const artifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
    input: { artifactId },
  });
  requireCondition(
    artifact.artifact.artifactType === 'chapter_summary' &&
      artifact.artifact.sourceNovelId === input.novelId &&
      artifact.artifact.sourceChapterId === input.chapterId &&
      artifact.artifact.sourceDraftId === input.adoptedDraftId &&
      artifact.artifact.sourceBaseContentHash === input.adoptedHash &&
      (!input.adoptedDraftVersion ||
        artifact.artifact.sourceDraftVersion === input.adoptedDraftVersion) &&
      ['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus) &&
      artifact.rawContent.trim().length > 0 &&
      sha256(artifact.rawContent) === artifact.artifact.contentHash,
    `Chapter ${input.chapterNumber} automatic summary artifact is not bound to the adopted draft.`,
  );

  const runBlock = await findTestIdByAttribute('workbench-run', 'data-run-id', terminalRun.runId);
  const card = await findChildByAttribute(
    runBlock,
    'workbench-artifact-card',
    'data-artifact-id',
    artifactId,
  );
  const apply = await card.$('[data-testid="workbench-artifact-apply"]');
  await apply.waitForClickable({ timeout: 30_000 });
  await apply.click();
  const applyTransactionId = await waitForAppliedAssetDecision({
    conversationId: input.conversationId,
    artifactId,
    chapterNumber: input.chapterNumber,
    asset: 'chapter_summary',
  });

  let summaryId = '';
  await browser.waitUntil(
    async () => {
      const summary = await bridgeCall<ChapterSummaryRecord | null>('get_chapter_summary', {
        chapterId: input.chapterId,
      });
      summaryId = summary?.id ?? '';
      return Boolean(summaryId);
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${input.chapterNumber} summary did not persist from the workbench card.`,
    },
  );

  const [summary, contexts, memory] = await Promise.all([
    bridgeCall<ChapterSummaryRecord | null>('get_chapter_summary', {
      chapterId: input.chapterId,
    }),
    bridgeCall<ContextRecord[]>('get_context_records', { novelId: input.novelId }),
    bridgeCall<MemoryDocumentPage>('list_memory_documents', {
      input: { novelId: input.novelId, status: 'active', offset: 0, limit: 100 },
    }),
  ]);
  requireCondition(
    summary?.id === summaryId &&
      summary.novelId === input.novelId &&
      summary.chapterId === input.chapterId &&
      summary.adoptedDraftId === input.adoptedDraftId &&
      summary.summary.trim().length > 0 &&
      summary.enabled &&
      !summary.isExpired &&
      summary.contentHash === input.adoptedHash &&
      (!input.adoptedDraftVersion || summary.draftVersion === input.adoptedDraftVersion),
    `Chapter ${input.chapterNumber} summary is not bound to the authoritative adopted draft.`,
  );

  const chapterContexts = contexts.filter((record) => record.chapterId === input.chapterId);
  requireCondition(
    chapterContexts.length > 0 &&
      chapterContexts.some(
        (record) =>
          record.isActive &&
          !record.isExpired &&
          record.content.trim().length > 0 &&
          record.contentHash === input.adoptedHash &&
          (!input.adoptedDraftVersion || record.draftVersion === input.adoptedDraftVersion),
      ),
    `Chapter ${input.chapterNumber} did not persist an active ContextRecord for its adopted draft.`,
  );

  const chapterMemory = memory.items.filter(
    (document) => document.chapterId === input.chapterId && document.status === 'active',
  );
  const memorySourceTypes = [
    ...new Set(chapterMemory.map((document) => document.sourceType)),
  ].sort();
  requireCondition(
    chapterMemory.some(
      (document) =>
        document.sourceType === 'adopted_draft' &&
        document.sourceId === input.adoptedDraftId &&
        document.sourceHash === input.adoptedHash,
    ) &&
      chapterMemory.some(
        (document) =>
          document.sourceType === 'chapter_summary' &&
          document.sourceId === summaryId &&
          document.adoptedDraftId === input.adoptedDraftId &&
          document.sourceHash === input.adoptedHash,
      ),
    `Chapter ${input.chapterNumber} did not project adopted draft and summary Memory.`,
  );

  return {
    turnId,
    runId: terminalRun.runId,
    artifactId,
    applyTransactionId,
    summaryId,
    retryCount: terminalSummary.attempts.length - 1,
    attempts: terminalSummary.attempts,
    contextRecordCount: chapterContexts.length,
    memorySourceTypes,
  };
}

async function readAndAssertAutomaticAssetProviderEvidence(input: {
  chapterNumber: number;
  asset: SparseAssetKind;
  goal: string;
  persistedTurnContent: string;
  originalGoal: string;
  artifactId: string;
  taskId: string;
}): Promise<{
  taskDetail: AiTaskDetail;
  postRunProjectionEvidence: RealConversationAutomaticAssetPostRunProjectionEvidence;
  actualProviderRequestEvidence: RealConversationAutomaticAssetProviderRequestEvidence;
}> {
  const taskDetail = await bridgeCall<AiTaskDetail>('get_ai_task', {
    input: { taskId: input.taskId },
  });
  const successfulAttempts = taskDetail.attempts.filter(
    (attempt) => attempt.status === 'succeeded' && attempt.providerRequestId?.trim(),
  );
  const attempt = successfulAttempts[0];
  requireCondition(
    taskDetail.task.taskId === input.taskId &&
      taskDetail.task.status === 'completed' &&
      taskDetail.task.resultArtifactId === input.artifactId &&
      successfulAttempts.length === 1 &&
      Boolean(attempt?.attemptId.trim() && attempt.providerRequestId?.trim()),
    `Chapter ${input.chapterNumber} ${input.asset} post-run task projection is not linked to one successful Provider attempt.`,
  );

  let projectionEnvelope: unknown;
  try {
    projectionEnvelope = JSON.parse(taskDetail.inputSnapshot.body);
  } catch {
    projectionEnvelope = undefined;
  }
  const projectionPayload = taskDetail.inputSnapshot.payloadJson;
  const projectionMessages =
    isPlainRecord(projectionEnvelope) && Array.isArray(projectionEnvelope.messages)
      ? projectionEnvelope.messages
      : [];
  const projectionMessage = projectionMessages[0];
  const goalSha256 = sha256(input.goal);
  const projectedTurnContentSha256 = sha256(input.persistedTurnContent);
  const decodedProjectedTurn = decodeWorkbenchTurnContent(input.persistedTurnContent);
  requireCondition(
    taskDetail.inputSnapshot.inputType === 'workbench_dsh_messages_v1' &&
      isPlainRecord(projectionPayload) &&
      projectionPayload.goal === input.persistedTurnContent &&
      projectionMessages.length === 1 &&
      isPlainRecord(projectionMessage) &&
      projectionMessage.role === 'user' &&
      projectionMessage.content === input.persistedTurnContent &&
      decodedProjectedTurn.content === input.goal &&
      decodedProjectedTurn.origin === 'workbench_asset_preparation',
    `Chapter ${input.chapterNumber} ${input.asset} post-run projection did not retain its compact goal-only contract.`,
  );
  const providerRequestIdSha256 = sha256(attempt!.providerRequestId!);
  const postRunProjectionEvidence: RealConversationAutomaticAssetPostRunProjectionEvidence = {
    schemaVersion: 'workbench_dsh_post_run_projection_evidence_v1',
    scope: 'post_run_artifact_projection',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    taskId: input.taskId,
    attemptId: attempt!.attemptId,
    providerRequestIdSha256,
    inputType: 'workbench_dsh_messages_v1',
    bodySha256: sha256(taskDetail.inputSnapshot.body),
    messagesSha256: sha256(JSON.stringify(projectionMessages)),
    messageCount: 1,
    projectedTurnContentSha256,
    decodedGoalSha256: goalSha256,
    turnOrigin: 'workbench_asset_preparation',
  };

  const providerEvidenceDirectory = requiredEnvironment(
    REAL_ACCEPTANCE_ENV.providerEvidenceDirectory,
  );
  const providerEvidencePath = path.join(
    providerEvidenceDirectory,
    `${providerRequestIdSha256}.json`,
  );
  await browser.waitUntil(async () => fs.existsSync(providerEvidencePath), {
    timeout: 10_000,
    interval: 50,
    timeoutMsg: `Chapter ${input.chapterNumber} ${input.asset} actual Provider request evidence was not captured.`,
  });
  let providerEvidenceRaw: unknown;
  let providerEvidenceText = '';
  try {
    providerEvidenceText = fs.readFileSync(providerEvidencePath, 'utf8');
    providerEvidenceRaw = JSON.parse(providerEvidenceText);
  } catch {
    providerEvidenceRaw = undefined;
  }
  const providerEvidence = isPlainRecord(providerEvidenceRaw) ? providerEvidenceRaw : {};
  const creativeBrief = isPlainRecord(providerEvidence.creativeBrief)
    ? providerEvidence.creativeBrief
    : {};
  const configuredCanaryIds = Array.isArray(providerEvidence.configuredPreparedFixtureCanaryIds)
    ? providerEvidence.configuredPreparedFixtureCanaryIds.filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  const matchedCanaryIds = Array.isArray(providerEvidence.matchedPreparedFixtureCanaryIds)
    ? providerEvidence.matchedPreparedFixtureCanaryIds.filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  const expectedCanaryIds = REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES.map((canary) => canary.id);
  const expectedProviderEvidenceKeys = [
    'schemaVersion',
    'captureMode',
    'hashAlgorithm',
    'messagesSerialization',
    'providerRequestIdSha256',
    'requestBodySha256',
    'messagesSha256',
    'messageCount',
    'messageTextSha256',
    'messageTextCount',
    'latestUserMessageSha256',
    'latestUserMessageLength',
    'classification',
    'turnOrigin',
    'assetKind',
    'creativeBriefParseStatus',
    'creativeBrief',
    'creativeBriefMarkerCount',
    'latestUserCreativeBriefMarkerCount',
    'configuredPreparedFixtureCanaryIds',
    'matchedPreparedFixtureCanaryIds',
    'rawMessageContentPersisted',
  ].sort();
  requireCondition(
    arraysEqual(Object.keys(providerEvidence).sort(), expectedProviderEvidenceKeys) &&
      arraysEqual(Object.keys(creativeBrief).sort(), [
        'contentLength',
        'contentSha256',
        'schema',
        'source',
      ]) &&
      providerEvidence.schemaVersion === REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION &&
      providerEvidence.captureMode === 'hash_only' &&
      providerEvidence.hashAlgorithm === 'sha256' &&
      providerEvidence.messagesSerialization === 'json_stringify_messages_v1' &&
      providerEvidence.providerRequestIdSha256 === providerRequestIdSha256 &&
      isSha256(providerEvidence.requestBodySha256) &&
      isSha256(providerEvidence.messagesSha256) &&
      providerEvidence.messagesSha256 !== postRunProjectionEvidence.messagesSha256 &&
      typeof providerEvidence.messageCount === 'number' &&
      Number.isSafeInteger(providerEvidence.messageCount) &&
      providerEvidence.messageCount > postRunProjectionEvidence.messageCount &&
      isSha256(providerEvidence.messageTextSha256) &&
      typeof providerEvidence.messageTextCount === 'number' &&
      Number.isSafeInteger(providerEvidence.messageTextCount) &&
      providerEvidence.messageTextCount >= providerEvidence.messageCount &&
      isSha256(providerEvidence.latestUserMessageSha256) &&
      typeof providerEvidence.latestUserMessageLength === 'number' &&
      Number.isSafeInteger(providerEvidence.latestUserMessageLength) &&
      providerEvidence.latestUserMessageLength > input.goal.length &&
      providerEvidence.classification === 'automatic_asset_preparation' &&
      providerEvidence.turnOrigin === 'workbench_asset_preparation' &&
      providerEvidence.assetKind === input.asset &&
      providerEvidence.creativeBriefParseStatus === 'valid' &&
      creativeBrief.schema === 'ans_core_asset_creative_brief_v1' &&
      creativeBrief.source === 'original_user_goal' &&
      creativeBrief.contentSha256 === sha256(input.originalGoal) &&
      creativeBrief.contentLength === input.originalGoal.length &&
      typeof providerEvidence.creativeBriefMarkerCount === 'number' &&
      Number.isSafeInteger(providerEvidence.creativeBriefMarkerCount) &&
      providerEvidence.creativeBriefMarkerCount >= 1 &&
      providerEvidence.latestUserCreativeBriefMarkerCount === 1 &&
      arraysEqual(configuredCanaryIds, expectedCanaryIds) &&
      matchedCanaryIds.length === 0 &&
      providerEvidence.rawMessageContentPersisted === false,
    `Chapter ${input.chapterNumber} ${input.asset} actual Provider request does not prove sparse creative-brief propagation without prepared-fixture injection.`,
  );
  for (const forbidden of [
    input.goal,
    input.originalGoal,
    ...REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES.map((canary) => canary.value),
  ]) {
    requireCondition(
      !providerEvidenceText.includes(forbidden),
      `Chapter ${input.chapterNumber} ${input.asset} Provider evidence persisted raw request content.`,
    );
  }

  const actualProviderRequestEvidence: RealConversationAutomaticAssetProviderRequestEvidence = {
    schemaVersion: REAL_ACCEPTANCE_PROVIDER_REQUEST_EVIDENCE_SCHEMA_VERSION,
    captureMode: 'hash_only',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    providerRequestIdSha256,
    requestBodySha256: providerEvidence.requestBodySha256 as string,
    messagesSha256: providerEvidence.messagesSha256 as string,
    messageCount: providerEvidence.messageCount as number,
    messageTextSha256: providerEvidence.messageTextSha256 as string,
    messageTextCount: providerEvidence.messageTextCount as number,
    latestUserMessageSha256: providerEvidence.latestUserMessageSha256 as string,
    latestUserMessageLength: providerEvidence.latestUserMessageLength as number,
    classification: 'automatic_asset_preparation',
    turnOrigin: 'workbench_asset_preparation',
    assetKind: input.asset,
    creativeBriefParseStatus: 'valid',
    creativeBrief: {
      schema: 'ans_core_asset_creative_brief_v1',
      source: 'original_user_goal',
      contentSha256: creativeBrief.contentSha256 as string,
      contentLength: creativeBrief.contentLength as number,
    },
    creativeBriefMarkerCount: providerEvidence.creativeBriefMarkerCount as number,
    latestUserCreativeBriefMarkerCount: 1,
    configuredPreparedFixtureCanaryIds: configuredCanaryIds,
    matchedPreparedFixtureCanaryIds: [],
    rawMessageContentPersisted: false,
  };
  return { taskDetail, postRunProjectionEvidence, actualProviderRequestEvidence };
}

async function prepareSparseIdeaAssetsThroughUi(input: {
  chapterNumber: number;
  novelId: string;
  conversationId: string;
  originalGoal: string;
  expectedPrompts: readonly string[];
  profile: ReturnType<typeof readRealConversationAcceptanceProfile>;
  evidence: SparseAssetPreparationEvidence[];
  resumeDiagnostics: AutomaticAssetResumeDiagnostic[];
  recordStoryPlanApplyEvidence: (evidence: RealConversationStoryPlanApplyEvidence) => void;
}): Promise<void> {
  const readiness = await waitForTestId('workbench-asset-readiness');
  await browser.waitUntil(async () => (await readiness.getAttribute('data-ready')) === 'false', {
    timeout: 30_000,
    interval: 100,
    timeoutMsg: `Chapter ${input.chapterNumber} did not expose its sparse-asset recovery gate.`,
  });
  requireCondition(
    (await readiness.getText()).includes(input.originalGoal),
    `Chapter ${input.chapterNumber} asset gate did not retain the original creative instruction.`,
  );

  const initialMissing = await readVisibleSparseAssets();
  requireCondition(
    arraysEqual(initialMissing, ['world_setting', 'protagonist']),
    `Chapter ${input.chapterNumber} exposed unexpected missing assets: ${initialMissing.join(',') || 'none'}.`,
  );

  const expectedPreparations: SparseAssetKind[] = ['world_setting', 'protagonist', 'story_plan'];
  for (const asset of expectedPreparations) {
    await browser.waitUntil(
      async () => {
        const visible = await readVisibleSparseAssets();
        return visible.includes(asset) && !visible.includes('chapter_outline');
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: `Chapter ${input.chapterNumber} did not advance its sparse recovery to ${asset}.`,
      },
    );
    const contract = SPARSE_ASSET_CONTRACT[asset];
    const goal = buildCoreAssetGenerationGoal(asset, input.originalGoal);
    const knownTurnIds = new Set(input.evidence.map((item) => item.turnId));

    const turnId = await waitForAutomaticAssetTurn({
      conversationId: input.conversationId,
      goal,
      knownTurnIds,
      expectedPrompts: input.expectedPrompts,
      chapterNumber: input.chapterNumber,
    });
    const run = await waitForTerminalTurnRun({
      conversationId: input.conversationId,
      turnId,
      minimumAttemptCount: 1,
      chapterNumber: input.chapterNumber,
      timeoutMs: input.profile.chapterTimeoutMs,
    });
    if (run.status !== 'completed') {
      const error = await readChapterFailure(input.conversationId, run.runId);
      throw new Error(
        `Chapter ${input.chapterNumber} ${asset} preparation failed${error ? `: ${error}` : '.'}`,
      );
    }

    const completed = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
      conversationId: input.conversationId,
    });
    const persistedRun = completed?.runs.find((item) => item.runId === run.runId);
    requireCondition(
      persistedRun?.turnId === turnId &&
        persistedRun.status === 'completed' &&
        persistedRun.modelSnapshot.runtimeMode === 'api' &&
        persistedRun.modelSnapshot.providerId === 'openai_compatible' &&
        persistedRun.modelSnapshot.modelId === input.profile.model &&
        normalizeUrl(persistedRun.modelSnapshot.baseUrl) === input.profile.baseUrl,
      `Chapter ${input.chapterNumber} ${asset} preparation did not retain its real DSH model run.`,
    );
    const candidateToolEvents =
      completed?.toolEvents.filter(
        (event) => event.runId === run.runId && event.toolName === contract.toolName,
      ) ?? [];
    const successfulCandidateEvents = candidateToolEvents.filter(
      (event) => event.status === 'succeeded' && !event.error,
    );
    requireCondition(
      candidateToolEvents.length >= 1 &&
        candidateToolEvents.length <= REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS &&
        successfulCandidateEvents.length === 1 &&
        candidateToolEvents.at(-1) === successfulCandidateEvents[0] &&
        candidateToolEvents.slice(0, -1).every((event) => event.status === 'failed'),
      `Chapter ${input.chapterNumber} ${asset} preparation did not converge from bounded tool attempts to one successful ${contract.toolName} event.`,
    );
    const runArtifacts = completed?.artifacts.filter((item) => item.runId === run.runId) ?? [];
    requireCondition(
      runArtifacts.length === 1 && runArtifacts[0]?.artifactType === contract.artifactType,
      `Chapter ${input.chapterNumber} ${asset} preparation did not publish one ${contract.artifactType} artifact.`,
    );
    const artifactId = runArtifacts[0]!.artifactId;
    const artifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
      input: { artifactId },
    });
    requireCondition(
      artifact.artifact.artifactType === contract.artifactType &&
        artifact.artifact.sourceNovelId === input.novelId &&
        !artifact.artifact.sourceChapterId &&
        ['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus) &&
        sha256(artifact.rawContent) === artifact.artifact.contentHash,
      `Chapter ${input.chapterNumber} ${asset} structured artifact evidence is invalid.`,
    );
    const persistedTurn = completed?.turns.find((turn) => turn.turnId === turnId);
    const decodedPersistedTurn = decodeWorkbenchTurnContent(persistedTurn?.content);
    requireCondition(
      persistedTurn?.role === 'user' &&
        Boolean(persistedTurn.content) &&
        decodedPersistedTurn.content === goal &&
        decodedPersistedTurn.origin === 'workbench_asset_preparation',
      `Chapter ${input.chapterNumber} ${asset} automatic turn origin is not authoritative.`,
    );
    const providerEvidence = await readAndAssertAutomaticAssetProviderEvidence({
      chapterNumber: input.chapterNumber,
      asset,
      goal,
      persistedTurnContent: persistedTurn!.content!,
      originalGoal: input.originalGoal,
      artifactId,
      taskId: artifact.artifact.taskId,
    });

    let storyPlanEvidence: RealConversationStoryPlanApplyEvidence | undefined;
    if (asset === 'story_plan') {
      const frozenBookWordGoal = providerEvidence.taskDetail.task.targetHintJson?.bookWordGoal;
      storyPlanEvidence = createRealConversationStoryPlanApplyEvidence({
        artifactId,
        candidateText: artifact.rawContent,
        frozenTarget: {
          target: frozenBookWordGoal?.targetWords,
          minimum: frozenBookWordGoal?.minimumWords,
          maximum: frozenBookWordGoal?.maximumWords,
          sourceTurnId: frozenBookWordGoal?.sourceTurnId,
          sourceTurnSequence: frozenBookWordGoal?.sourceTurnSequence,
          sourceContentSha256: frozenBookWordGoal?.sourceContentSha256,
        },
      });
      input.recordStoryPlanApplyEvidence(storyPlanEvidence);
    }

    const runBlock = await findTestIdByAttribute('workbench-run', 'data-run-id', run.runId);
    const card = await findChildByAttribute(
      runBlock,
      'workbench-artifact-card',
      'data-artifact-id',
      artifactId,
    );
    const apply = await card.$('[data-testid="workbench-artifact-apply"]');
    await apply.waitForClickable({ timeout: 30_000 });
    requireCondition(
      (await apply.getText()).includes('应用到作品'),
      `Chapter ${input.chapterNumber} ${asset} did not expose the structured apply UI.`,
    );
    try {
      await apply.click();
    } catch (error) {
      if (storyPlanEvidence) {
        storyPlanEvidence = recordRealConversationStoryPlanApplyFailure(
          storyPlanEvidence,
          'APPLY_UI_INTERACTION_FAILED',
        );
        input.recordStoryPlanApplyEvidence(storyPlanEvidence);
      }
      throw error;
    }

    let applyTransactionId = '';
    try {
      applyTransactionId = await waitForAppliedAssetDecision({
        conversationId: input.conversationId,
        artifactId,
        chapterNumber: input.chapterNumber,
        asset,
        onConflict: (conflictCode) => {
          if (!storyPlanEvidence) return;
          storyPlanEvidence = recordRealConversationStoryPlanApplyFailure(
            storyPlanEvidence,
            conflictCode,
          );
          input.recordStoryPlanApplyEvidence(storyPlanEvidence);
        },
      });
    } catch (error) {
      if (storyPlanEvidence?.applyResult === 'pending') {
        storyPlanEvidence = recordRealConversationStoryPlanApplyFailure(
          storyPlanEvidence,
          'APPLY_DECISION_UNOBSERVED',
        );
        input.recordStoryPlanApplyEvidence(storyPlanEvidence);
      }
      throw error;
    }
    if (storyPlanEvidence) {
      storyPlanEvidence = recordRealConversationStoryPlanApplySuccess(
        storyPlanEvidence,
        applyTransactionId,
      );
      input.recordStoryPlanApplyEvidence(storyPlanEvidence);
    }
    await browser.waitUntil(
      async () => {
        const projectedCard = await browser.$(
          `[data-testid="workbench-artifact-card"][data-artifact-id="${artifactId}"]`,
        );
        return (
          (await projectedCard.isExisting()) &&
          (await projectedCard.getAttribute('data-decision')) === 'request_apply' &&
          (await projectedCard.getText()).includes('已应用')
        );
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: `Chapter ${input.chapterNumber} ${asset} card did not project its applied state.`,
      },
    );
    input.evidence.push({
      chapter: input.chapterNumber,
      asset,
      goal,
      goalSha256: sha256(goal),
      goalLength: goal.length,
      turnId,
      turnOrigin: 'workbench_asset_preparation',
      runId: run.runId,
      artifactId,
      artifactType: contract.artifactType,
      toolName: contract.toolName,
      toolAttemptCount: candidateToolEvents.length,
      failedToolAttemptCount: candidateToolEvents.filter((event) => event.status === 'failed')
        .length,
      applyTransactionId,
      conflictCode: '',
      postRunProjectionEvidence: providerEvidence.postRunProjectionEvidence,
      actualProviderRequestEvidence: providerEvidence.actualProviderRequestEvidence,
    });

    await browser.waitUntil(
      async () =>
        !(await browser.$(`[data-testid="workbench-missing-asset-${asset}"]`).isExisting()),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: `Chapter ${input.chapterNumber} ${asset} remained missing after atomic apply.`,
      },
    );
  }

  let unexpectedPreparationError = '';
  try {
    await waitForLiveCondition(
      async () => {
        const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
          conversationId: input.conversationId,
        });
        replaceAutomaticAssetResumeDiagnostics(input.resumeDiagnostics, bundle);
        if (input.resumeDiagnostics.length > expectedPreparations.length) {
          unexpectedPreparationError = `Expected ${expectedPreparations.length} automatic asset turns, observed ${input.resumeDiagnostics.length}.`;
          return true;
        }
        const userTurns = creativeUserTurns(bundle);
        const sourceTurn = userTurns[userTurns.length - 1];
        return Boolean(
          sourceTurn &&
          userTurns.length === input.expectedPrompts.length &&
          sha256(sourceTurn.content ?? '') === sha256(input.originalGoal) &&
          bundle?.runs.some((run) => run.turnId === sourceTurn.turnId),
        );
      },
      {
        timeout: input.profile.chapterTimeoutMs,
        interval: 250,
        timeoutMessage: `Chapter ${input.chapterNumber} did not start a run for the original user turn after the final structured apply.`,
      },
    );
  } catch (error) {
    const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
      conversationId: input.conversationId,
    });
    replaceAutomaticAssetResumeDiagnostics(input.resumeDiagnostics, bundle);
    throw new Error(
      `${safeEvidenceError(error)} Automatic asset diagnostics: ${JSON.stringify(input.resumeDiagnostics)}.`,
    );
  }
  if (unexpectedPreparationError) {
    throw new Error(
      `${unexpectedPreparationError} Automatic asset diagnostics: ${JSON.stringify(input.resumeDiagnostics)}.`,
    );
  }
  requireCondition(
    input.resumeDiagnostics.length === expectedPreparations.length,
    `Chapter ${input.chapterNumber} did not retain exactly ${expectedPreparations.length} automatic asset preparation turns.`,
  );

  const [worldSettings, ruleSystems, novel] = await Promise.all([
    bridgeCall<WorldSettingRecord[]>('get_world_settings', { novelId: input.novelId }),
    bridgeCall<RuleSystemRecord[]>('get_rule_systems', { novelId: input.novelId }),
    bridgeCall<NovelRecord | null>('get_novel_by_id', { id: input.novelId }),
  ]);
  requireCondition(
    worldSettings.some((setting) => setting.isActive && setting.content.trim()) &&
      ruleSystems.some((rule) => rule.isActive && rule.content.trim()) &&
      readProtagonistNames(novel).length > 0,
    'Sparse-idea preparation did not persist a usable world setting, rule system, and protagonist.',
  );
}

function replaceAutomaticAssetResumeDiagnostics(
  target: AutomaticAssetResumeDiagnostic[],
  bundle: TaskConversationBundle | null,
): void {
  const diagnostics = automaticAssetPreparationTurns(bundle).map((turn) => {
    const runs = bundle?.runs.filter((run) => run.turnId === turn.turnId) ?? [];
    const run = runs.at(-1);
    return {
      goal: decodeWorkbenchTurnContent(turn.content).content,
      turnId: turn.turnId,
      runId: run?.runId ?? '',
      runStatus: run?.status ?? 'not_started',
      artifactCount: run
        ? (bundle?.artifacts.filter((artifact) => artifact.runId === run.runId).length ?? 0)
        : 0,
    };
  });
  target.splice(0, target.length, ...diagnostics);
}

async function readVisibleSparseAssets(): Promise<SparseAssetKind[]> {
  const visible: SparseAssetKind[] = [];
  for (const asset of SPARSE_ASSET_ORDER) {
    const item = await browser.$(`[data-testid="workbench-missing-asset-${asset}"]`);
    if ((await item.isExisting()) && (await item.isDisplayed())) visible.push(asset);
  }
  return visible;
}

async function waitForAutomaticAssetTurn(input: {
  conversationId: string;
  goal: string;
  knownTurnIds: Set<string>;
  expectedPrompts: readonly string[];
  chapterNumber: number;
}): Promise<string> {
  let turnId = '';
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId: input.conversationId,
      });
      const creativeTurns = creativeUserTurns(bundle);
      if (
        creativeTurns.length !== input.expectedPrompts.length ||
        !input.expectedPrompts.every(
          (prompt, index) => sha256(creativeTurns[index]?.content ?? '') === sha256(prompt),
        )
      ) {
        return false;
      }
      const turn = (bundle?.turns ?? []).find(
        (item) =>
          item.role === 'user' &&
          !input.knownTurnIds.has(item.turnId) &&
          decodeWorkbenchTurnContent(item.content).content === input.goal &&
          isAutomaticAssetPreparationTurn(item),
      );
      // The DSH planner can take longer than this UI-transition timeout before it
      // projects a Workbench Run. The terminal-run wait below owns model latency.
      if (!turn) return false;
      turnId = turn.turnId;
      return true;
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${input.chapterNumber} did not persist automatic asset turn: ${input.goal}.`,
    },
  );
  return turnId;
}

async function waitForAppliedAssetDecision(input: {
  conversationId: string;
  artifactId: string;
  chapterNumber: number;
  asset: string;
  onConflict?: (conflictCode: string) => void;
}): Promise<string> {
  let applyTransactionId = '';
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId: input.conversationId,
      });
      const decisions = bundle?.decisions.filter(
        (decision) => decision.artifactId === input.artifactId,
      );
      const decision = decisions?.[decisions.length - 1];
      if (decision?.conflictCode) {
        input.onConflict?.(decision.conflictCode);
        throw new Error(
          `Chapter ${input.chapterNumber} ${input.asset} apply conflicted: ${decision.conflictCode}.`,
        );
      }
      if (decision?.decision !== 'request_apply' || !decision.applyTransactionId) return false;
      requireCondition(
        decisions?.length === 1,
        `Chapter ${input.chapterNumber} ${input.asset} recorded duplicate apply decisions.`,
      );
      applyTransactionId = decision.applyTransactionId;
      return true;
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${input.chapterNumber} ${input.asset} did not retain an atomic apply transaction.`,
    },
  );
  return applyTransactionId;
}

async function findChildByAttribute(
  parent: WebdriverIO.Element,
  testId: string,
  attribute: string,
  expected: string,
): Promise<WebdriverIO.Element> {
  const element = await parent.$(`[data-testid="${testId}"][${attribute}="${expected}"]`);
  await element.waitForDisplayed({ timeout: 30_000 });
  return element as unknown as WebdriverIO.Element;
}

function assertArtifact(artifact: ResultArtifactBundle, input: ChapterRunInput): void {
  requireCondition(
    artifact.artifact.artifactType === 'chapter_text' &&
      artifact.artifact.sourceNovelId === input.novelId &&
      artifact.artifact.sourceChapterId === input.chapterId,
    `Chapter ${input.chapterNumber} artifact scope is invalid.`,
  );
  requireCondition(
    ['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus),
    `Chapter ${input.chapterNumber} artifact validation failed.`,
  );
  requireCondition(
    sha256(artifact.rawContent) === artifact.artifact.contentHash,
    `Chapter ${input.chapterNumber} artifact hash is invalid.`,
  );
}

function assertActiveConversation(
  bundle: TaskConversationBundle | null,
  input: ChapterRunInput,
): { turnId: string; runId: string } {
  requireCondition(
    Boolean(bundle),
    `Chapter ${input.chapterNumber} conversation bundle is absent.`,
  );
  const userTurns = assertPersistedConversationTurns(bundle, input.expectedPrompts);
  const turn = userTurns[userTurns.length - 1];
  const turnRuns = bundle!.runs.filter((run) => run.turnId === turn.turnId);
  requireCondition(
    turnRuns.length === input.evidence.attempts.length && turnRuns.length >= 1,
    `Chapter ${input.chapterNumber} run attempts do not match the retained evidence.`,
  );
  const run = turnRuns[turnRuns.length - 1];
  requireCondition(
    turnRuns.slice(0, -1).every((attempt) => attempt.status === 'failed') &&
      run.status === 'completed' &&
      run.modelSnapshot.runtimeMode === 'api' &&
      run.modelSnapshot.providerId === 'openai_compatible' &&
      run.modelSnapshot.modelId === input.profile.model &&
      normalizeUrl(run.modelSnapshot.baseUrl) === input.profile.baseUrl &&
      Number(run.modelSnapshot.options?.maxTokens) === 12_000,
    `Chapter ${input.chapterNumber} run did not freeze the requested model identity.`,
  );
  requireCondition(
    input.evidence.attempts.every(
      (attempt, index) =>
        attempt.attempt === index + 1 &&
        attempt.runId === turnRuns[index]?.runId &&
        attempt.status === turnRuns[index]?.status,
    ),
    `Chapter ${input.chapterNumber} immutable retry evidence drifted from persisted runs.`,
  );
  requireCondition(
    bundle!.toolEvents.some(
      (event) =>
        event.runId === run.runId &&
        event.toolName === 'generate_chapter' &&
        event.status === 'succeeded' &&
        !event.error,
    ),
    `Chapter ${input.chapterNumber} has no successful generate_chapter tool event.`,
  );
  requireCondition(
    bundle!.artifacts.filter(
      (artifact) => artifact.runId === run.runId && artifact.artifactType === 'chapter_text',
    ).length === 1,
    `Chapter ${input.chapterNumber} did not retain one run-linked chapter artifact.`,
  );
  return { turnId: turn.turnId, runId: run.runId };
}

function isAutomaticAssetPreparationTurn(turn: { role: string; content?: string }): boolean {
  if (turn.role !== 'user') return false;
  const decoded = decodeWorkbenchTurnContent(turn.content);
  return (
    decoded.origin === 'workbench_asset_preparation' &&
    (
      [
        'story_plan',
        'world_setting',
        'rule_system',
        'protagonist',
        'chapter_outline',
      ] satisfies ChapterCoreAsset[]
    ).some((asset) => isCoreAssetGenerationGoal(decoded.content, asset))
  );
}

function isAutomaticChapterSummaryTurn(turn: { role: string; content?: string }): boolean {
  if (turn.role !== 'user') return false;
  const decoded = decodeWorkbenchTurnContent(turn.content);
  return decoded.origin === 'workbench_chapter_summary' && decoded.content === '总结本章';
}

function isAutomaticWorkbenchTurn(turn: { role: string; content?: string }): boolean {
  return isAutomaticAssetPreparationTurn(turn) || isAutomaticChapterSummaryTurn(turn);
}

function creativeUserTurns(
  bundle: TaskConversationBundle | null,
): Array<{ turnId: string; role: string; content?: string }> {
  return (bundle?.turns ?? []).filter(
    (turn) => turn.role === 'user' && !isAutomaticWorkbenchTurn(turn),
  );
}

function buildCreativeUserTurnEvidence(
  turns: ReadonlyArray<{ turnId: string; content?: string }>,
  expectedPrompts: readonly string[],
  scenario: RealConversationAcceptanceScenario,
): RealConversationCreativeUserTurnEvidence[] {
  requireCondition(
    turns.length === expectedPrompts.length,
    'Creative user-turn evidence cannot be built from an incomplete turn sequence.',
  );
  return turns.map((turn, index) => {
    const content = turn.content ?? '';
    const expected = expectedPrompts[index] ?? '';
    requireCondition(
      content === expected,
      `Creative user turn ${index + 1} drifted before evidence capture.`,
    );
    return {
      sequence: index + 1,
      turnId: turn.turnId,
      source: 'user',
      classification:
        index > 0
          ? 'continuation_instruction'
          : scenario === 'sparse-idea'
            ? 'initial_creative_brief'
            : 'chapter_generation_instruction',
      contentSha256: sha256(content),
      contentLength: content.length,
    };
  });
}

function automaticAssetPreparationTurns(
  bundle: TaskConversationBundle | null,
): Array<{ turnId: string; role: string; content?: string }> {
  return (bundle?.turns ?? []).filter(isAutomaticAssetPreparationTurn);
}

function automaticChapterSummaryTurns(
  bundle: TaskConversationBundle | null,
): Array<{ turnId: string; role: string; content?: string }> {
  return (bundle?.turns ?? []).filter(isAutomaticChapterSummaryTurn);
}

function assertPersistedConversationTurns(
  bundle: TaskConversationBundle | null,
  expectedPrompts: readonly string[],
): Array<{ turnId: string; role: string; content?: string }> {
  requireCondition(Boolean(bundle), 'The continuous task conversation bundle is absent.');
  const userTurns = creativeUserTurns(bundle);
  const mismatchedIndex = expectedPrompts.findIndex(
    (prompt, index) => sha256(userTurns[index]?.content ?? '') !== sha256(prompt),
  );
  requireCondition(
    userTurns.length === expectedPrompts.length && mismatchedIndex === -1,
    `Continuous creative instructions drifted: userTurns=${userTurns.length}; expected=${expectedPrompts.length}; firstMismatchedTurn=${mismatchedIndex + 1}.`,
  );
  requireCondition(
    new Set(userTurns.map((turn) => turn.turnId)).size === userTurns.length,
    'The continuous task reused a user turn identifier.',
  );
  return userTurns;
}

async function waitForPersistedConversationTurns(
  conversationId: string,
  expectedPrompts: readonly string[],
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId,
      });
      const userTurns = creativeUserTurns(bundle);
      return (
        userTurns.length === expectedPrompts.length &&
        expectedPrompts.every(
          (prompt, index) => sha256(userTurns[index]?.content ?? '') === sha256(prompt),
        )
      );
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `The continuous task did not persist user turn ${expectedPrompts.length}.`,
    },
  );
}

async function waitForLatestTurnRun(
  conversationId: string,
  expectedPrompts: readonly string[],
): Promise<string> {
  let turnId = '';
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId,
      });
      const userTurns = creativeUserTurns(bundle);
      const currentTurn = userTurns[userTurns.length - 1];
      if (
        userTurns.length !== expectedPrompts.length ||
        !currentTurn ||
        sha256(currentTurn.content ?? '') !==
          sha256(expectedPrompts[expectedPrompts.length - 1] ?? '') ||
        !bundle?.runs.some((run) => run.turnId === currentTurn.turnId)
      ) {
        return false;
      }
      turnId = currentTurn.turnId;
      return true;
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `The continuous task did not start the run for user turn ${expectedPrompts.length}.`,
    },
  );
  return turnId;
}

async function waitForChapterRunWithTransientRecovery(input: {
  chapterNumber: number;
  conversationId: string;
  turnId: string;
  chapterTimeoutMs: number;
  evidence: ChapterEvidence;
}): Promise<void> {
  for (
    let attemptNumber = 1;
    attemptNumber <= REAL_ACCEPTANCE_MAX_RUN_ATTEMPTS;
    attemptNumber += 1
  ) {
    const run = await waitForTerminalTurnRun({
      conversationId: input.conversationId,
      turnId: input.turnId,
      minimumAttemptCount: attemptNumber,
      chapterNumber: input.chapterNumber,
      timeoutMs: input.chapterTimeoutMs,
    });
    const error =
      run.status === 'completed' ? '' : await readChapterFailure(input.conversationId, run.runId);
    input.evidence.attempts.push({
      attempt: attemptNumber,
      runId: run.runId,
      status: run.status,
      error,
    });
    input.evidence.retryCount = input.evidence.attempts.length - 1;

    if (run.status === 'completed') {
      const status = await waitForTestId('workbench-conversation-status');
      try {
        await browser.waitUntil(
          async () => (await status.getAttribute('data-status')) === 'waiting_user',
          {
            timeout: 30_000,
            interval: 100,
            timeoutMsg: `Chapter ${input.chapterNumber} completed but the task did not return to the waiting state.`,
          },
        );
      } catch (error) {
        const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
          conversationId: input.conversationId,
        }).catch(() => null);
        const activeRunCount =
          bundle?.runs.filter((item) =>
            ['queued', 'running', 'cancel_requested'].includes(item.status),
          ).length ?? 0;
        const chapterCandidateCount =
          bundle?.artifacts.filter((artifact) => artifact.artifactType === 'chapter_text').length ??
          0;
        const diagnostics = {
          domStatus: await status.getAttribute('data-status').catch(() => 'unavailable'),
          conversationStatus: bundle?.conversation.status ?? 'unavailable',
          activeRunCount,
          chapterCandidateCount,
          totalRunCount: bundle?.runs.length ?? 0,
          totalArtifactCount: bundle?.artifacts.length ?? 0,
        };
        throw new Error(
          `${safeEvidenceError(error)} State diagnostics: ${JSON.stringify(diagnostics)}.`,
        );
      }
      input.evidence.error = '';
      return;
    }

    input.evidence.error = error || `Run ${run.runId} ended with status ${run.status}.`;
    const retryable = run.status === 'failed' && isRetryableRealAcceptanceRunFailure(error);
    if (!retryable || input.evidence.retryCount >= REAL_ACCEPTANCE_MAX_RETRYABLE_RUN_RETRIES) {
      throw new Error(
        `Chapter ${input.chapterNumber} generation failed${error ? `: ${error}` : '.'}`,
      );
    }

    const runBlock = await findTestIdByAttribute('workbench-run', 'data-run-id', run.runId);
    const retry = await runBlock.$('[data-testid="workbench-retry-turn"]');
    await retry.waitForClickable({ timeout: 30_000 });
    await retry.click();
    await waitForTurnRunCount(
      input.conversationId,
      input.turnId,
      input.evidence.attempts.length + 1,
      input.chapterNumber,
    );
  }
  throw new Error(`Chapter ${input.chapterNumber} exhausted its retryable-run budget.`);
}

async function waitForTerminalTurnRun(input: {
  conversationId: string;
  turnId: string;
  minimumAttemptCount: number;
  chapterNumber: number;
  timeoutMs: number;
}): Promise<{ runId: string; status: 'completed' | 'failed' | 'cancelled' }> {
  let terminalRun: { runId: string; status: 'completed' | 'failed' | 'cancelled' } | undefined;
  await waitForLiveCondition(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId: input.conversationId,
      });
      const turnRuns = bundle?.runs.filter((run) => run.turnId === input.turnId) ?? [];
      const latestRun = turnRuns[turnRuns.length - 1];
      if (
        turnRuns.length < input.minimumAttemptCount ||
        !latestRun ||
        !['completed', 'failed', 'cancelled'].includes(latestRun.status)
      ) {
        return false;
      }
      terminalRun = {
        runId: latestRun.runId,
        status: latestRun.status as 'completed' | 'failed' | 'cancelled',
      };
      return true;
    },
    {
      timeout: input.timeoutMs,
      interval: 250,
      timeoutMessage: `Chapter ${input.chapterNumber} did not reach a terminal generation state for attempt ${input.minimumAttemptCount}.`,
    },
  );
  return terminalRun!;
}

async function waitForAutomaticSummaryTerminalRun(input: {
  conversationId: string;
  turnId: string;
  chapterNumber: number;
  timeoutMs: number;
}): Promise<{
  run: { runId: string; status: 'completed' | 'failed' | 'cancelled' };
  attempts: ChapterRunAttemptEvidence[];
}> {
  let terminalRun: { runId: string; status: 'completed' | 'failed' | 'cancelled' } | undefined;
  let attempts: ChapterRunAttemptEvidence[] = [];
  await waitForLiveCondition(
    async () => {
      const [bundle, runtimeStatus] = await Promise.all([
        bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
          conversationId: input.conversationId,
        }),
        bridgeCall<DshTaskRuntimeStatus | null>('dsh_get_task_runtime_status', {
          conversationId: input.conversationId,
        }),
      ]);
      const turnRuns = bundle?.runs.filter((run) => run.turnId === input.turnId) ?? [];
      const latestRun = turnRuns.at(-1);
      const runtimeStillOwnsRecovery =
        runtimeStatus &&
        ['attesting', 'running', 'cancel_requested'].includes(runtimeStatus.status);
      if (
        !latestRun ||
        !['completed', 'failed', 'cancelled'].includes(latestRun.status) ||
        runtimeStillOwnsRecovery
      ) {
        return false;
      }
      terminalRun = {
        runId: latestRun.runId,
        status: latestRun.status as 'completed' | 'failed' | 'cancelled',
      };
      attempts = turnRuns.map((run, index) => ({
        attempt: index + 1,
        runId: run.runId,
        status: run.status as 'completed' | 'failed' | 'cancelled',
        error: run.error ?? '',
      }));
      return true;
    },
    {
      timeout: input.timeoutMs,
      interval: 250,
      timeoutMessage: `Chapter ${input.chapterNumber} automatic summary did not finish its bounded recovery sequence.`,
    },
  );
  return { run: terminalRun!, attempts };
}

async function waitForLiveCondition(
  condition: () => Promise<boolean>,
  options: { timeout: number; interval: number; timeoutMessage: string },
): Promise<void> {
  const deadline = Date.now() + options.timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
      lastError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no such window|target window already closed|web view not found/i.test(message)) {
        throw new Error(
          `The desktop workbench window closed during the real-model run: ${message}`,
        );
      }
      lastError = message;
    }
    await new Promise((resolve) => setTimeout(resolve, options.interval));
  }
  throw new Error(
    lastError ? `${options.timeoutMessage} Last error: ${lastError}` : options.timeoutMessage,
  );
}

async function waitForTurnRunCount(
  conversationId: string,
  turnId: string,
  expectedCount: number,
  chapterNumber: number,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId,
      });
      return bundle?.runs.filter((run) => run.turnId === turnId).length === expectedCount;
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${chapterNumber} retry did not create immutable run ${expectedCount}.`,
    },
  );
}

async function readAndAssertGenerationSnapshot(input: {
  chapterNumber: number;
  chapterId: string;
  expectedContextHash: string;
  expectedContinuitySourceHash: string;
  scenario: RealConversationAcceptanceScenario;
}): Promise<RealConversationGenerationSnapshot> {
  const bridgeSnapshot = await bridgeCall<RealConversationGenerationSnapshotBridgeRecord | null>(
    'get_latest_chapter_generation_snapshot',
    { chapterId: input.chapterId },
  );
  requireCondition(
    Boolean(bridgeSnapshot),
    `Chapter ${input.chapterNumber} has no frozen snapshot.`,
  );
  const snapshot = parseRealConversationGenerationSnapshot(bridgeSnapshot!, input.chapterNumber);
  requireCondition(
    snapshot.chapterId === input.chapterId && snapshot.contextHash === input.expectedContextHash,
    `Chapter ${input.chapterNumber} snapshot identity does not match its tool evidence.`,
  );
  requireCondition(
    Boolean(snapshot.styleProfileId && snapshot.outputProfileId),
    `Chapter ${input.chapterNumber} did not resolve built-in style/output profiles.`,
  );

  const requiredSources = requiredGenerationSnapshotSourceTypes(input.scenario);
  for (const sourceType of requiredSources) {
    const source = snapshot.sources.find((item) => item.type === sourceType);
    requireCondition(
      source?.status === 'used',
      `Chapter ${input.chapterNumber} snapshot did not use ${sourceType}.`,
    );
  }
  const continuity = snapshot.sources.find((source) => source.type === 'adopted_chapter');
  requireCondition(
    input.chapterNumber === 1
      ? continuity?.status === 'missing'
      : continuity?.status === 'used' && continuity.summary === input.expectedContinuitySourceHash,
    `Chapter ${input.chapterNumber} snapshot continuity source is not the prior adopted hash.`,
  );

  const sections = new Map(
    snapshot.compiledContext.sections.map((section) => [section.key, section.content]),
  );
  if (input.scenario === 'prepared-assets') {
    const assetCanaries = [
      ['novel', WORLD_BACKGROUND],
      ['protagonist', PROTAGONIST_NAME],
      ['outline', CHAPTER_OUTLINES[input.chapterNumber - 1] ?? ''],
      ['style_output', STYLE_PROFILE_SUMMARY],
      ['reference_materials', '机械钟'],
    ] as const;
    const missingCanaries = assetCanaries
      .filter(([key, canary]) => !canary || !sections.get(key)?.includes(canary))
      .map(([key]) => key);
    const sectionLengths = assetCanaries
      .map(([key]) => `${key}:${sections.get(key)?.length ?? 0}`)
      .join(',');
    requireCondition(
      missingCanaries.length === 0,
      `Chapter ${input.chapterNumber} snapshot sections do not contain the prepared asset canaries: missing=${missingCanaries.join(',') || 'none'}; lengths=${sectionLengths}.`,
    );
  } else {
    const requiredSectionKeys = ['novel', 'protagonist', 'outline', 'style_output'];
    const emptySections = requiredSectionKeys.filter((key) => !sections.get(key)?.trim());
    requireCondition(
      emptySections.length === 0,
      `Chapter ${input.chapterNumber} sparse-idea flow did not build usable formal context sections: ${emptySections.join(',') || 'none'}.`,
    );
    const fixtureLeaks = findRealConversationFixtureLeaks(
      [...sections.entries()].map(([label, content]) => ({ label, content })),
      [
        { label: 'world', value: WORLD_BACKGROUND },
        { label: 'protagonist_name', value: PROTAGONIST_NAME },
        { label: 'protagonist_identity', value: PROTAGONIST_IDENTITY },
        { label: 'protagonist_motivation', value: PROTAGONIST_MOTIVATION },
        { label: 'research_title', value: RESEARCH_REFERENCE_TITLE },
        { label: 'research_text', value: RESEARCH_REFERENCE_TEXT },
        ...CHAPTER_OUTLINES.map((value, index) => ({
          label: `chapter_outline_${index + 1}`,
          value,
        })),
      ],
    );
    requireCondition(
      fixtureLeaks.length === 0,
      `Chapter ${input.chapterNumber} sparse-idea flow leaked prepared-assets fixture content: ${fixtureLeaks
        .map((leak) => `${leak.canaryLabel}@${leak.surfaceLabel}`)
        .join(',')}.`,
    );

    const chapter = await bridgeCall<ChapterRecord | null>('get_chapter_by_id', {
      id: input.chapterId,
    });
    const novelId = chapter?.novelId?.trim() ?? '';
    requireCondition(
      Boolean(novelId),
      `Chapter ${input.chapterNumber} cannot resolve its novel for sparse asset verification.`,
    );
    const [worldSettings, ruleSystems, novel] = await Promise.all([
      bridgeCall<WorldSettingRecord[]>('get_world_settings', { novelId }),
      bridgeCall<RuleSystemRecord[]>('get_rule_systems', { novelId }),
      bridgeCall<NovelRecord | null>('get_novel_by_id', { id: novelId }),
    ]);
    const activeWorld = worldSettings.find((setting) => setting.isActive && setting.content.trim());
    const activeRuleContents = ruleSystems
      .filter((rule) => rule.isActive && rule.content.trim())
      .map((rule) => rule.content.trim());
    const protagonistNames = readProtagonistNames(novel);
    const novelSection = sections.get('novel') ?? '';
    const protagonistSection = sections.get('protagonist') ?? '';
    requireCondition(
      Boolean(activeWorld?.content.trim()) &&
        novelSection.includes(activeWorld!.content.trim()) &&
        activeRuleContents.length > 0 &&
        activeRuleContents.every((content) => novelSection.includes(content)) &&
        protagonistNames.length > 0 &&
        protagonistNames.every((name) => protagonistSection.includes(name)),
      `Chapter ${input.chapterNumber} snapshot does not contain the world, rules, and protagonist persisted by sparse preparation.`,
    );
    if (input.chapterNumber === 1) {
      const [styleProfiles, outputProfiles] = await Promise.all([
        bridgeCall<unknown[]>('list_style_profiles', { projectId: null }),
        bridgeCall<unknown[]>('list_output_profiles', { projectId: null }),
      ]);
      assertRealConversationBuiltInProfileSelection({
        styleProfileId: snapshot.styleProfileId,
        outputProfileId: snapshot.outputProfileId,
        styleProfiles,
        outputProfiles,
        styleOutputSection: sections.get('style_output') ?? '',
      });
    }
  }
  return snapshot;
}

async function readAndAssertProviderRequestEvidence(input: {
  chapterNumber: number;
  snapshot: RealConversationGenerationSnapshot;
  evidence: WorkbenchProviderRequestEvidence | undefined;
  lengthRepairCount: number;
  integrityRepairCount: number;
  integrityRepairAttempts: IntegrityRepairAttemptEvidence[];
}): Promise<WorkbenchProviderRequestEvidence> {
  const evidence = input.evidence;
  requireCondition(
    Boolean(
      evidence &&
      evidence.schemaVersion === 'workbench_provider_request_evidence_v1' &&
      evidence.hashAlgorithm === 'sha256' &&
      evidence.messagesSerialization === 'json_stringify_messages_v1' &&
      evidence.taskId &&
      evidence.attemptId &&
      isGenerationContextHash(evidence.snapshotContextHash) &&
      evidence.snapshotContextHash === input.snapshot.contextHash &&
      evidence.messageCount > 0 &&
      isSha256(evidence.messagesSha256) &&
      isSha256(evidence.compiledContextSha256) &&
      isSha256(evidence.snapshotCompiledPromptSha256) &&
      isSha256(evidence.snapshotRequestSourceSha256) &&
      isSha256(evidence.includedSnapshotRequestSourceSha256) &&
      evidence.snapshotRequestSourceStatus === 'included' &&
      evidence.snapshotRequestSourceSha256 === evidence.includedSnapshotRequestSourceSha256,
    ),
    `Chapter ${input.chapterNumber} did not expose complete hash-only Provider request evidence.`,
  );

  const detail = await bridgeCall<AiTaskDetail>('get_ai_task', {
    input: { taskId: evidence!.taskId },
  });
  const attempt = detail.attempts.find((item) => item.attemptId === evidence!.attemptId);
  requireCondition(
    detail.task.taskId === evidence!.taskId &&
      detail.task.status === 'completed' &&
      Boolean(detail.task.resultArtifactId) &&
      attempt?.status === 'succeeded' &&
      attempt.providerRequestId === evidence!.attemptId,
    `Chapter ${input.chapterNumber} Provider request evidence does not reference a successful persisted attempt.`,
  );

  requireCondition(
    detail.inputSnapshot.inputType === 'compiled_provider_messages_v1' &&
      isPlainRecord(detail.inputSnapshot.payloadJson),
    `Chapter ${input.chapterNumber} Provider request input snapshot is not a compiled messages contract.`,
  );
  const payload = detail.inputSnapshot.payloadJson as Record<string, unknown>;
  requireCondition(
    payload.contractVersion === 'compiled_ai_request_v1' &&
      payload.messageCount === evidence!.messageCount &&
      payload.requestBodyHash === evidence!.messagesSha256 &&
      sha256(detail.inputSnapshot.body) === evidence!.messagesSha256,
    `Chapter ${input.chapterNumber} Provider messages hash drifted from its persisted dispatch contract.`,
  );
  const taskInput = isPlainRecord(payload.taskInput) ? payload.taskInput : {};

  let providerMessages: unknown;
  try {
    providerMessages = JSON.parse(detail.inputSnapshot.body);
  } catch {
    providerMessages = undefined;
  }
  const messageList =
    isPlainRecord(providerMessages) && Array.isArray(providerMessages.messages)
      ? providerMessages.messages
      : [];
  requireCondition(
    messageList.length === evidence!.messageCount &&
      messageList.every(
        (message) =>
          isPlainRecord(message) &&
          typeof message.role === 'string' &&
          typeof message.content === 'string',
      ),
    `Chapter ${input.chapterNumber} persisted Provider messages cannot be verified without exposing them.`,
  );

  requireCondition(
    isPlainRecord(detail.contextSnapshot.sourceManifestJson),
    `Chapter ${input.chapterNumber} Provider context manifest is invalid.`,
  );
  const manifest = detail.contextSnapshot.sourceManifestJson as Record<string, unknown>;
  const rawManifestSources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const manifestSources = rawManifestSources.filter(isPlainRecord);
  requireCondition(
    manifest.contractVersion === 'context_manifest_v1' &&
      manifest.compiledContextHash === evidence!.compiledContextSha256 &&
      sha256(detail.contextSnapshot.compiledContext) === evidence!.compiledContextSha256 &&
      manifestSources.length === rawManifestSources.length,
    `Chapter ${input.chapterNumber} Provider context manifest hash or source shape is invalid.`,
  );

  const normalizedCompiledPrompt = input.snapshot.compiledPromptText.replace(/\r\n?/g, '\n').trim();
  requireCondition(
    Boolean(normalizedCompiledPrompt) &&
      sha256(normalizedCompiledPrompt) === evidence!.snapshotCompiledPromptSha256,
    `Chapter ${input.chapterNumber} frozen generation prompt hash drifted from its snapshot.`,
  );

  const requestSources = manifestSources.filter(
    (source) => source.sourceType === 'request_context',
  );
  const finalRequestSource = requestSources[0] ?? {};
  const finalRequestSourceVersion =
    typeof finalRequestSource.sourceVersion === 'string' ? finalRequestSource.sourceVersion : '';
  const finalRequestKind =
    input.integrityRepairCount > 0
      ? 'integrity_repair'
      : input.lengthRepairCount > 0
        ? 'length_repair'
        : 'initial';
  const finalRequestIsRepair = finalRequestKind !== 'initial';
  requireCondition(
    requestSources.length === 1 &&
      finalRequestSource.required === true &&
      finalRequestSource.requireFull === true &&
      finalRequestSource.status === 'included' &&
      finalRequestSource.contentHash === evidence!.snapshotRequestSourceSha256 &&
      finalRequestSource.includedHash === evidence!.includedSnapshotRequestSourceSha256 &&
      finalRequestSource.contentHash === finalRequestSource.includedHash &&
      (finalRequestKind === 'integrity_repair'
        ? isSha256(finalRequestSourceVersion) &&
          taskInput.purpose === 'workbench_chapter_integrity_repair' &&
          taskInput.integrityRepairAttempt === input.integrityRepairCount &&
          taskInput.sourceContentHash === finalRequestSourceVersion &&
          input.integrityRepairAttempts.at(-1)?.sourceContentHash === finalRequestSourceVersion &&
          JSON.stringify(taskInput.issueCodes) ===
            JSON.stringify(input.integrityRepairAttempts.at(-1)?.issueCodes)
        : finalRequestKind === 'length_repair'
          ? isSha256(finalRequestSourceVersion) &&
            taskInput.purpose === 'workbench_chapter_length_repair' &&
            taskInput.repairAttempt === input.lengthRepairCount &&
            taskInput.sourceContentHash === finalRequestSourceVersion
          : finalRequestSourceVersion === input.snapshot.contextHash &&
            taskInput.purpose === 'workbench_chapter_candidate'),
    `Chapter ${input.chapterNumber} final request source is not the fully included ${finalRequestKind.replace('_', '-')} version.`,
  );

  const providerSections = input.snapshot.compiledContext.sections.filter(
    (section) => section.key !== 'current_editor',
  );
  const sectionManifestSources = new Map<string, Record<string, unknown>>();
  for (const section of providerSections) {
    const matches = manifestSources.filter(
      (source) =>
        source.sourceVersion === input.snapshot.contextHash && source.label === section.title,
    );
    const source = matches[0] ?? {};
    const normalizedSectionContent = section.content.replace(/\r\n?/g, '\n').trim();
    requireCondition(
      matches.length === 1 &&
        Boolean(normalizedSectionContent) &&
        source.contentHash === sha256(normalizedSectionContent) &&
        isSha256(source.contentHash) &&
        ['included', 'truncated', 'omitted_empty', 'omitted_budget'].includes(
          String(source.status),
        ),
      `Chapter ${input.chapterNumber} snapshot section ${section.key} is not an independent, hash-aligned Provider source.`,
    );
    sectionManifestSources.set(section.key, source);
  }
  requireCondition(
    sectionManifestSources.size === providerSections.length &&
      new Set(
        manifestSources.map((source) => `${String(source.sourceType)}:${String(source.sourceId)}`),
      ).size === manifestSources.length,
    `Chapter ${input.chapterNumber} Provider manifest merged snapshot sections or reused a source identity.`,
  );

  const criticalSectionKeys = ['novel', 'protagonist', 'outline'];
  if (sectionManifestSources.has('cross_chapter_continuity')) {
    criticalSectionKeys.push('cross_chapter_continuity');
  }
  for (const sectionKey of criticalSectionKeys) {
    const source = sectionManifestSources.get(sectionKey);
    requireCondition(
      Boolean(source) &&
        source!.required === true &&
        source!.requireFull === true &&
        source!.status === 'included' &&
        source!.contentHash === source!.includedHash &&
        detail.contextSnapshot.compiledContext.includes(
          input.snapshot.compiledContext.sections
            .find((section) => section.key === sectionKey)!
            .content.replace(/\r\n?/g, '\n')
            .trim(),
        ),
      `Chapter ${input.chapterNumber} critical Provider section ${sectionKey} was not included in full.`,
    );
  }

  if (finalRequestIsRepair) {
    const repairDraftSources = manifestSources.filter(
      (source) =>
        source.sourceType === 'draft' &&
        source.sourceVersion === finalRequestSourceVersion &&
        source.label === 'Current chapter repair draft',
    );
    const repairDraftSource = repairDraftSources[0] ?? {};
    requireCondition(
      repairDraftSources.length === 1 &&
        repairDraftSource.required === true &&
        repairDraftSource.requireFull === true &&
        repairDraftSource.status === 'included' &&
        repairDraftSource.contentHash === finalRequestSourceVersion &&
        repairDraftSource.includedHash === repairDraftSource.contentHash,
      `Chapter ${input.chapterNumber} final length repair did not carry its complete source draft.`,
    );
  }

  const requireFullSources = manifestSources.filter((source) => source.requireFull === true);
  requireCondition(
    requireFullSources.length >= criticalSectionKeys.length + 1 &&
      requireFullSources.every(
        (source) =>
          source.required === true &&
          source.status === 'included' &&
          isSha256(source.contentHash) &&
          source.contentHash === source.includedHash,
      ),
    `Chapter ${input.chapterNumber} has a critical Provider source that was not included in full.`,
  );

  const manifestStatus = manifestSources.some((source) => source.status === 'omitted_budget')
    ? 'omitted_budget'
    : manifestSources.some((source) => source.status === 'omitted_empty')
      ? 'omitted_empty'
      : manifestSources.some((source) => source.status === 'truncated')
        ? 'truncated'
        : 'included';
  type SourceStatus = 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  const expectedGenerationStatuses: Record<string, SourceStatus> = {};
  const mergeExpectedStatus = (sourceType: string, status: SourceStatus) => {
    const current = expectedGenerationStatuses[sourceType];
    const statuses = current ? [current, status] : [status];
    expectedGenerationStatuses[sourceType] = statuses.includes('omitted_budget')
      ? 'omitted_budget'
      : statuses.includes('omitted_empty')
        ? 'omitted_empty'
        : statuses.includes('truncated')
          ? 'truncated'
          : 'included';
  };
  for (const section of providerSections) {
    const source = sectionManifestSources.get(section.key);
    const status = source?.status;
    if (!['included', 'truncated', 'omitted_empty', 'omitted_budget'].includes(String(status))) {
      continue;
    }
    for (const sourceType of section.sourceTypes) {
      mergeExpectedStatus(sourceType, status as SourceStatus);
    }
  }
  mergeExpectedStatus('user_instruction', 'included');
  if (finalRequestIsRepair) mergeExpectedStatus('current_editor', 'included');
  requireCondition(
    evidence!.providerSourceStatus === manifestStatus &&
      Object.entries(expectedGenerationStatuses).every(
        ([sourceType, status]) => evidence!.generationSourceStatuses?.[sourceType] === status,
      ),
    `Chapter ${input.chapterNumber} aggregate Provider source evidence drifted from the manifest.`,
  );

  const providerMessageContainsCompiledContext = messageList.some(
    (message) =>
      isPlainRecord(message) &&
      typeof message.content === 'string' &&
      message.content.includes(detail.contextSnapshot.compiledContext),
  );
  requireCondition(
    providerMessageContainsCompiledContext,
    `Chapter ${input.chapterNumber} compiled typed context is absent from the hashed Provider messages.`,
  );
  return evidence!;
}

function requiredGenerationSnapshotSourceTypes(
  scenario: RealConversationAcceptanceScenario,
): string[] {
  const sourceTypes = [
    'novel',
    'world_setting',
    'protagonist',
    'chapter_outline',
    'style_profile',
    'output_profile',
  ];
  if (scenario === 'prepared-assets') sourceTypes.push('reference_material');
  if (scenario === 'sparse-idea') sourceTypes.push('rule_system');
  return sourceTypes;
}

function assertFinalContinuousConversation(
  bundle: TaskConversationBundle | null,
  expectedPrompts: readonly string[],
  chapters: readonly ChapterEvidence[],
  assetPreparations: readonly SparseAssetPreparationEvidence[],
  scenario: RealConversationAcceptanceScenario,
): void {
  const userTurns = assertPersistedConversationTurns(bundle, expectedPrompts);
  const automaticAssetTurns = automaticAssetPreparationTurns(bundle);
  const automaticSummaryTurns = automaticChapterSummaryTurns(bundle);
  const totalAttemptCount = chapters.reduce((sum, chapter) => sum + chapter.attempts.length, 0);
  const totalSummaryAttemptCount = chapters.reduce(
    (sum, chapter) => sum + chapter.summaryAttempts.length,
    0,
  );
  requireCondition(
    bundle!.conversation.status === 'completed' &&
      automaticAssetTurns.length === assetPreparations.length &&
      automaticSummaryTurns.length === chapters.length &&
      bundle!.runs.length ===
        totalAttemptCount + assetPreparations.length + totalSummaryAttemptCount &&
      bundle!.artifacts.length === expectedPrompts.length * 2 + assetPreparations.length &&
      bundle!.decisions.length === expectedPrompts.length * 2 + assetPreparations.length &&
      bundle!.authorizations.length === expectedPrompts.length,
    'The final continuous task does not retain every creative, asset, summary, decision, and authorization fact.',
  );
  requireCondition(
    bundle!.runs.every((run) => ['completed', 'failed'].includes(run.status)) &&
      new Set(bundle!.runs.map((run) => run.runId)).size === bundle!.runs.length &&
      new Set(bundle!.artifacts.map((artifact) => artifact.artifactId)).size ===
        bundle!.artifacts.length,
    'The final continuous task contains an active/cancelled or duplicate run/artifact identity.',
  );
  requireCondition(
    chapters.every(
      (chapter) =>
        bundle!.decisions.filter(
          (decision) =>
            decision.artifactId === chapter.artifactId && decision.decision === 'confirm',
        ).length === 1,
    ) &&
      assetPreparations.every((asset) => {
        const decisions = bundle!.decisions.filter(
          (decision) => decision.artifactId === asset.artifactId,
        );
        return (
          decisions.length === 1 &&
          decisions[0]?.decision === 'request_apply' &&
          decisions[0]?.applyTransactionId === asset.applyTransactionId &&
          !decisions[0]?.conflictCode
        );
      }) &&
      chapters.every((chapter) => {
        const decisions = bundle!.decisions.filter(
          (decision) => decision.artifactId === chapter.summaryArtifactId,
        );
        return (
          decisions.length === 1 &&
          decisions[0]?.decision === 'request_apply' &&
          decisions[0]?.applyTransactionId === chapter.summaryApplyTransactionId &&
          !decisions[0]?.conflictCode
        );
      }) &&
      bundle!.authorizations.every(
        (authorization) =>
          authorization.status === 'consumed' &&
          authorization.consumedByDraftId &&
          chapters.some((chapter) => chapter.artifactId === authorization.artifactId) &&
          !assetPreparations.some((asset) => asset.artifactId === authorization.artifactId),
      ),
    'Final decisions do not prove atomic asset application and chapter-only consumed review authorizations.',
  );
  requireCondition(
    chapters.every((chapter, index) => {
      const turnId = userTurns[index]?.turnId;
      const turnRuns = bundle!.runs.filter((run) => run.turnId === turnId);
      const finalRun = turnRuns[turnRuns.length - 1];
      return (
        chapter.conversationId === bundle!.conversation.conversationId &&
        chapter.turnId === turnId &&
        chapter.instructionHash === sha256(expectedPrompts[index] ?? '') &&
        chapter.retryCount === chapter.attempts.length - 1 &&
        turnRuns.length === chapter.attempts.length &&
        chapter.attempts.every(
          (attempt, attemptIndex) =>
            attempt.runId === turnRuns[attemptIndex]?.runId &&
            attempt.status === turnRuns[attemptIndex]?.status,
        ) &&
        turnRuns.slice(0, -1).every((run) => run.status === 'failed') &&
        finalRun?.status === 'completed' &&
        chapter.runId === finalRun.runId &&
        chapter.artifactId ===
          bundle!.artifacts.find((artifact) => artifact.runId === finalRun.runId)?.artifactId &&
        (index === 0
          ? chapter.continuitySourceHash === ''
          : chapter.continuitySourceHash === chapters[index - 1]?.adoptedHash)
      );
    }),
    'Chapter evidence does not prove one continuous conversation, immutable retry history, or authoritative continuity handoff.',
  );
  requireCondition(
    assetPreparations.every((asset) => {
      const turn = automaticAssetTurns.find((item) => item.turnId === asset.turnId);
      const decodedTurn = decodeWorkbenchTurnContent(turn?.content);
      const runs = bundle!.runs.filter((run) => run.turnId === asset.turnId);
      const artifact = bundle!.artifacts.find((item) => item.runId === asset.runId);
      const toolEvents = bundle!.toolEvents.filter(
        (event) => event.runId === asset.runId && event.toolName === asset.toolName,
      );
      const successfulToolEvents = toolEvents.filter(
        (event) => event.status === 'succeeded' && !event.error,
      );
      return (
        decodedTurn.content === asset.goal &&
        decodedTurn.origin === asset.turnOrigin &&
        asset.turnOrigin === 'workbench_asset_preparation' &&
        asset.goalSha256 === sha256(asset.goal) &&
        asset.goalLength === asset.goal.length &&
        asset.postRunProjectionEvidence.providerRequestIdSha256 ===
          asset.actualProviderRequestEvidence.providerRequestIdSha256 &&
        asset.postRunProjectionEvidence.messagesSha256 !==
          asset.actualProviderRequestEvidence.messagesSha256 &&
        asset.actualProviderRequestEvidence.creativeBrief.contentSha256 ===
          sha256(REAL_ACCEPTANCE_SPARSE_IDEA) &&
        asset.actualProviderRequestEvidence.matchedPreparedFixtureCanaryIds.length === 0 &&
        runs.length === 1 &&
        runs[0]?.runId === asset.runId &&
        runs[0]?.status === 'completed' &&
        toolEvents.length === asset.toolAttemptCount &&
        toolEvents.filter((event) => event.status === 'failed').length ===
          asset.failedToolAttemptCount &&
        successfulToolEvents.length === 1 &&
        toolEvents.at(-1) === successfulToolEvents[0] &&
        toolEvents.slice(0, -1).every((event) => event.status === 'failed') &&
        artifact?.artifactId === asset.artifactId &&
        artifact.artifactType === asset.artifactType &&
        asset.conflictCode === ''
      );
    }),
    'Automatic asset preparation turns do not map one-to-one to completed runs and structured artifacts.',
  );
  requireCondition(
    chapters.every((chapter) => {
      const turn = automaticSummaryTurns.find((item) => item.turnId === chapter.summaryTurnId);
      const runs = bundle!.runs.filter((run) => run.turnId === chapter.summaryTurnId);
      const artifacts = bundle!.artifacts.filter(
        (item) => item.turnId === chapter.summaryTurnId && item.artifactType === 'chapter_summary',
      );
      const artifact = artifacts[0];
      const toolEvent = bundle!.toolEvents.find(
        (event) => event.runId === chapter.summaryRunId && event.toolName === 'summarize_chapter',
      );
      const frozenModelSnapshot = JSON.stringify(runs[0]?.modelSnapshot);
      return (
        decodeWorkbenchTurnContent(turn?.content).content === '总结本章' &&
        runs.length === chapter.summaryAttempts.length &&
        runs.length === chapter.summaryRetryCount + 1 &&
        runs.length >= 1 &&
        runs.length <= 3 &&
        runs.every((run) => JSON.stringify(run.modelSnapshot) === frozenModelSnapshot) &&
        runs
          .slice(0, -1)
          .every(
            (run) => run.status === 'failed' && isAutomaticSummaryProtocolRecoveryError(run.error),
          ) &&
        runs.at(-1)?.runId === chapter.summaryRunId &&
        runs.at(-1)?.status === 'completed' &&
        chapter.summaryAttempts.every(
          (attempt, index) =>
            attempt.attempt === index + 1 &&
            attempt.runId === runs[index]?.runId &&
            attempt.status === runs[index]?.status,
        ) &&
        toolEvent?.status === 'succeeded' &&
        !toolEvent.error &&
        artifacts.length === 1 &&
        artifact?.artifactId === chapter.summaryArtifactId &&
        Boolean(chapter.summaryId && chapter.summaryApplyTransactionId)
      );
    }),
    'Automatic chapter summary turns do not retain a bounded failed-run history and exactly one applied summary artifact.',
  );
  requireCondition(
    new Set(chapters.map((chapter) => chapter.chapterId)).size === chapters.length &&
      chapters.every((chapter) => chapter.chapterId),
    'The continuous task did not switch to one distinct target chapter per user turn.',
  );
  requireCondition(
    chapters.every(
      (chapter) =>
        chapter.targetWordCount >= 500 &&
        chapter.targetWordCount <= 10_000 &&
        chapter.originalWordCount > 0 &&
        chapter.lengthRepairCount >= 0 &&
        chapter.lengthRepairCount <= 3 &&
        chapter.integrityRepairCount >= 0 &&
        chapter.integrityRepairCount <= 2 &&
        isRealAcceptanceLengthControlEvidenceConsistent({
          scenario,
          targetWordCount: chapter.targetWordCount,
          originalWordCount: chapter.originalWordCount,
          finalWordCount: chapter.wordCount,
          lengthRepairCount: chapter.lengthRepairCount,
          integrityRepairCount: chapter.integrityRepairCount,
        }),
    ),
    'Writer length-control evidence is incomplete or internally inconsistent.',
  );
  requireCondition(
    chapters.every((chapter) => {
      const check = chapter.artifactCandidateIntegrityCheck;
      return (
        Object.prototype.hasOwnProperty.call(chapter, 'integrityRepairCount') &&
        Number.isSafeInteger(chapter.integrityRepairCount) &&
        chapter.integrityRepairCount >= 0 &&
        check.checker === 'inspectChapterCandidateIntegrity' &&
        check.source === 'persisted_result_artifact' &&
        check.executed &&
        check.passed &&
        check.artifactId === chapter.artifactId &&
        check.artifactContentSha256 === chapter.candidateHash &&
        isSha256(check.artifactContentSha256) &&
        check.issueCodes.length === 0
      );
    }),
    'Chapter evidence does not prove an independent passing integrity check of every persisted artifact.',
  );
  requireCondition(
    chapters.every(
      (chapter, index) =>
        Boolean(chapter.snapshotId && chapter.styleProfileId && chapter.outputProfileId) &&
        requiredGenerationSnapshotSourceTypes(scenario).every((sourceType) =>
          chapter.snapshotSourceTypes.includes(sourceType),
        ) &&
        (index === 0 || chapter.snapshotSourceTypes.includes('adopted_chapter')),
    ),
    'Generation snapshot evidence does not retain every required formal asset source.',
  );
  requireCondition(
    chapters.every((chapter, index) => {
      const request = chapter.providerRequestEvidence;
      const criticalSourceTypes = [
        ...requiredGenerationSnapshotSourceTypes(scenario),
        'user_instruction',
        ...(index > 0 ? ['adopted_chapter'] : []),
        ...(chapter.lengthRepairCount > 0 || chapter.integrityRepairCount > 0
          ? ['current_editor']
          : []),
      ];
      return (
        request?.schemaVersion === 'workbench_provider_request_evidence_v1' &&
        request.snapshotRequestSourceStatus === 'included' &&
        request.snapshotRequestSourceSha256 === request.includedSnapshotRequestSourceSha256 &&
        ['included', 'truncated', 'omitted_empty', 'omitted_budget'].includes(
          String(request.providerSourceStatus),
        ) &&
        criticalSourceTypes.every(
          (sourceType) => request.generationSourceStatuses?.[sourceType] === 'included',
        ) &&
        isGenerationContextHash(request.snapshotContextHash) &&
        isSha256(request.snapshotCompiledPromptSha256) &&
        isSha256(request.messagesSha256) &&
        isSha256(request.compiledContextSha256)
      );
    }),
    'Provider request evidence is incomplete or does not prove full critical-source inclusion.',
  );
}

function assertClosedLoopDeltas(
  before: ClosedLoopState,
  after: ClosedLoopState,
  chapterCount: number,
  runCount: number,
  minimumResultArtifactCount: number,
  assetPreparationCount: number,
  summaryRunCount: number,
): void {
  const actual = {
    conversations: after.conversationsCount - before.conversationsCount,
    runs: after.runsCount - before.runsCount,
    resultArtifacts: after.resultArtifactsCount - before.resultArtifactsCount,
    artifactDecisions: after.artifactDecisionsCount - before.artifactDecisionsCount,
    reviewAuthorizations: after.reviewAuthorizationsCount - before.reviewAuthorizationsCount,
    consumedAuthorizations: after.consumedAuthorizationsCount - before.consumedAuthorizationsCount,
    adoptedDrafts: after.adoptedDraftsCount - before.adoptedDraftsCount,
    toolEvents: after.toolEventsCount - before.toolEventsCount,
  };
  const expected = {
    conversations: 1,
    runs: runCount + assetPreparationCount + summaryRunCount,
    resultArtifactsMinimum: minimumResultArtifactCount,
    artifactDecisions: chapterCount * 2 + assetPreparationCount,
    reviewAuthorizations: chapterCount,
    consumedAuthorizations: chapterCount,
    adoptedDrafts: chapterCount,
    toolEventsMinimum: 1,
  };
  requireCondition(
    actual.conversations === expected.conversations &&
      actual.runs === expected.runs &&
      actual.resultArtifacts >= expected.resultArtifactsMinimum &&
      actual.artifactDecisions === expected.artifactDecisions &&
      actual.reviewAuthorizations === expected.reviewAuthorizations &&
      actual.consumedAuthorizations === expected.consumedAuthorizations &&
      actual.adoptedDrafts === expected.adoptedDrafts &&
      actual.toolEvents >= expected.toolEventsMinimum,
    `Final closed-loop fact deltas do not match: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}.`,
  );
}

async function readAuthoritativeWordCounts(
  novelId: string,
  chapterIds: string[],
): Promise<{
  independentWordCount: number;
  chapterWordCountSum: number;
  novelWordCount: number;
}> {
  const chapters = await bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', { novelId });
  const relevant = chapters.filter((chapter) => chapterIds.includes(chapter.id));
  requireCondition(
    relevant.length === chapterIds.length,
    'The authoritative chapter set is incomplete during word-count audit.',
  );
  let independentWordCount = 0;
  for (const chapter of relevant) {
    requireCondition(
      Boolean(chapter.adoptedDraftId),
      'A target chapter has no adopted draft pointer.',
    );
    const drafts = await bridgeCall<DraftRecord[]>('get_drafts_by_chapter_id', {
      chapterId: chapter.id,
    });
    const adopted = drafts.find((draft) => draft.id === chapter.adoptedDraftId);
    requireCondition(adopted?.isAdopted === true, 'A target chapter adopted draft is unavailable.');
    independentWordCount += countTextWords(adopted!.content);
  }
  const novel = await bridgeCall<NovelRecord | null>('get_novel_by_id', { id: novelId });
  requireCondition(Boolean(novel), 'The target novel is unavailable during word-count audit.');
  return {
    independentWordCount,
    chapterWordCountSum: relevant.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    novelWordCount: novel!.totalWordCount,
  };
}

async function selectExactModel(modelId: string): Promise<string> {
  const statusSelector = '[data-testid="workbench-new-task-model-status"]';
  await browser.waitUntil(
    async () => {
      const status = await browser.$(statusSelector);
      if (!(await status.isExisting())) return true;
      return !(await status.getText()).includes('正在刷新 Runtime 模型目录');
    },
    {
      timeout: 120_000,
      timeoutMsg: 'Runtime model directory refresh did not settle.',
    },
  );
  const select = await waitForTestId('workbench-new-task-model-select');
  const options = await select.$$('option');
  let exact = '';
  for (const option of options) {
    const value = await option.getAttribute('value');
    if (value === `openai_compatible:${modelId}` && (await option.isEnabled())) {
      exact = value;
      break;
    }
  }
  const status = await browser.$(statusSelector);
  const statusText = (await status.isExisting()) ? await status.getText() : '';
  requireCondition(
    Boolean(exact),
    `The requested real model is absent from the Runtime directory: ${JSON.stringify(statusText)}; selectEnabled=${await select.isEnabled()}.`,
  );
  await select.selectByAttribute('value', exact);
  await waitForStableSelectValue(
    select,
    exact,
    'The requested real model selection did not settle.',
  );
  return exact;
}

async function readChapterFailure(conversationId: string, runId: string): Promise<string> {
  const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
    conversationId,
  });
  const runError = bundle?.runs.find((run) => run.runId === runId)?.error?.trim();
  const toolErrors = (bundle?.toolEvents ?? [])
    .filter((event) => event.runId === runId && event.status === 'failed' && event.error?.trim())
    .map((event) => `${event.toolName}: ${event.error!.trim()}`);
  const runBlock = await findTestIdByAttribute('workbench-run', 'data-run-id', runId);
  const visibleError = await runBlock.$('[data-testid="workbench-run-error"]');
  const visibleText = (await visibleError.isExisting())
    ? (await visibleError.getText()).trim()
    : '';
  return [...new Set([runError, ...toolErrors, visibleText].filter(Boolean))]
    .join(' | ')
    .slice(0, 800);
}

async function prepareRealAcceptanceAssetsThroughUi(input: {
  novelId: string;
  chapterIds: readonly string[];
  chapterOutlines: readonly string[];
  evidenceDirectory: string;
}): Promise<void> {
  requireCondition(
    input.chapterIds.length === input.chapterOutlines.length && input.chapterIds.length > 0,
    'Asset preparation requires one outline for every target chapter.',
  );
  await navigateHash(`#/novels/${input.novelId}`);
  const detail = await browser.$(`[data-project-id="${input.novelId}"]`);
  await detail.waitForDisplayed({ timeout: 30_000 });
  await saveWorldBackgroundThroughUi();
  await saveProtagonistThroughUi();
  for (let index = 0; index < input.chapterIds.length; index += 1) {
    await saveChapterOutlineThroughUi({
      chapterId: input.chapterIds[index],
      chapterTitle: `第 ${index + 1} 章`,
      outline: input.chapterOutlines[index],
      chapterNumber: index + 1,
    });
  }
  await importResearchReferenceThroughUi(input.novelId, input.evidenceDirectory);
  await initializeBuiltInGenerationProfilesThroughUi();
  await assertPreparedFormalAssets(input.novelId, input.chapterIds, input.chapterOutlines);
}

async function assertSparseIdeaStartingState(novelId: string): Promise<void> {
  const [
    worldSettings,
    ruleSystems,
    novel,
    protagonist,
    volumes,
    chapters,
    masterOutlines,
    volumeOutlines,
    chapterOutlines,
    characters,
    references,
    projectStyles,
    visibleOutputProfiles,
  ] = await Promise.all([
    bridgeCall<WorldSettingRecord[]>('get_world_settings', { novelId }),
    bridgeCall<RuleSystemRecord[]>('get_rule_systems', { novelId }),
    bridgeCall<NovelRecord | null>('get_novel_by_id', { id: novelId }),
    bridgeCall<Record<string, unknown> | null>('get_protagonist', { novelId }),
    bridgeCall<unknown[]>('get_volumes_by_novel_id', { novelId }),
    bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', { novelId }),
    bridgeCall<unknown[]>('get_master_outline_versions', { projectId: novelId }),
    bridgeCall<unknown[]>('get_volume_outline_versions', {
      projectId: novelId,
      volumeId: null,
    }),
    bridgeCall<unknown[]>('get_chapter_outline_versions', {
      projectId: novelId,
      chapterId: null,
    }),
    bridgeCall<unknown[]>('list_characters', { novelId }),
    bridgeCall<unknown[]>('list_reference_works', { input: { novelId } }),
    bridgeCall<unknown[]>('list_style_profiles', { projectId: novelId }),
    bridgeCall<unknown[]>('list_output_profiles', { projectId: novelId }),
  ]);
  const projectOutputProfiles = visibleOutputProfiles.filter(
    (profile) =>
      isPlainRecord(profile) && (profile.novelId === novelId || profile.projectId === novelId),
  );
  const projectStyleProfiles = projectStyles.filter(
    (profile) =>
      isPlainRecord(profile) && (profile.novelId === novelId || profile.projectId === novelId),
  );
  requireCondition(
    !worldSettings.some((setting) => setting.isActive && setting.content.trim()) &&
      !ruleSystems.some((rule) => rule.isActive && rule.content.trim()) &&
      readProtagonistNames(novel).length === 0 &&
      protagonist === null &&
      volumes.length === 0 &&
      chapters.length === 0 &&
      masterOutlines.length === 0 &&
      volumeOutlines.length === 0 &&
      chapterOutlines.length === 0 &&
      characters.length === 0 &&
      references.length === 0 &&
      projectStyleProfiles.length === 0 &&
      projectOutputProfiles.length === 0,
    'Sparse-idea acceptance must start without formal world/rules, protagonist, volumes, outlines, characters, references, or project generation profiles.',
  );
}

async function readAndAssertPlannedChapterIds(
  novelId: string,
  assetPreparations: readonly SparseAssetPreparationEvidence[],
): Promise<{
  chapterIds: string[];
  targetWordCount: number;
  bookWordGoal: BookWordGoalEvidence;
}> {
  const storyPlanPreparation = assetPreparations.find((asset) => asset.asset === 'story_plan');
  requireCondition(
    Boolean(storyPlanPreparation?.artifactId),
    'Sparse planning did not retain its formal story-plan artifact identity.',
  );
  const artifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
    input: { artifactId: storyPlanPreparation!.artifactId },
  });
  const task = await bridgeCall<AiTaskDetail>('get_ai_task', {
    input: { taskId: artifact.artifact.taskId },
  });
  const bookWordGoal = task.task.targetHintJson?.bookWordGoal;
  const plan = parseRealConversationStoryPlan(artifact.rawContent);
  const [chapters, novel] = await Promise.all([
    bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', { novelId }),
    bridgeCall<NovelRecord | null>('get_novel_by_id', { id: novelId }),
  ]);
  const persistedTargetWordCount = chapters.reduce(
    (sum, chapter) => sum + Math.max(0, chapter.targetWordCount ?? 0),
    0,
  );
  requireCondition(
    chapters.length === plan.chapters.length &&
      new Set(chapters.map((chapter) => chapter.id)).size === plan.chapters.length &&
      chapters.every(
        (chapter, index) =>
          chapter.novelId === novelId &&
          Boolean(chapter.volumeId) &&
          chapter.title?.trim() === plan.chapters[index]?.title &&
          chapter.outline?.trim() === plan.chapters[index]?.outline &&
          chapter.goal?.trim() === plan.chapters[index]?.goal &&
          chapter.targetWordCount === plan.chapters[index]?.targetWordCount,
      ) &&
      persistedTargetWordCount ===
        plan.chapters.reduce((sum, chapter) => sum + chapter.targetWordCount, 0) &&
      novel?.targetWordCount === plan.targetWordCount &&
      bookWordGoal?.contractVersion === 'ans_book_word_goal_v1' &&
      bookWordGoal.parserVersion === 'zh_book_words_v1' &&
      bookWordGoal.sourceTurnSequence === 0 &&
      Boolean(bookWordGoal.sourceTurnId) &&
      bookWordGoal.sourceContentSha256 === sha256(REAL_ACCEPTANCE_SPARSE_IDEA) &&
      bookWordGoal.targetWords === SPARSE_BOOK_TARGET_WORDS &&
      bookWordGoal.comparison === 'approximate' &&
      bookWordGoal.toleranceBps === 1_000 &&
      bookWordGoal.minimumWords === SPARSE_BOOK_MIN_WORDS &&
      bookWordGoal.maximumWords === SPARSE_BOOK_MAX_WORDS &&
      plan.targetWordCount >= bookWordGoal.minimumWords &&
      plan.targetWordCount <= bookWordGoal.maximumWords &&
      persistedTargetWordCount >= bookWordGoal.minimumWords &&
      persistedTargetWordCount <= bookWordGoal.maximumWords,
    `Sparse planning did not atomically apply the formal story-plan order and approximately 60,000-word target: artifactChapters=${plan.chapters.length}; persistedChapters=${chapters.length}; artifactTargetWords=${plan.targetWordCount}; persistedTargetWords=${persistedTargetWordCount}.`,
  );
  return {
    chapterIds: chapters.map((chapter) => chapter.id),
    targetWordCount: plan.targetWordCount,
    bookWordGoal: bookWordGoal!,
  };
}

async function saveWorldBackgroundThroughUi(): Promise<void> {
  const card = await browser.$(
    '//span[normalize-space(.)="世界背景"]/ancestor::div[contains(concat(" ", normalize-space(@class), " "), " detail-card ")][1]',
  );
  await card.waitForDisplayed({ timeout: 30_000 });
  const edit = await card.$('.//button[contains(normalize-space(.), "编辑")]');
  await edit.click();
  await setInputValue(
    '//span[normalize-space(.)="世界背景"]/ancestor::div[contains(concat(" ", normalize-space(@class), " "), " detail-card ")][1]//input[@placeholder="设定标题"]',
    '临雾世界背景',
  );
  await setInputValue(
    '//span[normalize-space(.)="世界背景"]/ancestor::div[contains(concat(" ", normalize-space(@class), " "), " detail-card ")][1]//textarea',
    WORLD_BACKGROUND,
  );
  const save = await card.$('.//button[contains(normalize-space(.), "保存")]');
  await save.waitForClickable({ timeout: 30_000 });
  await save.click();
  await browser.waitUntil(async () => (await card.getText()).includes(WORLD_BACKGROUND), {
    timeout: 30_000,
    timeoutMsg: 'World background did not settle through the Novel Detail UI.',
  });
}

async function saveProtagonistThroughUi(): Promise<void> {
  const card = await browser.$(
    '//span[normalize-space(.)="主角设定"]/ancestor::div[contains(concat(" ", normalize-space(@class), " "), " detail-card ")][1]',
  );
  await card.waitForDisplayed({ timeout: 30_000 });
  const edit = await card.$('.//button[contains(normalize-space(.), "编辑")]');
  await edit.click();
  const field = (label: string, element: 'input' | 'textarea' = 'input') =>
    `//span[normalize-space(.)="主角设定"]/ancestor::div[contains(concat(" ", normalize-space(@class), " "), " detail-card ")][1]//label[normalize-space(.)="${label}"]/following-sibling::${element}`;
  await setInputValue(field('姓名 *'), PROTAGONIST_NAME);
  await setInputValue(field('身份'), PROTAGONIST_IDENTITY);
  await setInputValue(field('动机'), PROTAGONIST_MOTIVATION);
  await setInputValue(field('性格', 'textarea'), '克制、敏锐、谨慎，但面对被篡改的记忆不会退让。');
  const save = await card.$('.//button[contains(normalize-space(.), "保存")]');
  await save.waitForClickable({ timeout: 30_000 });
  await save.click();
  await browser.waitUntil(async () => (await card.getText()).includes(PROTAGONIST_NAME), {
    timeout: 30_000,
    timeoutMsg: 'Protagonist did not settle through the Novel Detail UI.',
  });
}

async function saveChapterOutlineThroughUi(input: {
  chapterId: string;
  chapterTitle: string;
  outline: string;
  chapterNumber: number;
}): Promise<void> {
  const row = await browser.$(
    `//span[normalize-space(.)="${input.chapterTitle}"]/ancestor::div[.//button[normalize-space(.)="✏️"]][1]`,
  );
  await row.waitForDisplayed({ timeout: 30_000 });
  const edit = await row.$('.//button[normalize-space(.)="✏️"]');
  await edit.click();
  const dialog = await browser.$(
    '//div[contains(concat(" ", normalize-space(@class), " "), " modal-dialog ")][.//div[normalize-space(.)="编辑章节"]]',
  );
  await dialog.waitForDisplayed({ timeout: 30_000 });
  await setInputValue(
    '//div[normalize-space(.)="编辑章节"]/parent::div//label[normalize-space(.)="章节大纲"]/following-sibling::textarea',
    input.outline,
  );
  await setInputValue(
    '//div[normalize-space(.)="编辑章节"]/parent::div//label[normalize-space(.)="本章目标"]/following-sibling::input',
    `完成第 ${input.chapterNumber} 章大纲中的冲突推进与结尾钩子`,
  );
  const status = await dialog.$(
    './/label[normalize-space(.)="章节状态"]/following-sibling::select',
  );
  await status.selectByAttribute('value', 'outline_ready');
  const save = await dialog.$('.//button[normalize-space(.)="保存"]');
  await save.waitForClickable({ timeout: 30_000 });
  await save.click();
  await dialog.waitForExist({ reverse: true, timeout: 30_000 });
  const chapter = await bridgeCall<ChapterAssetRecord | null>('get_chapter_by_id', {
    id: input.chapterId,
  });
  requireCondition(
    chapter?.outline === input.outline,
    `Chapter ${input.chapterNumber} outline was not persisted through the UI.`,
  );
}

async function importResearchReferenceThroughUi(
  novelId: string,
  evidenceDirectory: string,
): Promise<void> {
  const fixturePath = path.join(evidenceDirectory, 'gate-research-reference.txt');
  fs.writeFileSync(fixturePath, RESEARCH_REFERENCE_TEXT, { encoding: 'utf8', flag: 'wx' });
  try {
    await navigateHash(`#/novels/${novelId}/references`);
    const input = await browser.$('section[aria-label="导入参考资料"] input[type="file"]');
    await input.waitForExist({ timeout: 30_000 });
    await browser.execute(() => {
      const fileInput = document.querySelector<HTMLInputElement>(
        'section[aria-label="导入参考资料"] input[type="file"]',
      );
      if (fileInput) {
        fileInput.hidden = false;
        fileInput.style.display = 'block';
      }
    });
    await input.setValue(fixturePath);
    const review = await browser.$('.reference-import-review');
    await review.waitForDisplayed({ timeout: 30_000 });
    const purpose = await review.$('.//label[contains(normalize-space(.), "用途")]/select');
    await purpose.selectByAttribute('value', 'research');
    await setInputValue(
      '//div[contains(concat(" ", normalize-space(@class), " "), " reference-import-review ")]//label[contains(normalize-space(.), "作品标题")]/input',
      RESEARCH_REFERENCE_TITLE,
    );
    const commit = await review.$('.//button[normalize-space(.)="确认导入"]');
    await commit.waitForClickable({ timeout: 30_000 });
    await commit.click();
    await browser.waitUntil(
      async () => (await browser.$('body').getText()).includes('参考资料已保存'),
      { timeout: 30_000, timeoutMsg: 'Research reference did not persist through the UI.' },
    );
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
}

async function initializeBuiltInGenerationProfilesThroughUi(): Promise<void> {
  await navigateHash('#/styles');
  await browser.waitUntil(
    async () => (await browser.$('body').getText()).includes(STYLE_PROFILE_NAME),
    { timeout: 30_000, timeoutMsg: 'Built-in style profile did not initialize.' },
  );
  const outputTab = await browser.$('//button[contains(normalize-space(.), "输出控制")]');
  await outputTab.waitForClickable({ timeout: 30_000 });
  await outputTab.click();
  await browser.waitUntil(
    async () => (await browser.$('body').getText()).includes(OUTPUT_PROFILE_NAME),
    { timeout: 30_000, timeoutMsg: 'Built-in default output profile did not initialize.' },
  );
}

async function assertPreparedFormalAssets(
  novelId: string,
  chapterIds: readonly string[],
  chapterOutlines: readonly string[],
): Promise<void> {
  const [worldSettings, novel, chapters] = await Promise.all([
    bridgeCall<WorldSettingRecord[]>('get_world_settings', { novelId }),
    bridgeCall<NovelRecord | null>('get_novel_by_id', { id: novelId }),
    Promise.all(
      chapterIds.map((id) => bridgeCall<ChapterAssetRecord | null>('get_chapter_by_id', { id })),
    ),
  ]);
  const protagonistNames = readProtagonistNames(novel);
  requireCondition(
    worldSettings.some(
      (setting) => setting.isActive && setting.content.includes(WORLD_BACKGROUND),
    ) && protagonistNames.includes(PROTAGONIST_NAME),
    'World background or protagonist was not persisted as formal project data.',
  );
  requireCondition(
    chapters.every((chapter, index) => chapter?.outline === chapterOutlines[index]),
    'One or more formal chapter outlines drifted before generation.',
  );
}

function readProtagonistNames(novel: NovelRecord | null): string[] {
  if (!novel) return [];
  if (Array.isArray(novel.protagonists)) {
    return novel.protagonists.map((profile) => profile.name?.trim() ?? '').filter(Boolean);
  }
  if (!novel.protagonistsJson) return [];
  try {
    const parsed = JSON.parse(novel.protagonistsJson) as Array<{ name?: string }>;
    return Array.isArray(parsed)
      ? parsed.map((profile) => profile.name?.trim() ?? '').filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function createTargetChapterThroughUi(title: string, volumeId: string): Promise<string> {
  await clickTestId('chapter-create');
  const volume = await waitForTestId('chapter-volume-select');
  await volume.selectByAttribute('value', volumeId);
  await waitForStableSelectValue(
    volume,
    volumeId,
    'The target volume did not settle in the chapter form.',
  );
  await fillControlledInputTestId('chapter-title-input', title);
  await fillControlledInputTestId('chapter-target-word-count', String(TARGET_CHAPTER_WORDS));
  const submit = await waitForTestId('chapter-create-submit');
  await submit.waitForEnabled({ timeout: 30_000 });
  await submit.waitForClickable({ timeout: 30_000 });
  await submit.click();
  const chapter = await findTestIdByAttribute('chapter-item', 'data-chapter-title', title);
  const chapterId = await chapter.getAttribute('data-chapter-id');
  requireCondition(Boolean(chapterId), 'Created target chapter has no identifier.');
  await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId!);
  return chapterId!;
}

async function waitForStableSelectValue(
  select: WebdriverIO.Element,
  expected: string,
  timeoutMsg: string,
): Promise<void> {
  let stableReads = 0;
  await browser.waitUntil(
    async () => {
      stableReads = (await select.getValue()) === expected ? stableReads + 1 : 0;
      return stableReads >= 2;
    },
    { timeout: 30_000, interval: 50, timeoutMsg },
  );
}

async function fillControlledInputTestId(testId: string, value: string): Promise<void> {
  await waitForTestId(testId);
  const canonicalValue = await browser.execute(
    (inputTestId, nextValue) => {
      const element = document.querySelector(`[data-testid="${inputTestId}"]`);
      if (!(element instanceof HTMLInputElement)) {
        throw new Error(`${inputTestId} is not an input`);
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('HTMLInputElement value setter is unavailable');
      setter.call(element, nextValue);
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
      );
      return element.value;
    },
    testId,
    value,
  );
  requireCondition(
    canonicalValue === value,
    `Controlled input DOM write was incomplete: testId=${testId}; expectedLength=${value.length}; actualLength=${canonicalValue.length}.`,
  );

  let stableReads = 0;
  await browser.waitUntil(
    async () => {
      const element = await browser.$(`[data-testid="${testId}"]`);
      stableReads = (await element.getValue()) === value ? stableReads + 1 : 0;
      return stableReads >= 2;
    },
    {
      timeout: 30_000,
      interval: 50,
      timeoutMsg: `Controlled input ${testId} did not settle.`,
    },
  );
}

async function setInputValue(selector: string, value: string): Promise<void> {
  const input = await browser.$(selector);
  await input.waitForDisplayed({ timeout: 30_000 });
  await input.clearValue();
  await input.setValue(value);
}

async function waitForNewConversationId(
  previousConversationId: string,
  chapterNumber: number,
): Promise<string> {
  let conversationId = '';
  await browser.waitUntil(
    async () => {
      conversationId = await readVisibleConversationId();
      return Boolean(conversationId && conversationId !== previousConversationId);
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Chapter ${chapterNumber} did not select its newly created conversation.`,
    },
  );
  return conversationId;
}

async function readVisibleConversationId(): Promise<string> {
  const headers = (await browser.$$(
    '[data-testid="workbench-task-header"]',
  )) as unknown as WebdriverIO.Element[];
  for (const header of headers) {
    if (await header.isDisplayed()) {
      return (await header.getAttribute('data-conversation-id'))?.trim() ?? '';
    }
  }
  return '';
}

async function fillControlledTaskGoal(value: string): Promise<void> {
  await fillControlledTextareaTestId('workbench-new-task-goal', value);
  await assertTaskGoalValue(value);
}

async function fillControlledTextareaTestId(testId: string, value: string): Promise<void> {
  await waitForTestId(testId);
  const canonicalValue = await browser.execute(
    (inputTestId, nextValue) => {
      const element = document.querySelector(`[data-testid="${inputTestId}"]`);
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error(`${inputTestId} is not a textarea`);
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) throw new Error('HTMLTextAreaElement value setter is unavailable');
      setter.call(element, nextValue);
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
      );
      return element.value;
    },
    testId,
    value,
  );
  requireCondition(
    canonicalValue === value,
    `Controlled textarea DOM write was incomplete: testId=${testId}; expectedLength=${value.length}; actualLength=${canonicalValue.length}; expectedSha256=${sha256(value)}; actualSha256=${sha256(canonicalValue)}.`,
  );

  let stableReads = 0;
  await browser.waitUntil(
    async () => {
      const element = await browser.$(`[data-testid="${testId}"]`);
      stableReads = String(await element.getValue()) === value ? stableReads + 1 : 0;
      return stableReads >= 2;
    },
    {
      timeout: 30_000,
      interval: 50,
      timeoutMsg: `Controlled textarea ${testId} did not settle.`,
    },
  );
}

async function assertTaskGoalValue(expected: string): Promise<void> {
  let stableReads = 0;
  await browser.waitUntil(
    async () => {
      const element = await browser.$('[data-testid="workbench-new-task-goal"]');
      const current = String(await element.getValue());
      stableReads = current === expected ? stableReads + 1 : 0;
      return stableReads >= 2;
    },
    {
      timeout: 30_000,
      interval: 50,
      timeoutMsg: 'The complete task goal did not settle in the controlled textarea.',
    },
  );
}

function countTextWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  return (
    (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length +
    (cleaned.match(/[a-zA-Z0-9]+/g) ?? []).length
  );
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGenerationContextHash(value: unknown): value is string {
  return typeof value === 'string' && /^(?:txt_[0-9a-f]{8}|[0-9a-f]{64})$/.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

function safeEvidenceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(?:bearer\s+)?(?:sk|agt)_[a-z0-9_-]{12,}\b/gi, '[REDACTED_CREDENTIAL]')
    .slice(0, 800);
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
