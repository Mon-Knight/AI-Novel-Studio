import assert from 'node:assert/strict';
import test from 'node:test';
import { selectChapterWriteHost } from './chapterWriteRoute';

const base = { novelId: 'novel-1', chapterId: 'chapter-1' };

test('desktop plans, model modes and obsolete feature flags cannot select a second host', async () => {
  let planReads = 0;
  let flagReads = 0;
  const dependencies = {
    isTauri: () => true,
    dshEnabled: () => {
      flagReads++;
      return false;
    },
    hasAppliedSceneOnlyPlan: async () => {
      planReads++;
      return true;
    },
  };
  for (const runtimeMode of ['mock', 'api'] as const) {
    for (const extra of [
      {},
      { retrySourceRunId: 'failed-run' },
      { workflowAction: 'polish_chapter' },
      { revisionSource: { artifactId: 'exact-source' } as never },
    ]) {
      assert.equal(
        await selectChapterWriteHost(
          { ...base, ...extra, modelSnapshot: { runtimeMode } as never },
          dependencies,
        ),
        'dsh',
      );
    }
  }
  assert.equal(
    await selectChapterWriteHost({ novelId: base.novelId }, dependencies),
    'dsh',
    'target resolution is a native phase, not Writer fallback',
  );
  assert.equal(planReads, 0);
  assert.equal(flagReads, 0);
});

test('browser writing remains an explicitly limited development adapter', async () => {
  assert.equal(await selectChapterWriteHost(base, { isTauri: () => false }), 'writer');
});
