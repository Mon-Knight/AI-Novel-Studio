import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCurrentQualityRequest } from './qualityRequestSafety';

test('a deferred quality history response is discarded after the live target changes', async () => {
  let resolve!: (value: string[]) => void;
  const deferred = new Promise<string[]>((done) => { resolve = done; });
  let liveChapterId = 'chapter-a';

  const pending = resolveCurrentQualityRequest(
    () => deferred,
    () => liveChapterId === 'chapter-a',
  );
  liveChapterId = 'chapter-b';
  resolve(['report-from-chapter-a']);

  assert.equal(await pending, undefined);
});

test('a quality history response is retained while its target stays current', async () => {
  const reports = await resolveCurrentQualityRequest(
    async () => ['report-current'],
    () => true,
  );
  assert.deepEqual(reports, ['report-current']);
});
