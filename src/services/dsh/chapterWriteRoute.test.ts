import assert from 'node:assert/strict';
import test from 'node:test';
import { selectChapterWriteHost } from './chapterWriteRoute';

const desktop = {
  isTauri: () => true,
  dshEnabled: () => true,
};

test('an applied Scene-only plan leaves whole-chapter DSH for the staged writer', async () => {
  const host = await selectChapterWriteHost(
    { novelId: 'novel-1', chapterId: 'chapter-1', modelSnapshot: { runtimeMode: 'api' } as never },
    { ...desktop, hasAppliedSceneOnlyPlan: async () => true },
  );
  assert.equal(host, 'writer');
});

test('chapters without a v2 plan, retries, polish, and revisions stay on DSH', async () => {
  const base = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    modelSnapshot: { runtimeMode: 'api' } as never,
  };
  const deps = { ...desktop, hasAppliedSceneOnlyPlan: async () => false };
  assert.equal(await selectChapterWriteHost(base, deps), 'dsh');
  assert.equal(
    await selectChapterWriteHost(
      { ...base, retrySourceRunId: 'run-1' },
      { ...desktop, hasAppliedSceneOnlyPlan: async () => true },
    ),
    'dsh',
  );
  assert.equal(
    await selectChapterWriteHost(
      { ...base, workflowAction: 'polish_chapter' },
      { ...desktop, hasAppliedSceneOnlyPlan: async () => true },
    ),
    'dsh',
  );
  assert.equal(
    await selectChapterWriteHost(
      { ...base, revisionSource: { artifactId: 'a' } as never },
      { ...desktop, hasAppliedSceneOnlyPlan: async () => true },
    ),
    'dsh',
  );
});

test('mock and browser writing do not gain a DSH route', async () => {
  assert.equal(
    await selectChapterWriteHost(
      { novelId: 'novel-1', chapterId: 'chapter-1' },
      { isTauri: () => false, dshEnabled: () => true, hasAppliedSceneOnlyPlan: async () => false },
    ),
    'writer',
  );
});
