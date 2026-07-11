import { describe, expect, it } from 'vitest';

import {
  MonotonicDocumentLoadGuard,
  resolveGuardedDocumentLoad,
} from '../../features/workspace/documentSafety';
import { deferred } from '../deferred';

describe('T01 - rapid chapter switching', () => {
  it('keeps chapter C when the older B request resolves last', async () => {
    const guard = new MonotonicDocumentLoadGuard();
    let liveTarget = { novelId: 'novel-a', chapterId: 'chapter-a' };
    let displayed = '';

    const loadA = deferred<string>();
    const tokenA = guard.issue(liveTarget);
    const resultA = resolveGuardedDocumentLoad(guard, tokenA, loadA.promise, () => liveTarget);

    liveTarget = { novelId: 'novel-a', chapterId: 'chapter-b' };
    const loadB = deferred<string>();
    const tokenB = guard.issue(liveTarget);
    const resultB = resolveGuardedDocumentLoad(guard, tokenB, loadB.promise, () => liveTarget);

    liveTarget = { novelId: 'novel-a', chapterId: 'chapter-c' };
    const loadC = deferred<string>();
    const tokenC = guard.issue(liveTarget);
    const resultC = resolveGuardedDocumentLoad(guard, tokenC, loadC.promise, () => liveTarget);

    loadC.resolve('chapter-c-content');
    const resolvedC = await resultC;
    if (resolvedC.accepted) displayed = resolvedC.value;

    loadB.resolve('late-chapter-b-content');
    const resolvedB = await resultB;
    if (resolvedB.accepted) displayed = resolvedB.value;

    loadA.resolve('latest-to-resolve-chapter-a-content');
    const resolvedA = await resultA;
    if (resolvedA.accepted) displayed = resolvedA.value;

    expect(resolvedC.accepted).toBe(true);
    expect(resolvedB.accepted).toBe(false);
    expect(resolvedA.accepted).toBe(false);
    expect(displayed).toBe('chapter-c-content');
  });
});
