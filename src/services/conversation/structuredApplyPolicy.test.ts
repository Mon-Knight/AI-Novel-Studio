import { describe, expect, it } from 'vitest';
import {
  CONTEXT_COMPRESSION_PROVIDER_ID,
  CONTEXT_COMPRESSION_PROVIDER_VERSION,
} from '../context/novelContextCompressionProvider';
import {
  isChapterScopedArtifact,
  planStructuredApply,
  resolveArtifactDecisionTarget,
  STRUCTURED_APPLY_TYPES,
  supportsStructuredApply,
} from './structuredApplyPolicy';

const NOVEL = 'novel-1';
const CHAPTER = 'chapter-1';

const compressedText = '压缩后的上下文：主角沈砚。';
const emptyBucket = { required: [], present: [], missing: [] };
const validCompression = {
  providerId: CONTEXT_COMPRESSION_PROVIDER_ID,
  version: CONTEXT_COMPRESSION_PROVIDER_VERSION,
  config: { tokenBudget: 800 },
  novelId: NOVEL,
  sourceRevision: 'rev-0123abcd-3',
  compressedText,
  coverage: {
    characters: { required: ['沈砚'], present: ['沈砚'], missing: [] },
    plot: emptyBucket,
    foreshadow: emptyBucket,
    timeline: emptyBucket,
    world: emptyBucket,
    rules: emptyBucket,
    outlines: emptyBucket,
    style: emptyBucket,
    output: emptyBucket,
    tokens: { budget: 800, used: [...compressedText].length, withinBudget: true },
  },
  valid: true,
};

describe('structuredApplyPolicy', () => {
  it('whitelists exactly the five structured types plus valid context compression', () => {
    expect([...STRUCTURED_APPLY_TYPES]).toEqual([
      'outline',
      'character_candidates',
      'event_candidates',
      'setting_candidates',
      'chapter_summary',
    ]);
    for (const artifactType of STRUCTURED_APPLY_TYPES) {
      expect(supportsStructuredApply({ artifactType })).toBe(true);
    }
    expect(supportsStructuredApply({ artifactType: 'chapter_text' })).toBe(false);
    expect(supportsStructuredApply({ artifactType: 'quality_report' })).toBe(false);
    expect(supportsStructuredApply({ artifactType: 'style_analysis' })).toBe(false);
    expect(supportsStructuredApply({ artifactType: 'generic_json' })).toBe(false);
    expect(supportsStructuredApply({ artifactType: 'generic_json', payload: { foo: 1 } })).toBe(
      false,
    );
    expect(
      supportsStructuredApply({
        artifactType: 'generic_json',
        payload: { ...validCompression, valid: false },
      }),
    ).toBe(false);
    expect(
      supportsStructuredApply({ artifactType: 'generic_json', payload: validCompression }),
    ).toBe(true);
    expect(
      supportsStructuredApply({
        artifactType: 'generic_json',
        derivationType: 'context_compression',
      }),
    ).toBe(true);
  });

  it('mirrors the Rust expected_target matrix for chapter vs novel scope', () => {
    expect(isChapterScopedArtifact('event_candidates', undefined)).toBe(true);
    expect(isChapterScopedArtifact('chapter_summary', undefined)).toBe(true);
    expect(isChapterScopedArtifact('outline', CHAPTER)).toBe(true);
    expect(isChapterScopedArtifact('outline', undefined)).toBe(false);
    expect(isChapterScopedArtifact('character_candidates', CHAPTER)).toBe(false);
    expect(isChapterScopedArtifact('setting_candidates', CHAPTER)).toBe(false);
    expect(isChapterScopedArtifact('generic_json', CHAPTER)).toBe(false);
  });

  it('never lets structured artifacts fall back to the currently opened chapter', () => {
    expect(
      resolveArtifactDecisionTarget({
        artifactType: 'outline',
        currentChapterId: CHAPTER,
        novelId: NOVEL,
      }),
    ).toEqual({ targetType: 'asset', targetId: NOVEL, chapterId: undefined, chapterScoped: false });
    expect(
      resolveArtifactDecisionTarget({
        artifactType: 'chapter_summary',
        currentChapterId: CHAPTER,
        novelId: NOVEL,
      }),
    ).toEqual({ targetType: 'asset', targetId: NOVEL, chapterId: undefined, chapterScoped: true });
    expect(
      resolveArtifactDecisionTarget({
        artifactType: 'chapter_text',
        currentChapterId: CHAPTER,
        novelId: NOVEL,
      }),
    ).toEqual({
      targetType: 'chapter',
      targetId: CHAPTER,
      chapterId: CHAPTER,
      chapterScoped: true,
    });
    expect(
      resolveArtifactDecisionTarget({
        artifactType: 'outline',
        sourceChapterId: CHAPTER,
        novelId: NOVEL,
      }),
    ).toEqual({ targetType: 'asset', targetId: CHAPTER, chapterId: CHAPTER, chapterScoped: true });
  });

  it('plans apply targets from persisted artifact metadata and rejects mismatches', () => {
    const outline = {
      artifactType: 'outline',
      processingStatus: 'valid',
      sourceNovelId: NOVEL,
      sourceChapterId: CHAPTER,
    };
    expect(
      planStructuredApply({
        artifact: outline,
        payload: undefined,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: CHAPTER, chapterId: CHAPTER },
      }),
    ).toEqual({ ok: true, plan: { targetType: 'asset', targetId: CHAPTER, chapterId: CHAPTER } });
    expect(
      planStructuredApply({
        artifact: outline,
        payload: undefined,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: NOVEL, chapterId: CHAPTER },
      }),
    ).toEqual({ ok: false, reason: 'TARGET_MISMATCH' });
    expect(
      planStructuredApply({
        artifact: outline,
        payload: undefined,
        requested: {
          novelId: 'novel-2',
          targetType: 'asset',
          targetId: CHAPTER,
          chapterId: CHAPTER,
        },
      }),
    ).toEqual({ ok: false, reason: 'NOVEL_MISMATCH' });
    expect(
      planStructuredApply({
        artifact: { ...outline, processingStatus: 'invalid' },
        payload: undefined,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: CHAPTER, chapterId: CHAPTER },
      }),
    ).toEqual({ ok: false, reason: 'NOT_VALIDATED' });
    expect(
      planStructuredApply({
        artifact: { ...outline, artifactType: 'chapter_summary', sourceChapterId: undefined },
        payload: undefined,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: NOVEL },
      }),
    ).toEqual({ ok: false, reason: 'CHAPTER_SOURCE_MISSING' });
    expect(
      planStructuredApply({
        artifact: { ...outline, artifactType: 'quality_report' },
        payload: undefined,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: CHAPTER, chapterId: CHAPTER },
      }),
    ).toEqual({ ok: false, reason: 'READ_ONLY_REPORT' });
    expect(
      planStructuredApply({
        artifact: { ...outline, artifactType: 'generic_json', sourceChapterId: undefined },
        payload: { anything: true },
        requested: { novelId: NOVEL, targetType: 'asset', targetId: NOVEL },
      }),
    ).toEqual({ ok: false, reason: 'TYPE_UNSUPPORTED' });
    expect(
      planStructuredApply({
        artifact: { ...outline, artifactType: 'generic_json', sourceChapterId: undefined },
        payload: validCompression,
        requested: { novelId: NOVEL, targetType: 'asset', targetId: NOVEL },
      }),
    ).toEqual({ ok: true, plan: { targetType: 'asset', targetId: NOVEL, chapterId: undefined } });
  });
});
