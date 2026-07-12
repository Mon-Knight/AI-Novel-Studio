import { describe, expect, it } from 'vitest';
import { calculateChapterDiff } from '../../services/ai-tasks/chapterDiffService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

async function input(baseContent: string, candidateContent: string, overrides: Record<string, unknown> = {}) {
  const hash = await computeContentSha256(baseContent);
  return {
    novelId: 'novel-a', chapterId: 'chapter-a', baseDraftId: 'draft-a', baseDraftVersion: 3, baseContentHash: hash,
    candidateArtifactId: 'artifact-a', candidateNovelId: 'novel-a', candidateChapterId: 'chapter-a',
    candidateSourceDraftId: 'draft-a', candidateSourceDraftVersion: 3, candidateBaseContentHash: hash,
    baseContent, candidateContent, ...overrides,
  };
}

describe('chapter paragraph diff', () => {
  it('returns a stable zero diff for identical content', async () => {
    const result = await calculateChapterDiff(await input('first\n\nsecond', 'first\n\nsecond'));
    expect(result).toMatchObject({ status: 'ready', summary: { addedBlocks: 0, removedBlocks: 0, modifiedBlocks: 0, unchangedBlocks: 2, characterDelta: 0 } });
  });

  it('identifies added, removed, and modified paragraphs', async () => {
    const added = await calculateChapterDiff(await input('one\n\nthree', 'one\n\ntwo\n\nthree'));
    const removed = await calculateChapterDiff(await input('one\n\ntwo\n\nthree', 'one\n\nthree'));
    const modified = await calculateChapterDiff(await input('one\n\ntwo', 'one\n\nchanged'));
    expect(added.summary?.addedBlocks).toBe(1);
    expect(removed.summary?.removedBlocks).toBe(1);
    expect(modified.summary?.modifiedBlocks).toBe(1);
  });

  it('fails closed for mismatched source identity or changed base content', async () => {
    const mismatch = await calculateChapterDiff(await input('base', 'candidate', { candidateChapterId: 'chapter-b' }));
    const crossNovel = await calculateChapterDiff(await input('base', 'candidate', { candidateNovelId: 'novel-b' }));
    const changedDraft = await calculateChapterDiff(await input('base', 'candidate', { candidateSourceDraftId: 'draft-latest' }));
    const changed = await calculateChapterDiff(await input('base', 'candidate', { baseContentHash: 'wrong-hash' }));
    expect(mismatch.status).toBe('blocked');
    expect(crossNovel.status).toBe('blocked');
    expect(changedDraft.status).toBe('blocked');
    expect(changed.status).toBe('blocked');
  });

  it('handles long content and redacts credential-like paragraph details', async () => {
    const base = Array.from({ length: 300 }, (_, index) => `base-${index}`).join('\n\n');
    const result = await calculateChapterDiff(await input(base, `${base}\n\nAuthorization: Bearer abcdefghijklmnop`));
    expect(result.status).toBe('ready');
    expect(result.summary?.addedBlocks).toBe(1);
    expect(JSON.stringify(result.blocks)).not.toContain('abcdefghijklmnop');
  });

  it('recomputes the same frozen summary after restart-like reconstruction and redacts prompt markers', async () => {
    const first = await calculateChapterDiff(await input('开场\n\n旧段落', '开场\n\n新的段落\n\n系统提示词：不得泄露'));
    const second = await calculateChapterDiff(await input('开场\n\n旧段落', '开场\n\n新的段落\n\n系统提示词：不得泄露'));
    expect(first.status).toBe('ready');
    expect(second.summary).toEqual(first.summary);
    expect(JSON.stringify(first.blocks)).not.toContain('系统提示词');
  });
});
