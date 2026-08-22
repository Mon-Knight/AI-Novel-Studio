import { vi } from 'vitest';

import { deferred, type Deferred } from '../deferred';

export class FakeAsyncQueue<TArgs extends unknown[], TResult> {
  readonly calls: TArgs[] = [];
  readonly pending: Array<Deferred<TResult>> = [];

  readonly invoke = vi.fn((...args: TArgs): Promise<TResult> => {
    this.calls.push(args);
    const request = deferred<TResult>();
    this.pending.push(request);
    return request.promise;
  });

  resolve(index: number, value: TResult): void {
    const request = this.pending[index];
    if (!request) throw new Error(`No pending request at index ${index}`);
    request.resolve(value);
  }

  reject(index: number, reason: unknown): void {
    const request = this.pending[index];
    if (!request) throw new Error(`No pending request at index ${index}`);
    request.reject(reason);
  }
}

export function createFakeDraftRepository<TDraft>() {
  const loads = new FakeAsyncQueue<[chapterId: string], TDraft | null>();
  return {
    loads,
    getLatestByChapterId: loads.invoke,
  };
}

export function createFakeSaveService<TResult>() {
  const saves = new FakeAsyncQueue<[input: unknown], TResult>();
  return {
    saves,
    save: saves.invoke,
  };
}

export function createFakeRecoveryService<TSnapshot>() {
  const reads = new FakeAsyncQueue<[novelId: string, chapterId: string], TSnapshot | null>();
  const writes = new FakeAsyncQueue<[input: unknown], TSnapshot>();
  const deletes = new FakeAsyncQueue<[novelId: string, chapterId: string], void>();

  return {
    reads,
    writes,
    deletes,
    get: reads.invoke,
    upsert: writes.invoke,
    remove: deletes.invoke,
  };
}

export function createFakeNavigation() {
  return {
    navigate: vi.fn<(target: string) => void>(),
  };
}

export function createFakeCloseRequest() {
  return {
    preventDefault: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

export function createFakeWindowClose() {
  return {
    close: vi.fn<() => Promise<void>>(async () => undefined),
  };
}
