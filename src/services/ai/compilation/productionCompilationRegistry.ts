import connectionTestTemplate from '../../../../prompts/system_connection_test.md?raw';
import settingExpandTemplate from '../../../../prompts/setting_expand.md?raw';
import chapterGenerationExecutionTemplate from '../../../../prompts/chapter_generation_execution.md?raw';
import chapterBeatRepairTemplate from '../../../../prompts/chapter_beat_repair.md?raw';
import chapterSceneGenerationLocalTemplate from '../../../../prompts/chapter_scene_generation_local.md?raw';
import chapterScenePlanTemplate from '../../../../prompts/chapter_scene_plan_generate.md?raw';
import autonomousPlotTemplate from '../../../../prompts/autonomous_plot_planner.md?raw';
import autonomousCharacterTemplate from '../../../../prompts/autonomous_character_evolution.md?raw';
import autonomousWorldTemplate from '../../../../prompts/autonomous_world_builder.md?raw';
import autonomousConflictTemplate from '../../../../prompts/autonomous_conflict_generator.md?raw';
import autonomousPacingTemplate from '../../../../prompts/autonomous_pacing_controller.md?raw';
import autonomousChapterTemplate from '../../../../prompts/autonomous_chapter_batch.md?raw';
import type { AiSettings } from '../../../types/ai';
import type {
  AiCompilationScope,
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../../types/aiCompilation';
import type { AiTaskType } from '../../../types/ai-task';
import { productionToolRegistry } from '../../agent-tools/productionToolRegistry';
import {
  CONNECTION_TEST_MAX_OUTPUT_TOKENS,
  CONNECTION_TEST_TEMPERATURE,
} from '../providerRequestPolicy';
import {
  CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS,
  CHAPTER_SCENE_PLAN_TEMPERATURE,
  chapterScenePlanThinkingModeForModel,
} from '../chapterScenePlanPolicy';
import { AiCompilationError } from './errors';
import {
  compileAiExecutionContract,
  type AiTaskCompilationDefinition,
} from './executionContractCompiler';

function autonomousUserPrompt(marker: string) {
  return (taskInput: Record<string, unknown>) => {
    const payload = taskInput.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        `任务 ${marker} 缺少结构化 payload。`,
      );
    }
    return `${marker}\n【REQUEST_JSON】\n${JSON.stringify(payload)}`;
  };
}

function chapterGenerationUserPrompt(taskInput: Record<string, unknown>): string {
  const chapterTitle =
    typeof taskInput.chapterTitle === 'string' ? taskInput.chapterTitle.trim() : '';
  const contextHash = typeof taskInput.contextHash === 'string' ? taskInput.contextHash.trim() : '';
  if (!chapterTitle || !contextHash) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_generate 缺少章节标题或上下文哈希。',
    );
  }
  const targetWordCount =
    typeof taskInput.targetWordCount === 'number' && Number.isFinite(taskInput.targetWordCount)
      ? String(Math.max(1, Math.round(taskInput.targetWordCount)))
      : '按冻结上下文要求';
  return [
    '[CHAPTER_GENERATE_REQUEST]',
    `Chapter: ${chapterTitle}`,
    `Target word count: ${targetWordCount}`,
    `Context hash: ${contextHash}`,
    'Generate only the final chapter prose using the compiled context above.',
  ].join('\n');
}

function chapterBeatRepairUserPrompt(taskInput: Record<string, unknown>): string {
  const chapterTitle = textValue(taskInput.chapterTitle);
  const contextHash = textValue(taskInput.contextHash);
  const sceneNo = Number(taskInput.sceneNo);
  const beatOrder = Number(taskInput.beatOrder);
  if (!chapterTitle || !contextHash || !Number.isFinite(sceneNo) || !Number.isFinite(beatOrder)) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_beat_repair 缺少章节、Scene、Beat 或上下文标识。',
    );
  }
  const targetWordCount =
    typeof taskInput.targetWordCount === 'number' && Number.isFinite(taskInput.targetWordCount)
      ? Math.max(1, Math.round(taskInput.targetWordCount))
      : 650;
  const minimumCharacterCount =
    typeof taskInput.minimumCharacterCount === 'number' &&
    Number.isFinite(taskInput.minimumCharacterCount)
      ? Math.max(1, Math.round(taskInput.minimumCharacterCount))
      : 500;
  const maximumCharacterCount =
    typeof taskInput.maximumCharacterCount === 'number' &&
    Number.isFinite(taskInput.maximumCharacterCount)
      ? Math.max(minimumCharacterCount, Math.round(taskInput.maximumCharacterCount))
      : Math.max(minimumCharacterCount, 900);
  const requiredBeatText =
    textValue(taskInput.requiredBeatText) || listValue(taskInput.sceneBeats)[0] || '';
  const rawMinimumCharacterCount =
    typeof taskInput.rawMinimumCharacterCount === 'number' &&
    Number.isFinite(taskInput.rawMinimumCharacterCount)
      ? Math.max(minimumCharacterCount, Math.round(taskInput.rawMinimumCharacterCount))
      : Math.max(minimumCharacterCount + 300, maximumCharacterCount);
  const paragraphCount =
    typeof taskInput.paragraphCount === 'number' && Number.isFinite(taskInput.paragraphCount)
      ? Math.max(1, Math.round(taskInput.paragraphCount))
      : 10;
  const requiredEventDeadline = Math.max(300, Math.floor(maximumCharacterCount * 0.65));
  const requestedCharacterCount = Math.max(minimumCharacterCount, targetWordCount);
  const rawCharacterLimit =
    typeof taskInput.rawMaximumCharacterCount === 'number' &&
    Number.isFinite(taskInput.rawMaximumCharacterCount)
      ? Math.max(rawMinimumCharacterCount, Math.round(taskInput.rawMaximumCharacterCount))
      : maximumCharacterCount + 300;
  const rawCharactersPerParagraphMinimum = Math.floor(rawMinimumCharacterCount / paragraphCount);
  const rawCharactersPerParagraphMaximum = Math.floor(rawCharacterLimit / paragraphCount);
  return [
    '[CHAPTER_BEAT_REPAIR_REQUEST]',
    `Chapter: ${chapterTitle}`,
    `Scene: ${Math.max(1, Math.round(sceneNo))}`,
    `Beat: ${Math.max(1, Math.round(beatOrder))}`,
    `Minimum effective narrative characters (punctuation and whitespace excluded): ${requestedCharacterCount}`,
    `Accepted envelope after safe complete-sentence trimming: ${minimumCharacterCount}-${maximumCharacterCount}. Under-running is rejected; a normal-stop overrun may be trimmed.`,
    `The generation target intentionally exceeds the final ${maximumCharacterCount}-character acceptance ceiling to offset habitual under-running. Do not self-trim; the orchestrator will trim at a complete-sentence boundary and rerun every gate.`,
    requiredBeatText
      ? `Required Beat (complete every event and end-state clause): ${requiredBeatText}`
      : '',
    `Complete every required event and the final end state before about ${requiredEventDeadline} effective characters; only then add essential texture and close naturally.`,
    `Completing the end state does not permit an early stop: continue with only in-Beat action resistance, sensory detail, immediate reaction, or brief dialogue until at least ${requestedCharacterCount} effective characters are present. If uncertain, finish normally after writing slightly more rather than stopping early.`,
    `The raw response, including punctuation and whitespace, must contain ${rawMinimumCharacterCount}-${rawCharacterLimit} characters. Never stop below the raw-character floor.`,
    `Use exactly ${paragraphCount} substantive prose paragraphs, never fewer, of about ${rawCharactersPerParagraphMinimum}-${rawCharactersPerParagraphMaximum} raw characters each and at least two complete sentences per paragraph. Complete every required event by paragraph 5; the remaining paragraphs may deepen only this Beat. Empty paragraphs, headings, and standalone ellipses do not count.`,
    'Keep setup under 80 effective characters.',
    'Compress setup and supporting evidence instead of delaying or omitting the Beat ending.',
    `Context hash: ${contextHash}`,
    'Return only the complete replacement prose for this Beat.',
  ]
    .filter(Boolean)
    .join('\n');
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  const single = textValue(value);
  return single ? [single] : [];
}

function chapterSceneGenerationUserPrompt(taskInput: Record<string, unknown>): string {
  const chapterTitle = textValue(taskInput.chapterTitle);
  const contextHash = textValue(taskInput.contextHash);
  const goal = textValue(taskInput.sceneGoal);
  const beats = listValue(taskInput.sceneBeats);
  const constraints = listValue(taskInput.sceneConstraints);
  if (!chapterTitle || !contextHash || !goal || beats.length !== 1 || constraints.length === 0) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_scene_generate 必须包含章节标题、上下文哈希、场景目标、且仅包含一个 Beat 和有效 Constraints。',
    );
  }
  return [
    `Goal：\n${goal}`,
    `Beat：\n${beats[0]}`,
    `Constraints：\n${constraints.map((constraint) => `- ${constraint}`).join('\n')}`,
  ].join('\n');
}

function chapterScenePlanUserPrompt(taskInput: Record<string, unknown>): string {
  const chapterTitle = textValue(taskInput.chapterTitle);
  const contextHash = textValue(taskInput.contextHash);
  const targetWordCount =
    typeof taskInput.targetWordCount === 'number' && Number.isFinite(taskInput.targetWordCount)
      ? Math.max(1, Math.round(taskInput.targetWordCount))
      : 2500;
  const beatCount = Math.min(5, Math.max(3, Math.round(targetWordCount / 650)));
  const beatTarget = Math.min(900, Math.max(500, Math.round(targetWordCount / beatCount)));
  if (!chapterTitle || !contextHash) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'chapter_scene_plan_generate 缺少章节标题或上下文哈希。',
    );
  }
  return [
    '请根据 Context 为当前章节生成可人工确认的 Scene/Beat 候选规划。',
    '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、解释或额外文字。',
    '从第一个字符开始直接输出 JSON；不要复述 Context，不要先写分析过程。',
    'JSON 顶层必须包含 scenes 数组；每个 scene 必须包含 sceneNo、title、contextCapsule、location、characters、goal、conflict、beats、constraints、expectedEndState、result、transition。contextCapsule 必须写明视角/主要角色身份、开场状态和不可变已知事实。',
    'beats 必须是有序数组，每个 beat 必须包含 order、text、required；不要把跨章节人物演化 beat 混入场景 beats。',
    `整章必须严格生成 ${beatCount} 个 Beat；每个 Beat 将单独调用一次本地模型，正文目标约 ${beatTarget} 字（允许 500–900 字）。`,
    '每个 Scene 安排 1–3 个 Beat；每个 Beat 只描述一个连续、边界清楚的叙事推进单元，不得把多个阶段压进同一 Beat。',
    beatCount >= 4 ? '请优先规划为 2 个 Scene，并让 Beat 在两个 Scene 间连续分布。' : '',
    '保持 JSON 紧凑：title/location 不超过 30 字，goal/conflict/result/transition/expectedEndState 不超过 120 字，contextCapsule 和每个 beat.text 不超过 180 字。',
    `章节：${chapterTitle}`,
    `章节目标字数：${targetWordCount}`,
    `上下文哈希：${contextHash}`,
    '目标结构示例：{"scenes":[{"sceneNo":1,"title":"","contextCapsule":"","location":"","characters":[],"goal":"","conflict":"","beats":[{"order":1,"text":"","required":true}],"constraints":[],"expectedEndState":"","result":"","transition":""}]}',
  ].join('\n');
}

function autonomousDefinition(input: {
  taskType: AiTaskType;
  promptTemplateId: string;
  promptTemplateBody: string;
  userMarker: string;
  maxOutputTokens: number;
  defaultTemperature: number;
}): AiTaskCompilationDefinition {
  return {
    taskType: input.taskType,
    expectedArtifactType: 'plan',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: input.promptTemplateId,
    promptTemplateVersion: '1',
    promptTemplateBody: input.promptTemplateBody,
    userPrompt: autonomousUserPrompt(input.userMarker),
    responseSchema: `${input.taskType}_json_v1`,
    constraints: {
      jsonOnly: true,
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: [],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: input.maxOutputTokens,
    defaultTemperature: input.defaultTemperature,
  };
}

const definitions: Partial<Record<AiTaskType, AiTaskCompilationDefinition>> = {
  connection_test: {
    taskType: 'connection_test',
    expectedArtifactType: 'generic_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'system/connection_test',
    promptTemplateVersion: '2',
    promptTemplateBody: connectionTestTemplate,
    userPrompt: '请只回复 OK。',
    responseSchema: 'exact_text_ok_v1',
    constraints: {
      exactText: 'OK',
      allowMarkdown: false,
      allowAdditionalText: false,
    },
    allowedSourceTypes: [],
    requiredSourceTypes: [],
    allowedTools: [],
    modelContextTokens: 512,
    maxOutputTokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS,
    defaultTemperature: CONNECTION_TEST_TEMPERATURE,
  },
  setting_expand: {
    taskType: 'setting_expand',
    expectedArtifactType: 'setting_candidates',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'setting/expand',
    promptTemplateVersion: '2',
    promptTemplateBody: settingExpandTemplate,
    userPrompt: '请为当前章节补充相关设定候选。',
    responseSchema: 'setting_candidates_v1',
    constraints: {
      candidateOnly: true,
      minimumCandidates: 3,
      maximumCandidates: 8,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
    },
    allowedSourceTypes: ['novel', 'chapter', 'world_setting', 'rule_system', 'request_context'],
    requiredSourceTypes: ['novel'],
    allowedTools: [],
    modelContextTokens: 16_000,
    maxOutputTokens: 5_000,
    defaultTemperature: 0.7,
  },
  chapter_generate: {
    taskType: 'chapter_generate',
    expectedArtifactType: 'chapter_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/generation_execution',
    promptTemplateVersion: '1',
    promptTemplateBody: chapterGenerationExecutionTemplate,
    userPrompt: chapterGenerationUserPrompt,
    responseSchema: 'chapter_text_v1',
    constraints: {
      outputMode: 'prose',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: 12_000,
    defaultTemperature: 0.7,
  },
  chapter_beat_repair: {
    taskType: 'chapter_beat_repair',
    expectedArtifactType: 'chapter_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/beat_repair_external',
    promptTemplateVersion: '7',
    promptTemplateBody: chapterBeatRepairTemplate,
    userPrompt: chapterBeatRepairUserPrompt,
    responseSchema: 'chapter_text_v1',
    constraints: {
      outputMode: 'beat_prose',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    // DeepSeek V4 defaults to high thinking. This tightly scoped replacement
    // task needs only final prose, so its compiled request disables thinking.
    maxOutputTokens: 4_000,
    defaultTemperature: 0.35,
    thinkingMode: 'disabled',
  },
  chapter_scene_generate: {
    taskType: 'chapter_scene_generate',
    expectedArtifactType: 'scene_text',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/scene_generation_local',
    promptTemplateVersion: '1',
    promptTemplateBody: chapterSceneGenerationLocalTemplate,
    userPrompt: chapterSceneGenerationUserPrompt,
    responseSchema: 'scene_text_v1',
    constraints: {
      outputMode: 'beat_prose',
      protocolVersion: 'qwen35-novel-beat-v3',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
      messageMode: 'single_user',
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 4096,
    maxOutputTokens: 1024,
    defaultTemperature: 0.7,
    messageMode: 'single_user',
  },
  chapter_scene_plan_generate: {
    taskType: 'chapter_scene_plan_generate',
    expectedArtifactType: 'plan',
    expectedArtifactSchemaVersion: 1,
    promptTemplateId: 'chapter/scene_plan_generate',
    promptTemplateVersion: '2',
    promptTemplateBody: chapterScenePlanTemplate,
    userPrompt: chapterScenePlanUserPrompt,
    responseSchema: 'chapter_scene_plan_v1',
    constraints: {
      jsonOnly: true,
      outputMode: 'scene_plan_candidates',
      candidateOnly: true,
      mayWriteBusinessData: false,
      requireExplicitApplyConfirmation: true,
      mustFollowCompiledContext: true,
    },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    allowedTools: [],
    modelContextTokens: 64_000,
    maxOutputTokens: CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS,
    defaultTemperature: CHAPTER_SCENE_PLAN_TEMPERATURE,
  },
  autonomous_plot_plan: autonomousDefinition({
    taskType: 'autonomous_plot_plan',
    promptTemplateId: 'autonomous/plot_planner',
    promptTemplateBody: autonomousPlotTemplate,
    userMarker: '[AUTONOMOUS_FOUNDATION_REQUEST]',
    maxOutputTokens: 8_000,
    defaultTemperature: 0.55,
  }),
  autonomous_character_evolution: autonomousDefinition({
    taskType: 'autonomous_character_evolution',
    promptTemplateId: 'autonomous/character_evolution',
    promptTemplateBody: autonomousCharacterTemplate,
    userMarker: '[AUTONOMOUS_CHARACTER_REQUEST]',
    maxOutputTokens: 8_000,
    defaultTemperature: 0.5,
  }),
  autonomous_world_build: autonomousDefinition({
    taskType: 'autonomous_world_build',
    promptTemplateId: 'autonomous/world_builder',
    promptTemplateBody: autonomousWorldTemplate,
    userMarker: '[AUTONOMOUS_WORLD_REQUEST]',
    maxOutputTokens: 8_000,
    defaultTemperature: 0.55,
  }),
  autonomous_conflict_generate: autonomousDefinition({
    taskType: 'autonomous_conflict_generate',
    promptTemplateId: 'autonomous/conflict_generator',
    promptTemplateBody: autonomousConflictTemplate,
    userMarker: '[AUTONOMOUS_CONFLICT_REQUEST]',
    maxOutputTokens: 8_000,
    defaultTemperature: 0.6,
  }),
  autonomous_pacing_control: autonomousDefinition({
    taskType: 'autonomous_pacing_control',
    promptTemplateId: 'autonomous/pacing_controller',
    promptTemplateBody: autonomousPacingTemplate,
    userMarker: '[AUTONOMOUS_PACING_REQUEST]',
    maxOutputTokens: 4_000,
    defaultTemperature: 0.35,
  }),
  autonomous_chapter_batch: autonomousDefinition({
    taskType: 'autonomous_chapter_batch',
    promptTemplateId: 'autonomous/chapter_batch',
    promptTemplateBody: autonomousChapterTemplate,
    userMarker: '[AUTONOMOUS_CHAPTER_BATCH_REQUEST]',
    maxOutputTokens: 12_000,
    defaultTemperature: 0.55,
  }),
};

export interface CompileProductionAiExecutionInput {
  taskType: AiTaskType;
  scope: AiCompilationScope;
  compilation: AiExecutionCompilationInput;
  settings: AiSettings;
  providerId: string;
  modelId: string;
}

export async function compileProductionAiExecution(
  input: CompileProductionAiExecutionInput,
): Promise<CompiledAiExecutionContractV1> {
  const definition = definitionForExecution(input.taskType, input.modelId);
  if (!definition) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `任务 ${input.taskType} 尚未注册正式编译策略。`,
    );
  }
  return compileAiExecutionContract({
    ...input,
    definition,
    toolRegistry: await productionToolRegistry.getManifest(),
  });
}

function definitionForExecution(
  taskType: AiTaskType,
  modelId: string,
): AiTaskCompilationDefinition | undefined {
  const definition = definitions[taskType];
  const thinkingMode =
    taskType === 'chapter_scene_plan_generate'
      ? chapterScenePlanThinkingModeForModel(modelId)
      : undefined;
  if (definition && thinkingMode) {
    return { ...definition, thinkingMode };
  }
  return definition;
}

export const productionCompilationRegistryPrivate = { definitions, definitionForExecution };
