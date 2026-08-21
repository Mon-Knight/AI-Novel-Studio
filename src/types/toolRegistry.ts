export type ToolJsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface ToolJsonSchema {
  type?: ToolJsonSchemaType;
  description?: string;
  properties?: Record<string, ToolJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolJsonSchema;
  enum?: Array<string | number | boolean | null>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export type ToolPermission =
  'novel.read' | 'chapter.read' | 'style.read' | 'verification.execute' | 'business.write';

export type ToolSideEffect = 'none' | 'create' | 'update' | 'delete' | 'external';
export type ToolConfirmationPolicy = 'never' | 'user_confirmation';
export type ToolScope = 'system' | 'novel' | 'chapter' | 'draft';

export interface ToolDescriptorV1 {
  name: string;
  version: string;
  description: string;
  inputSchema: ToolJsonSchema;
  outputSchema: ToolJsonSchema;
  permissions: ToolPermission[];
  scope: ToolScope;
  sideEffect: ToolSideEffect;
  confirmationPolicy: ToolConfirmationPolicy;
  timeoutMs: number;
}

export interface ToolRegistryManifestV1 {
  contractVersion: 'tool_registry_manifest_v1';
  registryVersion: 'tool_registry_v1';
  registryHash: string;
  tools: ToolDescriptorV1[];
}

export interface ToolInvocationContext {
  invocationId: string;
  novelId?: string;
  chapterId?: string;
  draftId?: string;
  grantedPermissions: ToolPermission[];
  allowedTools: string[];
  confirmation?: {
    confirmedBy: 'user';
    userConfirmedAt: string;
    planId: string;
    operationId: string;
    planHash: string;
  };
  dryRun?: boolean;
  modelSnapshot?: {
    providerId: string;
    modelId: string;
    runtimeMode: 'mock' | 'api';
    baseUrl?: string;
    capabilities?: string[];
    options?: Record<string, unknown>;
    pricing?: {
      inputPricePerMillionTokens?: number;
      outputPricePerMillionTokens?: number;
    };
  };
  signal?: AbortSignal;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  toolVersion?: string;
  artifactType?: string;
  candidateOnly?: boolean;
  data?: T;
  error?: string;
  source?: string;
  warnings?: string[];
}

export type ToolRegistryErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_VERSION_MISMATCH'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_ARGUMENT_INVALID'
  | 'TOOL_SCOPE_MISMATCH'
  | 'TOOL_CONFIRMATION_REQUIRED'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_EXECUTION_FAILED';
