import assert from 'node:assert/strict';
import test from 'node:test';

import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { putLocalMemoryDocument } from '../memory/adoptedDraftMemory';
import { ToolRegistryError } from './toolRegistry';
import type { ToolInvocationContext } from '../../types/toolRegistry';

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

function installLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

function restoreLocalStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function context(
  novelId: string,
  chapterId?: string,
  allowedTools: string[] = [],
): ToolInvocationContext {
  return {
    invocationId: `runtime-${novelId}`,
    novelId,
    chapterId,
    grantedPermissions: ['novel.read', 'chapter.read', 'style.read', 'verification.execute'],
    allowedTools,
  };
}

test.beforeEach(installLocalStorage);
test.afterEach(restoreLocalStorage);

test('production read tools execute against a real isolated browser fixture', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const novel = await novelRepository.create({
    title: '能力资产化验收作品',
    description: '用于验证生产 Tool handler 的隔离 fixture',
    genre: '测试',
  });
  await novelRepository.updateProtagonists(novel.id, {
    protagonistMode: 'single',
    protagonists: [
      {
        id: `protagonist-${novel.id}`,
        label: 'primary',
        name: '林默',
        gender: '男',
        identity: '黑市调查员',
        personality: '谨慎而固执',
        goal: '查清失踪案',
        motivation: '保护仍然活着的人',
        ability: '辨认残留记忆',
        limitation: '每次使用都会遗忘自己的片段',
        background: '来自被封锁的旧城区',
        arc: '从独自承担转向信任同伴',
        notes: '测试用完整主角资料',
      },
    ],
  });
  const volume = await volumeRepository.create({ novelId: novel.id, title: '第一卷' });
  const previousChapter = await chapterRepository.create({
    novelId: novel.id,
    volumeId: volume.id,
    title: '第一章',
    outline: '验证读取链路',
    goal: '确认返回真实章节事实',
  });
  const chapter = await chapterRepository.create({
    novelId: novel.id,
    volumeId: volume.id,
    title: '第二章',
    outline: '承接第一章',
    goal: '检索此前已采用事实',
  });
  putLocalMemoryDocument({
    documentId: `memory-${novel.id}`,
    novelId: novel.id,
    sourceType: 'adopted_draft',
    sourceId: `draft-${previousChapter.id}`,
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    adoptedDraftId: `draft-${previousChapter.id}`,
    chapterId: previousChapter.id,
    metadata: { fixture: true },
    chunks: [
      {
        id: `chunk-${previousChapter.id}`,
        ordinal: 0,
        text: '黑市的雨声压住了脚步。',
        tokenCount: 12,
        importance: 0.8,
        chapterOrderIndex: 0,
        temporalStartChapter: 0,
        entityKeys: [],
        metadata: { fixture: true },
        contentHash: 'b'.repeat(64),
      },
    ],
  });

  const project = await productionToolRegistry.invoke(
    'novel.read_context',
    '1',
    { novelId: novel.id },
    context(novel.id, chapter.id, ['novel.read_context@1']),
  );
  assert.equal(project.ok, true);
  assert.equal((project.data as { novel?: { id?: string } }).novel?.id, novel.id);
  assert.equal(
    (project.data as { protagonistSource?: string }).protagonistSource,
    'novels.protagonists',
  );
  assert.equal(
    (project.data as { protagonists?: Array<{ name?: string }> }).protagonists?.[0]?.name,
    '林默',
  );

  const outline = await productionToolRegistry.invoke(
    'chapter.read_outline',
    '1',
    { novelId: novel.id, chapterId: chapter.id },
    context(novel.id, chapter.id, ['chapter.read_outline@1']),
  );
  assert.equal(outline.ok, true);
  assert.equal(
    (outline.data as { chapter?: { id?: string; novelId?: string } }).chapter?.id,
    chapter.id,
  );
  assert.equal((outline.data as { chapter?: { novelId?: string } }).chapter?.novelId, novel.id);

  const settings = await productionToolRegistry.invoke(
    'novel.read_settings',
    '1',
    { novelId: novel.id },
    context(novel.id, chapter.id, ['novel.read_settings@1']),
  );
  assert.equal(settings.ok, true);
  assert.equal((settings.data as { novelId?: string }).novelId, novel.id);
  assert.equal(
    (settings.data as { protagonistSource?: string }).protagonistSource,
    'novels.protagonists',
  );

  const chapterContext = await productionToolRegistry.invoke(
    'chapter.read_context',
    '1',
    { novelId: novel.id, chapterId: chapter.id },
    context(novel.id, chapter.id, ['chapter.read_context@1']),
  );
  assert.equal(chapterContext.ok, true);
  assert.equal(
    (chapterContext.data as { chapter?: { novelId?: string } }).chapter?.novelId,
    novel.id,
  );

  const memory = await productionToolRegistry.invoke(
    'search_memory',
    '1',
    { novelId: novel.id, query: '黑市', targetChapterId: chapter.id },
    context(novel.id, chapter.id, ['search_memory@1']),
  );
  assert.equal(memory.ok, true);
  assert.equal(memory.source, 'localstorage');
  assert.equal(
    (memory.data as { items?: Array<{ chapterId?: string }> }).items?.[0]?.chapterId,
    previousChapter.id,
  );

  const executableCases: Array<{
    name: string;
    args: Record<string, unknown>;
    allowed: string;
  }> = [
    {
      name: 'generate_chapter',
      args: {
        novelId: novel.id,
        chapterId: chapter.id,
        candidateText: '一段足够长的章节候选正文。',
      },
      allowed: 'generate_chapter@1',
    },
    {
      name: 'generate_outline',
      args: { novelId: novel.id, chapterId: chapter.id, candidateText: '{"outline":"冲突升级"}' },
      allowed: 'generate_outline@1',
    },
    {
      name: 'generate_characters',
      args: {
        novelId: novel.id,
        chapterId: chapter.id,
        candidateText: '{"characters":[{"name":"林默"}]}',
      },
      allowed: 'generate_characters@1',
    },
    {
      name: 'suggest_events',
      args: {
        novelId: novel.id,
        chapterId: chapter.id,
        candidateText: '{"events":[{"title":"雨夜会面"}]}',
      },
      allowed: 'suggest_events@1',
    },
    {
      name: 'expand_settings',
      args: {
        novelId: novel.id,
        chapterId: chapter.id,
        candidateText: '{"settings":[{"name":"黑市"}]}',
      },
      allowed: 'expand_settings@1',
    },
    {
      name: 'polish_chapter',
      args: { novelId: novel.id, chapterId: chapter.id, candidateText: '润色后的章节候选正文。' },
      allowed: 'polish_chapter@1',
    },
    {
      name: 'check_quality',
      args: { novelId: novel.id, chapterId: chapter.id, candidateText: '{"summary":"结构完整"}' },
      allowed: 'check_quality@1',
    },
    {
      name: 'summarize_chapter',
      args: {
        novelId: novel.id,
        chapterId: chapter.id,
        candidateText: '{"summary":"本章完成会面"}',
      },
      allowed: 'summarize_chapter@1',
    },
    {
      name: 'verification.check_readiness',
      args: { novelId: novel.id, chapterId: chapter.id },
      allowed: 'verification.check_readiness@1',
    },
    {
      name: 'verification.check_outline',
      args: { novelId: novel.id, chapterId: chapter.id, draft: '林默走进黑市，雨声渐停。' },
      allowed: 'verification.check_outline@1',
    },
    {
      name: 'verification.check_style',
      args: { novelId: novel.id, draft: '林默走进黑市，雨声渐停。' },
      allowed: 'verification.check_style@1',
    },
    {
      name: 'style.read_profile',
      args: { novelId: novel.id },
      allowed: 'style.read_profile@1',
    },
    {
      name: 'style.read_output_control',
      args: { novelId: novel.id },
      allowed: 'style.read_output_control@1',
    },
  ];
  for (const executable of executableCases) {
    const result = await productionToolRegistry.invoke(
      executable.name,
      '1',
      executable.args,
      context(novel.id, chapter.id, [executable.allowed]),
    );
    assert.equal(result.ok, true, `${executable.name} failed: ${result.error ?? 'unknown error'}`);
  }
});

test('production chapter read tool fails closed for cross-novel scope', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const first = await novelRepository.create({ title: '作品一', genre: '测试' });
  const second = await novelRepository.create({ title: '作品二', genre: '测试' });
  const volume = await volumeRepository.create({ novelId: first.id, title: '第一卷' });
  const chapter = await chapterRepository.create({
    novelId: first.id,
    volumeId: volume.id,
    title: '第一章',
  });

  const result = await productionToolRegistry.invoke(
    'chapter.read_outline',
    '1',
    { novelId: second.id, chapterId: chapter.id },
    context(second.id, chapter.id, ['chapter.read_outline@1']),
  );
  assert.equal(result.ok, false);
  assert.equal(result.source, 'scope');
  assert.match(result.error ?? '', /不属于当前作品/);

  const verification = await productionToolRegistry.invoke(
    'verification.check_outline',
    '1',
    { novelId: second.id, chapterId: chapter.id, draft: '跨作品正文不应被检查。' },
    context(second.id, chapter.id, ['verification.check_outline@1']),
  );
  assert.equal(verification.ok, false);
  assert.equal(verification.source, 'scope');
});

test('production read tool rejects missing authoritative scope before handler', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  await assert.rejects(
    () =>
      productionToolRegistry.invoke(
        'novel.read_context',
        '1',
        { novelId: 'novel-without-context' },
        {
          invocationId: 'missing-scope',
          grantedPermissions: ['novel.read'],
          allowedTools: ['novel.read_context@1'],
        },
      ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_SCOPE_MISMATCH',
  );
});
