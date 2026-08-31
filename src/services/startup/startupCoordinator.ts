import type { LegacyChapterContextMigrationResult } from '../context/legacyChapterContextMigrationService';
import type { StartupGenerationRecovery } from '../../types/generationJob';
import { appLogger } from '../observability/appLogger';
import { describeUnknownError } from '../../utils/errorMessage';

export type StartupTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface StartupTaskSnapshot<T> {
  status: StartupTaskStatus;
  result?: T;
  error?: string;
}

export interface ConversationStartupRecovery {
  recoveredRuns: number;
}

export interface StartupConversationRuntimeStatus {
  runId: string;
  status: string;
}

export interface StartupSnapshot {
  conversationRecovery: StartupTaskSnapshot<ConversationStartupRecovery>;
  contextMigration: StartupTaskSnapshot<LegacyChapterContextMigrationResult>;
  generationRecovery: StartupTaskSnapshot<StartupGenerationRecovery>;
}

export interface StartupCoordinatorDependencies {
  listConversationRuntimeStatuses?: () => Promise<StartupConversationRuntimeStatus[]>;
  recoverConversations: (activeRuntimeRunIds?: readonly string[]) => Promise<number>;
  migrateContext: () => Promise<LegacyChapterContextMigrationResult>;
  recoverGeneration: () => Promise<StartupGenerationRecovery>;
  reportError?: (code: string, message: string) => void;
  taskTimeoutMs?: number;
}

export interface StartupCoordinator {
  isStarted(): boolean;
  start(): Promise<void>;
  waitForConversationRecovery(): Promise<void>;
  waitForContextMigration(): Promise<void>;
  waitForGenerationRecovery(): Promise<void>;
  getSnapshot(): StartupSnapshot;
  subscribe(listener: () => void): () => void;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const DEFAULT_STARTUP_TASK_TIMEOUT_MS = 30_000;
const ACTIVE_CONVERSATION_RUNTIME_STATUSES = new Set([
  'attesting',
  'queued',
  'running',
  'cancel_requested',
]);

const INITIAL_SNAPSHOT: StartupSnapshot = {
  conversationRecovery: { status: 'idle' },
  contextMigration: { status: 'idle' },
  generationRecovery: { status: 'idle' },
};

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runWithTimeout<T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs: number,
  reconcileLateSuccess: (value: T) => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label}超过 ${timeoutMs} ms，已停止等待。`));
    }, timeoutMs);
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
      return;
    }
    void pending.then(
      (value) => {
        if (settled) {
          reconcileLateSuccess(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function activeConversationRuntimeRunIds(
  statuses: readonly StartupConversationRuntimeStatus[],
): string[] {
  return Array.from(
    new Set(
      statuses
        .filter((status) => ACTIVE_CONVERSATION_RUNTIME_STATUSES.has(status.status))
        .map((status) => status.runId.trim())
        .filter(Boolean),
    ),
  );
}

class DefaultStartupCoordinator implements StartupCoordinator {
  private snapshot: StartupSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly conversationReady = deferred();
  private readonly contextReady = deferred();
  private readonly generationReady = deferred();
  private startPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: StartupCoordinatorDependencies) {}

  getSnapshot = (): StartupSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isStarted(): boolean {
    return this.startPromise !== null;
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      // Defer execution one microtask so startPromise is assigned before listeners
      // can re-enter start() through a status update.
      this.startPromise = Promise.resolve().then(() => this.run());
    }
    return this.startPromise;
  }

  async waitForConversationRecovery(): Promise<void> {
    void this.start();
    await this.conversationReady.promise;
    this.assertReady('conversationRecovery', '任务对话恢复检查失败');
  }

  async waitForContextMigration(): Promise<void> {
    void this.start();
    await this.contextReady.promise;
    this.assertReady('contextMigration', '旧章节上下文迁移失败');
  }

  async waitForGenerationRecovery(): Promise<void> {
    void this.start();
    await this.generationReady.promise;
    this.assertReady('generationRecovery', '生成任务恢复检查失败');
  }

  private assertReady(key: keyof StartupSnapshot, fallback: string): void {
    const task = this.snapshot[key];
    if (task.status === 'failed') throw new Error(task.error || fallback);
  }

  private taskTimeoutMs(): number {
    return this.dependencies.taskTimeoutMs ?? DEFAULT_STARTUP_TASK_TIMEOUT_MS;
  }

  private update<K extends keyof StartupSnapshot>(key: K, value: StartupSnapshot[K]): void {
    this.snapshot = { ...this.snapshot, [key]: value };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A view subscriber must not interrupt recovery or leave readiness pending.
      }
    }
  }

  private report(code: string, message: string): void {
    try {
      this.dependencies.reportError?.(code, message);
    } catch {
      // Logging is diagnostic only and must never break startup recovery.
    }
  }

  private async run(): Promise<void> {
    await Promise.all([
      this.runConversationRecovery(),
      this.runContextMigration(),
      this.runGenerationRecovery(),
    ]);
  }

  private async runConversationRecovery(): Promise<void> {
    this.update('conversationRecovery', { status: 'running' });
    try {
      const listRuntimeStatuses = this.dependencies.listConversationRuntimeStatuses;
      const recoverAfterRuntimeReconciliation = listRuntimeStatuses
        ? () =>
            listRuntimeStatuses().then((runtimeStatuses) =>
              this.dependencies.recoverConversations(
                activeConversationRuntimeRunIds(runtimeStatuses),
              ),
            )
        : () => this.dependencies.recoverConversations([]);
      const recoveredRuns = await runWithTimeout(
        recoverAfterRuntimeReconciliation,
        '任务对话恢复检查',
        this.taskTimeoutMs(),
        (lateRecoveredRuns) => {
          this.update('conversationRecovery', {
            status: 'succeeded',
            result: { recoveredRuns: lateRecoveredRuns },
          });
        },
      );
      this.update('conversationRecovery', {
        status: 'succeeded',
        result: { recoveredRuns },
      });
    } catch (error) {
      const message = describeUnknownError(error, '任务对话恢复检查失败');
      this.report('[STARTUP_CONVERSATION_RECOVERY_FAILED]', message);
      this.update('conversationRecovery', { status: 'failed', error: message });
    } finally {
      this.conversationReady.resolve();
    }
  }

  private async runContextMigration(): Promise<void> {
    this.update('contextMigration', { status: 'running' });
    try {
      const result = await runWithTimeout(
        this.dependencies.migrateContext,
        '旧章节上下文迁移',
        this.taskTimeoutMs(),
        (lateResult) => {
          this.update('contextMigration', { status: 'succeeded', result: lateResult });
        },
      );
      this.update('contextMigration', { status: 'succeeded', result });
    } catch (error) {
      const message = describeUnknownError(error, '旧章节上下文迁移失败');
      this.report('[STARTUP_CONTEXT_MIGRATION_FAILED]', message);
      this.update('contextMigration', { status: 'failed', error: message });
    } finally {
      this.contextReady.resolve();
    }
  }

  private async runGenerationRecovery(): Promise<void> {
    this.update('generationRecovery', { status: 'running' });
    try {
      const result = await runWithTimeout(
        this.dependencies.recoverGeneration,
        '生成任务恢复检查',
        this.taskTimeoutMs(),
        (lateResult) => {
          this.update('generationRecovery', { status: 'succeeded', result: lateResult });
        },
      );
      this.update('generationRecovery', { status: 'succeeded', result });
    } catch (error) {
      const message = describeUnknownError(error, '生成任务恢复检查失败');
      this.report('[STARTUP_TASK_RECOVERY_FAILED]', message);
      this.update('generationRecovery', { status: 'failed', error: message });
    } finally {
      this.generationReady.resolve();
    }
  }
}

export function createStartupCoordinator(
  dependencies: StartupCoordinatorDependencies,
): StartupCoordinator {
  return new DefaultStartupCoordinator(dependencies);
}

export const startupCoordinator = createStartupCoordinator({
  async listConversationRuntimeStatuses() {
    const { isTauri } = await import('../database/db');
    if (!isTauri()) return [];
    const { dshTaskRuntimeService } = await import('../dsh/taskRuntimeService');
    return dshTaskRuntimeService.listStatuses();
  },
  async recoverConversations(activeRuntimeRunIds) {
    const { taskConversationService } = await import('../conversation/taskConversationService');
    return taskConversationService.recoverInterruptedRuns(undefined, activeRuntimeRunIds);
  },
  async migrateContext() {
    const { legacyChapterContextMigrationService } =
      await import('../context/legacyChapterContextMigrationService');
    return legacyChapterContextMigrationService.migrate();
  },
  async recoverGeneration() {
    const { recoverInterruptedJobsOnStartup } = await import('../generation/startupRecovery');
    return recoverInterruptedJobsOnStartup();
  },
  reportError(code, message) {
    appLogger.error(code, { message });
  },
});
