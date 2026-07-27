import type { AiSettings } from '../../../types/ai';
import type {
  AiCompilationScope,
  AiContextSourceType,
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../../types/aiCompilation';
import type { AiTaskType } from '../../../types/ai-task';
import type { ResultArtifactType } from '../../../types/result-artifact';
import type { ToolRegistryManifestV1 } from '../../../types/toolRegistry';
import {
  canonicalHash,
  estimateTokens,
  isPlainRecord,
  normalizeCompilationText,
  sha256,
} from './canonical';
import { compileAiConstraint } from './constraintCompiler';
import { compileAiContext } from './contextCompiler';
import { AiCompilationError } from './errors';

const CONTEXT_ENVELOPE = '【编译上下文】\n';
const MESSAGE_SAFETY_TOKENS = 256;

export interface AiTaskCompilationDefinition {
  taskType: AiTaskType;
  expectedArtifactType: ResultArtifactType;
  expectedArtifactSchemaVersion: number;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateBody: string;
  userPrompt: string;
  responseSchema: string;
  constraints: Record<string, unknown>;
  allowedSourceTypes: AiContextSourceType[];
  requiredSourceTypes: AiContextSourceType[];
  allowedTools: string[];
  modelContextTokens: number;
  maxOutputTokens: number;
  defaultTemperature: number;
}

export interface CompileAiExecutionContractInput {
  definition: AiTaskCompilationDefinition;
  scope: AiCompilationScope;
  compilation: AiExecutionCompilationInput;
  settings: AiSettings;
  providerId: string;
  modelId: string;
  toolRegistry: ToolRegistryManifestV1;
}

function validateScope(
  definition: AiTaskCompilationDefinition,
  scope: AiCompilationScope,
  compilation: AiExecutionCompilationInput,
): void {
  if (definition.taskType === 'connection_test') {
    if (scope.scopeType !== 'system'
      || scope.novelId !== 'system'
      || scope.chapterId
      || scope.draftId
      || compilation.sources.length > 0) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        '连接测试必须使用无来源的 system scope。',
      );
    }
    return;
  }
  if (scope.scopeType === 'system' || scope.novelId === 'system') {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `${definition.taskType} 不能使用 system scope。`,
    );
  }
  for (const source of compilation.sources) {
    if (!definition.allowedSourceTypes.includes(source.sourceType)) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        `任务 ${definition.taskType} 不允许来源类型 ${source.sourceType}。`,
      );
    }
    if (source.sourceType === 'novel' && source.sourceId !== scope.novelId) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        'Novel 来源与 Task scope 不一致。',
      );
    }
    if (source.sourceType === 'chapter'
      && scope.chapterId
      && source.sourceId !== scope.chapterId) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        'Chapter 来源与 Task scope 不一致。',
      );
    }
  }
  for (const sourceType of compilation.missingSourceTypes ?? []) {
    if (!definition.allowedSourceTypes.includes(sourceType)) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        `任务 ${definition.taskType} 不允许缺失来源类型 ${sourceType}。`,
      );
    }
  }
  for (const requiredType of definition.requiredSourceTypes) {
    if (!compilation.sources.some((source) => (
      source.sourceType === requiredType && source.content.trim()
    ))) {
      throw new AiCompilationError(
        'AI_CONTEXT_SOURCE_REQUIRED',
        `任务 ${definition.taskType} 缺少必需来源 ${requiredType}。`,
      );
    }
  }
}

function temperature(definition: AiTaskCompilationDefinition, settings: AiSettings): number {
  const requested = settings.temperature ?? definition.defaultTemperature;
  return Math.min(2, Math.max(0, requested));
}

export async function compileAiExecutionContract(
  input: CompileAiExecutionContractInput,
): Promise<CompiledAiExecutionContractV1> {
  const { definition, scope, compilation, toolRegistry } = input;
  if (!isPlainRecord(compilation.taskInput ?? {})) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      'taskInput 必须是 JSON object。',
    );
  }
  validateScope(definition, scope, compilation);
  const availableTools = new Set(
    toolRegistry.tools.map((tool) => `${tool.name}@${tool.version}`),
  );
  const allowedTools = [...new Set(definition.allowedTools)].sort();
  for (const toolName of allowedTools) {
    if (!availableTools.has(toolName)) {
      throw new AiCompilationError(
        'AI_CONSTRAINT_POLICY_INVALID',
        `任务策略引用了未注册工具 ${toolName}。`,
      );
    }
  }
  const promptTemplateBody = normalizeCompilationText(definition.promptTemplateBody);
  const userPrompt = normalizeCompilationText(definition.userPrompt);
  const fixedMessages = {
    messages: [
      { role: 'system', content: `${promptTemplateBody}\n\n${CONTEXT_ENVELOPE}` },
      { role: 'user', content: userPrompt },
    ],
  };
  const fixedMessageTokens = estimateTokens(JSON.stringify(fixedMessages)) + MESSAGE_SAFETY_TOKENS;
  const contextSnapshot = await compileAiContext({
    sources: compilation.sources,
    missingSourceTypes: compilation.missingSourceTypes,
    modelContextTokens: definition.modelContextTokens,
    reservedOutputTokens: definition.maxOutputTokens,
    fixedMessageTokens,
  });
  const systemMessage = contextSnapshot.compiledContext
    ? `${promptTemplateBody}\n\n${CONTEXT_ENVELOPE}${contextSnapshot.compiledContext}`
    : promptTemplateBody;
  const request = {
    taskType: definition.taskType,
    messages: [
      { role: 'system' as const, content: systemMessage },
      { role: 'user' as const, content: userPrompt },
    ],
    temperature: temperature(definition, input.settings),
    maxTokens: definition.maxOutputTokens,
    promptTemplateSource: definition.promptTemplateId,
  };
  const requestBody = JSON.stringify({ messages: request.messages });
  const requestBodyHash = await sha256(requestBody);
  const constraintSnapshot = await compileAiConstraint({
    taskType: definition.taskType,
    expectedArtifactType: definition.expectedArtifactType,
    expectedArtifactSchemaVersion: definition.expectedArtifactSchemaVersion,
    responseSchema: definition.responseSchema,
    constraints: definition.constraints,
    promptTemplateId: definition.promptTemplateId,
    promptTemplateVersion: definition.promptTemplateVersion,
    promptTemplateBody,
    providerId: input.providerId,
    model: input.modelId,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    toolPolicy: {
      registryVersion: 'tool_registry_v1',
      registryHash: toolRegistry.registryHash,
      allowedTools,
    },
  });
  const taskInput = compilation.taskInput ?? {};
  const compilationHash = await canonicalHash({
    contractVersion: 'compiled_ai_execution_v1',
    taskType: definition.taskType,
    scope,
    expectedArtifactType: definition.expectedArtifactType,
    expectedArtifactSchemaVersion: definition.expectedArtifactSchemaVersion,
    requestBodyHash,
    taskInput,
    contextManifest: contextSnapshot.sourceManifestJson,
    contextBudget: contextSnapshot.budgetJson,
    constraintPayload: constraintSnapshot.payloadJson,
    promptTemplateHash: constraintSnapshot.promptTemplateHash,
    providerOptions: constraintSnapshot.providerOptionsJson,
  });
  return {
    contractVersion: 'compiled_ai_execution_v1',
    taskType: definition.taskType,
    expectedArtifactType: definition.expectedArtifactType,
    expectedArtifactSchemaVersion: definition.expectedArtifactSchemaVersion,
    request,
    inputType: 'compiled_provider_messages_v1',
    inputPayloadJson: {
      contractVersion: 'compiled_ai_request_v1',
      taskType: definition.taskType,
      messageCount: request.messages.length,
      requestBodyHash,
      compilationHash,
      taskInput,
    },
    contextSnapshot,
    constraintSnapshot,
  };
}
