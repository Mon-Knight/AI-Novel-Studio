import type { ResultArtifactBundle } from '../../types/result-artifact';
import type { CharacterCandidate, CharacterRoleType } from '../../types/character';
import { characterService } from '../characters/characterService';
import { chapterEventService } from '../characters/chapterEventService';
import { chapterOutlineService, masterOutlineService } from '../outlines/outlineService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { isTauri } from '../database/db';
import { draftVersionService } from '../database/draftVersionService';
import { placementRuntimeService } from '../placements/placementRuntimeService';
import {
  CONTEXT_COMPRESSION_TITLE_PREFIX,
  isContextCompressionCandidate,
  novelContextCompressionProvider,
  type NovelContextCompressionCandidate,
} from '../context/novelContextCompressionProvider';
export interface ArtifactApplyInput {
  novelId: string;
  chapterId?: string;
  baseRevision?: string;
}

export interface ArtifactApplyOutcome {
  applyTransactionId?: string;
  conflictCode?: string;
}

const ROLE_TYPES = new Set<CharacterRoleType>([
  'protagonist',
  'supporting',
  'antagonist',
  'neutral',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start < 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(start)) as unknown;
    } catch {
      return undefined;
    }
  }
}

export function extractCandidatePayload(bundle: ResultArtifactBundle): unknown {
  if (bundle.structuredPayloadJson !== undefined && bundle.structuredPayloadJson !== null) {
    return bundle.structuredPayloadJson;
  }
  return parseJsonValue(bundle.rawContent) ?? parseJsonValue(bundle.displayContent ?? '');
}

export function extractCandidateText(bundle: ResultArtifactBundle): string {
  const payload = extractCandidatePayload(bundle);
  const object = record(payload);
  const nested = record(object?.data);
  return (
    asText(nested?.text) ||
    asText(object?.text) ||
    asText(object?.content) ||
    asText(object?.summary) ||
    bundle.displayContent?.trim() ||
    bundle.rawContent.trim()
  );
}

function characterFromUnknown(value: unknown): CharacterCandidate | undefined {
  const object = record(value);
  const name = asText(object?.name);
  if (!name) return undefined;
  const roleType = asText(object?.roleType);
  return {
    name,
    roleType: ROLE_TYPES.has(roleType as CharacterRoleType)
      ? (roleType as CharacterRoleType)
      : undefined,
    identity: asText(object?.identity) || undefined,
    faction: asText(object?.faction) || undefined,
    relationToProtagonist: asText(object?.relationToProtagonist) || undefined,
    goal: asText(object?.goal) || undefined,
    personality: asText(object?.personality) || undefined,
    behaviorLimits: asText(object?.behaviorLimits) || undefined,
    forbiddenBehaviors: asText(object?.forbiddenBehaviors) || undefined,
    currentState: asText(object?.currentState) || undefined,
  };
}

function listFromPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const object = record(payload);
  if (!object) return [];
  const nested = record(object.data);
  for (const key of keys) {
    const value = object[key] ?? nested?.[key];
    if (Array.isArray(value)) return value;
  }
  const text = asText(nested?.text) || asText(object.text);
  const parsed = parseJsonValue(text);
  if (Array.isArray(parsed)) return parsed;
  const parsedObject = record(parsed);
  for (const key of keys) {
    const value = parsedObject?.[key];
    if (Array.isArray(value)) return value;
  }
  return parsedObject ? [parsedObject] : object.name || object.title ? [object] : [];
}

function candidateRows(bundle: ResultArtifactBundle, keys: string[]): unknown[] {
  const fromPayload = listFromPayload(extractCandidatePayload(bundle), keys);
  if (fromPayload.length > 0) return fromPayload;
  return listFromPayload(parseJsonValue(extractCandidateText(bundle)), keys);
}

async function applySettingCandidates(bundle: ResultArtifactBundle): Promise<ArtifactApplyOutcome> {
  if (!isTauri()) {
    return { conflictCode: 'BROWSER_APPLY_UNSUPPORTED' };
  }
  const placement = await placementRuntimeService.prepare({
    artifactId: bundle.artifact.artifactId,
    candidateIndex: 0,
    expectedArtifactHash: bundle.artifact.contentHash,
  });
  const applied = await placementRuntimeService.apply({
    planId: placement.plan.planId,
    operationId: placement.plan.operationId,
    expectedPlanHash: placement.plan.planHash,
  });
  return { applyTransactionId: applied.plan.planId };
}

async function applyOutline(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  const text = extractCandidateText(bundle);
  if (!text) return { conflictCode: 'EMPTY_CANDIDATE' };
  const payload = record(extractCandidatePayload(bundle));
  const title =
    asText(payload?.title) || asText(record(payload?.data)?.title) || `${input.novelId} 大纲候选`;
  try {
    if (input.chapterId) {
      const saved = await chapterOutlineService.save({
        projectId: input.novelId,
        chapterId: input.chapterId,
        title,
        content: text,
        sourceType: 'ai_generated',
        saveAsNewVersion: true,
      });
      await chapterOutlineService.setActive(saved.id, input.novelId);
      return { applyTransactionId: saved.id };
    }
    const saved = await masterOutlineService.save({
      projectId: input.novelId,
      title,
      content: text,
      sourceType: 'workbench_apply',
      saveAsNewVersion: true,
    });
    await masterOutlineService.setActive(saved.id, input.novelId);
    return { applyTransactionId: saved.id };
  } catch (error) {
    return {
      conflictCode: isTauri()
        ? `OUTLINE_APPLY_FAILED:${error instanceof Error ? error.message : 'unknown'}`
        : 'BROWSER_OUTLINE_APPLY_UNSUPPORTED',
    };
  }
}

async function applyCharacters(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  const candidates = candidateRows(bundle, ['characters', 'candidates'])
    .map(characterFromUnknown)
    .filter((item): item is CharacterCandidate => Boolean(item));
  const unique = [...new Map(candidates.map((candidate) => [candidate.name, candidate])).values()];
  if (unique.length === 0) return { conflictCode: 'EMPTY_CANDIDATE' };
  const existing = await characterService.getByNovelId(input.novelId);
  const existingNames = new Set(existing.map((character) => character.name));
  const createdIds: string[] = [];
  for (const candidate of unique) {
    if (existingNames.has(candidate.name)) continue;
    const created = await characterService.create({
      novelId: input.novelId,
      name: candidate.name,
      roleType: candidate.roleType,
      identity: candidate.identity,
      faction: candidate.faction,
      relationToProtagonist: candidate.relationToProtagonist,
      goal: candidate.goal,
      personality: candidate.personality,
      behaviorLimits: candidate.behaviorLimits,
      forbiddenBehaviors: candidate.forbiddenBehaviors,
      currentState: candidate.currentState,
    });
    existingNames.add(created.name);
    createdIds.push(created.id);
  }
  if (createdIds.length === 0) {
    return { conflictCode: 'CHARACTER_CANDIDATES_ALREADY_APPLIED' };
  }
  return { applyTransactionId: createdIds.join(',') };
}

async function applyEvents(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  if (!input.chapterId) return { conflictCode: 'CHAPTER_TARGET_REQUIRED' };
  const rows = candidateRows(bundle, ['events', 'suggestions', 'candidates']);
  const createdIds: string[] = [];
  for (const row of rows) {
    const object = record(row);
    const title = asText(object?.title) || asText(object?.name);
    const description = asText(object?.description) || asText(object?.summary) || title;
    if (!title) continue;
    const created = await chapterEventService.create({
      novelId: input.novelId,
      chapterId: input.chapterId,
      title,
      description,
      status: 'adopted',
      source: 'ai_suggested',
    });
    createdIds.push(created.id);
  }
  if (createdIds.length === 0) {
    const text = extractCandidateText(bundle);
    if (!text) return { conflictCode: 'EMPTY_CANDIDATE' };
    const created = await chapterEventService.create({
      novelId: input.novelId,
      chapterId: input.chapterId,
      title: text.slice(0, 80),
      description: text,
      status: 'adopted',
      source: 'ai_suggested',
    });
    createdIds.push(created.id);
  }
  return { applyTransactionId: createdIds.join(',') };
}

async function applyChapterSummary(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  if (!input.chapterId) return { conflictCode: 'CHAPTER_TARGET_REQUIRED' };
  const adoptedDraft = await draftVersionService.getAdoptedByChapterId(input.chapterId);
  if (!adoptedDraft) {
    return { conflictCode: 'CHAPTER_SUMMARY_ADOPTED_DRAFT_REQUIRED' };
  }
  if (bundle.artifact.sourceDraftId && bundle.artifact.sourceDraftId !== adoptedDraft.id) {
    return { conflictCode: 'CHAPTER_SUMMARY_ADOPTED_DRAFT_MISMATCH' };
  }
  const payload = record(extractCandidatePayload(bundle));
  const nested = record(payload?.data);
  const parsed = record(parseJsonValue(extractCandidateText(bundle)));
  const summary =
    asText(parsed?.summary) ||
    asText(nested?.summary) ||
    asText(payload?.summary) ||
    extractCandidateText(bundle);
  if (!summary) return { conflictCode: 'EMPTY_CANDIDATE' };
  const saved = await chapterSummaryService.create({
    novelId: input.novelId,
    chapterId: input.chapterId,
    adoptedDraftId: adoptedDraft.id,
    summary,
    enabled: true,
    aiTaskId: bundle.artifact.taskId,
    contentHash: bundle.artifact.contentHash,
    draftVersion: adoptedDraft.versionNo,
  });
  return { applyTransactionId: saved.id };
}

async function applyCompressedContext(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  const payload = extractCandidatePayload(bundle);
  const parsed = parseJsonValue(extractCandidateText(bundle));
  const candidate = (
    isContextCompressionCandidate(payload)
      ? payload
      : isContextCompressionCandidate(parsed)
        ? parsed
        : undefined
  ) as NovelContextCompressionCandidate | undefined;
  if (!candidate) return { conflictCode: 'CONTEXT_COMPRESSION_INVALID' };
  if (candidate.novelId !== input.novelId) {
    return { conflictCode: 'CONTEXT_COMPRESSION_SCOPE_MISMATCH' };
  }
  const applied = await novelContextCompressionProvider.apply(candidate);
  return { applyTransactionId: applied.recordId };
}

export async function applyArtifactBundle(
  input: ArtifactApplyInput,
  bundle: ResultArtifactBundle,
): Promise<ArtifactApplyOutcome> {
  const artifactType = bundle.artifact.artifactType;
  if (artifactType === 'quality_report' || artifactType === 'style_analysis') {
    throw new Error('质量或风格报告不能直接写入正式小说事实。');
  }
  if (artifactType === 'chapter_text' || artifactType === 'scene_text') {
    return { conflictCode: 'CHAPTER_REQUIRES_REVIEW' };
  }
  if (artifactType === 'setting_candidates') {
    return applySettingCandidates(bundle);
  }
  if (artifactType === 'outline') {
    return applyOutline(input, bundle);
  }
  if (artifactType === 'character_candidates') {
    return applyCharacters(input, bundle);
  }
  if (artifactType === 'event_candidates') {
    return applyEvents(input, bundle);
  }
  if (artifactType === 'chapter_summary' || artifactType === 'volume_summary') {
    return applyChapterSummary(input, bundle);
  }
  if (
    artifactType === 'generic_json' &&
    (bundle.artifact.derivationType === 'context_compression' ||
      extractCandidateText(bundle).includes(CONTEXT_COMPRESSION_TITLE_PREFIX) ||
      isContextCompressionCandidate(extractCandidatePayload(bundle)))
  ) {
    return applyCompressedContext(input, bundle);
  }
  return { conflictCode: `UNSUPPORTED_APPLY:${artifactType}` };
}
