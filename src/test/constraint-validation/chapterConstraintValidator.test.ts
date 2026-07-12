import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterConstraintValidationService } from '../../services/ai-tasks/chapterConstraintValidationService';
import { validateChapterArtifactConstraints } from '../../services/ai-tasks/chapterConstraintValidator';
import type { ChapterConstraintValidationInput } from '../../types/chapterConstraintValidation';

function input(overrides: Partial<ChapterConstraintValidationInput> = {}): ChapterConstraintValidationInput {
  return {
    artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
    sourceDraftId: 'draft-a', sourceDraftVersion: 3, baseContentHash: 'base-hash',
    inputSnapshot: { sourceDraftId: 'draft-a', sourceDraftVersion: 3, baseContentHash: 'base-hash' },
    contextSnapshot: { sourceManifestJson: { novelId: 'novel-a', chapterId: 'chapter-a', sourceDraft: { id: 'draft-a', versionNo: 3, contentHash: 'base-hash' } } },
    constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [], should: [], forbid: [] } },
    artifactBody: '这是一段完整的章节正文。'.repeat(8),
    validationRunId: 'run-a', validatedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('chapter constraint validator', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('passes deterministic frozen identity and complete output without a Provider call', () => {
    const result = validateChapterArtifactConstraints(input());
    expect(result.status).toBe('passed');
    expect(result.validationRunId).toBe('run-a');
    expect(result.must.every((item) => item.status === 'passed')).toBe(true);
  });

  it('blocks a missing required outline point and required character', () => {
    const result = validateChapterArtifactConstraints(input({
      constraintSnapshot: { payloadJson: {
        targetChapterId: 'chapter-a',
        must: [
          { id: 'must-01', kind: 'must', text: '必须覆盖章节大纲关键点：找到旧仓库的钥匙。' },
          { id: 'must-02', kind: 'must', text: '必须让角色“林舟”直接出场并参与本章剧情。' },
        ], should: [], forbid: [],
      } },
    }));
    expect(result.status).toBe('blocked');
    expect(result.must.filter((item) => item.status === 'failed').map((item) => item.code))
      .toEqual(expect.arrayContaining(['CONSTRAINT_OUTLINE_MISSING', 'CONSTRAINT_CHARACTER_MISSING']));
  });

  it('blocks forbidden, truncated, and internal content without exposing the body in messages', () => {
    const body = '不得发生的事件 Authorization: Bearer abcdefghijklmnop...';
    const result = validateChapterArtifactConstraints(input({
      artifactBody: body,
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [], should: [], forbid: [
        { id: 'forbid-01', kind: 'forbid', text: '不得发生事件：不得发生的事件' },
      ] } },
    }));
    expect(result.status).toBe('blocked');
    expect(result.forbid.some((item) => item.code === 'CONSTRAINT_INTERNAL_CONTENT_LEAK' && item.status === 'failed')).toBe(true);
    expect(JSON.stringify(result.must.concat(result.forbid))).not.toContain('abcdefghijklmnop');
  });

  it('fails closed when frozen Snapshot identities are mixed across chapters or novels', () => {
    const result = validateChapterArtifactConstraints(input({
      contextSnapshot: { sourceManifestJson: { novelId: 'novel-b', chapterId: 'chapter-b', sourceDraft: { id: 'draft-b', versionNo: 4, contentHash: 'other' } } },
    }));
    expect(result.status).toBe('blocked');
    expect(result.must.find((item) => item.constraintId === 'frozen-identity')?.status).toBe('failed');
  });

  it('keeps should failures as explicit warnings', () => {
    const result = validateChapterArtifactConstraints(input({
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [], should: [
        { id: 'should-01', kind: 'should', text: '应尽量维持文风。' },
      ], forbid: [] } },
    }));
    expect(result.status).toBe('passed_with_warnings');
    expect(result.should[0]).toMatchObject({ status: 'unknown', code: 'CONSTRAINT_SHOULD_WARNING' });
  });

  it('fails closed for unknown must constraints, empty output, and truncation', () => {
    const unknown = validateChapterArtifactConstraints(input({
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [{ id: 'unknown', kind: 'must', text: '必须以复杂隐喻维持不可量化的叙事张力。' }], should: [], forbid: [] } },
    }));
    const empty = validateChapterArtifactConstraints(input({ artifactBody: '' }));
    const truncated = validateChapterArtifactConstraints(input({ artifactBody: `${'完整正文。'.repeat(20)}未完待续` }));
    expect(unknown).toMatchObject({ status: 'blocked', must: expect.arrayContaining([expect.objectContaining({ code: 'CONSTRAINT_MUST_UNKNOWN', status: 'unknown' })]) });
    expect(empty).toMatchObject({ status: 'blocked', must: expect.arrayContaining([expect.objectContaining({ code: 'CONSTRAINT_OUTPUT_EMPTY', status: 'failed' })]) });
    expect(truncated).toMatchObject({ status: 'blocked', must: expect.arrayContaining([expect.objectContaining({ code: 'CONSTRAINT_OUTPUT_TRUNCATED', status: 'failed' })]) });
  });

  it('blocks timeline, location, viewpoint, and world-rule conflicts deterministically', () => {
    const timeline = validateChapterArtifactConstraints(input({
      artifactBody: `${'港口的晨雾笼罩着林舟。'.repeat(8)}王城陷落已经发生。`,
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [], should: [], forbid: [{ id: 'timeline', kind: 'forbid', text: '不得提前发生：王城陷落' }] } },
    }));
    const location = validateChapterArtifactConstraints(input({
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [{ id: 'location', kind: 'must', text: '地点约束：港口' }], should: [], forbid: [] } },
    }));
    const viewpoint = validateChapterArtifactConstraints(input({
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [{ id: 'pov', kind: 'must', text: '叙事视角应围绕：林舟' }], should: [], forbid: [] } },
    }));
    const worldRule = validateChapterArtifactConstraints(input({
      artifactBody: `${'林舟站在港口。'.repeat(8)}魔法不能复活。`,
      constraintSnapshot: { payloadJson: { targetChapterId: 'chapter-a', must: [], should: [], forbid: [{ id: 'world', kind: 'forbid', text: '不得违反世界规则：魔法不能复活' }] } },
    }));
    expect(timeline.status).toBe('blocked');
    expect(location).toMatchObject({ status: 'blocked', must: expect.arrayContaining([expect.objectContaining({ code: 'CONSTRAINT_LOCATION_CONFLICT', status: 'failed' })]) });
    expect(viewpoint).toMatchObject({ status: 'blocked', must: expect.arrayContaining([expect.objectContaining({ code: 'CONSTRAINT_POV_CONFLICT', status: 'failed' })]) });
    expect(worldRule.status).toBe('blocked');
  });

  it('never calls a Provider and preserves append-only browser validation runs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const firstInput = input({ validationRunId: 'run-first' });
    const secondInput = input({ validationRunId: 'run-second' });
    const bodyBefore = firstInput.artifactBody;
    await chapterConstraintValidationService.validateAndPersist(firstInput);
    await chapterConstraintValidationService.validateAndPersist(secondInput);
    const stored = JSON.parse(localStorage.getItem('ai_novel_studio_chapter_constraint_validation_artifact-a') || '[]');
    const latest = await chapterConstraintValidationService.getLatest('artifact-a');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(firstInput.artifactBody).toBe(bodyBefore);
    expect(stored).toHaveLength(2);
    expect(latest?.validationRunId).toBe('run-second');
  });
});
