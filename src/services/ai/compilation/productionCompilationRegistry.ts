import connectionTestTemplate from '../../../../prompts/system_connection_test.md?raw';
import settingExpandTemplate from '../../../../prompts/setting_expand.md?raw';
import type { AiSettings } from '../../../types/ai';
import type {
  AiCompilationScope,
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../../types/aiCompilation';
import type { AiTaskType } from '../../../types/ai-task';
import { productionToolRegistry } from '../../agent-tools/productionToolRegistry';
import { AiCompilationError } from './errors';
import {
  compileAiExecutionContract,
  type AiTaskCompilationDefinition,
} from './executionContractCompiler';

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
    maxOutputTokens: 8,
    defaultTemperature: 0,
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
    allowedSourceTypes: [
      'novel',
      'chapter',
      'world_setting',
      'rule_system',
      'request_context',
    ],
    requiredSourceTypes: ['novel'],
    allowedTools: [],
    modelContextTokens: 16_000,
    maxOutputTokens: 5_000,
    defaultTemperature: 0.7,
  },
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
