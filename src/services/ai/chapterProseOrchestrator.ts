import type { AiGenerateRequest, AiSettings } from '../../types/ai';
import { appLogger } from '../observability/appLogger';
import type { AiExecutionResult, AiSceneExecutionResult } from './aiExecutionPipeline';
import { executeAiTask } from './aiExecutionPipeline';
import { executeChapterSceneGeneration } from './chapterSceneGenerationExecutionService';
import { isAiRequestCancelled } from './aiCancellation';
import type {
  ChapterGenerationExecutionInput,
  ChapterProseResumeBeat,
} from './chapterGenerationExecutionService';
import type { ScenePlanItem } from '../../types/chapterEngineering';

function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

export const EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS = 300;
export const EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS = 100;
export const EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS = 400;
export const EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO = 0.65;
export const EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM = 1_100;
export const EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER = 800;
export const EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT = 14;
/** Transport retries do not create another logical Beat-repair round. */
export const MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS = 2;
export const EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS = 1_000;

export function withExternalBeatRepairRequestSettings(settings: AiSettings): AiSettings {
  return {
    ...settings,
    temperature: Math.min(settings.temperature ?? 0.35, 0.35),
    timeoutSeconds: Math.max(
      settings.timeoutSeconds ?? 0,
      EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS,
    ),
  };
}

export function externalBeatRepairPromptMinimum(beatTarget: number, beatMaximum: number): number {
  return Math.max(
    beatTarget,
    MIN_LOCAL_BEAT_CHARACTERS + EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS,
    beatMaximum + EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS,
  );
}

export function externalBeatRepairPromptMaximum(
  requestedMinimum: number,
  beatMaximum: number,
): number {
  return Math.max(requestedMinimum, beatMaximum + EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS);
}

export function externalBeatRepairRequiredEventDeadline(beatMaximum: number): number {
  return Math.max(
    300,
    Math.min(beatMaximum, Math.floor(beatMaximum * EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO)),
  );
}

export function externalBeatRepairRawCharacterLimit(beatMaximum: number): number {
  return beatMaximum + EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM;
}

export function externalBeatRepairRawCharacterMinimum(beatMaximum: number): number {
  return Math.min(
    externalBeatRepairRawCharacterLimit(beatMaximum),
    Math.max(
      MIN_LOCAL_BEAT_CHARACTERS + EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER,
      beatMaximum + EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER,
    ),
  );
}

async function executeExternalChapterGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  return executeAiTask({
    operationId: input.operationId,
    traceId: input.traceId ?? input.operationId,
    taskType: 'chapter_generate',
    scopeType: 'chapter',
    novelId: input.novelId,
    chapterId: input.chapterId,
    targetHintJson: input.targetHintJson,
    settings: input.settings,
    compilation: {
      taskInput: input.taskInput,
      sources: [
        {
          sourceType: 'request_context',
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          origin: 'request',
          label: 'Frozen chapter generation prompt',
          content: requestSource(input.request),
          order: 0,
          priority: 100,
          required: true,
          maxTokens: 48_000,
        },
      ],
    },
    signal: input.signal,
    stream: input.stream,
    onStreamEvent: input.onStreamEvent,
  });
}

async function executeExternalBeatRepairGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  return executeAiTask({
    operationId: input.operationId,
    traceId: input.traceId ?? input.operationId,
    taskType: 'chapter_beat_repair',
    scopeType: 'chapter',
    novelId: input.novelId,
    chapterId: input.chapterId,
    targetHintJson: input.targetHintJson,
    settings: withExternalBeatRepairRequestSettings(input.settings),
    compilation: {
      taskInput: input.taskInput,
      sources: [
        {
          sourceType: 'request_context',
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          origin: 'request',
          label: 'Frozen external Beat repair prompt',
          content: requestSource(input.request),
          order: 0,
          priority: 100,
          required: true,
          maxTokens: 16_000,
        },
      ],
    },
    signal: input.signal,
    stream: input.stream,
    onStreamEvent: input.onStreamEvent,
  });
}

export function isRetryableExternalBeatRepairError(error: unknown): boolean {
  if (isAiRequestCancelled(error)) return false;
  if (error && typeof error === 'object' && (error as { retryable?: unknown }).retryable === true) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:429|5\d\d)\b|超时|过载|网络请求失败|请求过于频繁|服务错误/u.test(message);
}

async function executeExternalBeatRepairWithTransportRetry(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  rejectedText: string,
  validationFailure: unknown,
  constraints: string[],
  beatTarget: number,
  beatMaximum: number,
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  acceptedChapterPrefix: string,
): Promise<AiExecutionResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      return await executeExternalBeatRepair(
        input,
        scene,
        beat,
        rejectedText,
        validationFailure,
        constraints,
        beatTarget,
        beatMaximum,
        previous,
        acceptedChapterPrefix,
      );
    } catch (error: unknown) {
      lastError = error;
      if (
        attempt >= MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS ||
        !isRetryableExternalBeatRepairError(error)
      ) {
        throw error;
      }
      appLogger.warn('[ChapterProse] retrying transient external Beat-repair transport failure', {
        attempt,
        nextAttempt: attempt + 1,
        sceneNo: scene.sceneNo,
        beatOrder: beat.order,
      });
      await new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS * attempt),
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error('外部 Beat 修稿传输失败。');
}

/**
 * Headless recovery and job-resume entry point for one already locally-attempted Beat.
 * It deliberately exposes only the same issue-bound repair path used by the orchestrator.
 */
export async function executeChapterBeatRepair(
  input: ChapterGenerationExecutionInput,
  sceneNo: number,
  beatOrder: number,
  rejectedText: string,
  validationFailure: unknown,
): Promise<AiExecutionResult> {
  const scenes = scenePlanFromInput(input);
  validateLocalGenerationPlan(scenes);
  const scene = scenes.find((item) => item.sceneNo === sceneNo);
  const beat = scene?.beats.find((item) => item.order === beatOrder);
  if (!scene || !beat) throw new Error(`找不到待外部修复的 Scene ${sceneNo} / Beat ${beatOrder}。`);
  const totalBeats = scenes.reduce((sum, item) => sum + item.beats.length, 0);
  const chapterTarget = positiveNumber(input.taskInput.targetWordCount);
  const beatTarget = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(500, chapterTarget ? Math.round(chapterTarget / totalBeats) : 650),
  );
  const beatMaximum = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(MIN_LOCAL_BEAT_CHARACTERS, Math.ceil(beatTarget * 1.2)),
  );
  const constraints = sceneConstraints(
    input,
    scene,
    beat,
    undefined,
    beat.order === scene.beats.length,
  );
  return executeExternalBeatRepairWithTransportRetry(
    input,
    scene,
    beat,
    rejectedText,
    validationFailure,
    constraints,
    beatTarget,
    beatMaximum,
    undefined,
    '',
  );
}

interface OrchestratedScene {
  sceneNo: number;
  title: string;
  location: string;
  characters: string[];
  goal: string;
  conflict: string;
  beats: Array<{ order: number; text: string; required: boolean }>;
  result: string;
  transition: string;
  contextCapsule: string;
  constraints: string[];
  expectedEndState: string;
  targetCharacters: number | undefined;
}

const MIN_LOCAL_CHAPTER_BEATS = 3;
const MAX_LOCAL_CHAPTER_BEATS = 5;
const MAX_LOCAL_SCENE_BEATS = 3;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : stringValue(value)
      ? [stringValue(value)]
      : [];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function scenePlanFromInput(input: ChapterGenerationExecutionInput): OrchestratedScene[] {
  const raw = input.taskInput.scenePlan;
  if (Array.isArray(raw)) {
    const scenes = raw
      .map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const scene = value as Partial<ScenePlanItem>;
        const beats = Array.isArray(scene.beats)
          ? scene.beats
              .map((beat, beatIndex) => {
                if (!beat || typeof beat !== 'object' || Array.isArray(beat)) return null;
                const text = stringValue((beat as { text?: unknown }).text);
                return text
                  ? {
                      order: Math.max(
                        1,
                        Math.round(Number((beat as { order?: unknown }).order) || beatIndex + 1),
                      ),
                      text,
                      required: (beat as { required?: unknown }).required !== false,
                    }
                  : null;
              })
              .filter(
                (beat): beat is { order: number; text: string; required: boolean } => beat !== null,
              )
              .sort((left, right) => left.order - right.order)
              .map((beat, beatIndex) => ({ ...beat, order: beatIndex + 1 }))
          : [];
        return {
          sceneNo: Math.max(1, Math.round(Number(scene.sceneNo) || index + 1)),
          title: stringValue(scene.title) || '场景 ' + (index + 1),
          location: stringValue(scene.location),
          characters: stringList(scene.characters),
          goal: stringValue(scene.goal),
          conflict: stringValue(scene.conflict),
          beats,
          result: stringValue(scene.result),
          transition: stringValue(scene.transition),
          contextCapsule: stringValue(scene.contextCapsule),
          constraints: stringList(scene.constraints),
          expectedEndState: stringValue(scene.expectedEndState),
          targetCharacters: positiveNumber(scene.targetCharacters),
        };
      })
      .filter((scene): scene is OrchestratedScene => scene !== null)
      .sort((left, right) => left.sceneNo - right.sceneNo)
      .map((scene, index) => ({ ...scene, sceneNo: index + 1 }));
    if (scenes.length) return scenes;
  }

  const fallbackBeats = stringList(input.taskInput.sceneBeats);
  return [
    {
      sceneNo: 1,
      title: stringValue(input.taskInput.sceneTitle) || '场景 1',
      location: '',
      characters: [],
      goal: stringValue(input.taskInput.sceneGoal) || '推进当前章节的核心目标。',
      conflict: '',
      beats: (fallbackBeats.length ? fallbackBeats : ['完成当前场景的核心事件推进。']).map(
        (text, index) => ({
          order: index + 1,
          text,
          required: true,
        }),
      ),
      result: '',
      transition: '',
      contextCapsule: '',
      constraints: [],
      expectedEndState: '',
      targetCharacters: positiveNumber(input.taskInput.targetWordCount),
    },
  ];
}

/**
 * The trained local contract is one request per Beat. A 2,000–3,000 character
 * chapter therefore uses a compact 3–5 Beat plan, with no Scene containing
 * more than three Beats.
 */
export function validateLocalGenerationPlan(
  scenes: ReadonlyArray<Pick<OrchestratedScene, 'sceneNo' | 'beats'>>,
): void {
  const invalid = scenes.filter(
    (scene) => scene.beats.length < 1 || scene.beats.length > MAX_LOCAL_SCENE_BEATS,
  );
  if (invalid.length > 0) {
    throw new Error(
      `每个 Scene 必须包含 1–${MAX_LOCAL_SCENE_BEATS} 个 Beat；` +
        `当前异常场景：${invalid.map((scene) => `Scene ${scene.sceneNo}（${scene.beats.length} 个）`).join('、')}。`,
    );
  }
  const total = scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  if (total < MIN_LOCAL_CHAPTER_BEATS || total > MAX_LOCAL_CHAPTER_BEATS) {
    throw new Error(
      `整章必须包含 ${MIN_LOCAL_CHAPTER_BEATS}–${MAX_LOCAL_CHAPTER_BEATS} 个 Beat，且每个 Beat 单独调用本地模型；` +
        `当前共 ${total} 个。请返回 Scene/Beat 候选编辑后再生成。`,
    );
  }
}

function compact(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : '[前文已压缩]\n' + text.slice(-maxLength);
}

function compactHeadAndTail(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const marker = '\n[中段已压缩]\n';
  const side = Math.max(1, Math.floor((maxLength - marker.length) / 2));
  return text.slice(0, side) + marker + text.slice(-side);
}

function immediateBeatContext(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  acceptedChapterPrefix: string,
): string {
  if (!previous) {
    const frozenChapterContext = input.request.messages
      .map((message) => message.content)
      .join('\n\n');
    return [
      scene.contextCapsule ? '当前场景状态：\n' + compact(scene.contextCapsule, 700) : '',
      '冻结章节上下文（头尾压缩，必须保持人物身份和既有事实）：\n' +
        compactHeadAndTail(
          stringValue(input.taskInput.sceneContext) || frozenChapterContext,
          1_500,
        ),
      `当前 Scene ${scene.sceneNo}：${scene.title}`,
      `当前 Beat ${beat.order}：${beat.text}`,
    ].join('\n\n');
  }
  return [
    `上一生成单元：Scene ${previous.scene.sceneNo} / Beat ${previous.beatOrder}`,
    '本章此前已接受正文（只用于保持事实和衔接，不得复述）：\n' +
      compact(acceptedChapterPrefix || previous.text, 1_800),
    previous.scene.sceneNo !== scene.sceneNo && previous.scene.result
      ? '上一场景结果：' + previous.scene.result
      : '',
    previous.scene.sceneNo !== scene.sceneNo && previous.scene.transition
      ? '原定转场：' + previous.scene.transition
      : '',
    '当前场景：' + scene.title,
    `当前 Beat ${beat.order}：${beat.text}`,
    scene.location ? '当前地点：' + scene.location : '',
    scene.characters.length ? '当前角色：' + scene.characters.join('、') : '',
    scene.conflict ? '当前冲突：' + scene.conflict : '',
    '只承接上一 Beat 已经发生的事实，不回写或重述已有正文。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function sceneConstraints(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  isLastBeatInScene: boolean,
): string[] {
  const constraints = stringList(input.taskInput.sceneConstraints);
  return [
    ...constraints,
    ...scene.constraints,
    scene.location ? '当前地点：' + scene.location : '',
    scene.characters.length ? '当前角色：' + scene.characters.join('、') : '',
    scene.conflict ? '当前冲突：' + scene.conflict : '',
    previous
      ? `承接上一生成单元 Scene ${previous.scene.sceneNo} / Beat ${previous.beatOrder} 的结尾状态。`
      : '',
    `当前只完成 Beat ${beat.order}：${beat.text}`,
    isLastBeatInScene && scene.transition ? '本 Beat 结束后仅推进至：' + scene.transition : '',
    isLastBeatInScene && scene.expectedEndState
      ? '本 Beat 完成时达到：' + scene.expectedEndState
      : '',
    isLastBeatInScene ? '' : '不得提前完成当前 Scene 的最终结果或转场。',
    '只输出当前一个 Beat 的连续正文，不提前写入后续 Beat 或收束整章。',
  ].filter(Boolean);
}

function meaningfulTerms(value: string, chineseWindow = 3): string[] {
  const terms: string[] = [];
  for (const segment of value.match(/[\u4e00-\u9fff]+|[A-Za-z0-9]{3,}/g) ?? []) {
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length <= chineseWindow) {
        terms.push(segment);
      } else {
        for (let index = 0; index <= segment.length - chineseWindow; index += 1) {
          terms.push(segment.slice(index, index + chineseWindow));
        }
      }
    } else {
      terms.push(segment);
    }
  }
  return [...new Set(terms)];
}

function semanticBeatClauses(beatText: string): string[] {
  return beatText
    .split(/[，,；;。！？!?]+/u)
    .map((clause) => clause.replace(/[“”‘’"']/g, '').trim())
    .filter((clause) => narrativeCharacterCount(clause) >= 4);
}

type CoverageActionStatus = 'actual' | 'prospective' | 'negated';

interface CoverageActionFamily {
  id: string;
  terms: readonly string[];
}

interface CoverageActionSignature {
  family: CoverageActionFamily;
  status: CoverageActionStatus;
  index: number;
}

/**
 * These are domain-neutral narrative actions. Objects, roles, places and lore
 * are deliberately learned from each Beat instead of being encoded here.
 */
const GENERIC_COVERAGE_ACTIONS: readonly CoverageActionFamily[] = [
  { id: 'arrive', terms: ['抵达', '到达', '赶到', '来到'] },
  {
    id: 'enter',
    terms: ['进入', '走进', '踏入', '跨入', '潜入', '混进', '闯进', '钻进', '进去', '入内'],
  },
  {
    id: 'leave',
    terms: [
      '推门而出',
      '迈出去',
      '转身走',
      '快步走',
      '穿过',
      '走远',
      '下楼',
      '离开',
      '走出',
      '退出',
      '撤离',
      '逃离',
      '脱身',
      '冲出',
      '出去',
    ],
  },
  { id: 'visit', terms: ['走访', '探访', '拜访', '登门', '造访', '上门'] },
  {
    id: 'record',
    terms: [
      '补录',
      '记下',
      '写下',
      '写入',
      '记入',
      '记进',
      '录入',
      '输入',
      '登记',
      '保存',
      '抄下',
      '默记',
      '记住',
      '录下',
    ],
  },
  { id: 'touch', terms: ['摸到', '摸向', '摸索', '触碰', '接触', '按住', '按在', '探向', '探到', '接入', '插入', '拔开'] },
  { id: 'inspect', terms: ['接受检查', '进行检查', '开始检查', '完成检查', '扫描', '检验', '测试', '启动'] },
  {
    id: 'notice',
    terms: [
      '发现',
      '留意',
      '注意到',
      '盯着',
      '注视',
      '望见',
      '认出',
      '察觉',
      '看见',
      '看到',
      '听见',
      '捕捉',
      '确认',
      '指向',
      '显示',
      '表明',
      '意识到',
      '交汇',
      '汇聚',
      '收束',
      '归拢',
      '串起',
      '串联',
    ],
  },
  {
    id: 'alert',
    terms: [
      '警觉',
      '起疑',
      '怀疑',
      '戒备',
      '警惕',
      '察觉',
      '审视',
      '皱眉',
      '盯住',
      '拦住',
      '挡住',
      '目光',
      '视线',
      '打量',
      '追上',
      '追来',
      '逼近',
      '忽然站起',
      '猛地站起',
    ],
  },
  { id: 'restrict', terms: ['封存', '封锁', '锁定', '归档', '禁止', '拦截', '无权限', '无法修改'] },
  {
    id: 'compare',
    terms: [
      '比对',
      '比较',
      '核对',
      '对照',
      '并表',
      '并成',
      '合并',
      '并排',
      '并列',
      '摊开',
      '摊在',
      '列成',
      '列在',
      '共同点',
      '一致',
      '相同',
      '重合',
      '交汇',
      '汇聚',
      '逐行',
      '逐项',
      '对齐',
      '串起',
      '串联',
    ],
  },
  {
    id: 'disguise',
    terms: ['伪装', '假扮', '冒充', '假称', '乔装', '化装', '改扮', '假名', '装作', '便装', '借口', '为由'],
  },
  {
    id: 'announce',
    terms: [
      '告知',
      '通知',
      '宣布',
      '提醒',
      '表示',
      '通告',
      '口径',
      '回答',
      '回应',
      '回复',
      '建议',
      '要求',
      '强调',
      '研判',
      '说明',
      '称',
      '说',
    ],
  },
] as const;

const COVERAGE_NEGATION =
  /(?:没有|没能|并未|未曾|不曾|从未|不会|不能|无法|未能|拒绝|放弃|停止|取消|并不|不是|没|未|无)[^，,；;。！？!?\n]{0,8}$/u;
const COVERAGE_PROSPECTIVE =
  /(?:可能|也许|或许|似乎|仿佛|假如|如果|以免|避免|防止|差点|险些|准备|打算|计划|决定|尝试|试图|正要|即将|将要|想要|要去)[^；;。！？!?\n]{0,80}$/u;
const COVERAGE_NEGATED_SUFFIX = /^(?:失败|未果|被取消|被中止|没有成功|并未发生)/u;
const COVERAGE_BOUNDARY = /[，,；;。！？!?\n]/u;
const COVERAGE_SENTENCE_BOUNDARY = /[；;。！？!?\n]/u;
const COVERAGE_FUNCTION_BIGRAMS = new Set([
  '他的',
  '她的',
  '他们',
  '她们',
  '这个',
  '那个',
  '一个',
  '已经',
  '随后',
  '然后',
  '同时',
  '开始',
  '出现',
]);

function normalizeBeatCoverageText(value: string): string {
  return value.replace(/\s+/gu, '').replace(/[“”‘’"']/gu, '').toLowerCase();
}

function occurrenceContext(value: string, index: number): { prefix: string; suffix: string } {
  let start = index;
  while (start > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(value[start - 1])) start -= 1;
  return {
    prefix: value.slice(Math.max(start, index - 96), index),
    suffix: value.slice(index, index + 16),
  };
}

function actionStatusAt(value: string, index: number): CoverageActionStatus {
  const context = occurrenceContext(value, index);
  if (COVERAGE_NEGATION.test(context.prefix) || COVERAGE_NEGATED_SUFFIX.test(context.suffix)) {
    return 'negated';
  }
  return COVERAGE_PROSPECTIVE.test(context.prefix) ? 'prospective' : 'actual';
}

function actionOccurrences(
  value: string,
  family: CoverageActionFamily,
): Array<{ index: number; end: number; status: CoverageActionStatus }> {
  const occurrences: Array<{ index: number; end: number; status: CoverageActionStatus }> = [];
  for (const term of [...family.terms].sort((left, right) => right.length - left.length)) {
    let cursor = 0;
    while (cursor < value.length) {
      const index = value.indexOf(term, cursor);
      if (index < 0) break;
      occurrences.push({ index, end: index + term.length, status: actionStatusAt(value, index) });
      cursor = index + Math.max(1, term.length);
    }
  }
  if (family.id === 'enter') {
    const singleCharacterEntry =
      /(?:本人|人物|主角|他|她|我|你|者|便|就|要|想|将|再|径直|直接)进(?!行|度|展|程|阶|取|攻|步|化|修|一)(?=[\u4e00-\u9fffA-Za-z0-9])/gu;
    for (const match of value.matchAll(singleCharacterEntry)) {
      const index = match.index + match[0].lastIndexOf('进');
      occurrences.push({ index, end: index + 1, status: actionStatusAt(value, index) });
    }
  }
  if (family.id === 'disguise') {
    const contextualDisguise =
      /(?:以|用)[^，,；;。！？!?\n]{0,16}(?:身份|名义)|(?:假|化)[^，,；;。！？!?\n]{0,8}(?:名字|身份|证件)|换(?:下|上|了)?[^，,；;。！？!?\n]{0,16}(?:衣|衫|裙|袍|褂|甲|帽|发|妆|装束)|看起来像/gu;
    for (const match of value.matchAll(contextualDisguise)) {
      const index = match.index;
      occurrences.push({
        index,
        end: index + match[0].length,
        status: actionStatusAt(value, index),
      });
    }
  }
  return occurrences.sort((left, right) => left.index - right.index || right.end - left.end);
}

function actionSignatures(value: string): CoverageActionSignature[] {
  const normalized = normalizeBeatCoverageText(value);
  return GENERIC_COVERAGE_ACTIONS.flatMap((family) => {
    const first = actionOccurrences(normalized, family)[0];
    return first ? [{ family, status: first.status, index: first.index }] : [];
  }).sort((left, right) => left.index - right.index);
}

function requiredCompletedActions(beatText: string): CoverageActionFamily[] {
  const excluded = new Set(['notice', 'alert', 'announce', 'compare', 'arrive']);
  const planned = actionSignatures(beatText).filter(
    (signature) => signature.status === 'prospective' && !excluded.has(signature.family.id),
  );
  const terminal = planned[planned.length - 1];
  return terminal ? [terminal.family] : [];
}

function beatRequiresCompletedAction(beatText: string): boolean {
  return requiredCompletedActions(beatText).length > 0;
}

export function externalBeatRepairCompletionChecklist(beatText: string): string {
  const clauses = semanticBeatClauses(beatText);
  const requiredClauses = clauses.length ? clauses : [beatText.trim()];
  const requiresCompletedAction = beatRequiresCompletedAction(beatText);
  return [
    'Required 事件执行清单（必须按顺序写成已经发生的小说事实，不得复述成提纲）：',
    ...requiredClauses.map(
      (clause, index) => `- 第 ${Math.min(index + 1, 5)} 段结束前必须完成：${clause}`,
    ),
    '完成态硬门槛：决定、准备、在路上、接近目标、观察、尝试、正要执行或即将执行，都不算对应动作已经完成。',
    requiresCompletedAction
      ? '本 Beat 含先表达意图、再完成行动的结果：必须继续写到计划中的核心动作已经实际发生，并呈现动作造成的可观察状态变化；停在决定、准备、途中、抵达、观察或即将执行均不合格。'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function statusSatisfies(required: CoverageActionStatus, actual: CoverageActionStatus): boolean {
  if (required === 'negated') return actual === 'negated';
  if (required === 'prospective') return actual !== 'negated';
  return actual === 'actual';
}

const CONTRADICTION_SENSITIVE_ACTION_IDS = new Set([
  'enter',
  'record',
  'touch',
  'alert',
]);

const STRONG_ALERT_TERMS = new Set([
  '起疑',
  '警觉',
  '怀疑',
  '戒备',
  '警惕',
  '察觉',
  '审视',
  '皱眉',
  '拦住',
  '挡住',
  '追上',
  '追来',
  '逼近',
]);

function alertEvidenceSatisfies(
  occurrence: { index: number; end: number; status: CoverageActionStatus },
  candidate: string,
): boolean {
  const term = candidate.slice(occurrence.index, occurrence.end);
  if (occurrence.status !== 'actual') return false;
  if (STRONG_ALERT_TERMS.has(term)) return true;
  if (!/^(?:目光|视线|盯住|打量)$/u.test(term)) return false;
  const context = candidate.slice(
    Math.max(0, occurrence.index - 32),
    Math.min(candidate.length, occurrence.end + 72),
  );
  return /(?:移到|落在|扫过|停在|盯住|打量|查看|检查|接口|通道|痕迹|手上|缩回|异样|波动|干扰|起身|走近|靠近|拦|挡|追)/u.test(
    context,
  );
}

function flexibleObservationSatisfies(
  signature: CoverageActionSignature,
  occurrence: { index: number; end: number; status: CoverageActionStatus },
  candidate: string,
): boolean {
  if (
    signature.status !== 'actual' ||
    occurrence.status !== 'prospective'
  ) {
    return false;
  }
  const context = candidate.slice(
    Math.max(0, occurrence.index - 72),
    Math.min(candidate.length, occurrence.end + 96),
  );
  if (['notice', 'alert'].includes(signature.family.id)) {
    return /(?:异样|变化|反应|目光|视线|眉|皱|屏幕|波形|频率|节奏|信号|声音|脚步|门口|走廊|离开|走出|冲出)/u.test(
      context,
    );
  }
  return (
    signature.family.id === 'restrict' &&
    /(?:弹出|显示|屏幕|灰|锁|无法|提示|归档|封存|封锁)/u.test(context)
  );
}

function implicitCoverageSatisfies(
  signature: CoverageActionSignature,
  clause: string,
  candidate: string,
): boolean {
  if (signature.status === 'negated') return false;
  if (signature.family.id === 'compare') {
    // Compare/aggregation is often narrated without the exact planning verb
    // from the Beat (for example, records are laid out side by side and their
    // common destination is discovered). Accept those canonical prose forms
    // while still requiring an evidence-bearing organization/comparison cue.
    return /(?:并排|并列|并成|摊开|摊在|铺开|摆在|列在|列成|排成|逐行|逐项|一一(?:核对|比对|对齐)|对齐|交汇|汇聚|收束|共同点|唯一(?:的)?共同|放在一起|合在一起|串起|串联|归拢|整理成)[^，,；;。！？!?\n]{0,32}(?:表|记录|证词|案例|名字|地址|时间|症状|共同|交集|同一|诊所|地点|线索|一处|一起|纸|桌)/u.test(
      candidate,
    );
  }
  if (signature.family.id === 'disguise') {
    const contradicted = /(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:进入|检查|扫描|检测|启用|启动|戴|贴)/u.test(
      candidate,
    );
    return (
      !contradicted &&
      /(?:患者|病人|病历|挂号|失眠|症状|就诊|检查室|检查床|检测椅|躺椅|电极)/u.test(
        candidate,
      ) &&
      /(?:配合|坐下|坐进|躺|贴|戴|接受|检查|扫描|仪器|启动)/u.test(candidate)
    );
  }
  if (signature.family.id === 'notice') {
    const terms = lexicalTerms(clause);
    const matchedTerms = terms.filter((term) => candidate.includes(term)).length;
    const contradicted = /(?:没有|未|并未|没能)[^，,；;。！？!?\n]{0,16}(?:发现|留意|注意|看见|看到|听见|捕捉|确认|察觉)/u.test(
      candidate,
    );
    const discoveryCue = /(?:唯一|共同|交集|重合|归纳|得出|交汇|汇聚|收束|指向|串起|串联|同一|一致|相同)/u.test(
      candidate,
    );
    return (
      !contradicted &&
      matchedTerms >= (discoveryCue ? 1 : Math.min(2, terms.length)) &&
      /(?:目光|视线|眼|瞳孔|耳|屏幕|波形|频率|节奏|信号|声音|灯|变化|一样|相同|吻合|唯一|共同|交集|重合|归纳|得出)/u.test(
        candidate,
      )
    );
  }
  if (signature.family.id === 'leave') {
    const contradicted = /(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:离开|走出|出去|下楼|冲出|迈出|推开|拉开)/u.test(
      candidate,
    );
    return (
      !contradicted &&
      /(?:推|拉|打开)[^，,；;。！？!?\n]{0,10}门[^，,；;。！？!?\n]{0,24}(?:走|冲|迈|踏|进入)[^，,；;。！？!?\n]{0,20}(?:夜风|室外|户外|街|巷|人群|阳光|雨|雪)/u.test(
        candidate,
      )
    );
  }
  if (signature.family.id === 'record') {
    return (
      !/(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:录进|录到|存进|保存到|写进)/u.test(
        candidate,
      ) && /(?:录进|录到|存进|保存到|写进)/u.test(candidate)
    );
  }
  if (signature.family.id === 'compare') {
    return /(?:并成|列成|整理成|汇成|排成|做成)[^，,；;。！？!?\n]{0,16}(?:表|清单|列表)|逐项(?:核对|对齐|比对)/u.test(
      candidate,
    );
  }
  return false;
}

const POSITIVE_POLICY_CUE =
  /(?:维稳|涉稳|影响稳定|稳定(?:工作|需要|要求)|理性看待|不要(?:过度)?恐慌|避免(?:引起)?恐慌|统一(?:口径|说法|表述|回复|处理)|同样(?:说法|回复)|反复强调|按流程处理|不用操心|不要乱传|禁止外传|正常现象|官方口径)/gu;

function hasPositivePolicyCue(candidate: string): boolean {
  for (const match of candidate.matchAll(POSITIVE_POLICY_CUE)) {
    const index = match.index ?? 0;
    let sentenceStart = index;
    while (sentenceStart > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(candidate[sentenceStart - 1])) {
      sentenceStart -= 1;
    }
    const prefix = candidate.slice(sentenceStart, index);
    if (/(?:想起|回想|记起|那句|提到|曾经|听说|转述)/u.test(prefix)) continue;
    if (/(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}$/u.test(prefix)) continue;
    return true;
  }
  return false;
}

function requiredSemanticAnchorsCovered(clause: string, candidate: string): boolean {
  if (/(?:口径|统一说法|统一表述)/u.test(clause)) {
    // Official euphemisms are commonly paraphrased in prose. A bare mention
    // of "口径" is not enough: the candidate must contain a positive policy /
    // stability statement, and an explicitly negated statement must not be
    // the only evidence.
    if (!hasPositivePolicyCue(candidate)) return false;
    if (
      /(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}(?:提出|出现|提供|形成|统一)?[^，,；;。！？!?\n]{0,12}(?:口径|维稳|涉稳|稳定|恐慌|说法|表述)/u.test(
        candidate,
      ) &&
      !hasPositivePolicyCue(
        candidate.replace(
          /(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}(?:提出|出现|提供|形成|统一)?[^，,；;。！？!?\n]{0,12}(?:口径|维稳|涉稳|稳定|恐慌|说法|表述)/gu,
          '',
        ),
      )
    ) {
      return false;
    }
  }
  return true;
}

function lexicalTerms(value: string): string[] {
  return meaningfulTerms(normalizeBeatCoverageText(value), 2).filter(
    (term) => !COVERAGE_FUNCTION_BIGRAMS.has(term),
  );
}

function lexicalEvidenceCount(clause: string, candidate: string): number {
  const terms = lexicalTerms(clause);
  return terms.filter((term) => candidate.includes(term)).length;
}

function visitEstablishedByPresence(clause: string, candidate: string): boolean {
  if (lexicalEvidenceCount(clause, candidate) < 1) return false;
  const contradicted = ['visit', 'arrive', 'enter'].some((id) => {
    const family = GENERIC_COVERAGE_ACTIONS.find((action) => action.id === id);
    return family
      ? actionOccurrences(candidate, family).some((occurrence) => occurrence.status === 'negated')
      : false;
  });
  if (
    contradicted ||
    /(?:门外|屋外|室外|场外|远处|远远|隔着)/u.test(candidate) ||
    /(?:没有|未|并未|只)[^，,；;。！？!?\n]{0,12}(?:走近|靠近|接近|交谈|说话|询问|拜访|走访|见面)/u.test(
      candidate,
    ) ||
    /(?:没有|未|并未)[^，,；;。！？!?\n]{0,20}(?:见到|见面|上楼|敲门)/u.test(candidate)
  ) {
    return false;
  }
  if (!/(?:家(?:中|里)?|住处|住所|屋里|屋内|房间|现场|营地|办公室|店内|舱内|门槛)/u.test(candidate)) {
    return false;
  }
  const arrive = GENERIC_COVERAGE_ACTIONS.find((action) => action.id === 'arrive');
  return (
    /(?:见我来了|我来了|我来|来到|迎接|招呼|交谈|询问|问|递给|让座|走近|靠近|蹲下|坐下|给[^，,；;。！？!?\n]{0,12}(?:倒|递|拿|端))/u.test(
      candidate,
    ) ||
    Boolean(
      arrive &&
        actionOccurrences(candidate, arrive).some((occurrence) => occurrence.status === 'actual'),
    )
  );
}

function clauseCoveredByCandidate(clause: string, candidate: string): boolean {
  const normalizedClause = normalizeBeatCoverageText(clause);
  const normalizedCandidate = normalizeBeatCoverageText(candidate);
  const signatures = actionSignatures(normalizedClause);

  for (const signature of signatures) {
    const occurrences = actionOccurrences(normalizedCandidate, signature.family);
    if (
      signature.family.id === 'alert' &&
      signature.status === 'actual' &&
      !occurrences.some(
        (occurrence) =>
          alertEvidenceSatisfies(occurrence, normalizedCandidate) ||
          flexibleObservationSatisfies(signature, occurrence, normalizedCandidate),
      )
    ) {
      return false;
    }
    if (
      occurrences.some(
        (occurrence) =>
          statusSatisfies(signature.status, occurrence.status) ||
          flexibleObservationSatisfies(signature, occurrence, normalizedCandidate),
      )
    ) {
      continue;
    }
    if (
      signature.family.id === 'visit' &&
      signature.status !== 'negated' &&
      !occurrences.some((occurrence) => occurrence.status === 'negated') &&
      visitEstablishedByPresence(normalizedClause, normalizedCandidate)
    ) {
      continue;
    }
    if (
      !occurrences.some((occurrence) => occurrence.status === 'negated') &&
      implicitCoverageSatisfies(signature, normalizedClause, normalizedCandidate)
    ) {
      continue;
    }
    return false;
  }

  const terms = lexicalTerms(normalizedClause);
  if (!terms.length) return signatures.length > 0;
  const matchedTerms = terms.filter((term) => normalizedCandidate.includes(term)).length;
  const requiredMatches =
    signatures.length >= 2
      ? 0
      : signatures.length === 1
        ? Math.min(1, terms.length)
        : Math.min(2, terms.length);
  if (matchedTerms < requiredMatches) return false;

  if (
    signatures.length === 0 &&
    !COVERAGE_NEGATION.test(normalizedClause) &&
    /(?:没有|并未|未曾|不曾|从未|未能|无法)/u.test(normalizedCandidate) &&
    matchedTerms < Math.min(3, terms.length)
  ) {
    return false;
  }
  return requiredSemanticAnchorsCovered(normalizedClause, normalizedCandidate);
}

export function clauseCoverageEnd(
  normalizedText: string,
  clause: string,
  fromIndex: number,
  minimumEnd = fromIndex,
): number | undefined {
  const boundaries: number[] = [];
  for (let index = fromIndex; index < normalizedText.length; index += 1) {
    if (COVERAGE_BOUNDARY.test(normalizedText[index])) boundaries.push(index + 1);
  }
  if (boundaries[boundaries.length - 1] !== normalizedText.length) boundaries.push(normalizedText.length);
  return boundaries.find(
    (end) =>
      end > minimumEnd && clauseCoveredByCandidate(clause, normalizedText.slice(fromIndex, end)),
  );
}

function previousCoverageBoundary(value: string, beforeIndex: number): number {
  let index = Math.max(0, beforeIndex - 1);
  while (index > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(value[index - 1])) index -= 1;
  return index;
}

function clauseCoverageEnds(
  normalizedText: string,
  clause: string,
  fromIndex: number,
  minimumEnd: number,
): number[] {
  const endSet = new Set<number>();
  for (let index = fromIndex; index < normalizedText.length; index += 1) {
    if (COVERAGE_BOUNDARY.test(normalizedText[index])) endSet.add(index + 1);
  }
  const normalizedClause = normalizeBeatCoverageText(clause);
  const terms = [
    ...lexicalTerms(normalizedClause),
    ...actionSignatures(normalizedClause).flatMap((signature) => signature.family.terms),
  ];
  for (const term of terms) {
    let cursor = fromIndex;
    while (cursor < normalizedText.length) {
      const index = normalizedText.indexOf(term, cursor);
      if (index < 0) break;
      endSet.add(index + term.length);
      cursor = index + Math.max(1, term.length);
    }
  }
  endSet.add(normalizedText.length);
  return [...endSet].sort((left, right) => left - right).filter(
    (end) =>
      end > minimumEnd && clauseCoveredByCandidate(clause, normalizedText.slice(fromIndex, end)),
  );
}

function hasCompleteOrderedCoverage(
  normalizedText: string,
  clauses: readonly string[],
  clauseIndex: number,
  cursor: number,
  memo: Map<string, boolean>,
): boolean {
  if (clauseIndex >= clauses.length) return true;
  const key = `${clauseIndex}:${cursor}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const clause = clauses[clauseIndex];
  if (clauseHasUnresolvedContradiction(clause, normalizedText)) {
    memo.set(key, false);
    return false;
  }
  const searchStart = previousCoverageBoundary(normalizedText, cursor);
  for (const end of clauseCoverageEnds(normalizedText, clause, searchStart, cursor)) {
    if (hasCompleteOrderedCoverage(normalizedText, clauses, clauseIndex + 1, end, memo)) {
      memo.set(key, true);
      return true;
    }
  }
  memo.set(key, false);
  return false;
}

function clauseHasUnresolvedContradiction(clause: string, fullText: string): boolean {
  const terms = lexicalTerms(clause);
  return actionSignatures(clause).some((signature) => {
    if (
      signature.status === 'negated' ||
      !CONTRADICTION_SENSITIVE_ACTION_IDS.has(signature.family.id)
    ) {
      return false;
    }
    const occurrences = actionOccurrences(fullText, signature.family);
    if (signature.family.id === 'alert') {
      const strong = occurrences.filter((occurrence) =>
        /^(?:起疑|警觉|怀疑|戒备|警惕|察觉|审视|皱眉|拦住|挡住|追上|追来|逼近|忽然站起|猛地站起)$/u.test(
          fullText.slice(occurrence.index, occurrence.end),
        ),
      );
      if (strong.length > 0 && strong[strong.length - 1]?.status === 'negated') return true;
    }
    const relevant = occurrences.filter((occurrence) => {
      const context = fullText.slice(
        Math.max(0, occurrence.index - 64),
        Math.min(fullText.length, occurrence.end + 64),
      );
      const matched = terms.filter((term) => context.includes(term)).length;
      return matched >= Math.min(1, terms.length);
    });
    if (signature.family.id === 'enter' && relevant.some((item) => item.status === 'negated')) {
      return true;
    }
    return relevant.length > 0 && relevant[relevant.length - 1]?.status === 'negated';
  });
}

function missingBeatClauses(normalized: string, beatText: string): string[] {
  const normalizedText = normalizeBeatCoverageText(normalized);
  const clauses = semanticBeatClauses(beatText);
  if (!clauses.length) return [];
  if (hasCompleteOrderedCoverage(normalizedText, clauses, 0, 0, new Map())) return [];

  const missing: string[] = [];
  let cursor = 0;
  for (const clause of clauses) {
    // A Beat clause may share a sentence with the preceding clause. Start at
    // that sentence boundary, while the action matcher below still enforces
    // core-action order inside the coverage window.
    const searchStart = previousCoverageBoundary(normalizedText, cursor);
    const end = clauseCoverageEnd(normalizedText, clause, searchStart, cursor);
    if (end === undefined) {
      missing.push(clause);
      continue;
    }
    if (clauseHasUnresolvedContradiction(clause, normalizedText)) {
      missing.push(clause);
    }
    cursor = end;
  }
  return missing;
}

function beatCovered(normalized: string, beatText: string): boolean {
  return missingBeatClauses(normalized, beatText).length === 0;
}

function externalRepairBeatCovered(normalized: string, beatText: string): boolean {
  if (!beatCovered(normalized, beatText)) return false;
  const text = normalizeBeatCoverageText(normalized);
  return requiredCompletedActions(beatText).every((family) =>
    actionOccurrences(text, family).some((occurrence) => occurrence.status === 'actual'),
  );
}

export function validateSceneText(
  text: string,
  scene: {
    sceneNo: number;
    beats: ReadonlyArray<{ text: string; required: boolean }>;
  },
  finishReason?: string,
  minimumCharacters?: number,
  maximumCharacters?: number,
): void {
  const normalized = text.trim();
  if (!normalized) throw new Error('Scene ' + scene.sceneNo + ' 返回空正文。');
  if (normalized.includes('<think>') || normalized.includes('</think>')) {
    throw new Error('Scene ' + scene.sceneNo + ' 返回了思考过程，未采纳。');
  }
  if (finishReason === 'length') {
    throw new Error('Scene ' + scene.sceneNo + ' 在输出上限处截断，未采纳。');
  }
  const metaLeakage = normalizedParagraphs(normalized).find((paragraph) =>
    /(?:互动基调|短期目标|为后续.{0,12}铺垫|本章目标|场景目标|写作要求|提纲)/.test(
      paragraph.normalized,
    ),
  );
  if (metaLeakage) {
    throw new Error('Scene ' + scene.sceneNo + ' 混入了提纲或写作指令，未采纳。');
  }
  const copiedBeatInstruction = scene.beats.find((beat) => {
    const instruction = beat.text.replace(/\s+/g, '');
    return (
      instruction.length >= 12 &&
      normalizedParagraphs(normalized).some((paragraph) => paragraph.normalized === instruction)
    );
  });
  if (copiedBeatInstruction) {
    throw new Error('Scene ' + scene.sceneNo + ' 原样输出了 Beat 规划句，未采纳。');
  }
  if (/(?:（?本章完）?|（?全文完）?)/.test(normalized)) {
    throw new Error('Scene ' + scene.sceneNo + ' 提前输出章节结束标记，未采纳。');
  }
  const characterCount = narrativeCharacterCount(normalized);
  if (minimumCharacters && minimumCharacters > 0 && characterCount < minimumCharacters) {
    throw new Error(
      'Scene ' + scene.sceneNo + ' 正文不足最低篇幅 ' + minimumCharacters + ' 字，未采纳。',
    );
  }
  if (maximumCharacters && maximumCharacters > 0 && characterCount > maximumCharacters) {
    throw new Error(
      'Scene ' + scene.sceneNo + ' 正文超过最高篇幅 ' + maximumCharacters + ' 字，未采纳。',
    );
  }
  validateSceneRepetition(normalized, scene.sceneNo);
  const required = scene.beats.filter((beat) => beat.required);
  const missing = required
    .map((beat) => ({ beat, clauses: missingBeatClauses(normalized, beat.text) }))
    .filter((item) => item.clauses.length > 0);
  if (missing.length > 0) {
    throw new Error(
      'Scene ' +
        scene.sceneNo +
        ' 未覆盖必需 Beat：' +
        missing
          .map(
            ({ beat, clauses }) =>
              beat.text + (clauses.length ? `（缺少分句：${clauses.join(' / ')}）` : ''),
          )
          .join('；') +
        '，未采纳。',
    );
  }
}

function stateAnchorTerms(
  scene: Pick<OrchestratedScene, 'result' | 'transition' | 'expectedEndState'>,
): string[] {
  return meaningfulTerms(
    [scene.result, scene.transition, scene.expectedEndState].filter(Boolean).join(' '),
  );
}

export function validateSceneContinuity(
  previous: Pick<OrchestratedScene, 'result' | 'transition' | 'expectedEndState'>,
  currentText: string,
): void {
  const anchors = stateAnchorTerms(previous);
  if (!anchors.length) return;
  const normalized = currentText.trim();
  if (!anchors.some((anchor) => normalized.includes(anchor))) {
    throw new Error('当前 Scene 未承接上一 Scene 的结果、转场或预期结束状态，未采纳。');
  }
}

/**
 * The local model contract is deliberately bounded: one initial generation
 * plus one rewrite of the same Beat. A truncated response is never continued
 * in-place because the model was trained to close one Beat before 1024 tokens.
 */
export const MAX_LOCAL_BEAT_ATTEMPTS = 2;
/** @deprecated Kept for compatibility with existing callers and tests. */
export const MAX_LOCAL_SCENE_ATTEMPTS = MAX_LOCAL_BEAT_ATTEMPTS;
export const MIN_LOCAL_BEAT_CHARACTERS = 500;
export const MAX_LOCAL_BEAT_CHARACTERS = 900;
const CONTINUATION_CONTEXT_TAIL_CHARS = 600;
const MAX_CONTINUATION_REUSED_RATIO = 0.35;
const MIN_CONTINUATION_REUSED_CHARS = 160;

export function narrativeCharacterCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) ?? []).reduce(
    (sum, part) => sum + (/^[A-Za-z0-9]+$/.test(part) ? 1 : part.length),
    0,
  );
}

const NATURAL_SENTENCE_ENDS = new Set(['。', '！', '？', '!', '?', '…']);
const NATURAL_SENTENCE_CLOSERS = new Set(['”', '’', '」', '』', '》', '）', ')', '】', ']']);

interface NaturalSentenceUnit {
  paragraphIndex: number;
  text: string;
}

const MAX_EXTERNAL_REPAIR_SUBSET_STATES = 120_000;

function naturalSentenceUnits(text: string): NaturalSentenceUnit[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph, paragraphIndex) => {
      const units: NaturalSentenceUnit[] = [];
      let start = 0;
      for (let index = 0; index < paragraph.length; index += 1) {
        const character = paragraph[index];
        if (!NATURAL_SENTENCE_ENDS.has(character)) continue;
        if (character === '…' && paragraph[index + 1] === '…') continue;

        let end = index + 1;
        while (end < paragraph.length && NATURAL_SENTENCE_CLOSERS.has(paragraph[end])) {
          end += 1;
        }
        const sentence = paragraph.slice(start, end).trim();
        if (sentence) units.push({ paragraphIndex, text: sentence });
        start = end;
        index = end - 1;
      }
      return units;
    });
}

function sentenceUnitsText(units: ReadonlyArray<NaturalSentenceUnit>): string {
  const paragraphs: string[] = [];
  let paragraphIndex = -1;
  for (const unit of units) {
    if (unit.paragraphIndex !== paragraphIndex) {
      paragraphs.push(unit.text);
      paragraphIndex = unit.paragraphIndex;
    } else {
      paragraphs[paragraphs.length - 1] += unit.text;
    }
  }
  return paragraphs.join('\n\n');
}

/**
 * Find a bounded ordered subset of complete prose units when a provider has
 * included more material than the Beat envelope permits. The search keeps
 * source order, prefers retaining the opening and closing units, and always
 * re-runs the semantic Beat gate on the assembled candidate.
 */
function boundedExternalRepairSubsetSearch<T>(
  units: ReadonlyArray<T>,
  render: (selected: ReadonlyArray<T>) => string,
  minimumCharacters: number,
  maximumCharacters: number,
  requiredBeatText: string,
): string | undefined {
  if (units.length < 2) return undefined;

  const weights = units.map((unit) => narrativeCharacterCount(render([unit])));
  const suffixWeights = new Array<number>(units.length + 1).fill(0);
  for (let index = units.length - 1; index >= 0; index -= 1) {
    suffixWeights[index] = suffixWeights[index + 1] + weights[index];
  }

  let visited = 0;
  let best:
    | { text: string; characterCount: number; retainedCount: number; gapCount: number }
    | undefined;

  const isBetter = (candidate: {
    characterCount: number;
    retainedCount: number;
    gapCount: number;
  }): boolean => {
    if (!best) return true;
    if (candidate.characterCount !== best.characterCount) {
      return candidate.characterCount > best.characterCount;
    }
    if (candidate.retainedCount !== best.retainedCount) {
      return candidate.retainedCount > best.retainedCount;
    }
    return candidate.gapCount < best.gapCount;
  };

  const consider = (selected: ReadonlyArray<T>, indexes: ReadonlyArray<number>): void => {
    const text = render(selected).trim();
    const characterCount = narrativeCharacterCount(text);
    if (
      characterCount < minimumCharacters ||
      characterCount > maximumCharacters ||
      !externalRepairBeatCovered(text, requiredBeatText)
    ) {
      return;
    }
    let gapCount = 0;
    for (let index = 1; index < indexes.length; index += 1) {
      gapCount += Math.max(0, indexes[index] - indexes[index - 1] - 1);
    }
    const candidate = {
      text,
      characterCount,
      retainedCount: selected.length,
      gapCount,
    };
    if (isBetter(candidate)) best = candidate;
  };

  const run = (preserveEndpoints: boolean): void => {
    if (units.length < 2) return;
    const initialIndexes = preserveEndpoints ? [0] : [];
    const initialUnits = preserveEndpoints ? [units[0]] : [];
    const initialCount = preserveEndpoints ? weights[0] : 0;
    const lastIndex = units.length - 1;
    if (initialCount > maximumCharacters) return;

    const visit = (
      index: number,
      currentCount: number,
      indexes: number[],
      selected: T[],
    ): void => {
      if (visited >= MAX_EXTERNAL_REPAIR_SUBSET_STATES) return;
      visited += 1;
      if (currentCount > maximumCharacters) return;
      if (currentCount + suffixWeights[index] < minimumCharacters) return;

      if (index >= lastIndex) {
        if (preserveEndpoints) {
          if (indexes[indexes.length - 1] !== lastIndex) {
            consider(
              [...selected, units[lastIndex]],
              [...indexes, lastIndex],
            );
          } else {
            consider(selected, indexes);
          }
        } else if (index === lastIndex) {
          // The last unit is optional in the unconstrained pass.
          consider(selected, indexes);
          if (currentCount + weights[lastIndex] <= maximumCharacters) {
            consider([...selected, units[lastIndex]], [...indexes, lastIndex]);
          }
        }
        return;
      }

      // Include before exclude so the best candidate is usually found early.
      if (currentCount + weights[index] <= maximumCharacters) {
        visit(index + 1, currentCount + weights[index], [...indexes, index], [...selected, units[index]]);
      }
      visit(index + 1, currentCount, indexes, selected);
    };

    visit(
      preserveEndpoints ? 1 : 0,
      initialCount,
      initialIndexes,
      initialUnits,
    );
  };

  run(true);
  if (!best) run(false);
  return best?.text;
}

function compactExternalRepairSentences(
  text: string,
  minimumCharacters: number,
  maximumCharacters: number,
  requiredBeatText: string,
): string | undefined {
  const allUnits = naturalSentenceUnits(text);
  let retained = allUnits;
  if (
    retained.length < 3 ||
    !externalRepairBeatCovered(sentenceUnitsText(retained), requiredBeatText)
  ) {
    return undefined;
  }

  while (narrativeCharacterCount(sentenceUnitsText(retained)) > maximumCharacters) {
    const candidates = retained
      .map((_, index) => {
        const units = retained.filter((__, candidateIndex) => candidateIndex !== index);
        const candidateText = sentenceUnitsText(units);
        const characterCount = narrativeCharacterCount(candidateText);
        return { units, candidateText, characterCount };
      })
      .filter(
        (candidate) =>
          candidate.characterCount >= minimumCharacters &&
          externalRepairBeatCovered(candidate.candidateText, requiredBeatText),
      )
      .sort((left, right) => {
        const leftFits = left.characterCount <= maximumCharacters;
        const rightFits = right.characterCount <= maximumCharacters;
        if (leftFits !== rightFits) return leftFits ? -1 : 1;
        if (leftFits) return right.characterCount - left.characterCount;
        return left.characterCount - right.characterCount;
      });
    const next = candidates[0];
    if (!next) {
      return boundedExternalRepairSubsetSearch(
        allUnits,
        sentenceUnitsText,
        minimumCharacters,
        maximumCharacters,
        requiredBeatText,
      );
    }
    retained = next.units;
  }

  const compacted = sentenceUnitsText(retained);
  const compactedCount = narrativeCharacterCount(compacted);
  if (compactedCount >= minimumCharacters && compactedCount <= maximumCharacters) {
    return compacted;
  }
  return boundedExternalRepairSubsetSearch(
    allUnits,
    sentenceUnitsText,
    minimumCharacters,
    maximumCharacters,
    requiredBeatText,
  );
}

/**
 * An external repair may finish normally but overrun the dynamic Beat ceiling.
 * In that one case, keep only a complete sentence or paragraph that still fits
 * the hard envelope. The caller must rerun all semantic acceptance checks on
 * the returned text before it can be merged into the chapter.
 */
export function trimExternalBeatRepairAtNaturalBoundary(
  text: string,
  finishReason: string | undefined,
  minimumCharacters: number,
  maximumCharacters: number,
  requiredBeatText?: string,
): string {
  const normalized = text.trim();
  if (finishReason !== 'stop' || narrativeCharacterCount(normalized) <= maximumCharacters) {
    return normalized;
  }

  let repairSource = normalized;
  let paragraphs = normalized
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (requiredBeatText && externalRepairBeatCovered(normalized, requiredBeatText)) {
    for (let index = 0; index < paragraphs.length; index += 1) {
      const prefix = paragraphs.slice(0, index + 1).join('\n\n');
      if (!externalRepairBeatCovered(prefix, requiredBeatText)) continue;
      const prefixCount = narrativeCharacterCount(prefix);
      if (prefixCount < minimumCharacters) continue;
      repairSource = prefix;
      paragraphs = paragraphs.slice(0, index + 1);
      if (prefixCount >= minimumCharacters && prefixCount <= maximumCharacters) return prefix;
      break;
    }
  }
  if (
    requiredBeatText &&
    paragraphs.length >= 3 &&
    externalRepairBeatCovered(repairSource, requiredBeatText)
  ) {
    let retained = paragraphs.map((paragraph, index) => ({
      paragraph,
      index,
      characterCount: narrativeCharacterCount(paragraph),
    }));
    const protectedIndexes = new Set([0, paragraphs.length - 1]);
    while (
      retained.length >= 3 &&
      narrativeCharacterCount(retained.map((item) => item.paragraph).join('\n\n')) >
        maximumCharacters
    ) {
      const removable = retained
        .filter((item) => !protectedIndexes.has(item.index))
        .sort(
          (left, right) => right.characterCount - left.characterCount || left.index - right.index,
        );
      let removed = false;
      for (const candidate of removable) {
        const next = retained.filter((item) => item.index !== candidate.index);
        const nextText = next.map((item) => item.paragraph).join('\n\n');
        if (narrativeCharacterCount(nextText) < minimumCharacters) continue;
        if (!externalRepairBeatCovered(nextText, requiredBeatText)) continue;
        retained = next;
        removed = true;
        break;
      }
      if (!removed) break;
    }

    const compacted = retained.map((item) => item.paragraph).join('\n\n');
    const compactedCount = narrativeCharacterCount(compacted);
    if (compactedCount >= minimumCharacters && compactedCount <= maximumCharacters) {
      return compacted;
    }
  }

  if (requiredBeatText && externalRepairBeatCovered(repairSource, requiredBeatText)) {
    const sentenceCompacted = compactExternalRepairSentences(
      repairSource,
      minimumCharacters,
      maximumCharacters,
      requiredBeatText,
    );
    if (sentenceCompacted) return sentenceCompacted;

    const paragraphCompacted = boundedExternalRepairSubsetSearch(
      paragraphs,
      (selected) => selected.join('\n\n'),
      minimumCharacters,
      maximumCharacters,
      requiredBeatText,
    );
    if (paragraphCompacted) return paragraphCompacted;
  }

  const boundaries: number[] = [];
  for (let index = 0; index < repairSource.length; index += 1) {
    const character = repairSource[index];
    if (character === '\n') {
      boundaries.push(index);
      continue;
    }
    if (!NATURAL_SENTENCE_ENDS.has(character)) continue;
    if (character === '…' && repairSource[index + 1] === '…') continue;

    let end = index + 1;
    while (end < repairSource.length && NATURAL_SENTENCE_CLOSERS.has(repairSource[end])) {
      end += 1;
    }
    boundaries.push(end);
  }

  let candidate = '';
  for (const end of boundaries) {
    const prefix = repairSource.slice(0, end).trim();
    const count = narrativeCharacterCount(prefix);
    if (
      count >= minimumCharacters &&
      count <= maximumCharacters &&
      (!requiredBeatText || externalRepairBeatCovered(prefix, requiredBeatText))
    ) {
      candidate = prefix;
    }
  }
  if (!candidate) {
    throw new Error(
      `外部 AI 修稿超过最高篇幅 ${maximumCharacters} 字，且在 ${minimumCharacters}–${maximumCharacters} 字之间没有可安全收束的完整句或段落。`,
    );
  }
  return candidate;
}

function normalizedParagraphs(text: string): Array<{ raw: string; normalized: string }> {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((raw) => ({ raw: raw.trim(), normalized: raw.replace(/\s+/g, '') }))
    .filter((paragraph) => paragraph.normalized.length > 0);
}

function normalizedTextWithRawEnds(text: string): { normalized: string; rawEnds: number[] } {
  let normalized = '';
  const rawEnds: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) continue;
    normalized += character;
    rawEnds.push(index + 1);
  }
  return { normalized, rawEnds };
}

function trimNormalizedBoundaryOverlap(
  existingText: string,
  continuationText: string,
): { text: string; overlap: number } {
  const existing = normalizedTextWithRawEnds(existingText);
  const continuation = normalizedTextWithRawEnds(continuationText);
  let overlap = Math.min(existing.normalized.length, continuation.normalized.length);
  while (overlap >= 12) {
    if (existing.normalized.slice(-overlap) === continuation.normalized.slice(0, overlap)) {
      return {
        text: continuationText.slice(continuation.rawEnds[overlap - 1]).trimEnd(),
        overlap,
      };
    }
    overlap -= 1;
  }
  return { text: continuationText.trim(), overlap: 0 };
}

export function validateSceneRepetition(text: string, sceneNo: number): void {
  const normalizedText = text.replace(/\s+/g, '');
  const paragraphs = normalizedParagraphs(text).filter(
    (paragraph) => paragraph.normalized.length >= 12,
  );
  const counts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    counts.set(paragraph.normalized, (counts.get(paragraph.normalized) ?? 0) + 1);
  }
  let duplicateChars = 0;
  let maxLongRepeat = 1;
  for (const [paragraph, count] of counts) {
    if (count <= 1) continue;
    duplicateChars += paragraph.length * (count - 1);
    if (paragraph.length >= 24) maxLongRepeat = Math.max(maxLongRepeat, count);
  }
  const duplicateRatio = duplicateChars / Math.max(1, normalizedText.length);
  if (maxLongRepeat >= 3 || (duplicateChars >= 160 && duplicateRatio >= 0.18)) {
    throw new Error('Scene ' + sceneNo + ' 出现大段循环重复，未采纳。');
  }
}

export function validateBeatNovelty(
  acceptedChapterPrefix: string,
  currentText: string,
  sceneNo: number,
  beatOrder: number,
): void {
  const acceptedNormalized = acceptedChapterPrefix.replace(/\s+/g, '');
  if (!acceptedNormalized) return;
  const paragraphs = normalizedParagraphs(currentText).filter(
    (paragraph) => paragraph.normalized.length >= 12,
  );
  const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.normalized.length, 0);
  const reusedChars = paragraphs.reduce(
    (sum, paragraph) =>
      sum + (acceptedNormalized.includes(paragraph.normalized) ? paragraph.normalized.length : 0),
    0,
  );
  if (
    reusedChars >= MIN_CONTINUATION_REUSED_CHARS &&
    reusedChars / Math.max(1, totalChars) >= MAX_CONTINUATION_REUSED_RATIO
  ) {
    throw new Error(`Scene ${sceneNo} / Beat ${beatOrder} 大面积重复已接受的前文，未采纳。`);
  }
}

export function continuationSceneContext(previousText: string): string {
  return [
    '这是同一 Scene 的截断续写。下方只提供已写入草稿的结尾锚点，禁止复述锚点或返回 Scene 开头。',
    '续写锚点（禁止重复）：\n' + compact(previousText, CONTINUATION_CONTEXT_TAIL_CHARS),
    '第一句必须是锚点之后的新动作、新对白或新叙述；只输出新增正文，不要重新介绍人物、规则、目标或已发生事件。',
  ].join('\n\n');
}

function pendingSceneBeats(sceneText: string, scene: OrchestratedScene): string[] {
  return scene.beats
    .filter((beat) => beat.required && !beatCovered(sceneText, beat.text))
    .map((beat) => beat.text);
}

function validationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '上一版生成单元未通过校验。';
}

function retrySceneTaskInput(
  taskInput: Record<string, unknown>,
  scene: OrchestratedScene,
  baseConstraints: string[],
  validationError: unknown,
): Record<string, unknown> {
  const missingBeats = pendingSceneBeats('', scene);
  return {
    ...taskInput,
    sceneGoal: '完整重写当前 Beat，修复校验指出的问题后在 Beat 边界自然收束。',
    sceneBeats: scene.beats.length
      ? scene.beats.map((beat) => beat.text)
      : stringList(taskInput.sceneBeats),
    sceneConstraints: [
      ...baseConstraints,
      `上一版生成单元未通过校验：${validationErrorMessage(validationError)}`,
      missingBeats.length
        ? `重点确保以下有序 Beat 在正文中清楚发生：${missingBeats.join('；')}`
        : '',
      '这是当前 Beat 的最后一次本地重写机会；只输出完整、连贯、可直接替换上一版的正文。',
      '不要解释修复过程，不要输出提纲、JSON、思考过程或校验结果。',
    ].filter(Boolean),
  };
}

async function executeExternalBeatRepair(
  input: ChapterGenerationExecutionInput,
  scene: OrchestratedScene,
  beat: OrchestratedScene['beats'][number],
  rejectedText: string,
  validationFailure: unknown,
  constraints: string[],
  beatTarget: number,
  beatMaximum: number,
  previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined,
  acceptedChapterPrefix: string,
): Promise<AiExecutionResult> {
  const identity = `:scene:${scene.sceneNo}:beat:${beat.order}:external-repair`;
  const requestedMinimum = externalBeatRepairPromptMinimum(beatTarget, beatMaximum);
  const requestedMaximum = externalBeatRepairPromptMaximum(requestedMinimum, beatMaximum);
  const requiredEventDeadline = externalBeatRepairRequiredEventDeadline(beatMaximum);
  const rawCharacterMinimum = externalBeatRepairRawCharacterMinimum(beatMaximum);
  const rawCharacterLimit = externalBeatRepairRawCharacterLimit(beatMaximum);
  const rawCharactersPerParagraphMinimum = Math.floor(
    rawCharacterMinimum / EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT,
  );
  const rawCharactersPerParagraphMaximum = Math.floor(
    rawCharacterLimit / EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT,
  );
  const request: AiGenerateRequest = {
    taskType: 'chapter_generate',
    messages: [
      {
        role: 'user',
        content: [
          '【单 Beat 外部定点修稿】',
          `当前只修复 Scene ${scene.sceneNo} / Beat ${beat.order}，不得改写其他 Beat。`,
          `Beat 目标：${beat.text}`,
          `场景目标：${scene.goal || stringValue(input.taskInput.sceneGoal)}`,
          `校验失败原因：${validationErrorMessage(validationFailure)}`,
          `有效叙事字数只计算汉字和字母数字，标点、空白与 Markdown 符号不计；最终采纳正文会在完整句边界收束到 ${MIN_LOCAL_BEAT_CHARACTERS}–${beatMaximum} 字。低于下限直接拒绝，正常结束的轻微超长可安全裁剪。`,
          `为抵消外部模型常见的提前收束，本次生成目标有意高于最终 ${beatMaximum} 字采纳上限；你不得自行裁短，由程序在完整句边界裁剪并重新校验。`,
          `请至少写到 ${requestedMinimum} 个有效叙事字并以 ${requestedMaximum} 字为目标；完成后自行计数，少于 ${requestedMinimum} 个有效叙事字不得结束输出。计数不确定时宁可正常结束地略微写长，不要提前停笔。`,
          acceptedChapterPrefix
            ? '本章此前已接受正文（只用于保持事实、节奏和衔接，不得复述）：\n' +
              compact(acceptedChapterPrefix, 6_000)
            : '',
          previous && !acceptedChapterPrefix
            ? '上一 Beat 收束片段：\n' + compact(previous.text, 1_200)
            : '',
          constraints.length
            ? '必须遵守：\n' + constraints.map((constraint) => `- ${constraint}`).join('\n')
            : '',
          '本地模型第二次生成的待修正文：\n' + rejectedText,
          '同时检查并消除与此前正文的事实冲突、同类信息重复和节奏堆叠；不要凭空增加第二套证据或秘密。',
          '【最终硬约束】',
          `抵达约 ${requiredEventDeadline} 个有效叙事字之前，必须已经按顺序写完下方 required Beat 的每个事件和最末终态；后续只能补必要质感并自然收束。`,
          `写完最末终态不等于可以结束：之后必须继续补充只属于当前 Beat 的动作阻力、现场感官、即时反应或短对白，直到全文至少达到 ${requestedMinimum} 个有效叙事字并尽量贴近 ${requestedMaximum} 字；少于 ${requestedMinimum} 个有效叙事字绝对不得结束输出。`,
          `全文同时必须达到 ${rawCharacterMinimum}–${rawCharacterLimit} 个原始字符（含标点和换行）；少于 ${rawCharacterMinimum} 个原始字符不得结束输出。`,
          `严格用 ${EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT} 个实质自然段组织正文，不得少段；每段约 ${rawCharactersPerParagraphMinimum}–${rawCharactersPerParagraphMaximum} 个原始字符且至少包含两个完整句子，不得用空段、标题或单独省略号凑数；前 5 段内完成全部 required 事件和最末终态，其余段落只深化当前 Beat。`,
          '开场铺垫不得超过 80 个有效叙事字；绝不能把最末终态拖到篇幅尾部。',
          externalBeatRepairCompletionChecklist(beat.text),
          `Required Beat：${beat.text}`,
          '只输出修复后的当前 Beat 连续小说正文；不要解释、总结、列提纲、输出 JSON 或思考过程。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  };
  return executeExternalBeatRepairGeneration({
    ...input,
    operationId: input.operationId + identity,
    traceId: (input.traceId ?? input.operationId) + identity,
    sourceId: input.sourceId + identity,
    request,
    taskInput: {
      ...input.taskInput,
      mode: 'rewrite',
      targetWordCount: requestedMinimum,
      minimumCharacterCount: MIN_LOCAL_BEAT_CHARACTERS,
      maximumCharacterCount: beatMaximum,
      rawMinimumCharacterCount: rawCharacterMinimum,
      rawMaximumCharacterCount: rawCharacterLimit,
      paragraphCount: EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT,
      requiredBeatText: beat.text,
      sceneNo: scene.sceneNo,
      beatOrder: beat.order,
      sceneTitle: scene.title,
      sceneGoal: scene.goal,
      sceneBeats: [beat.text],
      sceneConstraints: constraints,
      rejectedBeatText: rejectedText,
      validationFailure: validationErrorMessage(validationFailure),
    },
  });
}

export function mergeSceneContinuation(
  existingText: string,
  continuationText: string,
  sceneNo: number,
): string {
  const existing = normalizedParagraphs(existingText);
  const boundary = trimNormalizedBoundaryOverlap(existingText, continuationText);
  let continuation = normalizedParagraphs(boundary.text);
  if (!continuation.length) throw new Error('Scene ' + sceneNo + ' 续写返回空正文。');

  let boundaryOverlap = Math.min(existing.length, continuation.length);
  while (boundaryOverlap > 0) {
    const existingStart = existing.length - boundaryOverlap;
    const matches = continuation
      .slice(0, boundaryOverlap)
      .every(
        (paragraph, index) => paragraph.normalized === existing[existingStart + index]?.normalized,
      );
    if (matches) break;
    boundaryOverlap -= 1;
  }
  if (boundaryOverlap > 0) continuation = continuation.slice(boundaryOverlap);
  if (!continuation.length) {
    throw new Error('Scene ' + sceneNo + ' 续写只重复了已有正文，未采纳。');
  }

  const existingNormalized = existingText.replace(/\s+/g, '');
  const eligible = continuation.filter((paragraph) => paragraph.normalized.length >= 8);
  const totalChars = eligible.reduce((sum, paragraph) => sum + paragraph.normalized.length, 0);
  const reusedChars = eligible.reduce(
    (sum, paragraph) =>
      sum + (existingNormalized.includes(paragraph.normalized) ? paragraph.normalized.length : 0),
    0,
  );
  if (
    reusedChars >= MIN_CONTINUATION_REUSED_CHARS &&
    reusedChars / Math.max(1, totalChars) >= MAX_CONTINUATION_REUSED_RATIO
  ) {
    throw new Error('Scene ' + sceneNo + ' 续写大面积重复已有正文，未采纳。');
  }

  const addition = continuation.map((paragraph) => paragraph.raw).join('\n\n');
  return boundary.overlap > 0
    ? existingText.trimEnd() + boundary.text
    : existingText.trim() + '\n\n' + addition;
}

export async function executeChapterProseOrchestrator(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  if (!input.settings.localChapterModel?.enabled || input.taskInput.mode === 'rewrite') {
    return executeExternalChapterGeneration(input);
  }
  if (!Array.isArray(input.taskInput.scenePlan) || input.taskInput.scenePlan.length === 0) {
    throw new Error('本地章节正文生成必须先由外部 AI 生成并由用户确认 Scene/Beat 计划。');
  }
  const scenes = scenePlanFromInput(input);
  validateLocalGenerationPlan(scenes);
  const chapterTarget = positiveNumber(input.taskInput.targetWordCount);
  const totalBeats = scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  const beatTarget = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(500, chapterTarget ? Math.round(chapterTarget / totalBeats) : 650),
  );
  const beatMaximum = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(MIN_LOCAL_BEAT_CHARACTERS, Math.ceil(beatTarget * 1.2)),
  );
  const results: AiSceneExecutionResult[] = [];
  let externalRepairUsed = false;
  let previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined;
  let generationUnitNo = 0;
  let resumePrefixOpen = Array.isArray(input.resumeBeats) && input.resumeBeats.length > 0;
  const resumeBeats = new Map<number, ChapterProseResumeBeat>(
    (input.resumeBeats ?? []).map((beat) => [beat.generationUnitNo, beat]),
  );

  for (const scene of scenes) {
    for (const beat of scene.beats) {
      if (input.signal?.aborted) throw new Error('AI_REQUEST_CANCELLED');
      generationUnitNo += 1;
      const isLastBeatInScene = beat.order === scene.beats.length;
      const unitScene = { ...scene, beats: [beat] };
      const acceptedChapterPrefix = results.map((result) => result.text).join('\n\n');
      const resumeBeat = resumePrefixOpen ? resumeBeats.get(generationUnitNo) : undefined;
      if (
        resumeBeat &&
        resumeBeat.sceneNo === scene.sceneNo &&
        resumeBeat.beatOrder === beat.order &&
        resumeBeat.generationUnitCount === totalBeats
      ) {
        const resumedText = resumeBeat.text.trim();
        try {
          validateSceneText(
            resumedText,
            unitScene,
            resumeBeat.finishReason ?? 'stop',
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, resumedText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, resumedText);
          }
          const beatResult: AiSceneExecutionResult = {
            sceneNo: scene.sceneNo,
            beatOrder: beat.order,
            generationUnitNo,
            generationUnitCount: totalBeats,
            title: `${scene.title} · Beat ${beat.order}`,
            text: resumedText,
            taskId: resumeBeat.taskId,
            attemptId: resumeBeat.attemptId,
            provider: {
              text: resumedText,
              providerId: resumeBeat.providerId,
              modelId: resumeBeat.modelId,
              finishReason: resumeBeat.finishReason ?? 'stop',
              tokenInput: 0,
              tokenOutput: 0,
              tokenTotal: 0,
              durationMs: 0,
            },
            persistence: 'sqlite',
            reusedFromJobId: resumeBeat.sourceJobId,
          };
          results.push(beatResult);
          externalRepairUsed ||=
            resumeBeat.providerId !== input.settings.localChapterModel?.providerId;
          await input.onSceneCompleted?.(beatResult);
          previous = { scene, beatOrder: beat.order, text: beatResult.text };
          continue;
        } catch {
          resumePrefixOpen = false;
        }
      } else if (resumePrefixOpen) {
        resumePrefixOpen = false;
      }
      const baseSceneConstraints = [
        ...sceneConstraints(input, scene, beat, previous, isLastBeatInScene),
        `本 Beat 正文目标约 ${beatTarget} 字，必须不少于 ${MIN_LOCAL_BEAT_CHARACTERS} 字且不超过 ${beatMaximum} 字。`,
      ];
      const initialSceneConstraints = [
        ...baseSceneConstraints,
        '在当前 Beat 的最后一个动作、对白或状态变化后自然收束，不追加下一 Beat。',
      ].filter(Boolean);
      const sceneTaskInput = {
        ...input.taskInput,
        sceneNo: scene.sceneNo,
        beatOrder: beat.order,
        generationUnitNo,
        generationUnitCount: totalBeats,
        sceneTitle: scene.title,
        sceneGoal: [
          scene.goal || stringValue(input.taskInput.sceneGoal) || '推进当前场景目标。',
          `当前 Beat：${beat.text}`,
        ].join('\n'),
        sceneBeats: [beat.text],
        targetCharacters: beatTarget,
        sceneConstraints: initialSceneConstraints,
        sceneContext: immediateBeatContext(input, scene, beat, previous, acceptedChapterPrefix),
      };
      let response: AiExecutionResult | undefined;
      let beatText = '';
      let validationFailure: unknown;
      for (let localAttempt = 1; localAttempt <= MAX_LOCAL_BEAT_ATTEMPTS; localAttempt += 1) {
        const attemptTaskInput =
          localAttempt === 1
            ? sceneTaskInput
            : retrySceneTaskInput(
                sceneTaskInput,
                unitScene,
                baseSceneConstraints,
                validationFailure,
              );
        const unitIdentity = `:scene:${scene.sceneNo}:beat:${beat.order}:attempt:${localAttempt}`;
        response = await executeChapterSceneGeneration({
          ...input,
          operationId: input.operationId + unitIdentity,
          traceId: (input.traceId ?? input.operationId) + unitIdentity,
          sourceId: input.sourceId + unitIdentity,
          taskInput: attemptTaskInput,
        });
        beatText = response.text.trim();
        try {
          validateSceneText(
            beatText,
            unitScene,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, beatText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, beatText);
          }
          validationFailure = undefined;
          break;
        } catch (error: unknown) {
          validationFailure = error;
        }
      }
      if (validationFailure) {
        response = await executeExternalBeatRepairWithTransportRetry(
          input,
          scene,
          beat,
          beatText,
          validationFailure,
          baseSceneConstraints,
          beatTarget,
          beatMaximum,
          previous,
          acceptedChapterPrefix,
        );
        beatText = response.text.trim();
        try {
          beatText = trimExternalBeatRepairAtNaturalBoundary(
            beatText,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
            beat.text,
          );
          validateSceneText(
            beatText,
            unitScene,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, beatText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, beatText);
          }
          validationFailure = undefined;
          externalRepairUsed = true;
        } catch (error: unknown) {
          throw new Error(
            `Scene ${scene.sceneNo} / Beat ${beat.order} 本地模型两次生成及外部 AI 定点修稿均未通过；` +
              validationErrorMessage(error),
          );
        }
      }
      if (!response || validationFailure) {
        throw new Error(`Scene ${scene.sceneNo} / Beat ${beat.order} 未得到可采纳正文。`);
      }
      const beatResult: AiSceneExecutionResult = {
        sceneNo: scene.sceneNo,
        beatOrder: beat.order,
        generationUnitNo,
        generationUnitCount: totalBeats,
        title: `${scene.title} · Beat ${beat.order}`,
        text: beatText,
        taskId: response.taskId,
        attemptId: response.attemptId,
        provider: response.provider,
        persistence: response.persistence,
      };
      results.push(beatResult);
      await input.onSceneCompleted?.(beatResult);
      previous = { scene, beatOrder: beat.order, text: beatResult.text };
    }
  }

  const last = results[results.length - 1];
  if (!last) throw new Error('未生成任何 Beat 正文。');
  return {
    persistence: last.persistence,
    text: results.map((result) => result.text).join('\n\n'),
    provider: last.provider,
    taskId: last.taskId,
    attemptId: last.attemptId,
    externalRepairUsed,
    sceneResults: results,
  };
}
