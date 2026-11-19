import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import type { AiProviderRequestEvidence } from '../ai/aiExecutionPipeline';

export interface WorkbenchProviderRequestEvidence {
  schemaVersion: 'workbench_provider_request_evidence_v1';
  hashAlgorithm: 'sha256';
  messagesSerialization: 'json_stringify_messages_v1';
  taskId?: string;
  attemptId?: string;
  messagesSha256: string;
  messageCount: number;
  compiledContextSha256: string;
  snapshotContextHash: string;
  snapshotCompiledPromptSha256: string;
  snapshotRequestSourceSha256: string;
  includedSnapshotRequestSourceSha256?: string;
  snapshotRequestSourceStatus: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  providerSourceStatus?: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  generationSourceStatuses?: Record<
    string,
    'included' | 'truncated' | 'omitted_empty' | 'omitted_budget'
  >;
}

export async function linkProviderRequestEvidence(
  snapshot: ChapterGenerationSnapshot,
  requestSourceVersion: string,
  evidence: AiProviderRequestEvidence | undefined,
  identity: { taskId?: string; attemptId?: string },
  currentDraftVersion?: string,
): Promise<WorkbenchProviderRequestEvidence | undefined> {
  if (!evidence) return undefined;
  const snapshotSource = evidence.requestContextSources.find(
    (source) => source.sourceVersion === requestSourceVersion,
  );
  if (!snapshotSource) return undefined;
  const providerSources = evidence.sources ?? [];
  const strictestStatus = (
    statuses: Array<'included' | 'truncated' | 'omitted_empty' | 'omitted_budget'>,
  ) => {
    if (statuses.includes('omitted_budget')) return 'omitted_budget' as const;
    if (statuses.includes('omitted_empty')) return 'omitted_empty' as const;
    if (statuses.includes('truncated')) return 'truncated' as const;
    return statuses.length > 0 ? ('included' as const) : undefined;
  };
  const generationSourceStatuses: WorkbenchProviderRequestEvidence['generationSourceStatuses'] = {};
  const mergeGenerationStatus = (
    sourceType: string,
    status: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget',
  ) => {
    const current = generationSourceStatuses[sourceType];
    generationSourceStatuses[sourceType] = strictestStatus(current ? [current, status] : [status])!;
  };
  for (const section of snapshot.compiledContext.sections) {
    const providerSource = providerSources.find(
      (source) => source.sourceVersion === snapshot.contextHash && source.label === section.title,
    );
    if (!providerSource) continue;
    for (const sourceType of section.sourceTypes) {
      mergeGenerationStatus(sourceType, providerSource.status);
    }
  }
  const requestProviderSource = providerSources.find(
    (source) =>
      source.sourceType === 'request_context' && source.sourceVersion === requestSourceVersion,
  );
  if (requestProviderSource) {
    mergeGenerationStatus('user_instruction', requestProviderSource.status);
  }
  if (currentDraftVersion) {
    const draftProviderSource = providerSources.find(
      (source) =>
        source.sourceType === 'draft' &&
        source.sourceVersion === currentDraftVersion &&
        source.label === 'Current chapter repair draft',
    );
    if (draftProviderSource) {
      mergeGenerationStatus('current_editor', draftProviderSource.status);
    }
  }
  return {
    schemaVersion: 'workbench_provider_request_evidence_v1',
    hashAlgorithm: evidence.hashAlgorithm,
    messagesSerialization: evidence.messagesSerialization,
    ...(identity.taskId ? { taskId: identity.taskId } : {}),
    ...(identity.attemptId ? { attemptId: identity.attemptId } : {}),
    messagesSha256: evidence.messagesSha256,
    messageCount: evidence.messageCount,
    compiledContextSha256: evidence.compiledContextSha256,
    snapshotContextHash: snapshot.contextHash,
    snapshotCompiledPromptSha256: await computeContentSha256(
      snapshot.compiledPromptText.replace(/\r\n?/g, '\n').trim(),
    ),
    snapshotRequestSourceSha256: snapshotSource.contentSha256,
    ...(snapshotSource.includedSha256
      ? { includedSnapshotRequestSourceSha256: snapshotSource.includedSha256 }
      : {}),
    snapshotRequestSourceStatus: snapshotSource.status,
    ...(strictestStatus(providerSources.map((source) => source.status))
      ? { providerSourceStatus: strictestStatus(providerSources.map((source) => source.status)) }
      : {}),
    ...(Object.keys(generationSourceStatuses).length > 0 ? { generationSourceStatuses } : {}),
  };
}
