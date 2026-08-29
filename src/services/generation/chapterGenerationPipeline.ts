import { generateId, nowISO } from '../database/db';
import { appLogger } from '../observability/appLogger';
import { aiSettingsService } from '../ai/aiClient';
import {
  executeChapterGeneration,
  type ChapterProseResumeBeat,
} from '../ai/chapterGenerationExecutionService';
import { isAiRequestCancelled } from '../ai/aiCancellation';
import { checkLocalChapterModelAvailability } from '../ai/localChapterModelHealthService';
import { qualityCheckAiService } from '../ai/qualityCheckAiService';
import { chapterQualityGateService } from '../ai/chapterQualityGateService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { qualityCheckService } from '../quality/qualityCheckService';
import { generationContextCompiler } from './generationContextCompiler';
import { countTextWords, hashTextContent } from '../../utils/contentHash';
import type { AiGenerateRequest, ChapterDraft } from '../../types/ai';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { QualityCheckItem } from '../../types/qualityCheck';
import type {
  GenerationJob,
  GenerationStepName,
  GenerationStepResult,
  GenerationStepStatus,
  RunChapterDraftGenerationJobInput,
  RunMockGenerationJobInput,
} from '../../types/generationJob';
import {
  type ActiveJobControl,
  type ChapterDraftJobResult,
  type GenerationJobProgressCallback,
  type PatchCandidate,
  TERMINAL_JOB_STATUSES,
  type UpdateGenerationJobInput,
  delay,
} from './types';
import { activeJobControls, trackActiveAiRequest } from './jobStateMachine';
import {
  cancelGenerationJob,
  createGenerationJob,
  getGenerationJobById,
  getGenerationJobsByChapterId,
  getGenerationSteps,
  saveGenerationStep,
  updateGenerationJob,
} from './jobRepository';
import { collectRepairArtifactResumeBeats, selectResumableBeatPrefix } from './checkpointRecovery';
import {
  applyLowRiskPatches,
  buildPatchCandidates,
  passesChapterQualityGate,
  shouldAttemptExternalQualityRepair,
} from './qualityGateRunner';
import type { ChapterCandidateIntegrityIssueCode } from './chapterCandidateIntegrity';

export function buildMockDraft(snapshot: ChapterGenerationSnapshot): string {
  const base = snapshot.compiledContext.baseContext;
  const engineering = snapshot.compiledContext.activeEngineeringState;
  const sceneLines = engineering?.scenePlan.length
    ? engineering.scenePlan
        .map(
          (scene) =>
            `- ${scene.sceneNo}. ${scene.title || '未命名场景'}：${scene.goal || scene.conflict || '推进本章目标'}`,
        )
        .join('\n')
    : '- 根据章节大纲推进本章目标';
  return [
    `【Mock 初稿】${base.chapterTitle || '未命名章节'}`,
    '',
    `目标字数：${base.targetWordCount || engineering?.chapterCard.targetWordCount || '未设置'}`,
    `上下文快照：${snapshot.contextHash}`,
    '',
    '场景推进：',
    sceneLines,
    '',
    '这里是 v1.9.7 Mock Provider 生成的占位正文结果，用于验证任务队列、步骤记录、轮询与取消链路；真实正文生成将在 v2.0.0 接入。',
  ].join('\n');
}

const SNAPSHOT_GENERATION_INSTRUCTIONS = [
  '你是一位专业小说作家。',
  '以本次冻结的章节资产为事实边界，把章纲当作创作计划，不得擅自增加设定、角色、秘密或事件结果。',
  '从上一章最终故事状态之后继续推进，保持时间、地点、人物、物件和设备状态可连续。角色只有在冻结前文或本章情节已经呈现获知过程后，才能使用相关信息。',
  '让章纲核心推进通过场景中的行动、感知、对话、冲突与后果自然发生，内部核验和写作检查不要进入正文。',
  '若快照指定目标字数，以目标字数的 ±10% 作为软范围收敛，不为凑字数牺牲情节完整性。',
  '只输出完整小说正文，以合法句末标点结束；不要输出说明、分析、写作标签或 Markdown。',
];

export function buildSnapshotProviderInstruction(snapshot: ChapterGenerationSnapshot): string {
  const base = snapshot.compiledContext.baseContext;
  return [
    ...SNAPSHOT_GENERATION_INSTRUCTIONS,
    `章节：${base.chapterTitle || '未命名章节'}`,
    `目标字数：${base.targetWordCount || snapshot.compiledContext.activeEngineeringState?.chapterCard.targetWordCount || '按冻结输出控制'}`,
    `context_hash：${snapshot.contextHash}`,
  ].join('\n');
}

export function buildSnapshotGenerateRequest(
  snapshot: ChapterGenerationSnapshot,
): AiGenerateRequest {
  const base = snapshot.compiledContext.baseContext;
  return {
    taskType: 'chapter_generate',
    messages: [
      {
        role: 'system',
        content: SNAPSHOT_GENERATION_INSTRUCTIONS.join('\n'),
      },
      {
        role: 'user',
        content: [
          `请根据以下 generation_context_snapshot 生成《${base.chapterTitle || '未命名章节'}》正文。`,
          `目标字数：${base.targetWordCount || snapshot.compiledContext.activeEngineeringState?.chapterCard.targetWordCount || '按上下文要求'}`,
          `context_hash：${snapshot.contextHash}`,
          '',
          snapshot.compiledPromptText,
        ].join('\n'),
      },
    ],
    promptTemplateSource: 'generation_context_snapshot',
  };
}

export interface ChapterLengthRepairRequestInput {
  chapterTitle: string;
  text: string;
  snapshotCompiledPromptText: string;
  currentWordCount: number;
  targetWordCount: number;
  minimumWordCount: number;
  maximumWordCount: number;
  repairAttempt: number;
  contextHash: string;
}

function chapterLengthRepairSystemInstructions(input: ChapterLengthRepairRequestInput): string[] {
  const isExpansion = input.currentWordCount < input.minimumWordCount;
  const minimumWordIncrease = Math.max(0, input.minimumWordCount - input.currentWordCount);
  const minimumWordReduction = Math.max(0, input.currentWordCount - input.maximumWordCount);
  return isExpansion
    ? [
        '你是一位小说正文扩写编辑。',
        '只输出一版完整、连续、可直接替换原稿的小说正文，不要解释、总结、标题、列表或 Markdown。',
        '严格保留原稿的事件顺序、人物知识边界、时间地点、物件与设备状态、伏笔及章末钩子，不得新增或改写剧情事实。',
        '只能在原稿已有场景内具体化动作因果、感官细节、人物反应、对话交锋和转场；新增文字要融入对应情节，不得附加新场景、新角色、新线索或后续剧情。',
        '不得用同义复述、空泛心理、密集短句或尾部续写凑字；章末钩子必须仍是原稿的最后状态。',
        `最终正文必须收敛到 ${input.minimumWordCount}-${input.maximumWordCount} 字。字数按每个汉字及每个连续英文或数字词计数。`,
        `本次至少增加 ${minimumWordIncrease} 字；完成保留全部事实与章末状态的完整重写，再自行核对字数。`,
        input.repairAttempt > 2
          ? '这是最后一次扩写收敛兜底：必须把充实内容分布到已有情节中，使完整正文落入本次范围。'
          : input.repairAttempt > 1
            ? '这是更严格的第二次扩写收敛：继续保留完整结尾，并明显充实现有场景的动作与反应。'
            : '',
      ]
    : [
        '你是一位小说正文压缩编辑。',
        '只输出一版完整、连续、可直接替换原稿的小说正文，不要解释、总结、标题、列表或 Markdown。',
        '严格保留原稿的事件顺序、人物知识边界、时间地点、物件与设备状态、伏笔及章末钩子，不得新增或改写事实。',
        '优先删除重复解释、同义复述、无推进的停顿观察和过密短单句段，不得通过截断结尾压缩。',
        `最终正文必须收敛到 ${input.minimumWordCount}-${input.maximumWordCount} 字。字数按每个汉字及每个连续英文或数字词计数。`,
        `本次至少删除 ${minimumWordReduction} 字；完成保留章末收束与钩子后的完整重写，再自行核对字数。`,
        input.repairAttempt > 2
          ? '这是最后一次收敛兜底：即使原稿结尾重要，也必须先压缩中段冗余，使完整正文落入本次范围。'
          : input.repairAttempt > 1
            ? '这是更严格的第二次收敛：继续保留完整结尾，并明显压缩中段重复内容。'
            : '',
      ];
}

export function buildChapterLengthRepairProviderInstruction(
  input: ChapterLengthRepairRequestInput,
): string {
  const isExpansion = input.currentWordCount < input.minimumWordCount;
  return [
    ...chapterLengthRepairSystemInstructions(input),
    `${isExpansion ? '扩写' : '压缩'}《${input.chapterTitle || '未命名章节'}》正文。`,
    `当前字数：${input.currentWordCount}`,
    `目标字数：${input.targetWordCount}`,
    `允许范围：${input.minimumWordCount}-${input.maximumWordCount}`,
    `context_hash：${input.contextHash}`,
    '冻结章节资产与当前修订稿分别作为独立来源提供；只能调整篇幅与表达。',
  ].join('\n');
}

export function buildChapterLengthRepairRequest(
  input: ChapterLengthRepairRequestInput,
): AiGenerateRequest {
  const isExpansion = input.currentWordCount < input.minimumWordCount;
  const systemInstructions = chapterLengthRepairSystemInstructions(input);
  return {
    taskType: 'chapter_generate',
    messages: [
      {
        role: 'system',
        content: systemInstructions.join('\n'),
      },
      {
        role: 'user',
        content: [
          `${isExpansion ? '扩写' : '压缩'}《${input.chapterTitle || '未命名章节'}》正文。`,
          `当前字数：${input.currentWordCount}`,
          `目标字数：${input.targetWordCount}`,
          `允许范围：${input.minimumWordCount}-${input.maximumWordCount}`,
          `context_hash：${input.contextHash}`,
          '',
          '【冻结 generation_context_snapshot】',
          '以下是初次生成所使用的同一份冻结创作上下文。长度修复只能调整篇幅与表达，仍须遵守其中的世界规则、人物边界、章纲、连续性、风格与输出约束。',
          input.snapshotCompiledPromptText,
          '',
          `【待${isExpansion ? '扩写' : '压缩'}完整正文】`,
          input.text,
        ].join('\n'),
      },
    ],
    promptTemplateSource: 'generation_context_snapshot:length_repair',
  };
}

export interface ChapterIntegrityRepairRequestInput {
  chapterTitle: string;
  text: string;
  snapshotCompiledPromptText: string;
  contextHash: string;
  issueCodes: ChapterCandidateIntegrityIssueCode[];
  targetWordCount: number;
  minimumWordCount: number;
  maximumWordCount: number;
}

function normalizedIntegrityIssueCodes(
  input: ChapterIntegrityRepairRequestInput,
): ChapterCandidateIntegrityIssueCode[] {
  const issueCodes = [...new Set(input.issueCodes)].sort();
  if (issueCodes.length === 0) throw new Error('chapter_integrity_repair_issue_codes_required');
  return issueCodes;
}

const CONTINUITY_REPAIR_INSTRUCTION =
  '从上一章最后一个有效故事状态之后开始，以新的动作、反应或后果衔接；删除重复边界句和已完成动作的重演，不得退回更早场景或生成替代分支。';
const SOURCE_CHAIN_REPAIR_INSTRUCTION =
  '修正知识来源链：未取得的附件、未连接或不可读的设备、未打开的文件和未查阅的档案都不能提供内容或元数据；人物指代和时间称谓必须与当前场景已知事实一致。只能删除无来源断言，或使用原稿已有事实补足可见的获取动作。';
const TEMPORAL_SEMANTICS_REPAIR_INSTRUCTION =
  '只修正无解释地把同一事件同时标为“凌晨”和二十三时的时间语义冲突；23:00-23:59 应称为深夜或夜间。若原稿写的是不同事件、从二十三时延续到次日凌晨的跨日范围，或人物与不同来源故意给出冲突记录，必须明确各自归属并写清矛盾，不得删除该事实或悬疑线索。';

const CHAPTER_INTEGRITY_ISSUE_INSTRUCTIONS = {
  chapter_opening_rollback: CONTINUITY_REPAIR_INSTRUCTION,
  chapter_boundary_sentence_repetition: CONTINUITY_REPAIR_INSTRUCTION,
  chapter_boundary_action_replay: CONTINUITY_REPAIR_INSTRUCTION,
  chapter_tail_pollution:
    '清除合法故事结尾之后的元数据、标签、残句、乱码或重复尾巴，不得截断合法故事内容或续写另一版正文。',
  chapter_meta_reasoning_leakage:
    '删除模型自我修订、提示词复述、字数核对和输出说明，只保留故事正文。',
  chapter_authorial_label_leakage:
    '删除作者侧章节编号、资产名称和创作标签，把必要信息改写为故事世界内自然可知的表达。',
  chapter_source_chain_break: SOURCE_CHAIN_REPAIR_INSTRUCTION,
  chapter_dialogue_reference_conflict: SOURCE_CHAIN_REPAIR_INSTRUCTION,
  chapter_temporal_semantics_conflict: TEMPORAL_SEMANTICS_REPAIR_INSTRUCTION,
  chapter_audit_voice_leakage:
    '删除成簇的核验状态和审校式结论；保留情节必需的不确定性，但改由人物行动、感知、对话、冲突或后果呈现。',
} satisfies Record<ChapterCandidateIntegrityIssueCode, string>;

function chapterIntegrityIssueInstructions(
  issueCodes: readonly ChapterCandidateIntegrityIssueCode[],
): string[] {
  return [...new Set(issueCodes.map((code) => CHAPTER_INTEGRITY_ISSUE_INSTRUCTIONS[code]))];
}

function chapterIntegrityRepairSystemInstructions(
  input: ChapterIntegrityRepairRequestInput,
): string[] {
  const issueCodes = normalizedIntegrityIssueCodes(input);
  return [
    '你是一位小说章节完整性修复编辑。',
    '只输出一版从第一句到最后一句都完整、连续、可直接替换原稿的小说正文；不要输出补丁、解释、总结、标题、列表或 Markdown。',
    `只修复本次检测到的问题（${issueCodes.join(', ')}）；原稿中未受影响的内容、事件顺序、因果、伏笔与章末钩子必须保留。`,
    '严格以冻结章节资产和当前正文为事实边界，不得新增角色、设定、场景、线索、秘密、人物知识、事件结果或后续剧情，也不得提前揭示或擅自解决悬念。',
    ...chapterIntegrityIssueInstructions(issueCodes),
    '最终输出必须以一条语义和语法完整的故事叙述句或对话句结束，并带合法的中文句末标点；句末之后不得再有标签、说明、残片或任何非正文内容。',
    `完整重写后的正文必须保持在 ${input.minimumWordCount}-${input.maximumWordCount} 字允许范围内，目标约 ${input.targetWordCount} 字；不得为凑字数引入新事实。`,
  ];
}

function chapterIntegrityRepairRequestLines(input: ChapterIntegrityRepairRequestInput): string[] {
  return [
    `完整性修复《${input.chapterTitle || '未命名章节'}》正文。`,
    `issue_codes：${normalizedIntegrityIssueCodes(input).join(', ')}`,
    `当前字数：${countTextWords(input.text)}`,
    `目标字数：${input.targetWordCount}`,
    `允许范围：${input.minimumWordCount}-${input.maximumWordCount}`,
    `context_hash：${input.contextHash}`,
    '冻结 generation_context_snapshot 各资产与当前章节正文已分别作为独立 typed sources 提供；以这些来源为准完成整章重写，不要在 request_context 中重复全文。',
  ];
}

export function buildChapterIntegrityRepairProviderInstruction(
  input: ChapterIntegrityRepairRequestInput,
): string {
  return [
    ...chapterIntegrityRepairSystemInstructions(input),
    ...chapterIntegrityRepairRequestLines(input),
  ].join('\n');
}

export function buildChapterIntegrityRepairRequest(
  input: ChapterIntegrityRepairRequestInput,
): AiGenerateRequest {
  return {
    taskType: 'chapter_generate',
    messages: [
      {
        role: 'system',
        content: chapterIntegrityRepairSystemInstructions(input).join('\n'),
      },
      {
        role: 'user',
        content: chapterIntegrityRepairRequestLines(input).join('\n'),
      },
    ],
    promptTemplateSource: 'generation_context_snapshot:integrity_repair',
  };
}

export function buildLocalSceneTaskInput(
  snapshot: ChapterGenerationSnapshot,
): Record<string, unknown> {
  const base = snapshot.compiledContext.baseContext;
  const engineering = snapshot.compiledContext.activeEngineeringState;
  const card = engineering?.chapterCard;
  const constraints = engineering?.generationConstraints;
  const scene = engineering?.scenePlan[0];
  const sceneGoal =
    scene?.goal?.trim() ||
    card?.chapterGoal?.trim() ||
    base.chapterGoal?.trim() ||
    '推进本章核心目标。';
  const sceneBeats = [
    ...(scene?.beats ?? []).map((beat) => beat.text),
    ...(scene?.keyActions ?? []),
    ...(scene?.keyDialogue ? [scene.keyDialogue] : []),
    ...(scene?.informationRelease ?? []).map((item) => `释放信息：${item}`),
    ...(scene?.result ? [`场景结果：${scene.result}`] : []),
    ...(scene?.transition ? [`场景转场：${scene.transition}`] : []),
    ...(card?.mustHappenEvents ?? []),
    ...(base.outlineKeyPoints ?? []).map((point) => point.text),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const sceneConstraints = [
    card?.viewpointCharacter ? `视角角色：${card.viewpointCharacter}` : '',
    constraints?.narrativePerson ? `叙事人称：${constraints.narrativePerson}` : '',
    scene?.location
      ? `当前地点：${scene.location}`
      : card?.primaryLocation
        ? `当前地点：${card.primaryLocation}`
        : '',
    scene?.characters?.length ? `当前角色：${scene.characters.join('、')}` : '',
    ...(constraints?.mustFollow ?? []).map((item) => `必须遵守：${item}`),
    ...(constraints?.forbiddenChanges ?? []).map((item) => `不得改变：${item}`),
    ...(constraints?.forbiddenAdditions ?? []).map((item) => `不得新增：${item}`),
    ...(constraints?.forbiddenEarlyEvents ?? []).map((item) => `不得提前发生：${item}`),
    ...(constraints?.forbiddenEarlyReveals ?? []).map((item) => `不得提前揭示：${item}`),
    ...(card?.forbiddenWriting ?? []).map((item) => `写法禁区：${item}`),
    '只输出当前场景连续正文，不提前收束整章或写入后续场景。',
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
  const sceneContext = [
    `章节：${base.chapterTitle}`,
    base.volumeTitle ? `分卷：${base.volumeTitle}` : '',
    base.previousContext ? `前文上下文：\n${base.previousContext}` : '',
    card?.openingState ? `场景开场状态：${card.openingState}` : '',
    card?.endingState ? `章节预期结束状态：${card.endingState}` : '',
    card?.knownInformation?.length ? `已知信息：${card.knownInformation.join('；')}` : '',
    card?.releasedInformation?.length ? `已释放信息：${card.releasedInformation.join('；')}` : '',
    card?.reservedMysteries?.length ? `保留悬念：${card.reservedMysteries.join('；')}` : '',
    scene?.conflict
      ? `场景冲突：${scene.conflict}`
      : card?.coreConflict
        ? `核心冲突：${card.coreConflict}`
        : '',
    base.styleProfile ? `风格方案：\n${base.styleProfile}` : '',
    base.outputProfile ? `输出方案：\n${base.outputProfile}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    chapterTitle: base.chapterTitle,
    targetWordCount: base.targetWordCount ?? card?.targetWordCount,
    minimumWordCount: constraints?.wordRange.min,
    contextHash: snapshot.contextHash,
    sceneGoal,
    sceneBeats: sceneBeats.length ? sceneBeats : ['完成当前章节的核心事件推进。'],
    sceneConstraints,
    scenePlan: engineering?.scenePlan ?? [],
    sceneContext:
      sceneContext || `章节：${base.chapterTitle}\n请依据当前章节目标推进一个连续场景。`,
    snapshotId: snapshot.id,
  };
}

export async function runMockChapterJob(
  input: RunMockGenerationJobInput,
  onProgress?: GenerationJobProgressCallback,
): Promise<GenerationJob> {
  let job = await createGenerationJob({
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    jobType: 'chapter_generation_mock',
    provider: 'mock',
    modelName: 'mock-generation-runner',
  });
  let steps: GenerationStepResult[] = [];

  const emit = async () => {
    steps = await getGenerationSteps(job.id);
    onProgress?.(job, steps);
  };
  const ensureNotCancelled = async () => {
    const latest = await getGenerationJobById(job.id);
    if (latest?.status === 'cancelled') throw new Error('generation_job_cancelled');
  };
  const updateJob = async (patch: Omit<UpdateGenerationJobInput, 'id'>) => {
    job = await updateGenerationJob({ ...patch, id: job.id });
    await emit();
  };
  const runStep = async (
    stepName: GenerationStepName,
    progressPercent: number,
    action: () => Promise<{
      outputJson?: unknown;
      outputText?: string;
      status?: GenerationStepStatus;
    }>,
    inputSnapshot?: unknown,
  ) => {
    await ensureNotCancelled();
    await updateJob({ status: 'running', currentStep: stepName, progressPercent });
    await delay(120);
    const result = await action();
    await ensureNotCancelled();
    const step = await saveGenerationStep({
      jobId: job.id,
      stepName,
      status: result.status ?? 'succeeded',
      inputSnapshot,
      outputJson: result.outputJson,
      outputText: result.outputText,
    });
    steps = [...steps, step];
    onProgress?.(job, steps);
  };

  try {
    await updateJob({ status: 'running', startedAt: nowISO(), progressPercent: 1 });
    await runStep('preflight', 8, async () => ({
      outputJson: { novelId: input.novelId, chapterId: input.chapterId, ok: true },
      outputText: 'Mock 预检通过。',
    }));
    let snapshot: ChapterGenerationSnapshot | null = null;
    await runStep('compile_context', 24, async () => {
      snapshot = await generationContextCompiler.compileAndSave({
        novelId: input.novelId,
        volumeId: input.volumeId,
        chapterId: input.chapterId,
        currentEditorContent: input.currentEditorContent,
        provisionalPreviousChapter: input.provisionalPreviousChapter,
      });
      return {
        outputJson: { snapshotId: snapshot.id, contextHash: snapshot.contextHash },
        outputText: snapshot.promptSummary,
      };
    });
    await runStep('chapter_card', 38, async () => ({
      outputJson: {
        engineeringStateId: snapshot?.engineeringStateId,
        hasActiveEngineeringState: Boolean(snapshot?.compiledContext.activeEngineeringState),
      },
      outputText: snapshot?.compiledContext.activeEngineeringState
        ? `读取 active 工程状态 v${snapshot.compiledContext.activeEngineeringState.draftVersion}。`
        : '未读取到 active 工程状态，使用旧式上下文降级。',
    }));
    await runStep('scene_plan', 52, async () => {
      const scenes = snapshot?.compiledContext.activeEngineeringState?.scenePlan ?? [];
      return {
        outputJson: {
          sceneCount: scenes.length,
          scenes: scenes.map((scene) => ({ no: scene.sceneNo, title: scene.title })),
        },
        outputText: scenes.length
          ? `读取 ${scenes.length} 个工程场景。`
          : '无工程场景，Mock 将按章节大纲推进。',
      };
    });
    await runStep('draft_generation', 72, async () => {
      if (!snapshot) throw new Error('missing_context_snapshot');
      const mockDraft = buildMockDraft(snapshot);
      return {
        outputJson: {
          provider: 'mock',
          contextHash: snapshot.contextHash,
          textLength: mockDraft.length,
        },
        outputText: mockDraft,
      };
    });
    await runStep('quality_check', 82, async () => ({
      status: 'skipped',
      outputText: 'v1.9.7 不接真实质量检查，已记录为 skipped。',
    }));
    await runStep('patch_generation', 90, async () => ({
      status: 'skipped',
      outputText: 'v1.9.7 不生成局部 patch，已记录为 skipped。',
    }));
    await runStep('patch_apply', 96, async () => ({
      status: 'skipped',
      outputText: 'v1.9.7 不应用 patch，已记录为 skipped。',
    }));
    await runStep('save_version', 99, async () => ({
      status: 'skipped',
      outputText: 'v1.9.7 不保存正文版本；v2.0.0 将接入正文版本保存。',
    }));
    await ensureNotCancelled();
    job = await updateGenerationJob({
      id: job.id,
      status: 'completed',
      progressPercent: 100,
      currentStep: 'save_version',
      finishedAt: nowISO(),
    });
    await emit();
    return job;
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'generation_job_cancelled') {
      const cancelled = await cancelGenerationJob(job.id);
      if (cancelled) job = cancelled;
      await emit();
      return job;
    }
    const persisted = await getGenerationJobById(job.id);
    if (
      persisted &&
      (persisted.status === 'completed' ||
        persisted.status === 'failed' ||
        persisted.status === 'cancelled')
    ) {
      job = persisted;
      await emit();
      return job;
    }
    const message = e instanceof Error ? e.message : '生成任务失败';
    try {
      await saveGenerationStep({
        jobId: job.id,
        stepName: job.currentStep ?? 'preflight',
        status: 'failed',
        errorMessage: message,
      });
      job = await updateGenerationJob({
        id: job.id,
        status: 'failed',
        errorMessage: message,
        progressPercent: job.progressPercent,
        finishedAt: nowISO(),
      });
    } catch (finalizationError) {
      const terminal = await getGenerationJobById(job.id);
      if (!terminal || !TERMINAL_JOB_STATUSES.has(terminal.status)) throw finalizationError;
      job = terminal;
    }
    await emit();
    return job;
  }
}

export async function runChapterDraftJob(
  input: RunChapterDraftGenerationJobInput,
  onProgress?: GenerationJobProgressCallback,
): Promise<ChapterDraftJobResult> {
  const settings = aiSettingsService.getSettings();
  const [{ buildRouteRequest, routeCreativeTask }, { syncLocalModelLifecycleSidecar }] =
    await Promise.all([
      import('../ai/runtime/modelRouter'),
      import('../ai/runtime/modelLifecycleSidecar'),
    ]);
  if (settings.localChapterModel?.enabled) {
    await syncLocalModelLifecycleSidecar(settings.localChapterModel);
  }
  let chapterWriterRoute = routeCreativeTask(settings, 'chapter_scene_generate');
  const chapterProvider = chapterWriterRoute.selected.providerId;
  const chapterModel = chapterWriterRoute.selected.modelId;
  let job = await createGenerationJob({
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    jobType: 'chapter_generation',
    provider: chapterProvider,
    modelName: chapterModel,
  });
  let steps: GenerationStepResult[] = [];
  let savedDraft: ChapterDraft | undefined;
  let qualityItems: QualityCheckItem[] = [];
  let patchCandidates: PatchCandidate[] = [];
  const control: ActiveJobControl = { controller: new AbortController() };
  activeJobControls.set(job.id, control);
  const onCallerAbort = () => control.controller.abort();
  input.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (input.signal?.aborted) onCallerAbort();

  const emit = async () => {
    steps = await getGenerationSteps(job.id);
    onProgress?.(job, steps);
  };
  const ensureNotCancelled = async () => {
    const latest = await getGenerationJobById(job.id);
    if (latest?.status === 'cancelled') throw new Error('generation_job_cancelled');
  };
  const updateJob = async (patch: Omit<UpdateGenerationJobInput, 'id'>) => {
    job = await updateGenerationJob({ ...patch, id: job.id });
    await emit();
  };
  const runStep = async (
    stepName: GenerationStepName,
    progressPercent: number,
    action: () => Promise<{
      outputJson?: unknown;
      outputText?: string;
      status?: GenerationStepStatus;
    }>,
    inputSnapshot?: unknown,
  ) => {
    await ensureNotCancelled();
    await updateJob({ status: 'running', currentStep: stepName, progressPercent });
    const result = await action();
    await ensureNotCancelled();
    const step = await saveGenerationStep({
      jobId: job.id,
      stepName,
      status: result.status ?? 'succeeded',
      inputSnapshot,
      outputJson: result.outputJson,
      outputText: result.outputText,
    });
    steps = [...steps, step];
    onProgress?.(job, steps);
  };

  try {
    await updateJob({ status: 'running', startedAt: nowISO(), progressPercent: 1 });
    await runStep('preflight', 8, async () => {
      let localAvailability:
        Awaited<ReturnType<typeof checkLocalChapterModelAvailability>> | undefined;
      let localAvailabilityError: string | undefined;
      const local = settings.localChapterModel;
      const localLifecycle = buildRouteRequest(settings, 'chapter_scene_generate').localLifecycle;
      if (local?.enabled && localLifecycle === 'AVAILABLE') {
        const [{ modelLifecycleManager }, { localModelRef }] = await Promise.all([
          import('../ai/runtime/modelLifecycle'),
          import('../ai/runtime/modelCatalog'),
        ]);
        const endpointId = localModelRef(local).endpointId;
        try {
          localAvailability = await checkLocalChapterModelAvailability(
            local,
            control.controller.signal,
          );
          const healthy = localAvailability.healthOk && localAvailability.modelOk;
          modelLifecycleManager.observeHealth(endpointId, healthy ? 'ok' : 'down');
          if (!healthy) localAvailabilityError = localAvailability.message;
        } catch (error) {
          if (control.controller.signal.aborted || isAiRequestCancelled(error)) throw error;
          modelLifecycleManager.observeHealth(endpointId, 'down');
          localAvailabilityError =
            error instanceof Error ? error.message : '专用本地正文模型检查失败。';
        }
        // Re-route after every non-generative health observation. A recovered
        // endpoint can re-enter service for this chapter; an outage falls back
        // or throws when the user explicitly disabled cloud writer fallback.
        chapterWriterRoute = routeCreativeTask(settings, 'chapter_scene_generate');
      }
      const selected = chapterWriterRoute.selected;
      if (job.provider !== selected.providerId || job.modelName !== selected.modelId) {
        job = await updateGenerationJob({
          id: job.id,
          provider: selected.providerId,
          modelName: selected.modelId,
        });
      }
      return {
        outputJson: {
          runtimeMode: settings.runtimeMode,
          provider: selected.providerId,
          modelName: selected.modelId,
          chapterId: input.chapterId,
          routeReason: chapterWriterRoute.reason,
          fallbackUsed: chapterWriterRoute.fallbackUsed,
          localAvailability: localAvailability
            ? {
                healthOk: localAvailability.healthOk,
                modelOk: localAvailability.modelOk,
                smokeCalled: false,
              }
            : undefined,
          localAvailabilityError,
        },
        outputText:
          selected.kind === 'local' && localAvailability
            ? '正文生成预检通过：本地服务健康、模型匹配，未执行 smoke 生成。'
            : settings.runtimeMode === 'mock'
              ? '正文生成预检通过：使用 Mock Provider。'
              : local?.enabled
                ? `正文生成预检通过：专用本地模型不接收流量（${chapterWriterRoute.reason}），由云端 Provider 临时代写。`
                : '正文生成预检通过：未启用专用本地模型，由云端 Provider 生成正文。',
      };
    });
    let snapshot: ChapterGenerationSnapshot | null = null;
    await runStep('compile_context', 24, async () => {
      snapshot = await generationContextCompiler.compileAndSave({
        novelId: input.novelId,
        volumeId: input.volumeId,
        chapterId: input.chapterId,
        currentEditorContent: input.currentEditorContent,
        provisionalPreviousChapter: input.provisionalPreviousChapter,
      });
      return {
        outputJson: { snapshotId: snapshot.id, contextHash: snapshot.contextHash },
        outputText: snapshot.promptSummary,
      };
    });
    let resumeBeats: ChapterProseResumeBeat[] = [];
    const compiledSnapshot = snapshot as ChapterGenerationSnapshot | null;
    const beatOrchestrationEnabled = Boolean(
      compiledSnapshot?.compiledContext.activeEngineeringState?.scenePlan.length,
    );
    if (beatOrchestrationEnabled && compiledSnapshot) {
      const resumableJobs = (await getGenerationJobsByChapterId(input.chapterId))
        .filter(
          (candidate) =>
            candidate.id !== job.id &&
            candidate.status === 'failed' &&
            candidate.jobType === 'chapter_generation' &&
            candidate.provider === chapterWriterRoute.selected.providerId &&
            candidate.modelName === chapterWriterRoute.selected.modelId,
        )
        .slice(0, 20);
      const candidates = await Promise.all(
        resumableJobs.map(async (candidate) => ({
          job: candidate,
          steps: await getGenerationSteps(candidate.id),
        })),
      );
      const repairBeats = await collectRepairArtifactResumeBeats({
        novelId: input.novelId,
        chapterId: input.chapterId,
        candidates,
        contextHash: compiledSnapshot.contextHash,
      });
      resumeBeats = selectResumableBeatPrefix({
        candidates,
        contextHash: compiledSnapshot.contextHash,
        provider: chapterWriterRoute.selected.providerId,
        modelName: chapterWriterRoute.selected.modelId,
        repairBeats,
      });
    }
    let generatedText = '';
    let aiTaskId: string | undefined;
    let externalBeatRepairUsed = false;
    await runStep('draft_generation', 72, async () => {
      if (!snapshot) throw new Error('missing_context_snapshot');
      const request = buildSnapshotGenerateRequest(snapshot);
      const response = await trackActiveAiRequest(
        control,
        executeChapterGeneration({
          novelId: input.novelId,
          chapterId: input.chapterId,
          operationId: `${job.id}:draft`,
          traceId: job.id,
          settings,
          request,
          sourceId: snapshot.id,
          sourceVersion: snapshot.contextHash,
          taskInput: {
            chapterTitle: snapshot.compiledContext.baseContext.chapterTitle,
            targetWordCount:
              snapshot.compiledContext.baseContext.targetWordCount ??
              snapshot.compiledContext.activeEngineeringState?.chapterCard.targetWordCount,
            contextHash: snapshot.contextHash,
            promptTemplateSource: request.promptTemplateSource,
            generationJobId: job.id,
            snapshotId: snapshot.id,
            ...buildLocalSceneTaskInput(snapshot),
          },
          targetHintJson: {
            generationJobId: job.id,
            snapshotId: snapshot.id,
            contextHash: snapshot.contextHash,
          },
          resumeBeats,
          signal: control.controller.signal,
          stream: true,
          onStreamEvent: input.onStreamEvent,
          onSceneCompleted: async (scene) => {
            const sceneStep = await saveGenerationStep({
              jobId: job.id,
              stepName: 'draft_generation',
              status: 'succeeded',
              inputSnapshot: {
                sceneNo: scene.sceneNo,
                beatOrder: scene.beatOrder,
                generationUnitNo: scene.generationUnitNo,
                generationUnitCount: scene.generationUnitCount,
                title: scene.title,
                taskId: scene.taskId,
                attemptId: scene.attemptId,
                reusedFromJobId: scene.reusedFromJobId,
              },
              outputJson: {
                sceneNo: scene.sceneNo,
                beatOrder: scene.beatOrder,
                generationUnitNo: scene.generationUnitNo,
                generationUnitCount: scene.generationUnitCount,
                taskId: scene.taskId,
                attemptId: scene.attemptId,
                provider: scene.provider.providerId,
                modelName: scene.provider.modelId,
                finishReason: scene.provider.finishReason,
                tokenInput: scene.provider.tokenInput,
                tokenOutput: scene.provider.tokenOutput,
                reusedFromJobId: scene.reusedFromJobId,
              },
              outputText: scene.text,
            });
            steps = [...steps, sceneStep];
            onProgress?.(job, steps);
          },
        }),
      );
      aiTaskId = response.taskId;
      externalBeatRepairUsed = response.externalRepairUsed === true;
      generatedText = response.text.trim();
      if (!generatedText) throw new Error('正文模型返回为空');
      const sceneResults = response.sceneResults ?? [
        {
          sceneNo: 1,
          beatOrder: undefined,
          generationUnitNo: undefined,
          generationUnitCount: undefined,
          taskId: response.taskId,
          attemptId: response.attemptId,
          provider: response.provider,
          reusedFromJobId: undefined,
        },
      ];
      const actualInputTokens = sceneResults.reduce(
        (total, scene) => total + (scene.provider.tokenInput ?? 0),
        0,
      );
      const actualOutputTokens = sceneResults.reduce(
        (total, scene) => total + (scene.provider.tokenOutput ?? 0),
        0,
      );
      job = await updateGenerationJob({
        id: job.id,
        actualInputTokens: actualInputTokens || response.provider.tokenInput,
        actualOutputTokens: actualOutputTokens || response.provider.tokenOutput,
        costEstimate: response.provider.usageCost?.estimatedCost,
      });
      return {
        outputJson: {
          provider: response.provider.providerId,
          modelName: response.provider.modelId,
          contextHash: snapshot.contextHash,
          aiTaskId: response.taskId,
          sceneCount: new Set(sceneResults.map((scene) => scene.sceneNo)).size,
          generationUnitCount: sceneResults.length,
          reusedGenerationUnitCount: sceneResults.filter((scene) => scene.reusedFromJobId).length,
          resumedFromJobIds: [
            ...new Set(
              sceneResults
                .map((scene) => scene.reusedFromJobId)
                .filter((sourceJobId): sourceJobId is string => Boolean(sourceJobId)),
            ),
          ],
          sceneResults: sceneResults.map((scene) => ({
            sceneNo: scene.sceneNo,
            beatOrder: scene.beatOrder,
            generationUnitNo: scene.generationUnitNo,
            generationUnitCount: scene.generationUnitCount,
            taskId: scene.taskId,
            attemptId: scene.attemptId,
            provider: scene.provider.providerId,
            modelName: scene.provider.modelId,
            finishReason: scene.provider.finishReason,
            tokenInput: scene.provider.tokenInput,
            tokenOutput: scene.provider.tokenOutput,
            reusedFromJobId: scene.reusedFromJobId,
          })),
          tokenInput: response.provider.tokenInput,
          tokenOutput: response.provider.tokenOutput,
          tokenTotal: response.provider.tokenTotal,
          costEstimate: response.provider.usageCost?.estimatedCost,
          costStatus: response.provider.usageCost?.status,
          textLength: generatedText.length,
        },
        outputText: generatedText,
      };
    });
    await runStep('save_version', 96, async () => {
      if (!snapshot) throw new Error('missing_context_snapshot');
      savedDraft = await draftVersionService.create({
        novelId: input.novelId,
        chapterId: input.chapterId,
        title: input.title || `AI 初稿 ${new Date().toLocaleString()}`,
        content: generatedText,
        source: 'ai_generated',
        aiTaskId,
        note: `v2.0.0 generation job ${job.id} / context ${snapshot.contextHash}`,
      });
      await input.onDraftSaved?.(savedDraft, job.id);
      const chapter = await chapterRepository.getById(input.chapterId);
      if (chapter && chapter.status !== 'adopted' && chapter.status !== 'summarized') {
        await chapterRepository.update(chapter.id, { status: 'draft_generated' }).catch((error) => {
          appLogger.warn('[GenerationJob] draft saved but chapter status refresh failed', {
            chapterId: chapter.id,
            error,
          });
        });
      }
      return {
        outputJson: {
          draftId: savedDraft.id,
          versionNo: savedDraft.versionNo,
          contextHash: snapshot.contextHash,
        },
        outputText: `已保存正文草稿 v${savedDraft.versionNo}。`,
      };
    });
    await runStep('quality_check', 99, async () => {
      if (!savedDraft) throw new Error('missing_saved_draft');
      const chapter = await chapterRepository.getById(input.chapterId);
      const contentHash = hashTextContent(savedDraft.content);
      const checkedAt = nowISO();
      const result = await trackActiveAiRequest(
        control,
        qualityCheckAiService.runCheck(
          {
            novelId: input.novelId,
            chapterId: input.chapterId,
            draftId: savedDraft.id,
            volumeId: input.volumeId,
            draftContent: savedDraft.content,
            chapterTitle: chapter?.title || input.title || '未命名章节',
            chapterOutline: chapter?.outline,
            chapterGoal: chapter?.goal,
            contentHash,
            wordCount: countTextWords(savedDraft.content),
          },
          {
            signal: control.controller.signal,
            requestId: `${job.id}:quality:${generateId()}`,
          },
        ),
      );
      const report = await qualityCheckService.createReport({
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: savedDraft.id,
        scope: 'current_draft',
        contentHash,
        contentLength: savedDraft.content.length,
        checkedAt,
      });
      const saved = await qualityCheckService.saveResult({
        reportId: report.id,
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: savedDraft.id,
        result,
        draftVersion: savedDraft.versionNo,
        model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        contentHash,
        contentLength: savedDraft.content.length,
        checkedAt,
        aiTaskId: result.aiTaskId,
      });
      qualityItems = saved.items;

      const initialScore = result.overallScore;
      let finalScore = initialScore;
      let finalReportId = saved.report?.id || report.id;
      let externalRepairAttempted = false;
      let externalRepairSucceeded = false;
      let manualReviewRequired = !passesChapterQualityGate(finalScore, qualityItems);

      if (
        shouldAttemptExternalQualityRepair({
          beatOrchestrationEnabled,
          runtimeMode: settings.runtimeMode,
          manualReviewRequired,
          qualityItems,
          externalBeatRepairUsed,
        })
      ) {
        externalRepairAttempted = true;
        try {
          const sourceDraft = savedDraft;
          const sourceReport = saved.report;
          if (!sourceReport) throw new Error('missing_saved_quality_report');
          const repaired = await chapterQualityGateService.runRepairAndRecheck(
            {
              novelId: input.novelId,
              chapterId: input.chapterId,
              volumeId: input.volumeId,
              chapterTitle: chapter?.title || input.title || '未命名章节',
              chapterOutline: chapter?.outline,
              chapterGoal: chapter?.goal,
              draft: sourceDraft,
              report: sourceReport,
              items: qualityItems,
            },
            {
              signal: control.controller.signal,
              requestIdPrefix: `${job.id}:external-quality`,
              cancel: () => control.controller.abort(),
              trackRequest: (request) => trackActiveAiRequest(control, request),
            },
          );
          externalRepairSucceeded = repaired.repairApplied;
          savedDraft = repaired.finalDraft;
          qualityItems = repaired.finalItems;
          finalReportId = repaired.finalReport.id;
          finalScore = repaired.finalScore;
          manualReviewRequired = !repaired.qualityGatePassed;
          if (repaired.finalDraft.id !== sourceDraft.id) {
            await input.onDraftSaved?.(repaired.finalDraft, job.id);
          }
        } catch (repairError) {
          appLogger.warn('[GenerationJob] external quality repair failed; manual review required', {
            jobId: job.id,
            error: repairError,
          });
        }
      }

      return {
        outputJson: {
          reportId: finalReportId,
          initialScore,
          finalScore,
          issueCount: qualityItems.length,
          pendingCount: qualityItems.filter((item) => item.status === 'pending').length,
          criticalCount: qualityItems.filter(
            (item) => item.status === 'pending' && item.severity === 'critical',
          ).length,
          highCount: qualityItems.filter(
            (item) => item.status === 'pending' && item.severity === 'high',
          ).length,
          qualityGatePassed: !manualReviewRequired,
          externalRepairAttempted,
          externalRepairSucceeded,
          externalBeatRepairUsed,
        },
        outputText: manualReviewRequired
          ? `质量检查完成：${initialScore} → ${finalScore} 分，仍需人工处理（外部质量修稿${externalRepairAttempted ? '已执行' : '未执行'}${externalBeatRepairUsed ? '；此前另有 Beat 定点修稿' : ''}）。`
          : `质量门禁通过：${finalScore} 分，critical/high 均为 0。`,
      };
    });
    await runStep('patch_generation', 99, async () => {
      patchCandidates = buildPatchCandidates(qualityItems);
      return {
        outputJson: {
          patchCount: patchCandidates.length,
          lowRiskCount: patchCandidates.filter((patch) => patch.riskLevel === 'low').length,
          patches: patchCandidates,
        },
        outputText: patchCandidates.length
          ? `已生成 ${patchCandidates.length} 个局部修复建议，其中 ${patchCandidates.filter((patch) => patch.riskLevel === 'low').length} 个为低风险。`
          : '未生成可自动处理的局部修复建议。',
      };
    });
    await runStep('patch_apply', 99, async () => {
      if (!savedDraft) throw new Error('missing_saved_draft');
      if (beatOrchestrationEnabled) {
        return {
          status: 'skipped',
          outputJson: {
            appliedCount: 0,
            skippedCount: patchCandidates.length,
            reason: 'beat_orchestration_quality_gate_owns_external_repair_round',
          },
          outputText:
            'Scene/Beat 正文流程不自动应用低风险 patch；请依据最终评分和问题列表人工确认。',
        };
      }
      const result = applyLowRiskPatches(savedDraft.content, patchCandidates);
      if (result.applied.length === 0 || result.content === savedDraft.content) {
        return {
          status: 'skipped',
          outputJson: { appliedCount: 0, skippedCount: result.skipped.length },
          outputText: '没有可自动应用的低风险 patch。',
        };
      }
      const patchedDraft = await draftVersionService.create({
        novelId: input.novelId,
        chapterId: input.chapterId,
        title: `${input.title || '章节'} - AI 局部修复`,
        content: result.content,
        source: 'ai_regenerated',
        aiTaskId: job.id,
        note: `v2.0.2 auto patch from generation job ${job.id}; applied ${result.applied.length} low-risk patches`,
      });
      savedDraft = patchedDraft;
      return {
        outputJson: {
          draftId: patchedDraft.id,
          versionNo: patchedDraft.versionNo,
          appliedCount: result.applied.length,
          skippedCount: result.skipped.length,
        },
        outputText: `已自动应用 ${result.applied.length} 个低风险 patch，并保存修复草稿 v${patchedDraft.versionNo}。`,
      };
    });
    await ensureNotCancelled();
    job = await updateGenerationJob({
      id: job.id,
      status: 'completed',
      progressPercent: 100,
      currentStep: 'save_version',
      finishedAt: nowISO(),
    });
    await emit();
    return { job, draft: savedDraft };
  } catch (e: unknown) {
    if (
      isAiRequestCancelled(e) ||
      (e instanceof Error && e.message === 'generation_job_cancelled')
    ) {
      const cancelled = await cancelGenerationJob(job.id);
      if (cancelled) job = cancelled;
      await emit();
      return { job, draft: savedDraft };
    }
    const persisted = await getGenerationJobById(job.id);
    if (
      persisted &&
      (persisted.status === 'completed' ||
        persisted.status === 'failed' ||
        persisted.status === 'cancelled')
    ) {
      job = persisted;
      await emit();
      return { job, draft: savedDraft };
    }
    const message = e instanceof Error ? e.message : '正文生成任务失败';
    try {
      await saveGenerationStep({
        jobId: job.id,
        stepName: job.currentStep ?? 'preflight',
        status: 'failed',
        errorMessage: message,
      });
      job = await updateGenerationJob({
        id: job.id,
        status: 'failed',
        errorMessage: message,
        progressPercent: job.progressPercent,
        finishedAt: nowISO(),
      });
    } catch (finalizationError) {
      const terminal = await getGenerationJobById(job.id);
      if (!terminal || !TERMINAL_JOB_STATUSES.has(terminal.status)) throw finalizationError;
      job = terminal;
    }
    await emit();
    return { job, draft: savedDraft };
  } finally {
    input.signal?.removeEventListener('abort', onCallerAbort);
    if (activeJobControls.get(job.id) === control) {
      activeJobControls.delete(job.id);
    }
  }
}
