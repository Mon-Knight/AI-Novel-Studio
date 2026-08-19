import { canonicalHash } from '../ai/compilation/canonical';
import { dbCall, lsGet, nowISO } from '../database/db';
import type {
  AutonomousPlanningBaseline,
  AutonomousPlanningChapterBaseline,
  AutonomousPlanningEntityBaseline,
  AutonomousPlanningVolumeBaseline,
} from '../../types/autonomousCreation';

const VOLUME_KEY = 'ai_novel_studio_volumes';
const CHAPTER_KEY = 'ai_novel_studio_chapters';
const CHARACTER_KEY = 'ai_novel_studio_characters';
const WORLD_KEY = 'ai_novel_studio_world_settings';

function records(key: string): Record<string, unknown>[] {
  const value = lsGet<unknown>(key);
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function belongsToNovel(item: Record<string, unknown>, novelId: string): boolean {
  return (item.novelId ?? item.novel_id) === novelId;
}

function localBaseline(novelId: string): Omit<AutonomousPlanningBaseline, 'structureHash'> {
  const existingVolumes: AutonomousPlanningVolumeBaseline[] = records(VOLUME_KEY)
    .filter((item) => belongsToNovel(item, novelId) && !item.deletedAt && !item.deleted_at)
    .map((item) => ({
      id: text(item.id) ?? '',
      orderIndex: number(item.orderIndex ?? item.order_index, 0),
      title: text(item.title) ?? '未命名分卷',
      status: text(item.status),
    }))
    .filter((item) => item.id)
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const existingChapters: AutonomousPlanningChapterBaseline[] = records(CHAPTER_KEY)
    .filter((item) => belongsToNovel(item, novelId) && !item.deletedAt && !item.deleted_at)
    .map((item) => ({
      id: text(item.id) ?? '',
      volumeId: text(item.volumeId ?? item.volume_id),
      chapterNumber: number(item.chapterNumber ?? item.chapter_number, 1),
      orderIndex: number(item.orderIndex ?? item.order_index, 0),
      title: text(item.title) ?? '未命名章节',
      outline: text(item.outline),
      goal: text(item.goal),
      status: text(item.status),
      adoptedDraftId: text(item.adoptedDraftId ?? item.adopted_draft_id),
      contentHash: text(item.contentHash ?? item.content_hash),
      summary: text(item.summary),
    }))
    .filter((item) => item.id)
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const existingCharacters: AutonomousPlanningEntityBaseline[] = records(CHARACTER_KEY)
    .filter(
      (item) => belongsToNovel(item, novelId) && item.isActive !== false && item.is_active !== 0,
    )
    .map((item) => ({
      id: text(item.id) ?? '',
      name: text(item.name) ?? '未命名角色',
      role: text(item.roleType ?? item.role_type),
      summary: text(item.currentState ?? item.current_state ?? item.identity),
    }))
    .filter((item) => item.id);
  const existingWorldElements: AutonomousPlanningEntityBaseline[] = records(WORLD_KEY)
    .filter(
      (item) => belongsToNovel(item, novelId) && item.isActive !== false && item.is_active !== 0,
    )
    .map((item) => ({
      id: text(item.id) ?? '',
      name: text(item.title ?? item.name) ?? '未命名设定',
      summary: text(item.content ?? item.summary),
    }))
    .filter((item) => item.id);
  return {
    novelId,
    capturedAt: nowISO(),
    existingVolumes,
    existingChapters,
    existingCharacters,
    existingWorldElements,
  };
}

function isBaseline(
  value: unknown,
): value is Omit<AutonomousPlanningBaseline, 'structureHash'> & { structureHash?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.novelId === 'string' &&
    typeof item.capturedAt === 'string' &&
    Array.isArray(item.existingVolumes) &&
    Array.isArray(item.existingChapters) &&
    Array.isArray(item.existingCharacters) &&
    Array.isArray(item.existingWorldElements)
  );
}

function structurePayload(baseline: Omit<AutonomousPlanningBaseline, 'structureHash'>) {
  return {
    novelId: baseline.novelId,
    existingVolumes: baseline.existingVolumes,
    existingChapters: baseline.existingChapters,
    existingCharacters: baseline.existingCharacters,
    existingWorldElements: baseline.existingWorldElements,
  };
}

export async function getAutonomousPlanningBaseline(
  novelId: string,
): Promise<AutonomousPlanningBaseline> {
  const raw = await dbCall<unknown>(
    'get_autonomous_planning_baseline',
    { input: { novelId } },
    () => localBaseline(novelId),
  );
  if (!isBaseline(raw) || raw.novelId !== novelId) {
    throw new Error('自主规划基线返回格式无效。');
  }
  const normalized = raw as Omit<AutonomousPlanningBaseline, 'structureHash'> & {
    structureHash?: string;
  };
  const structureHash =
    typeof normalized.structureHash === 'string' && /^[0-9a-f]{64}$/.test(normalized.structureHash)
      ? normalized.structureHash
      : await canonicalHash(structurePayload(normalized));
  return { ...normalized, structureHash };
}

export function autonomousPlanningStructurePayload(
  baseline: AutonomousPlanningBaseline,
): Record<string, unknown> {
  return structurePayload(baseline);
}
