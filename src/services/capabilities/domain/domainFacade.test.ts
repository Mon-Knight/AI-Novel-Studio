import assert from 'node:assert/strict';
import test from 'node:test';

import { chapterRepository } from '../../database/chapterRepository';
import { novelRepository } from '../../database/novelRepository';
import { volumeRepository } from '../../database/volumeRepository';
import { settingRepository } from '../../database/settingRepository';
import { protagonistRepository } from '../../database/protagonistRepository';
import { draftVersionService } from '../../database/draftVersionService';
import { putLocalMemoryDocument } from '../../memory/adoptedDraftMemory';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import { captureTaskModelSnapshot } from '../../conversation/taskModelSnapshot';
import { projectCapability } from './projectCapability';
import { contextCapability } from './contextCapability';
import { writingCapability } from './writingCapability';
import { conversationCapability } from './conversationCapability';
import { artifactCapability } from './artifactCapability';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
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
    this.values.set(key, value);
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(): void {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  // Prevent novelRepository's compatibility seed from introducing unrelated
  // records into a facade fixture.
  for (const key of [
    'ai_novel_studio_novels',
    'ai_novel_studio_volumes',
    'ai_novel_studio_chapters',
    'ai_novel_studio_world_settings',
    'ai_novel_studio_rule_systems',
    'ai_novel_studio_protagonists',
    'ai_novel_studio_memory_documents',
  ]) {
    storage.setItem(key, '[]');
  }
}

function restoreStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function storageSnapshot(): string {
  const rows: Array<[string, string | null]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) rows.push([key, localStorage.getItem(key)]);
  }
  rows.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(rows);
}

async function fixture() {
  const novelA = await novelRepository.create({
    title: 'Facade A',
    description: 'A 的公开简介',
    genre: '悬疑',
  });
  const novelB = await novelRepository.create({ title: 'Facade B', genre: '科幻' });
  const volumeA = await volumeRepository.create({
    novelId: novelA.id,
    title: 'A 卷',
    summary: 'A 卷摘要',
  });
  const chapterA = await chapterRepository.create({
    novelId: novelA.id,
    volumeId: volumeA.id,
    title: 'A 第一章',
    outline: 'A 的章节大纲',
    goal: 'A 的章节目标',
    targetWordCount: 1200,
  });
  await settingRepository.saveWorldSetting(null, {
    novelId: novelA.id,
    title: 'A 世界规则',
    content: 'A 的世界设定细节',
  });
  await protagonistRepository.save(null, {
    novelId: novelA.id,
    name: 'A 主角',
    identity: '调查员',
    goal: '查清真相',
    specialAbility: '观察',
  });
  putLocalMemoryDocument({
    documentId: `memory-${novelA.id}`,
    novelId: novelA.id,
    sourceType: 'adopted_draft',
    sourceId: `draft-${chapterA.id}`,
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    adoptedDraftId: `draft-${chapterA.id}`,
    chapterId: chapterA.id,
    metadata: { fixture: true },
    chunks: [
      {
        id: `chunk-${novelA.id}`,
        ordinal: 0,
        text: 'A 独有的黑市线索',
        tokenCount: 8,
        importance: 0.9,
        entityKeys: [],
        metadata: { fixture: true },
        contentHash: 'b'.repeat(64),
      },
    ],
  });
  putLocalMemoryDocument({
    documentId: `memory-${novelB.id}`,
    novelId: novelB.id,
    sourceType: 'adopted_draft',
    sourceId: `draft-${novelB.id}`,
    sourceVersion: 1,
    sourceHash: 'c'.repeat(64),
    metadata: { fixture: true },
    chunks: [
      {
        id: `chunk-${novelB.id}`,
        ordinal: 0,
        text: 'B 独有的实验线索',
        tokenCount: 8,
        importance: 0.9,
        entityKeys: [],
        metadata: { fixture: true },
        contentHash: 'd'.repeat(64),
      },
    ],
  });
  return { novelA, novelB, volumeA, chapterA };
}

test.beforeEach(installStorage);
test.afterEach(restoreStorage);

test('project and structure facades return stable public DTOs through production handlers', async () => {
  const { novelA, chapterA, volumeA } = await fixture();
  const first = await projectCapability.readCurrentProject({ novelId: novelA.id });
  const second = await projectCapability.readCurrentProject({ novelId: novelA.id });

  assert.equal(first.ok, true);
  assert.equal(first.source, 'localstorage');
  assert.equal(first.storageMode, 'browser_fallback');
  assert.equal(first.revision, null);
  assert.ok(first.data);
  assert.equal(first.data.project.id, novelA.id);
  assert.equal(first.data.structure.chapters[0].id, chapterA.id);
  assert.equal(first.data.structure.volumes[0].id, volumeA.id);
  assert.equal(first.data.settings.world[0].details, 'A 的世界设定细节');
  assert.equal(first.data.settings.protagonists[0].name, 'A 主角');
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(JSON.parse(JSON.stringify(first.data)), first.data);
  assert.equal('novel_id' in first.data, false);
  assert.equal('repository' in first.data, false);

  const position = await projectCapability.readChapterPosition({
    novelId: novelA.id,
    chapterId: chapterA.id,
  });
  assert.equal(position.ok, true);
  assert.equal(position.data?.chapter.id, chapterA.id);
  assert.equal(position.data?.volume?.novelId, novelA.id);
});

test('context and memory facades preserve ownership and empty-result semantics', async () => {
  const { novelA, novelB, chapterA } = await fixture();
  const memory = await contextCapability.searchMemory({ novelId: novelA.id, query: '独有的黑市' });
  assert.equal(memory.ok, true);
  assert.equal(memory.source, 'localstorage');
  assert.equal(memory.revision, null);
  assert.ok(memory.contentHash);
  assert.equal(memory.data?.items.length, 1);
  assert.equal(memory.data?.items[0].chapterId, chapterA.id);
  assert.match(memory.data?.items[0].text ?? '', /A 独有/);

  const noMemory = await contextCapability.searchMemory({
    novelId: novelA.id,
    query: '不存在的事实',
  });
  assert.equal(noMemory.ok, true);
  assert.deepEqual(noMemory.data?.items, []);

  const context = await contextCapability.readCurrentStoryContext({
    novelId: novelA.id,
    chapterId: chapterA.id,
    query: '黑市',
  });
  assert.equal(context.ok, true, context.error?.message);
  assert.equal(context.data?.project.id, novelA.id);
  assert.equal(context.data?.chapter.id, chapterA.id);
  assert.equal(context.data?.settings.protagonists[0].name, 'A 主角');
  assert.equal(context.data?.memory?.novelId, novelA.id);
  assert.equal('content' in (context.data ?? {}), false);

  const cross = await contextCapability.readCurrentStoryContext({
    novelId: novelB.id,
    chapterId: chapterA.id,
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.error?.code, 'SCOPE_MISMATCH');
  assert.equal(cross.data, undefined);
});

test('facades fail closed for missing identities, unknown targets, and malformed chapter relations', async () => {
  const { novelA, novelB, volumeA, chapterA } = await fixture();
  const missingNovel = await projectCapability.readCurrentProject({ novelId: 'missing-novel' });
  assert.equal(missingNovel.ok, false);
  assert.equal(missingNovel.error?.code, 'NOT_FOUND');

  const missingScope = await projectCapability.readCurrentProject({ novelId: '' });
  assert.equal(missingScope.ok, false);
  assert.equal(missingScope.error?.code, 'INVALID_SCOPE');

  const beforeCrossScope = storageSnapshot();
  const missingChapter = await projectCapability.readChapterPosition({
    novelId: novelA.id,
    chapterId: 'missing-chapter',
  });
  assert.equal(missingChapter.ok, false);
  assert.equal(missingChapter.error?.code, 'NOT_FOUND');

  const crossChapter = await projectCapability.readChapterPosition({
    novelId: novelB.id,
    chapterId: chapterA.id,
  });
  assert.equal(crossChapter.ok, false);
  assert.equal(crossChapter.error?.code, 'SCOPE_MISMATCH');
  assert.equal(storageSnapshot(), beforeCrossScope, '只读负例不得改写存储');

  // A malformed volume relation must not produce a mixed-ownership DTO.
  const malformed = await chapterRepository.create({
    novelId: novelA.id,
    volumeId: volumeA.id,
    title: 'A 合法章节',
  });
  // Replace the stored relation with an impossible foreign volume id in the
  // browser fallback fixture.  The production reader and facade must reject it.
  const raw = JSON.parse(localStorage.getItem('ai_novel_studio_chapters') ?? '[]') as Array<
    Record<string, unknown>
  >;
  const row = raw.find((item) => item.id === malformed.id);
  assert.ok(row);
  row!.volumeId = 'foreign-volume-id';
  localStorage.setItem('ai_novel_studio_chapters', JSON.stringify(raw));
  const malformedResult = await projectCapability.readChapterPosition({
    novelId: novelA.id,
    chapterId: malformed.id,
  });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.error?.code, 'INTEGRITY_ERROR');
});

test('public project DTO and hash survive a browser-process storage rehydrate', async () => {
  const { novelA } = await fixture();
  const before = await projectCapability.readCurrentProject({ novelId: novelA.id });
  assert.equal(before.ok, true);
  const persisted: Array<[string, string]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const value = key ? localStorage.getItem(key) : null;
    if (key && value !== null) persisted.push([key, value]);
  }
  const replacement = new MemoryStorage();
  for (const [key, value] of persisted) replacement.setItem(key, value);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: replacement,
  });
  const after = await projectCapability.readCurrentProject({ novelId: novelA.id });
  assert.equal(after.ok, true);
  assert.deepEqual(after.data, before.data);
  assert.equal(after.contentHash, before.contentHash);
});

test('conversation and artifact facades expose runtime facts and preserve review/CAS boundaries', async () => {
  const { novelA, chapterA } = await fixture();
  const { taskConversationService } = await import('../../conversation/taskConversationService');
  const conversation = await taskConversationService.create(novelA.id, 'Facade 对话');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '生成候选',
  );
  const listed = await conversationCapability.listTaskSummaries({ novelId: novelA.id });
  assert.equal(listed.ok, true);
  assert.equal(listed.data?.[0].conversationId, conversation.conversationId);

  const published = await artifactCapability.publishCandidate({
    novelId: novelA.id,
    chapterId: chapterA.id,
    conversationId: conversation.conversationId,
    artifactType: 'chapter_text',
    title: '候选正文',
    summary: '仅供审阅',
    structuredPayload: {
      data: {
        novelId: novelA.id,
        chapterId: chapterA.id,
        text: '候选正文，不应直接成为正式稿。',
      },
    },
  });
  assert.equal(published.ok, true, published.error?.message);
  assert.ok(published.data?.cardId);
  assert.ok(published.data?.artifactId);

  const runtime = await conversationCapability.readRuntimeSnapshot({
    novelId: novelA.id,
    conversationId: conversation.conversationId,
  });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data?.turns[0].turnId, turn.turnId);
  assert.equal('content' in (runtime.data?.turns[0] ?? {}), false);
  assert.equal('argumentsSummary' in (runtime.data?.toolEvents[0] ?? {}), false);

  const review = await artifactCapability.requestReview({
    novelId: novelA.id,
    chapterId: chapterA.id,
    conversationId: conversation.conversationId,
    cardId: published.data!.cardId,
    artifactId: published.data!.artifactId,
    userConfirmedAt: new Date().toISOString(),
  });
  assert.equal(review.ok, true, review.error?.message);
  assert.ok(review.data?.authorizationId);

  const draft = await draftVersionService.create({
    novelId: novelA.id,
    chapterId: chapterA.id,
    content: '审阅后的人工作品正文。',
    source: 'user_edited',
  });
  const hash = await computeContentSha256(draft.content);
  const applied = await artifactCapability.applyAuthorizedDraft({
    novelId: novelA.id,
    chapterId: chapterA.id,
    authorizationId: review.data!.authorizationId,
    draftId: draft.id,
    expectedDraftVersion: draft.versionNo,
    expectedContentHash: hash,
  });
  assert.equal(applied.ok, true, applied.error?.message);
  assert.equal(applied.data?.draftId, draft.id);
  assert.equal(applied.data?.isAdopted, true);

  const replay = await artifactCapability.applyAuthorizedDraft({
    novelId: novelA.id,
    chapterId: chapterA.id,
    authorizationId: review.data!.authorizationId,
    draftId: draft.id,
    expectedDraftVersion: draft.versionNo,
    expectedContentHash: hash,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.error?.code, 'CONFLICT');
});

test('writing facade enforces candidate and model-snapshot boundaries before the model pipeline', async () => {
  const { novelA, chapterA } = await fixture();
  const missingSnapshot = await writingCapability.generateCandidate({
    novelId: novelA.id,
    chapterId: chapterA.id,
    instruction: '继续当前章节',
  });
  assert.equal(missingSnapshot.ok, false);
  assert.equal(missingSnapshot.error?.code, 'MODEL_SNAPSHOT_REQUIRED');

  const missingSource = await writingCapability.rewriteCandidate({
    novelId: novelA.id,
    chapterId: chapterA.id,
    instruction: '节奏放慢',
    modelSnapshot: captureTaskModelSnapshot('mock', 'Facade-Test-Model'),
  });
  assert.equal(missingSource.ok, false);
  assert.equal(missingSource.error?.code, 'INVALID_ARGUMENT');
});
