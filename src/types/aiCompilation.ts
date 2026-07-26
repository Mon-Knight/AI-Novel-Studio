import type { AiGenerateRequest } from './ai';
import type { AiTaskScope, AiTaskType } from './ai-task';
import type { ResultArtifactType } from './result-artifact';

export type AiContextSourceType =
  | 'novel'
  | 'chapter'
  | 'draft'
  | 'world_setting'
  | 'rule_system'
  | 'protagonist'
  | 'character'
  | 'chapter_event'
  | 'outline'
  | 'context_record'
  | 'style_profile'
  | 'output_profile'
  | 'request_context';

export type AiContextSourceOrigin = 'sqlite' | 'request' | 'system';

export interface AiContextSourceInput {
  sourceType: AiContextSourceType;
  sourceId: string;
  sourceVersion: string;
  origin: AiContextSourceOrigin;
  label: string;
  content: string;
  order: number;
  priority: number;
  required?: boolean;
  maxTokens?: number;
}

export type CompiledSourceStatus = 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';

export interface CompiledAiContextSource {
  ordinal: number;
  sourceType: AiContextSourceType;
  sourceId: string;
  sourceVersion: string;
  origin: AiContextSourceOrigin;
  label: string;
  order: number;
  priority: number;
  required: boolean;
  contentHash: string;
  originalChars: number;
  originalBytes: number;
  originalTokens: number;
  status: CompiledSourceStatus;
  includedHash?: string;
  includedChars: number;
  includedBytes: number;
  includedTokens: number;
}

export interface AiContextSourceManifestV1 {
  contractVersion: 'context_manifest_v1';
  compilerVersion: 'context_compiler_v1';
  tokenEstimator: 'utf8_bytes_div3_v1';
  compiledContextHash: string;
  missingSourceTypes: AiContextSourceType[];
  sources: CompiledAiContextSource[];
}

export interface AiContextBudgetV1 {
  contractVersion: 'context_budget_v1';
  tokenEstimator: 'utf8_bytes_div3_v1';
  modelContextTokens: number;
  reservedOutputTokens: number;
  fixedMessageTokens: number;
  availableContextTokens: number;
  compiledContextTokens: number;
  compiledContextChars: number;
  compiledContextBytes: number;
  includedSourceCount: number;
  truncatedSourceCount: number;
  omittedSourceCount: number;
}

export interface CompiledAiContextV1 {
  schemaVersion: 2;
  compilerVersion: 'context_compiler_v1';
  sourceManifestJson: AiContextSourceManifestV1;
  compiledContext: string;
  budgetJson: AiContextBudgetV1;
}

export interface AiToolPolicySnapshotV1 {
  registryVersion: 'tool_registry_v1';
  registryHash: string;
  allowedTools: string[];
}

export interface AiConstraintPayloadV1 {
  contractVersion: 'constraint_payload_v1';
  compilerVersion: 'constraint_compiler_v1';
  taskType: AiTaskType;
  expectedArtifact: {
    type: ResultArtifactType;
    schemaVersion: number;
  };
  responseSchema: string;
  constraints: Record<string, unknown>;
  constraintsHash: string;
  toolPolicy: AiToolPolicySnapshotV1;
}

export interface CompiledAiConstraintV1 {
  schemaVersion: 2;
  compilerVersion: 'constraint_compiler_v1';
  payloadJson: AiConstraintPayloadV1;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateHash: string;
  promptTemplateBody: string;
  providerOptionsJson: {
    providerId: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

export interface AiCompilationScope {
  scopeType: AiTaskScope;
  novelId: string;
  chapterId?: string;
  draftId?: string;
}

export interface AiExecutionCompilationInput {
  sources: AiContextSourceInput[];
  missingSourceTypes?: AiContextSourceType[];
  taskInput?: Record<string, unknown>;
}

export interface CompiledAiExecutionContractV1 {
  contractVersion: 'compiled_ai_execution_v1';
  taskType: AiTaskType;
  expectedArtifactType: ResultArtifactType;
  expectedArtifactSchemaVersion: number;
  request: AiGenerateRequest;
  inputType: 'compiled_provider_messages_v1';
  inputPayloadJson: {
    contractVersion: 'compiled_ai_request_v1';
    taskType: AiTaskType;
    messageCount: number;
    requestBodyHash: string;
    compilationHash: string;
    taskInput: Record<string, unknown>;
  };
  contextSnapshot: CompiledAiContextV1;
  constraintSnapshot: CompiledAiConstraintV1;
}

export type AiContextDriftStatus = 'unchanged' | 'changed' | 'missing' | 'unexpected';

export interface AiContextDriftItem {
  sourceType: AiContextSourceType;
  sourceId: string;
  status: AiContextDriftStatus;
  expectedVersion?: string;
  actualVersion?: string;
  expectedHash?: string;
  actualHash?: string;
}

export interface AiContextDriftReport {
  matches: boolean;
  items: AiContextDriftItem[];
}
