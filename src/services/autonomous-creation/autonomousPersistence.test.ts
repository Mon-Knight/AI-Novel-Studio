import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';

const KEYS = {
  plans: 'ai_novel_studio_autonomous_story_plans',
  volumes: 'ai_novel_studio_volumes',
  chapters: 'ai_novel_studio_chapters',
  characters: 'ai_novel_studio_characters',
  world: 'ai_novel_studio_world_settings',
  chapterCharacters: 'ai_novel_studio_chapter_characters',
  chapterEvents: 'ai_novel_studio_chapter_events',
} as const;

const APPLY_KEYS = Object.values(KEYS);

class FailingMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private failures: string[] = [];

  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
    this.failures = [];
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
    if (this.failures[0] === key) {
      this.failures.shift();
      throw new Error(`injected localStorage failure: ${key}`);
    }
    this.values.set(key, value);
  }

  failWrites(...keys: string[]): void {
    this.failures = [...keys];
  }
}

const storage = new FailingMemoryStorage();
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const persistenceModule = (await vite.ssrLoadModule(
  '/src/services/autonomous-creation/autonomousPersistence.ts',
)) as typeof import('./autonomousPersistence');
const dbModule = (await vite.ssrLoadModule(
  '/src/services/database/db.ts',
)) as typeof import('../database/db');

after(async () => {
  await vite.close();
});

beforeEach(() => {
  storage.clear();
});

function readyPlan(): AutonomousStoryPlan {
  const chapters = Array.from({ length: 12 }, (_, index) => ({
    id: `chapter-${index + 1}`,
    chapterNumber: index + 1,
    volumeId: 'volume-1',
    arcId: 'arc-1',
    title: `第 ${index + 1} 章`,
    outline: `调查员沿第 ${index + 1} 条线索推进，并在结尾发现新的矛盾证据。`,
    goal: '推进调查并产生可观察的局势变化',
    targetWordCount: 2_400,
    pacingMode: 'build' as const,
    tension: 50,
    endingHook: '出现一条改变判断的新证据',
    conflictThreadIds: [],
    characterIds: [],
    characterBeatIds: [],
    worldElementIds: [],
    status: 'planned' as const,
  }));

  return {
    schemaVersion: 1,
    planId: 'plan-local-apply',
    operationId: 'operation-local-apply',
    requestHash: 'a'.repeat(64),
    novelId: 'novel-local-apply',
    status: 'ready',
    stage: 'ready',
    revision: 1,
    brief: {
      premise: '一名城市调查员发现公共记忆正在被系统性改写，并决定追查隐藏在记录背后的真相。',
      genre: '近未来悬疑',
      targetChapterCount: 12,
      targetWordsPerChapter: 2_400,
      readerPromise: '持续升级的谜题与可回溯线索',
      endingPreference: '主角公开真相并承担代价',
      constraints: [],
    },
    storyBible: {
      title: '回声边界',
      logline: '调查员追查被改写的城市记忆。',
      themes: ['身份'],
      protagonistPromise: '主动承担真相',
      centralQuestion: '真实是否值得代价',
      endingVision: '公开真相并承担后果',
      narrativeRules: ['线索必须可回溯'],
    },
    arcs: [
      {
        id: 'arc-1',
        index: 0,
        title: '追查',
        chapterStart: 1,
        chapterEnd: 12,
        goal: '找到证据',
        turningPoint: '盟友隐瞒事实',
        climax: '公开对抗',
        outcome: '主角承担代价',
      },
    ],
    volumes: [
      {
        id: 'volume-1',
        index: 0,
        title: '第一卷',
        chapterStart: 1,
        chapterEnd: 12,
        summary: '调查失忆事件',
        goal: '找到证据',
        mainConflict: '调查与封锁',
        arcIds: ['arc-1'],
      },
    ],
    characters: [],
    worldElements: [],
    conflicts: [],
    pacingPhases: [
      {
        id: 'phase-1',
        title: '调查升级',
        chapterStart: 1,
        chapterEnd: 12,
        mode: 'build',
        tensionStart: 35,
        tensionEnd: 70,
        purpose: '逐步增加线索压力',
      },
    ],
    pacingCurve: chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      phaseId: 'phase-1',
      mode: 'build',
      tension: 50,
      dialogueRatio: 45,
      descriptionRatio: 35,
      cliffhanger: true,
    })),
    chapters,
    agentRuns: [],
    chapterRuns: [],
    progress: {
      completedVolumeIds: [],
      currentVolumeIndex: 0,
      adoptedChapterNumbers: [],
      lastCheckpoint: '计划已就绪',
    },
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    completedAt: '2026-07-28T00:00:00.000Z',
  };
}

function seedReadyPlan(): Record<string, string | null> {
  storage.setItem(KEYS.plans, JSON.stringify([readyPlan()], null, 2));
  storage.setItem(KEYS.volumes, '[{"id":"old-volume","novelId":"other-novel"}]\n');
  storage.setItem(KEYS.chapters, '[{"id":"old-chapter","novelId":"other-novel"}]\n');
  storage.setItem(KEYS.characters, '[] ');
  storage.setItem(KEYS.chapterCharacters, '[\n]\n');
  storage.setItem(KEYS.chapterEvents, '[]');
  return Object.fromEntries(APPLY_KEYS.map((key) => [key, storage.getItem(key)]));
}

function snapshotApplyKeys(): Record<string, string | null> {
  return Object.fromEntries(APPLY_KEYS.map((key) => [key, storage.getItem(key)]));
}

test('lsSet propagates localStorage write failures instead of reporting false success', () => {
  storage.failWrites(KEYS.plans);
  assert.throws(() => dbModule.lsSet(KEYS.plans, [readyPlan()]), /injected localStorage failure/);
  assert.equal(storage.getItem(KEYS.plans), null);
});

test('browser plan apply restores every raw snapshot after a middle write fails', async () => {
  const before = seedReadyPlan();
  storage.failWrites(KEYS.characters);

  await assert.rejects(
    persistenceModule.autonomousPlanPersistence.applyPlan('plan-local-apply', 1),
    /injected localStorage failure/,
  );
  assert.deepEqual(snapshotApplyKeys(), before);

  const retry = await persistenceModule.autonomousPlanPersistence.applyPlan('plan-local-apply', 1);
  assert.equal(retry.plan.status, 'applied');
  assert.equal(retry.createdVolumes, 1);
  assert.equal(retry.createdChapters, 12);
});

test('browser plan apply reports rollback failures and still restores later keys', async () => {
  const before = seedReadyPlan();
  storage.failWrites(KEYS.characters, KEYS.volumes);

  await assert.rejects(
    persistenceModule.autonomousPlanPersistence.applyPlan('plan-local-apply', 1),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /补偿回滚未完全成功/);
      const rollbackErrors = (
        error as {
          rollbackErrors?: Array<{ key: string; error: unknown }>;
        }
      ).rollbackErrors;
      assert.equal(rollbackErrors?.length, 1);
      assert.equal(rollbackErrors?.[0]?.key, KEYS.volumes);
      return true;
    },
  );

  assert.equal(storage.getItem(KEYS.plans), before[KEYS.plans]);
  assert.equal(storage.getItem(KEYS.chapters), before[KEYS.chapters]);
  assert.equal(storage.getItem(KEYS.world), before[KEYS.world]);
  assert.equal(storage.getItem(KEYS.chapterEvents), before[KEYS.chapterEvents]);
  assert.notEqual(storage.getItem(KEYS.volumes), before[KEYS.volumes]);
});
