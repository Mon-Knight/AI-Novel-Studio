import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { createServer } from 'vite';
import type { Character } from '../../types/character';
import type { Chapter } from '../../types/chapter';
import type { SaveChapterContextBundleInput } from './chapterContextPersistenceService';

const IDS = {
  novel: '11111111-1111-4111-8111-111111111111',
  chapter: '22222222-2222-4222-8222-222222222222',
  draft: '33333333-3333-4333-8333-333333333333',
  revisedDraft: '88888888-8888-4888-8888-888888888888',
  character: '44444444-4444-4444-8444-444444444444',
  summary: '55555555-5555-4555-8555-555555555555',
  context: '66666666-6666-4666-8666-666666666666',
  state: '77777777-7777-4777-8777-777777777777',
};

const KEYS = {
  summaries: 'ai_novel_studio_chapter_summaries',
  contexts: 'ai_novel_studio_context_records',
  states: 'ai_novel_studio_character_states',
  characters: 'ai_novel_studio_characters',
  chapters: 'ai_novel_studio_chapters',
  drafts: `ai_novel_studio_drafts_list_${IDS.chapter}`,
};

class FailingMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private failKey: string | null = null;
  private failuresRemaining = 0;

  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
    this.resetFailure();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (key === this.failKey && this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error(`injected localStorage failure: ${key}`);
    }
    this.values.set(key, value);
  }

  failNextWrite(key: string): void {
    this.failKey = key;
    this.failuresRemaining = 1;
  }

  resetFailure(): void {
    this.failKey = null;
    this.failuresRemaining = 0;
  }
}

const storage = new FailingMemoryStorage();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const summaryModule = (await vite.ssrLoadModule(
  '/src/services/context/chapterSummaryService.ts',
)) as typeof import('./chapterSummaryService');
const characterStateModule = (await vite.ssrLoadModule(
  '/src/services/context/characterStateService.ts',
)) as typeof import('./characterStateService');
const contextModule = (await vite.ssrLoadModule(
  '/src/services/context/contextRecordService.ts',
)) as typeof import('./contextRecordService');
const bundleModule = (await vite.ssrLoadModule(
  '/src/services/context/chapterContextPersistenceService.ts',
)) as typeof import('./chapterContextPersistenceService');
const migrationModule = (await vite.ssrLoadModule(
  '/src/services/context/legacyChapterContextMigrationService.ts',
)) as typeof import('./legacyChapterContextMigrationService');
const draftModule = (await vite.ssrLoadModule(
  '/src/services/database/draftVersionService.ts',
)) as typeof import('../database/draftVersionService');

after(async () => {
  clearMocks();
  await vite.close();
});

beforeEach(() => {
  clearMocks();
  storage.clear();
});

function chapter(updatedAt = '2026-01-01T00:00:00.000Z'): Chapter {
  return {
    id: IDS.chapter,
    novelId: IDS.novel,
    title: '第一章',
    chapterNumber: 1,
    orderIndex: 0,
    sortOrder: 0,
    status: 'adopted',
    adoptedDraftId: IDS.draft,
    wordCount: 100,
    currentWords: 100,
    targetWords: 100,
    drafts: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function character(updatedAt = '2026-01-01T00:00:00.000Z'): Character {
  return {
    id: IDS.character,
    novelId: IDS.novel,
    name: '林默',
    source: 'manual',
    isActive: true,
    createdAt: updatedAt,
    updatedAt,
  };
}

function bundleInput(): SaveChapterContextBundleInput {
  return {
    novelId: IDS.novel,
    chapterId: IDS.chapter,
    adoptedDraftId: IDS.draft,
    summary: {
      novelId: IDS.novel,
      chapterId: IDS.chapter,
      adoptedDraftId: IDS.draft,
      summary: '第一章摘要',
      keyEvents: ['初遇'],
    },
    contextRecords: [
      {
        novelId: IDS.novel,
        chapterId: IDS.chapter,
        contextType: 'chapter_summary',
        title: '第一章',
        content: '第一章上下文',
        importance: 4,
      },
    ],
    characterStates: [
      {
        novelId: IDS.novel,
        chapterId: IDS.chapter,
        characterId: IDS.character,
        stateSummary: '已经抵达城门',
      },
    ],
  };
}

function seedBrowserOwners(): void {
  storage.setItem(KEYS.chapters, JSON.stringify([chapter()]));
  storage.setItem(KEYS.characters, JSON.stringify([character()]));
  storage.setItem(KEYS.summaries, JSON.stringify([]));
  storage.setItem(KEYS.contexts, JSON.stringify([]));
  storage.setItem(KEYS.states, JSON.stringify([]));
}

function snapshotAll(): Record<string, string | null> {
  return Object.fromEntries(Object.values(KEYS).map((key) => [key, storage.getItem(key)]));
}

test('Tauri IPC failures never write chapter context into localStorage', async () => {
  seedBrowserOwners();
  const before = snapshotAll();
  const originalError = console.error;
  console.error = () => {};
  try {
    mockIPC(() => {
      throw new Error('sqlite unavailable');
    });
    await assert.rejects(
      summaryModule.chapterSummaryService.create(bundleInput().summary),
      /sqlite unavailable/,
    );
    await assert.rejects(
      characterStateModule.characterStateService.create(bundleInput().characterStates[0]),
      /sqlite unavailable/,
    );
    await assert.rejects(
      contextModule.contextRecordService.create(bundleInput().contextRecords[0]),
      /sqlite unavailable/,
    );
    await assert.rejects(
      bundleModule.chapterContextPersistenceService.save(bundleInput()),
      /sqlite unavailable/,
    );
    assert.deepEqual(snapshotAll(), before);
  } finally {
    console.error = originalError;
  }
});

test('Tauri reads propagate errors instead of returning legacy localStorage rows', async () => {
  storage.setItem(
    KEYS.summaries,
    JSON.stringify([
      {
        id: IDS.summary,
        novelId: IDS.novel,
        chapterId: IDS.chapter,
        adoptedDraftId: IDS.draft,
        summary: '不应被读取',
        enabled: true,
        isExpired: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    mockIPC(() => {
      throw new Error('read failed');
    });
    await assert.rejects(
      summaryModule.chapterSummaryService.getByNovelId(IDS.novel),
      /read failed/,
    );
    await assert.rejects(
      characterStateModule.characterStateService.getByCharacterId(IDS.character),
      /read failed/,
    );
  } finally {
    console.error = originalError;
  }
});

test('Tauri list reads reject invalid IPC payloads instead of hiding contract failures', async () => {
  mockIPC(() => ({ invalid: true }));
  await assert.rejects(
    summaryModule.chapterSummaryService.getByNovelId(IDS.novel),
    /无效的章节总结列表/,
  );
  await assert.rejects(
    contextModule.contextRecordService.getByNovelId(IDS.novel),
    /无效的上下文记录列表/,
  );
  await assert.rejects(
    characterStateModule.characterStateService.getByCharacterId(IDS.character),
    /无效的角色状态列表/,
  );
  await assert.rejects(
    characterStateModule.characterStateService.getByChapterId(IDS.chapter),
    /无效的角色状态列表/,
  );
});

test('browser bundle commits summary, contexts, character states and chapter status together', async () => {
  seedBrowserOwners();
  const result = await bundleModule.chapterContextPersistenceService.save(bundleInput());

  assert.equal(result.chapterStatus, 'summarized');
  assert.equal(result.contextRecords.length, 1);
  assert.equal(result.characterStates.length, 1);
  const chapters = JSON.parse(storage.getItem(KEYS.chapters) ?? '[]') as Chapter[];
  const characters = JSON.parse(storage.getItem(KEYS.characters) ?? '[]') as Character[];
  assert.equal(chapters[0]?.status, 'summarized');
  assert.equal(characters[0]?.currentState, '已经抵达城门');
  assert.equal(JSON.parse(storage.getItem(KEYS.summaries) ?? '[]').length, 1);
  assert.equal(JSON.parse(storage.getItem(KEYS.contexts) ?? '[]').length, 1);
  assert.equal(JSON.parse(storage.getItem(KEYS.states) ?? '[]').length, 1);
});

test('browser bundle restores every key when a later localStorage write fails', async () => {
  seedBrowserOwners();
  const before = snapshotAll();
  storage.failNextWrite(KEYS.states);

  await assert.rejects(
    bundleModule.chapterContextPersistenceService.save(bundleInput()),
    /injected localStorage failure/,
  );
  assert.deepEqual(snapshotAll(), before);
});

test('browser character-state create compensates the state write when character update fails', async () => {
  seedBrowserOwners();
  const before = snapshotAll();
  storage.failNextWrite(KEYS.characters);

  await assert.rejects(
    characterStateModule.characterStateService.create(bundleInput().characterStates[0]),
    /injected localStorage failure/,
  );
  assert.deepEqual(snapshotAll(), before);
});

function seedBrowserAdoption(): void {
  const createdAt = '2026-01-01T00:00:00.000Z';
  storage.setItem(
    KEYS.drafts,
    JSON.stringify([
      {
        id: IDS.draft,
        novelId: IDS.novel,
        chapterId: IDS.chapter,
        content: '旧正文',
        source: 'user_edited',
        versionNo: 1,
        wordCount: 3,
        isAdopted: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: IDS.revisedDraft,
        novelId: IDS.novel,
        chapterId: IDS.chapter,
        content: '新正文',
        source: 'user_edited',
        versionNo: 2,
        wordCount: 3,
        isAdopted: false,
        createdAt,
        updatedAt: createdAt,
      },
    ]),
  );
  storage.setItem(
    KEYS.summaries,
    JSON.stringify([
      {
        id: IDS.summary,
        ...bundleInput().summary,
        enabled: true,
        isExpired: false,
        createdAt,
        updatedAt: createdAt,
      },
    ]),
  );
  storage.setItem(
    KEYS.contexts,
    JSON.stringify([
      {
        id: IDS.context,
        ...bundleInput().contextRecords[0],
        isActive: true,
        isExpired: false,
        createdAt,
        updatedAt: createdAt,
      },
    ]),
  );
}

test('summary source lookup ignores a newer unadopted draft', async () => {
  seedBrowserAdoption();

  const draft = await draftModule.draftVersionService.getAdoptedByChapterId(IDS.chapter);
  assert.equal(draft?.id, IDS.draft);
  assert.equal(draft?.content, '旧正文');
  assert.equal(draft?.versionNo, 1);
});

test('browser draft adoption expires chapter context before returning success', async () => {
  seedBrowserAdoption();

  const adopted = await draftModule.draftVersionService.adopt(IDS.revisedDraft, IDS.chapter);
  assert.equal(adopted.id, IDS.revisedDraft);
  assert.equal(adopted.isAdopted, true);
  const summaries = JSON.parse(storage.getItem(KEYS.summaries) ?? '[]');
  const contexts = JSON.parse(storage.getItem(KEYS.contexts) ?? '[]');
  assert.equal(summaries[0]?.isExpired, true);
  assert.equal(contexts[0]?.isExpired, true);
});

test('browser draft adoption restores drafts when context expiry fails', async () => {
  seedBrowserAdoption();
  const before = snapshotAll();
  storage.failNextWrite(KEYS.contexts);

  await assert.rejects(
    draftModule.draftVersionService.adopt(IDS.revisedDraft, IDS.chapter),
    /injected localStorage failure/,
  );
  assert.deepEqual(snapshotAll(), before);
});

test('browser draft adoption reports a draft write failure without changing context', async () => {
  seedBrowserAdoption();
  const before = snapshotAll();
  storage.failNextWrite(KEYS.drafts);

  await assert.rejects(
    draftModule.draftVersionService.adopt(IDS.revisedDraft, IDS.chapter),
    /injected localStorage failure/,
  );
  assert.deepEqual(snapshotAll(), before);
});

test('legacy migration keeps local data when the SQLite transaction fails', async () => {
  const legacySummary = {
    id: IDS.summary,
    ...bundleInput().summary,
    enabled: true,
    isExpired: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  storage.setItem(KEYS.summaries, JSON.stringify([legacySummary]));
  const before = storage.getItem(KEYS.summaries);
  const originalError = console.error;
  console.error = () => {};
  try {
    mockIPC(() => {
      throw new Error('migration rollback');
    });
    await assert.rejects(
      migrationModule.legacyChapterContextMigrationService.migrate(),
      /migration rollback/,
    );
    assert.equal(storage.getItem(KEYS.summaries), before);
  } finally {
    console.error = originalError;
  }
});

test('legacy migration cleans only IDs confirmed by SQLite and preserves ambiguous rows', async () => {
  const legacySummary = {
    id: IDS.summary,
    ...bundleInput().summary,
    enabled: true,
    isExpired: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const legacyContext = {
    id: IDS.context,
    ...bundleInput().contextRecords[0],
    isActive: true,
    isExpired: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const malformed = { id: 'ambiguous-with-missing-fields' };
  storage.setItem(KEYS.summaries, JSON.stringify([legacySummary, malformed]));
  storage.setItem(KEYS.contexts, JSON.stringify([legacyContext]));
  storage.setItem(KEYS.states, JSON.stringify([]));

  mockIPC((command, args) => {
    assert.equal(command, 'migrate_legacy_chapter_context');
    const input = args.input as Record<string, unknown[]>;
    assert.equal(input.chapterSummaries.length, 1);
    assert.equal(input.contextRecords.length, 1);
    return {
      chapterSummaries: { inserted: 0, matched: 0, skipped: 1 },
      contextRecords: { inserted: 1, matched: 0, skipped: 0 },
      characterStates: { inserted: 0, matched: 0, skipped: 0 },
      idMap: { [IDS.context]: IDS.context },
      warnings: ['chapterSummaries[0]: ownership mismatch'],
    };
  });

  const result = await migrationModule.legacyChapterContextMigrationService.migrate();
  assert.equal(result.localRecordsRemoved.contextRecords, 1);
  assert.equal(result.localRecordsRemoved.chapterSummaries, 0);
  assert.deepEqual(JSON.parse(storage.getItem(KEYS.contexts) ?? '[]'), []);
  assert.deepEqual(JSON.parse(storage.getItem(KEYS.summaries) ?? '[]'), [legacySummary, malformed]);
  assert.ok(result.warnings.some((warning) => warning.includes('字段不完整')));
  assert.ok(result.warnings.some((warning) => warning.includes('ownership mismatch')));
});

test('legacy cleanup failure returns a warning and leaves the retryable local row intact', async () => {
  const legacyContext = {
    id: IDS.context,
    ...bundleInput().contextRecords[0],
    isActive: true,
    isExpired: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  storage.setItem(KEYS.contexts, JSON.stringify([legacyContext]));
  mockIPC(() => ({
    chapterSummaries: { inserted: 0, matched: 0, skipped: 0 },
    contextRecords: { inserted: 0, matched: 1, skipped: 0 },
    characterStates: { inserted: 0, matched: 0, skipped: 0 },
    idMap: { [IDS.context]: IDS.context },
    warnings: [],
  }));
  storage.failNextWrite(KEYS.contexts);

  const result = await migrationModule.legacyChapterContextMigrationService.migrate();
  assert.equal(result.localRecordsRemoved.contextRecords, 0);
  assert.deepEqual(JSON.parse(storage.getItem(KEYS.contexts) ?? '[]'), [legacyContext]);
  assert.ok(result.warnings.some((warning) => warning.includes('下次启动会安全重试')));
});
