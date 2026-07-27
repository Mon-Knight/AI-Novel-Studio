import type {
  MemorySnapshotBundle,
  MemorySnapshotRecord,
  MemorySnapshotVerification,
} from '../../types/memory';
import { dbCall, generateId, isTauri } from '../database/db';

export class MemoryDesktopRequiredError extends Error {
  readonly code = 'MEMORY_DESKTOP_REQUIRED';
  readonly retryable = false;

  constructor() {
    super('长期记忆快照仅在桌面端使用 SQLite；浏览器模式不会伪造 Memory。');
    this.name = 'MemoryDesktopRequiredError';
  }
}

function requireDesktop(): void {
  if (!isTauri()) throw new MemoryDesktopRequiredError();
}

export const memoryPersistenceService = {
  isAvailable(): boolean {
    return isTauri();
  },

  newOperationId(): string {
    return `chapter-continuity-memory:${generateId()}`;
  },

  async create(input: {
    operationId: string;
    novelId: string;
    targetChapterId: string;
    lookbackChapters?: number;
    budgetBytes?: number;
  }): Promise<MemorySnapshotBundle> {
    requireDesktop();
    return dbCall('create_memory_snapshot', { input });
  },

  async get(snapshotId: string): Promise<MemorySnapshotBundle> {
    requireDesktop();
    return dbCall('get_memory_snapshot', { input: { snapshotId } });
  },

  async listByChapter(chapterId: string, limit = 20): Promise<MemorySnapshotRecord[]> {
    requireDesktop();
    return dbCall('list_memory_snapshots_by_chapter', {
      input: { chapterId, limit },
    });
  },

  async verify(snapshotId: string): Promise<MemorySnapshotVerification> {
    requireDesktop();
    return dbCall('verify_memory_snapshot', { input: { snapshotId } });
  },
};

