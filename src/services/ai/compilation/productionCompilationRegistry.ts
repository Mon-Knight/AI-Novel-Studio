import connectionTestTemplate from '../../../../prompts/system_connection_test.md?raw';
import settingExpandTemplate from '../../../../prompts/setting_expand.md?raw';
import chapterGenerationExecutionTemplate from '../../../../prompts/chapter_generation_execution.md?raw';
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
  const definition = definitions[input.taskType];
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

export const productionCompilationRegistryPrivate = { definitions };
