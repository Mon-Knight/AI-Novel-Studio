import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import type { AiGenerateRequest, AiSettings } from '../../types/ai';

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

Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

const vite = await createServer({
  appType: 'custom',
  define: {
    'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
  },
  server: { middlewareMode: true, hmr: false },
});

const { executeChapterSceneGeneration } = (await vite.ssrLoadModule(
  '/src/services/ai/chapterSceneGenerationExecutionService.ts',
)) as typeof import('../ai/chapterSceneGenerationExecutionService');

const { novelMemoryManager } = (await vite.ssrLoadModule(
  '/src/services/memory/novelMemoryManager.ts',
)) as typeof import('./novelMemoryManager');

after(async () => {
  await vite.close();
});

const testSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  modelName: 'gpt-4o-mini',
  mockMode: true,
};

test('Scene generation triggers Memory retrieval and injects memory into contract', async () => {
  const novelId = 'novel-scene-mem-01';
  novelMemoryManager.reset(novelId);

  // 1. 初始化长期记忆碎片
  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '青云宗后山禁止私自动用神识窥探与打斗。',
    relatedEntities: ['char-lin', 'char-yue'],
  });

  // 2. 初始化角色心境动态
  await novelMemoryManager.updateCharacterState(novelId, 'char-lin', {
    characterName: '林清玄',
    currentEmotion: '表面平静，心神警惕',
    currentGoal: '引开戒律堂盘查',
    injuries: ['经脉滞涩'],
  });

  // 3. 执行 Scene 生成
  const request: AiGenerateRequest = {
    taskType: 'chapter_scene_generate',
    messages: [
      {
        role: 'user',
        content: '林清玄在竹林中前行，迎面撞见搜山的戒律堂执事岳凌峰。',
      },
    ],
  };

  const initialVersions = novelMemoryManager.listMemoryVersions(novelId);
  const initialVersionCount = initialVersions.length;

  const result = await executeChapterSceneGeneration({
    novelId,
    chapterId: 'chap-001',
    operationId: 'op-scene-mem-01',
    settings: testSettings,
    request,
    sourceId: 'req-src-01',
    sourceVersion: '1',
    taskInput: {
      chapterTitle: '第一章 竹林遇伏',
      contextHash: 'hash-ctx-01',
      sceneNo: 1,
      sceneTitle: '竹林周旋',
      povCharacterId: 'char-lin',
      characters: ['char-lin', 'char-yue'],
      sceneGoal: '避开戒律堂盘查',
      sceneBeats: ['林清玄收敛气息在竹林中前行，迎面遇上搜山的岳凌峰。'],
      sceneConstraints: ['不得直接暴露真实修为', '保持视点单一'],
    },
  });

  assert.ok(result);
  assert.ok(result.text !== undefined);
  assert.ok(result.provider);

  // 4. 验证生成后触发了 State Delta 并自增了快照版本
  const updatedVersions = novelMemoryManager.listMemoryVersions(novelId);
  assert.ok(
    updatedVersions.length > initialVersionCount,
    '生成完成后应创建新的 Memory Version Snapshot',
  );

  const latestVersion = updatedVersions[updatedVersions.length - 1];
  assert.ok(latestVersion.description.includes('Scene 生成完成'));

  novelMemoryManager.reset(novelId);
});

test('Scene generation gracefully fallbacks when no Memory data exists', async () => {
  const emptyNovelId = 'novel-empty-mem-02';
  novelMemoryManager.reset(emptyNovelId);

  const request: AiGenerateRequest = {
    taskType: 'chapter_scene_generate',
    messages: [
      {
        role: 'user',
        content: '普通测试正文生成。',
      },
    ],
  };

  const result = await executeChapterSceneGeneration({
    novelId: emptyNovelId,
    chapterId: 'chap-002',
    operationId: 'op-scene-empty-02',
    settings: testSettings,
    request,
    sourceId: 'req-src-02',
    sourceVersion: '1',
    taskInput: {
      chapterTitle: '第二章 普通场景',
      contextHash: 'hash-ctx-02',
      sceneNo: 2,
      sceneTitle: '普通场景',
      sceneGoal: '推进剧情',
      sceneBeats: ['普通剧情推进 Beat。'],
      sceneConstraints: ['按基准文风推进'],
    },
  });

  assert.ok(result);
  assert.ok(result.text !== undefined);
  assert.ok(result.provider);

  novelMemoryManager.reset(emptyNovelId);
});
