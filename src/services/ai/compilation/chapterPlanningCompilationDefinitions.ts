import chapterScenePlanV2Template from '../../../../prompts/chapter_scene_plan_v2_generate.md?raw';
import chapterBeatPlanTemplate from '../../../../prompts/chapter_beat_plan_generate.md?raw';
import chapterBeatStateExtractTemplate from '../../../../prompts/chapter_beat_state_extract.md?raw';
import type { AiTaskType } from '../../../types/ai-task';
import {
  CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS,
  CHAPTER_SCENE_PLAN_TEMPERATURE,
} from '../chapterScenePlanPolicy';
import {
  CHAPTER_BEAT_PLAN_MAX_OUTPUT_TOKENS,
  CHAPTER_BEAT_PLAN_TEMPERATURE,
  CHAPTER_BEAT_STATE_EXTRACT_MAX_OUTPUT_TOKENS,
  CHAPTER_BEAT_STATE_EXTRACT_TEMPERATURE,
} from '../chapterBeatPlanPolicy';
import { AiCompilationError } from './errors';
import type { AiTaskCompilationDefinition } from './executionContractCompiler';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `chapter_beat_plan_generate 的 ${label} 必须是正整数。`,
    );
  }
  return value;
}

function positiveIntegerList(value: unknown, expectedCount: number): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== expectedCount ||
    value.some((item) => typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0)
  ) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_beat_plan_generate 缺少与 Beat 数一致的正整数 targetCharactersPerBeat。',
    );
  }
  return value as number[];
}

function chapterScenePlanV2UserPrompt(taskInput: Record<string, unknown>): string {
  const chapterTitle = textValue(taskInput.chapterTitle);
  const contextHash = textValue(taskInput.contextHash);
  if (!chapterTitle || !contextHash) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_scene_plan_v2_generate 缺少章节标题或上下文哈希。',
    );
  }
  const targetWordCount = positiveInteger(taskInput.targetWordCount, 2500);
  const maxScenes = positiveInteger(taskInput.maxScenes, 12);
  return [
    '请根据 Context 为当前章节生成可人工确认的 Scene-only 候选规划。',
    '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、解释或额外文字；从第一个字符开始直接输出 JSON。',
    `JSON 顶层必须是 {"scenes": [...]}，最多 ${maxScenes} 个 Scene；每个 Scene 必须包含 sceneNo、title、contextCapsule、location、characters、goal、conflict、constraints、expectedEndState、result、transition、targetCharacters。`,
    '每个 Scene 的 targetCharacters 必须是正整数，且各 Scene 合计应接近本章目标字数。',
    '本轮不得输出 beats 字段，也不得输出任何 Beat 文本；Beats 会在执行到达该 Scene 时依据实际正文另行规划。',
    'contextCapsule 必须写明视角/主要角色身份、开场状态和不可变已知事实；expectedEndState 只是预期，不得写成已经发生的事实。',
    '保持 JSON 紧凑：title/location 不超过 30 字，goal/conflict/result/transition/expectedEndState 不超过 120 字，contextCapsule 不超过 180 字。',
    `章节：${chapterTitle}`,
    `章节目标字数：${targetWordCount}`,
    `上下文哈希：${contextHash}`,
    '目标结构示例：{"scenes":[{"sceneNo":1,"title":"","contextCapsule":"","location":"","characters":[],"goal":"","conflict":"","constraints":[],"expectedEndState":"","result":"","transition":"","targetCharacters":800}]}',
  ].join('\n');
}

function chapterBeatPlanUserPrompt(taskInput: Record<string, unknown>): string {
  const sceneId = textValue(taskInput.sceneId);
  const sceneNo = Number(taskInput.sceneNo);
  const targetBeatCount = requiredPositiveInteger(taskInput.targetBeatCount, 'targetBeatCount');
  const minimumBeatCharacters = requiredPositiveInteger(
    taskInput.minimumBeatCharacters,
    'minimumBeatCharacters',
  );
  const maximumBeatCharacters = requiredPositiveInteger(
    taskInput.maximumBeatCharacters,
    'maximumBeatCharacters',
  );
  const sourceContextHash = textValue(taskInput.sourceContextHash);
  const previousTextHash = textValue(taskInput.previousTextHash);
  const inputStateHash = textValue(taskInput.inputStateHash);
  if (
    !sceneId ||
    !Number.isFinite(sceneNo) ||
    targetBeatCount <= 0 ||
    minimumBeatCharacters <= 0 ||
    maximumBeatCharacters < minimumBeatCharacters ||
    !/^[0-9a-f]{64}$/u.test(sourceContextHash) ||
    !/^[0-9a-f]{64}$/u.test(previousTextHash) ||
    !/^[0-9a-f]{64}$/u.test(inputStateHash)
  ) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_beat_plan_generate 缺少合法的 Scene、Beat 数量、字数包络或 SHA-256 基线。',
    );
  }
  const targets = positiveIntegerList(taskInput.targetCharactersPerBeat, targetBeatCount);
  return [
    '请只规划 Context 中当前这一个 Scene 的 Beats，不写正文，不规划其他 Scene。',
    '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、解释或额外文字；从第一个字符开始直接输出 JSON。',
    `JSON 顶层必须是 {"beats": [...]}，且必须恰好包含 ${targetBeatCount} 个有序 Beat。`,
    `每个 Beat 必须包含 order、text、required、startState、stateChange；text 是事件要求而不是正文；startState 与 stateChange 只描述预期状态，不得冒充实际已发生事实。`,
    `每个 Beat 的正文目标分别为 ${targets.join('、')} 字，允许包络 ${minimumBeatCharacters}–${maximumBeatCharacters} 字；不得合并或拆分调用方要求的 Beat。`,
    '必须承接 Context 中实际已写正文和实际入口状态；前文没有写出的人物位置、伤势、物件、知识或关系不得凭空补成事实，也不得提前完成后续 Scene。',
    `当前 Scene：${sceneNo}（${sceneId}）`,
    `基线 SHA-256：${sourceContextHash}`,
    `实际前缀 SHA-256：${previousTextHash}`,
    `入口状态 SHA-256：${inputStateHash}`,
    '目标结构示例：{"beats":[{"order":1,"text":"","required":true,"startState":"","stateChange":""}]}',
  ].join('\n');
}

function chapterBeatStateExtractUserPrompt(taskInput: Record<string, unknown>): string {
  const sourceTextHash = textValue(taskInput.sourceTextHash);
  if (!/^[0-9a-f]{64}$/u.test(sourceTextHash)) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_beat_state_extract 缺少合法的正文 SHA-256。',
    );
  }
  const sceneNo = Number(taskInput.sceneNo);
  const beatOrder = Number(taskInput.beatOrder);
  const identifiers =
    Number.isFinite(sceneNo) && Number.isFinite(beatOrder)
      ? [`当前 Scene / Beat：${sceneNo} / ${beatOrder}`]
      : [];
  return [
    '请只提取 Context 中当前 Beat 已写正文的实际状态，不续写、不润色、不修改正文。',
    'Context 只应包含当前 Beat 正文和进入该 Beat 前的实际状态；不得使用计划 expectedEndState、后续 Scene 或整章计划补值。',
    '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、解释或额外文字；从第一个字符开始直接输出 JSON。',
    'JSON 必须为 {"schemaVersion":1,"sourceTextHash":"","actualStateChange":[{"text":"","epistemic":"explicit|uncertain","evidence":[{"start":0,"end":1,"quote":""}]}],"endState":null,"unknowns":[],"semanticValidation":"not_checked"}。',
    'start / end 是相对当前 Beat 正文的 UTF-16 偏移，end 必须大于 start；quote 必须与正文逐字一致，不能改写引号、空白或标点。',
    'actualStateChange 只记录正文可核对的改变；endState 无法确认时必须为 null，并在 unknowns 中说明，不得从计划补值。',
    ...identifiers,
    `正文 SHA-256：${sourceTextHash}`,
  ].join('\n');
}

export const chapterPlanningCompilationDefinitions: Partial<
  Record<AiTaskType, AiTaskCompilationDefinition>
> = {
  chapter_scene_plan_v2_generate: {
    taskType: 'chapter_scene_plan_v2_generate',
    expectedArtifactType: 'plan',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/scene_plan_v2_generate',
    promptTemplateVersion: '1',
    promptTemplateBody: chapterScenePlanV2Template,
    userPrompt: chapterScenePlanV2UserPrompt,
    responseSchema: 'chapter_scene_plan_v2_json_v1',
    constraints: {
      jsonOnly: true,
      outputMode: 'scene_plan_v2_candidates',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
      sceneOnly: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS,
    defaultTemperature: CHAPTER_SCENE_PLAN_TEMPERATURE,
  },
  chapter_beat_plan_generate: {
    taskType: 'chapter_beat_plan_generate',
    expectedArtifactType: 'plan',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/beat_plan_generate',
    promptTemplateVersion: '1',
    promptTemplateBody: chapterBeatPlanTemplate,
    userPrompt: chapterBeatPlanUserPrompt,
    responseSchema: 'chapter_beat_plan_json_v1',
    constraints: {
      jsonOnly: true,
      outputMode: 'scene_beat_plan_candidates',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
      actualStateBound: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: CHAPTER_BEAT_PLAN_MAX_OUTPUT_TOKENS,
    defaultTemperature: CHAPTER_BEAT_PLAN_TEMPERATURE,
  },
  chapter_beat_state_extract: {
    taskType: 'chapter_beat_state_extract',
    expectedArtifactType: 'generic_json',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/beat_state_extract',
    promptTemplateVersion: '1',
    promptTemplateBody: chapterBeatStateExtractTemplate,
    userPrompt: chapterBeatStateExtractUserPrompt,
    responseSchema: 'actual_beat_state_v1',
    constraints: {
      jsonOnly: true,
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      semanticValidation: 'not_checked',
      actualStateOnly: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 32_000,
    maxOutputTokens: CHAPTER_BEAT_STATE_EXTRACT_MAX_OUTPUT_TOKENS,
    defaultTemperature: CHAPTER_BEAT_STATE_EXTRACT_TEMPERATURE,
    thinkingMode: 'disabled',
  },
};

export function usesChapterPlanningThinkingPolicy(taskType: AiTaskType): boolean {
  return (
    taskType === 'chapter_scene_plan_generate' ||
    taskType === 'chapter_scene_plan_v2_generate' ||
    taskType === 'chapter_beat_plan_generate'
  );
}
