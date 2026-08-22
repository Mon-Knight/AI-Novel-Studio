import type { AiTaskType } from './ai-task';

export type ModelKind = 'cloud' | 'local' | 'remote' | 'mock';

export type ModelCapability =
  | 'director.world'
  | 'director.character'
  | 'director.plot'
  | 'director.scene_plan'
  | 'director.repair'
  | 'writer.scene_prose'
  | 'writer.beat_prose'
  | 'writer.chapter_fallback'
  | 'critic.quality'
  | 'critic.review'
  | 'planner.prepare';

export type CreativeRole =
  | 'director.world'
  | 'director.character'
  | 'director.plot'
  | 'director.scene_plan'
  | 'director.repair'
  | 'writer.beat_prose'
  | 'writer.chapter_fallback'
  | 'critic.quality'
  | 'planner.prepare';

export type ModelLifecycle = 'AVAILABLE' | 'TRAINING' | 'TESTING' | 'FAILED' | 'DISABLED';

export type ModelHealth = 'ok' | 'down' | 'unknown';

export type RouteReason =
  | 'role_default'
  | 'cloud_writer_primary'
  | 'remote_gateway_primary'
  | 'remote_writer_primary'
  | 'local_available'
  | 'local_training'
  | 'local_testing'
  | 'local_failed'
  | 'local_disabled'
  | 'local_unhealthy'
  | 'context_too_large_for_local'
  | 'remote_gateway_fallback'
  | 'remote_writer_fallback'
  | 'cloud_writer_fallback'
  | 'mock';

export interface ModelRef {
  endpointId: string;
  providerId: string;
  modelId: string;
  kind: ModelKind;
}

export interface RemoteModelProvider {
  providerId: string;
  baseUrl: string;
  protocol: 'openai_compatible';
  authType: 'bearer_token' | 'api_key';
}

export interface ModelEndpoint extends ModelRef {
  protocol: 'chat_completions_v1';
  providerFamily: 'mock' | 'openai_compatible' | 'local_openai_compatible';
  capabilities: ModelCapability[];
  contextTokens: number;
  maxOutputTokens: number;
  loopbackRequired: boolean;
  priced: boolean;
}

export interface RemoteModelEndpoint extends ModelEndpoint {
  kind: 'remote';
  providerFamily: 'openai_compatible';
}

export type LocalModelBenchmarkStatus = 'pending' | 'passed' | 'failed';

export interface LocalModelBenchmarkSummaryV1 {
  status: LocalModelBenchmarkStatus;
  casesTotal: number;
  casesPassed: number;
  passRate: number;
  threshold: number;
  completedAt?: string;
  reportHash?: string;
}

export interface LocalModelLifecycleSidecarV1 {
  schemaVersion: 1;
  endpointId: string;
  providerId: string;
  modelId: string;
  lifecycle: ModelLifecycle;
  updatedAt: string;
  benchmark?: LocalModelBenchmarkSummaryV1;
  failureReason?: string;
}

export interface RouteRequest {
  role: CreativeRole;
  taskType: AiTaskType;
  compiledContextTokens?: number;
  localEnabled: boolean;
  localLifecycle: ModelLifecycle;
  localHealth: ModelHealth;
  localContextTokens?: number;
  localMaxOutputTokens?: number;
  remoteEnabled?: boolean;
  remoteAvailable?: boolean;
  remoteContextTokens?: number;
  remoteMaxOutputTokens?: number;
  cloudAvailable: boolean;
  runtimeMode: 'mock' | 'api';
  allowCloudWriterFallback: boolean;
  mockRef: ModelRef;
  cloudRef: ModelRef;
  localRef?: ModelRef;
  remoteRef?: ModelRef;
}

export interface RouteDecision {
  schemaVersion: 1;
  role: CreativeRole;
  taskType: AiTaskType;
  primary: ModelRef;
  fallback?: ModelRef;
  selected: ModelRef;
  reason: RouteReason;
  fallbackUsed: boolean;
  decidedAt: string;
}

export const ROUTE_DECISION_TASK_INPUT_KEY = 'routeDecision';
