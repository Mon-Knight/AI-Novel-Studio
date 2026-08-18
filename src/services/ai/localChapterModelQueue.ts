import { AiRequestCancelledError, throwIfAiRequestCancelled } from './aiCancellation';

interface QueueEntry<T> {
  operationId: string;
  run: () => Promise<T>;
  signal?: AbortSignal;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  started: boolean;
  cancelled: boolean;
  onAbort?: () => void;
}

/**
 * llama-server is configured for one active request. This queue is deliberately
 * separate from the shared external-provider concurrency policy so local Scene
 * generation cannot be interleaved with another Scene request.
 */
export class LocalChapterModelQueue {
  private readonly pending: QueueEntry<unknown>[] = [];
  private running = false;

  get active(): boolean {
    return this.running;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue<T>(operationId: string, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AiRequestCancelledError());
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        operationId,
        run,
        signal,
        resolve,
        reject,
        started: false,
        cancelled: false,
      };
      const onAbort = () => {
        if (entry.started || entry.cancelled) return;
        entry.cancelled = true;
        reject(new AiRequestCancelledError());
      };
      entry.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.push(entry as QueueEntry<unknown>);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    let entry = this.pending.shift();
    while (entry?.cancelled) entry = this.pending.shift();
    if (!entry) return;

    entry.started = true;
    entry.signal?.removeEventListener('abort', entry.onAbort!);
    if (entry.signal?.aborted) {
      entry.reject(new AiRequestCancelledError());
      void this.pump();
      return;
    }

    this.running = true;
    try {
      throwIfAiRequestCancelled(entry.signal);
      const result = await entry.run();
      entry.resolve(result);
    } catch (error) {
      entry.reject(error);
    } finally {
      this.running = false;
      void this.pump();
    }
  }
}

export const localChapterModelQueue = new LocalChapterModelQueue();
