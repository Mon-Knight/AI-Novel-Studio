import type { RuleSystem, SaveRuleSystemInput, WorldSetting } from '../../types/setting';
import type { WorldRuleChange } from '../../types/worldRules';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { settingRepository } from '../database/settingRepository';
import { parseWorldRuleDocument, serializeWorldRuleDocument } from './worldRuleSchema';
import { CHAPTER_SOURCE_REF_PREFIX } from './chapterSourceReference';

export type SourceReviewAsset = {
  kind: 'world_setting' | 'rule_system';
  record: WorldSetting | RuleSystem;
};
export interface ChapterSourceReviewSnapshot {
  novelId: string;
  chapterId: string;
  draftId: string;
  contentHash: string;
  versionNo: number;
  content: string;
  assets: SourceReviewAsset[];
}

export async function loadChapterSourceReview(
  novelId: string,
  chapterId: string,
  draftId: string,
): Promise<ChapterSourceReviewSnapshot> {
  const chapter = await chapterRepository.getById(chapterId);
  const draft = await draftVersionService.getById(chapterId, draftId);
  if (
    !chapter ||
    chapter.id !== chapterId ||
    chapter.deletedAt ||
    chapter.novelId !== novelId ||
    chapter.adoptedDraftId !== draftId ||
    !draft ||
    draft.id !== draftId ||
    draft.chapterId !== chapterId ||
    draft.novelId !== novelId ||
    !draft.isAdopted ||
    draft.contentState?.status !== 'ready' ||
    draft.contentState.content !== draft.content ||
    !draft.content.trim()
  ) {
    throw new Error('请先保存并采用当前正文，再核对源设定；采用稿必须完整可读。');
  }
  const [worlds, rules] = await Promise.all([
    settingRepository.getWorldSettings(novelId),
    settingRepository.getRuleSystems(novelId),
  ]);
  if ([...worlds, ...rules].some((item) => item.novelId !== novelId))
    throw new Error('源设定归属不匹配，请重新加载。');
  return {
    novelId,
    chapterId,
    draftId,
    content: draft.content,
    contentHash: await computeContentSha256(draft.content),
    versionNo: draft.versionNo,
    assets: [
      ...worlds
        .filter((item) => item.isActive)
        .map((record) => ({ kind: 'world_setting' as const, record })),
      ...rules
        .filter((item) => item.isActive)
        .map((record) => ({ kind: 'rule_system' as const, record })),
    ],
  };
}

async function requireCurrentSource(snapshot: ChapterSourceReviewSnapshot) {
  const chapter = await chapterRepository.getById(snapshot.chapterId);
  const draft = await draftVersionService.getById(snapshot.chapterId, snapshot.draftId);
  if (
    chapter?.novelId !== snapshot.novelId ||
    chapter.id !== snapshot.chapterId ||
    chapter.deletedAt ||
    chapter.adoptedDraftId !== snapshot.draftId ||
    draft?.novelId !== snapshot.novelId ||
    draft.id !== snapshot.draftId ||
    draft.chapterId !== snapshot.chapterId ||
    !draft.isAdopted ||
    draft.contentState?.status !== 'ready' ||
    draft.contentState.content !== draft.content ||
    (await computeContentSha256(draft.content)) !== snapshot.contentHash
  ) {
    throw new Error('CHAPTER_SOURCE_CHANGED: 采用正文已变化，请重新打开核对并预览影响。');
  }
}

function reference(snapshot: ChapterSourceReviewSnapshot): string {
  return `${CHAPTER_SOURCE_REF_PREFIX}${snapshot.chapterId}:${snapshot.draftId}:${snapshot.contentHash}`;
}

function withSourceReference(
  structuredJson: string | undefined,
  snapshot: ChapterSourceReviewSnapshot,
) {
  const parsed = parseWorldRuleDocument(structuredJson);
  // Opaque legacy metadata is preserved; the native write also verifies the reference in author notes.
  if (parsed.status !== 'valid') return structuredJson;
  return serializeWorldRuleDocument({
    ...parsed.document,
    provenance: {
      origin: 'adopted_text',
      sourceRefs: [...new Set([...parsed.document.provenance.sourceRefs, reference(snapshot)])],
    },
  });
}

export async function previewChapterSourceCorrection(
  snapshot: ChapterSourceReviewSnapshot,
  change: WorldRuleChange,
) {
  await requireCurrentSource(snapshot);
  if (
    !snapshot.assets.some(
      (item) => item.kind === change.targetType && item.record.id === change.targetId,
    )
  ) {
    throw new Error('源设定已失效，请重新加载。');
  }
  return settingRepository.previewWorldRuleChange(snapshot.novelId, [
    {
      ...change,
      structuredJson: withSourceReference(change.structuredJson, snapshot),
    },
  ]);
}

export async function saveChapterSourceCorrection(
  snapshot: ChapterSourceReviewSnapshot,
  asset: SourceReviewAsset,
  input: Omit<SaveRuleSystemInput, 'novelId'>,
) {
  await requireCurrentSource(snapshot);
  if (
    !snapshot.assets.some(
      (item) => item.kind === asset.kind && item.record.id === asset.record.id,
    ) ||
    input.expectedUpdatedAt !== asset.record.updatedAt ||
    !input.changeAuthorization
  ) {
    throw new Error('请重新预览并确认所选源设定的修改。');
  }
  const payload = {
    ...input,
    novelId: snapshot.novelId,
    structuredJson: withSourceReference(input.structuredJson, snapshot),
    changeAuthorization: {
      ...input.changeAuthorization,
      notes: [input.changeAuthorization.notes?.trim(), reference(snapshot)]
        .filter(Boolean)
        .join('\n'),
    },
  };
  return asset.kind === 'world_setting'
    ? settingRepository.saveWorldSetting(asset.record.id, payload)
    : settingRepository.saveRuleSystem(asset.record.id, payload);
}

/** Literal changed paragraphs aid review; they do not assert a semantic contradiction. */
export function changedSourceParagraphs(before: string | undefined, after: string) {
  if (before === undefined) return null;
  const paragraphs = (text: string) =>
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  const oldLines = paragraphs(before),
    newLines = paragraphs(after);
  const oldSet = new Set(oldLines),
    newSet = new Set(newLines);
  return {
    removed: oldLines.filter((line) => !newSet.has(line)),
    added: newLines.filter((line) => !oldSet.has(line)),
  };
}

export function sourceReviewMatches(asset: SourceReviewAsset, changedText: string): string[] {
  const phrases = new Set(
    changedText
      .match(/[\p{Script=Han}\p{L}\p{N}]{4,}/gu)
      ?.flatMap((text) =>
        Array.from({ length: text.length - 3 }, (_, index) => text.slice(index, index + 4)),
      ) ?? [],
  );
  const text = `${asset.record.title}\n${asset.record.content}\n${'forbiddenRules' in asset.record ? (asset.record.forbiddenRules ?? '') : ''}`;
  return [...phrases].filter((phrase) => text.includes(phrase)).slice(0, 5);
}
