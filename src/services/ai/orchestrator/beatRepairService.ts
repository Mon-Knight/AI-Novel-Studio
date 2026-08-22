import type { AiGenerateRequest, AiSettings } from '../../../types/ai';
import { appLogger } from '../../observability/appLogger';
import type { AiExecutionResult } from '../aiExecutionPipeline';
import { executeAiTask } from '../aiExecutionPipeline';
import { isAiRequestCancelled } from '../aiCancellation';
import type { ChapterGenerationExecutionInput } from '../chapterGenerationExecutionService';
import {
  type OrchestratedScene,
  EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS,
  EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT,
  EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS,
  EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS,
  EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM,
  EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER,
  EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO,
  EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS,
  MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS,
  MAX_LOCAL_BEAT_CHARACTERS,
  MIN_LOCAL_BEAT_CHARACTERS,
  narrativeCharacterCount,
  positiveNumber,
  requestSource,
  stringValue,
} from './types';
import { scenePlanFromInput, validateLocalGenerationPlan } from './scenePlanParser';
import { compact, sceneConstraints, validationErrorMessage } from './beatContextAssembler';
import {
  beatRequiresCompletedAction,
  externalRepairBeatCovered,
  semanticBeatClauses,
} from './beatTextValidator';

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

export function isRetryableExternalBeatRepairError(error: unknown): boolean {
  if (isAiRequestCancelled(error)) return false;
  if (error && typeof error === 'object' && (error as { retryable?: unknown }).retryable === true) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:429|5\d\d)\b|超时|过载|网络请求失败|请求过于频繁|服务错误/u.test(message);
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

export const NATURAL_SENTENCE_ENDS = new Set(['。', '！', '？', '!', '?', '…']);
export const NATURAL_SENTENCE_CLOSERS = new Set(['”', '’', '」', '』', '》', '）', ')', '】', ']']);

export interface NaturalSentenceUnit {
  paragraphIndex: number;
  text: string;
}

export const MAX_EXTERNAL_REPAIR_SUBSET_STATES = 120_000;

export function naturalSentenceUnits(text: string): NaturalSentenceUnit[] {
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

export function sentenceUnitsText(units: ReadonlyArray<NaturalSentenceUnit>): string {
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

export function boundedExternalRepairSubsetSearch<T>(
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
    { text: string; characterCount: number; retainedCount: number; gapCount: number } | undefined;

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

    const visit = (index: number, currentCount: number, indexes: number[], selected: T[]): void => {
      if (visited >= MAX_EXTERNAL_REPAIR_SUBSET_STATES) return;
      visited += 1;
      if (currentCount > maximumCharacters) return;
      if (currentCount + suffixWeights[index] < minimumCharacters) return;

      if (index >= lastIndex) {
        if (preserveEndpoints) {
          if (indexes[indexes.length - 1] !== lastIndex) {
            consider([...selected, units[lastIndex]], [...indexes, lastIndex]);
          } else {
            consider(selected, indexes);
          }
        } else if (index === lastIndex) {
          consider(selected, indexes);
          if (currentCount + weights[lastIndex] <= maximumCharacters) {
            consider([...selected, units[lastIndex]], [...indexes, lastIndex]);
          }
        }
        return;
      }

      if (currentCount + weights[index] <= maximumCharacters) {
        visit(
          index + 1,
          currentCount + weights[index],
          [...indexes, index],
          [...selected, units[index]],
        );
      }
      visit(index + 1, currentCount, indexes, selected);
    };

    visit(preserveEndpoints ? 1 : 0, initialCount, initialIndexes, initialUnits);
  };

  run(true);
  if (!best) run(false);
  return best?.text;
}

export function compactExternalRepairSentences(
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

export async function executeExternalBeatRepairGeneration(
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

export async function executeExternalBeatRepair(
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

export async function executeExternalBeatRepairWithTransportRetry(
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
