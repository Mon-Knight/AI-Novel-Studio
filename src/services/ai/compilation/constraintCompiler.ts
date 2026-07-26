import type {
  AiToolPolicySnapshotV1,
  CompiledAiConstraintV1,
} from '../../../types/aiCompilation';
import type { AiTaskType } from '../../../types/ai-task';
import type { ResultArtifactType } from '../../../types/result-artifact';
import {
  canonicalHash,
  isPlainRecord,
  normalizeCompilationText,
  sha256,
  unicodeLength,
} from './canonical';
import { AiCompilationError } from './errors';

export interface CompileAiConstraintInput {
  taskType: AiTaskType;
  expectedArtifactType: ResultArtifactType;
  expectedArtifactSchemaVersion: number;
  responseSchema: string;
  constraints: Record<string, unknown>;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateBody: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  toolPolicy: AiToolPolicySnapshotV1;
}

function identifier(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9._:/@-]+$/.test(normalized)) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      `${label} 不是有效的稳定标识。`,
    );
  }
  return normalized;
}

function validateToolPolicy(input: AiToolPolicySnapshotV1): AiToolPolicySnapshotV1 {
  if (input.registryVersion !== 'tool_registry_v1' || !/^[0-9a-f]{64}$/.test(input.registryHash)) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'Tool Registry identity 无效。',
    );
  }
  if (!Array.isArray(input.allowedTools) || input.allowedTools.length > 128) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'allowedTools 必须是最多 128 项的数组。',
    );
  }
  const allowedTools = [...new Set(input.allowedTools.map((name) => (
    identifier(name, 'allowed tool', 192)
  )))].sort();
  return { ...input, allowedTools };
}

export async function compileAiConstraint(
  input: CompileAiConstraintInput,
): Promise<CompiledAiConstraintV1> {
  if (!isPlainRecord(input.constraints)) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'constraints 必须是 JSON object。',
    );
  }
  if (!Number.isInteger(input.expectedArtifactSchemaVersion)
    || input.expectedArtifactSchemaVersion < 1
    || input.expectedArtifactSchemaVersion > 1000) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'Artifact schemaVersion 无效。',
    );
  }
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'temperature 必须位于 0～2。',
    );
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 1_000_000) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'maxTokens 无效。',
    );
  }
  const promptTemplateBody = normalizeCompilationText(input.promptTemplateBody);
  if (!promptTemplateBody || unicodeLength(promptTemplateBody) > 100_000) {
    throw new AiCompilationError(
      'AI_CONSTRAINT_POLICY_INVALID',
      'Prompt 模板为空或超过长度限制。',
    );
  }
  const promptTemplateId = identifier(input.promptTemplateId, 'promptTemplateId', 160);
  const promptTemplateVersion = identifier(
    input.promptTemplateVersion,
    'promptTemplateVersion',
    96,
  );
  const responseSchema = identifier(input.responseSchema, 'responseSchema', 160);
  const providerId = identifier(input.providerId, 'providerId', 160);
  const model = identifier(input.model, 'model', 160);
  const toolPolicy = validateToolPolicy(input.toolPolicy);
  const constraintsHash = await canonicalHash(input.constraints);
  return {
    schemaVersion: 2,
    compilerVersion: 'constraint_compiler_v1',
    payloadJson: {
      contractVersion: 'constraint_payload_v1',
      compilerVersion: 'constraint_compiler_v1',
      taskType: input.taskType,
      expectedArtifact: {
        type: input.expectedArtifactType,
        schemaVersion: input.expectedArtifactSchemaVersion,
      },
      responseSchema,
      constraints: input.constraints,
      constraintsHash,
      toolPolicy,
    },
    promptTemplateId,
    promptTemplateVersion,
    promptTemplateHash: await sha256(promptTemplateBody),
    promptTemplateBody,
    providerOptionsJson: {
      providerId,
      model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    },
  };
}
