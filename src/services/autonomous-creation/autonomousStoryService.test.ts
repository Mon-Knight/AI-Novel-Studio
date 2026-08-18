import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ApplyAutonomousPlanResult,
  AutonomousPlanningBaseline,
  AutonomousStoryBrief,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import type { AutonomousPlanPersistence } from './autonomousPersistence';
import type { AutonomousCreationProvider, AutonomousProviderResult } from './autonomousProvider';
import type {
  CharacterProposal,
  ConflictProposal,
  PacingPhaseProposal,
  PlotFoundationProposal,
  WorldElementProposal,
} from './autonomousPlanBuilder';
import {
  createAutonomousChapterBatchRequestId,
  resolveAutonomousChapterBatchMaxTokens,
} from './autonomousChapterBatchPolicy';
import { AutonomousStoryService } from './autonomousStoryService';

const brief: AutonomousStoryBrief = {
  premise: '一名城市调查员收到来自未来自己的录音，并发现整座城市的公共记忆正在被系统性改写。',
  genre: '近未来悬疑',
  targetChapterCount: 300,
  targetWordsPerChapter: 2_400,
  readerPromise: '持续升级的谜题、人物选择与跨卷伏笔回收。',
  endingPreference: '主角揭开真相，但必须放弃回到原有生活的可能。',
  constraints: ['重要胜利必须付出代价', '不使用无铺垫的万能能力'],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryPersistence implements AutonomousPlanPersistence {
  plans = new Map<string, AutonomousStoryPlan>();

  async savePlan(
    plan: AutonomousStoryPlan,
    expectedRevision: number,
  ): Promise<AutonomousStoryPlan> {
    const current = this.plans.get(plan.planId);
    if (current && current.revision !== expectedRevision) throw new Error('revision conflict');
    if (!current && expectedRevision !== 0) throw new Error('invalid initial revision');
    const saved = clone({ ...plan, revision: expectedRevision + 1 });
    this.plans.set(saved.planId, saved);
    return clone(saved);
  }

  async getPlan(planId: string) {
    const plan = this.plans.get(planId);
    return plan ? clone(plan) : null;
  }

  async getPlanByOperation(operationId: string) {
    const plan = [...this.plans.values()].find((item) => item.operationId === operationId);
    return plan ? clone(plan) : null;
  }

  async listPlansByNovel(novelId: string, limit = 20) {
    return [...this.plans.values()]
      .filter((item) => item.novelId === novelId)
      .slice(0, limit)
      .map(clone);
  }

  async applyPlan(): Promise<ApplyAutonomousPlanResult> {
    throw new Error('not used');
  }
}

function providerResult<T>(value: T, task: string): AutonomousProviderResult<T> {
  return {
    value,
    aiTaskId: task,
    tokensInput: 10,
    tokensOutput: 20,
    tokensUsed: 30,
    durationMs: 5,
  };
}

class DeterministicProvider implements AutonomousCreationProvider {
  calls = new Map<string, number>();
  chapterBatchCalls: Array<{
    start: number;
    end: number;
    previousChapterNumbers: number[];
  }> = [];
  activeDimensions = 0;
  maxActiveDimensions = 0;
  failWorldOnce = false;
  failChapterRangeOnce?: { start: number; end: number };

  private called(name: string) {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
  }

  private async dimension<T>(name: string, value: T): Promise<AutonomousProviderResult<T>> {
    this.called(name);
    this.activeDimensions += 1;
    this.maxActiveDimensions = Math.max(this.maxActiveDimensions, this.activeDimensions);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.activeDimensions -= 1;
    return providerResult(value, `${name}-${this.calls.get(name)}`);
  }

  async planFoundation(input: Parameters<AutonomousCreationProvider['planFoundation']>[0]) {
    this.called('plot');
    const value: PlotFoundationProposal = {
      storyBible: {
        title: '回声边界',
        logline: '调查员必须追踪来自未来的录音，并阻止城市记忆被永久重写。',
        themes: ['身份', '选择'],
        protagonistPromise: '从被动求证成长为主动承担真相的人。',
        centralQuestion: '真实是否值得以失去安稳生活为代价？',
        endingVision: '真相被公开，主角接受不可逆的个人代价。',
        narrativeRules: ['线索必须可回溯', '能力必须有代价'],
      },
      arcs: Array.from({ length: input.shape.arcCount }, (_, index) => ({
        title: `故事弧 ${index + 1}`,
        goal: `推进第 ${index + 1} 层真相。`,
        turningPoint: `第 ${index + 1} 次证据反转。`,
        climax: `第 ${index + 1} 次正面对抗。`,
        outcome: `形成第 ${index + 1} 个不可逆后果。`,
      })),
      volumes: Array.from({ length: input.shape.volumeCount }, (_, index) => ({
        title: `第 ${index + 1} 卷`,
        summary: `第 ${index + 1} 卷围绕新的证据与场域展开，并改变长期局势。`,
        goal: `完成第 ${index + 1} 个阶段任务。`,
        mainConflict: `第 ${index + 1} 个阶段的时间压力与阵营阻力。`,
      })),
    };
    return providerResult(value, 'plot-1');
  }

  async planCharacters(input: Parameters<AutonomousCreationProvider['planCharacters']>[0]) {
    this.called('characters');
    const total = input.brief.targetChapterCount;
    const values: CharacterProposal[] = [
      ['林序', 'protagonist'],
      ['苏弥', 'supporting'],
      ['周策', 'antagonist'],
    ].map(([name, role]) => ({
      name,
      role: role as CharacterProposal['role'],
      identity: `${name}的身份`,
      personality: '克制而执着',
      coreNeed: '确认自身记忆是否真实',
      flaw: '过度依赖可验证证据',
      initialState: '只掌握局部事实',
      desiredEndState: '能够主动承担选择后果',
      behaviorLimits: ['重大决定需要证据'],
      forbiddenBehaviors: ['无理由背叛核心目标'],
      beats: [1, Math.floor(total / 2), total].map((chapterNumber, index) => ({
        chapterNumber,
        stage: `阶段 ${index + 1}`,
        change: `${name}完成第 ${index + 1} 次认知变化。`,
      })),
    }));
    return providerResult(values, 'characters-1');
  }

  async buildWorld(input: Parameters<AutonomousCreationProvider['buildWorld']>[0]) {
    if (this.failWorldOnce) {
      this.failWorldOnce = false;
      this.called('world');
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('world temporarily failed');
    }
    const values: WorldElementProposal[] = input.volumes.map((volume, index) => ({
      type: index % 2 === 0 ? 'location' : 'rule',
      name: `世界元素 ${index + 1}`,
      summary: '为本卷行动提供可验证的环境规则和长期后果。',
      firstChapter: volume.chapterStart,
      dependencies: [],
      constraints: ['规则不可被无代价绕过'],
    }));
    return this.dimension('world', values);
  }

  async generateConflicts(input: Parameters<AutonomousCreationProvider['generateConflicts']>[0]) {
    const values: ConflictProposal[] = input.arcs.map((arc, index) => ({
      title: `冲突 ${index + 1}`,
      type: index % 2 === 0 ? 'mystery' : 'faction',
      participants: ['林序', index % 2 === 0 ? '苏弥' : '周策'],
      stakes: '失败将失去关键行动窗口。',
      summary: '通过信息差和立场差异持续升级。',
      introducedChapter: arc.chapterStart,
      escalationChapters: [Math.max(arc.chapterStart, arc.chapterEnd - 10)],
      climaxChapter: Math.max(arc.chapterStart, arc.chapterEnd - 3),
      resolutionChapter: arc.chapterEnd,
    }));
    return this.dimension('conflicts', values);
  }

  async controlPacing(input: Parameters<AutonomousCreationProvider['controlPacing']>[0]) {
    const values: PacingPhaseProposal[] = input.arcs.map((_, index) => ({
      title: `节奏阶段 ${index + 1}`,
      mode: index === input.arcs.length - 1 ? 'resolution' : index % 2 === 0 ? 'build' : 'pressure',
      tensionStart: 30 + index * 5,
      tensionEnd: index === input.arcs.length - 1 ? 55 : 70 + index * 4,
      purpose: '交替安排升级、兑现和必要的恢复空间。',
    }));
    return this.dimension('pacing', values);
  }

  async planChapterBatch(input: Parameters<AutonomousCreationProvider['planChapterBatch']>[0]) {
    this.called('chapters');
    this.chapterBatchCalls.push({
      start: input.volume.chapterStart,
      end: input.volume.chapterEnd,
      previousChapterNumbers: input.previousChapters.map((chapter) => chapter.chapterNumber),
    });
    if (
      this.failChapterRangeOnce &&
      this.failChapterRangeOnce.start === input.volume.chapterStart &&
      this.failChapterRangeOnce.end === input.volume.chapterEnd
    ) {
      this.failChapterRangeOnce = undefined;
      throw new Error(
        `chapter range ${input.volume.chapterStart}-${input.volume.chapterEnd} failed`,
      );
    }
    const conflict = input.conflicts[0];
    const values = Array.from(
      { length: input.volume.chapterEnd - input.volume.chapterStart + 1 },
      (_, offset) => {
        const chapterNumber = input.volume.chapterStart + offset;
        return {
          chapterNumber,
          title: `第 ${chapterNumber} 章 计划节点`,
          outline: `主角执行一项可观察行动，遭遇阻力并让第 ${chapterNumber} 章结束时的局势不同于开场状态。`,
          goal: `推进第 ${chapterNumber} 章的冲突与人物选择。`,
          endingHook: `第 ${chapterNumber} 章末出现一条反证。`,
          focusCharacters: ['林序', '苏弥'],
          conflictTitles: conflict ? [conflict.title] : [],
          worldElementNames: input.worldElements
            .filter((item) => item.firstChapter === chapterNumber)
            .map((item) => item.name),
        };
      },
    );
    return providerResult(values, `chapters-${input.volume.index + 1}`);
  }
}

function createService(
  provider = new DeterministicProvider(),
  maxConcurrentProviderCalls?: number,
) {
  const persistence = new MemoryPersistence();
  let id = 0;
  let tick = 0;
  const service = new AutonomousStoryService({
    provider,
    persistence,
    createId: () => `id-${++id}`,
    now: () => new Date(Date.UTC(2026, 6, 27, 12, 0, tick++)).toISOString(),
    maxConcurrentProviderCalls:
      maxConcurrentProviderCalls === undefined ? undefined : () => maxConcurrentProviderCalls,
  });
  return { service, provider, persistence };
}

test('生成精确 300 章的分层计划并让五类创作 Agent 形成可引用事实', async () => {
  const { service, provider } = createService();
  const plan = await service.generate({ novelId: 'novel-1', brief, operationId: 'operation-1' });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.stage, 'ready');
  assert.equal(plan.arcs.length, 5);
  assert.equal(plan.volumes.length, 10);
  assert.equal(plan.chapters.length, 300);
  assert.equal(plan.pacingCurve.length, 300);
  assert.deepEqual(
    plan.chapters.map((item) => item.chapterNumber),
    Array.from({ length: 300 }, (_, index) => index + 1),
  );
  assert.ok(plan.characters.every((item) => item.beats.length >= 2));
  assert.ok(plan.chapters.every((item) => item.characterIds.length >= 1));
  assert.ok(plan.chapters.every((item) => item.conflictThreadIds.length >= 1));
  assert.equal(provider.calls.get('chapters'), 60);
  assert.ok(provider.chapterBatchCalls.every((call) => call.end - call.start + 1 <= 5));
  assert.deepEqual(provider.chapterBatchCalls[0], {
    start: 1,
    end: 5,
    previousChapterNumbers: [],
  });
  assert.deepEqual(provider.chapterBatchCalls[1], {
    start: 6,
    end: 10,
    previousChapterNumbers: [3, 4, 5],
  });
  assert.equal(provider.maxActiveDimensions, 3);
  assert.ok(plan.agentRuns.every((item) => item.status === 'succeeded'));

  assert.equal(resolveAutonomousChapterBatchMaxTokens(5), 4_500);
  assert.equal(resolveAutonomousChapterBatchMaxTokens(1), 2_100);
  assert.equal(
    createAutonomousChapterBatchRequestId({
      operationId: 'operation-1',
      volumeIndex: 0,
      chapterStart: 1,
      chapterEnd: 5,
    }),
    'operation-1-volume-1-chapters-1-5',
  );
});

test('创作维度按全局并发额度分批执行且全部结果仍可持久化', async () => {
  const provider = new DeterministicProvider();
  const { service } = createService(provider, 2);

  const plan = await service.generate({
    novelId: 'novel-1',
    brief,
    operationId: 'operation-bounded-dimensions',
  });

  assert.equal(provider.maxActiveDimensions, 2);
  assert.ok(plan.worldElements.length > 0);
  assert.ok(plan.conflicts.length > 0);
  assert.equal(plan.pacingCurve.length, brief.targetChapterCount);
  assert.ok(plan.agentRuns.every((item) => item.status === 'succeeded'));
});

test('章节子批次失败后保留已保存范围，继续时不重复付费调用成功批次', async () => {
  const provider = new DeterministicProvider();
  provider.failChapterRangeOnce = { start: 6, end: 10 };
  const { service, persistence } = createService(provider);

  await assert.rejects(
    service.generate({ novelId: 'novel-1', brief, operationId: 'operation-chapter-resume' }),
    /chapter range 6-10 failed/,
  );
  const failed = await persistence.getPlanByOperation('operation-chapter-resume');
  assert.equal(failed?.status, 'failed');
  assert.deepEqual(
    failed?.chapters.map((chapter) => chapter.chapterNumber),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(failed?.progress.completedVolumeIds, []);

  const resumed = await service.resume(failed!.planId);
  assert.equal(resumed.status, 'ready');
  assert.deepEqual(
    resumed.chapters.map((chapter) => chapter.chapterNumber),
    Array.from({ length: 300 }, (_, index) => index + 1),
  );
  assert.equal(new Set(resumed.chapters.map((chapter) => chapter.id)).size, 300);
  assert.equal(
    provider.chapterBatchCalls.filter((call) => call.start === 1 && call.end === 5).length,
    1,
  );
  assert.equal(
    provider.chapterBatchCalls.filter((call) => call.start === 6 && call.end === 10).length,
    2,
  );
  assert.equal(resumed.progress.completedVolumeIds.length, 10);
});

test('非整十章节数使用安全尾批次并保持连续覆盖', async () => {
  const { service, provider } = createService();
  const plan = await service.generate({
    novelId: 'novel-tail',
    brief: { ...brief, targetChapterCount: 61 },
    operationId: 'operation-tail-batch',
  });

  assert.equal(plan.chapters.length, 61);
  assert.deepEqual(
    plan.chapters.map((chapter) => chapter.chapterNumber),
    Array.from({ length: 61 }, (_, index) => index + 1),
  );
  assert.ok(provider.chapterBatchCalls.every((call) => call.end - call.start + 1 <= 5));
  assert.ok(provider.chapterBatchCalls.some((call) => call.end - call.start + 1 < 5));
});

test('缺号或非连续的持久检查点失败关闭而不覆盖已有章节', async () => {
  const provider = new DeterministicProvider();
  provider.failChapterRangeOnce = { start: 6, end: 10 };
  const { service, persistence } = createService(provider);
  await assert.rejects(
    service.generate({ novelId: 'novel-1', brief, operationId: 'operation-corrupt-checkpoint' }),
  );
  const failed = await persistence.getPlanByOperation('operation-corrupt-checkpoint');
  const corrupted = clone({
    ...failed!,
    chapters: failed!.chapters.filter((chapter) => chapter.chapterNumber !== 5),
  });
  persistence.plans.set(corrupted.planId, corrupted);
  const callsBeforeResume = provider.calls.get('chapters');

  await assert.rejects(service.resume(corrupted.planId), /检查点不完整/);
  assert.equal(provider.calls.get('chapters'), callsBeforeResume);
});

test('operationId 完成重放不重复调用任何创作 Agent', async () => {
  const { service, provider } = createService();
  const first = await service.generate({
    novelId: 'novel-1',
    brief,
    operationId: 'operation-replay',
  });
  const calls = new Map(provider.calls);
  const replay = await service.generate({
    novelId: 'novel-1',
    brief,
    operationId: 'operation-replay',
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(provider.calls, calls);
});

test('创作维度部分失败后保存成功结果，继续时只重试缺失 Agent', async () => {
  const provider = new DeterministicProvider();
  provider.failWorldOnce = true;
  const { service, persistence } = createService(provider);
  await assert.rejects(
    service.generate({ novelId: 'novel-1', brief, operationId: 'operation-resume' }),
    /world temporarily failed/,
  );
  const failed = await persistence.getPlanByOperation('operation-resume');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.worldElements.length, 0);
  assert.ok((failed?.conflicts.length ?? 0) > 0);
  assert.ok((failed?.pacingCurve.length ?? 0) > 0);

  const conflictCalls = provider.calls.get('conflicts');
  const pacingCalls = provider.calls.get('pacing');
  const resumed = await service.resume(failed!.planId);
  assert.equal(resumed.status, 'ready');
  assert.equal(provider.calls.get('world'), 2);
  assert.equal(provider.calls.get('conflicts'), conflictCalls);
  assert.equal(provider.calls.get('pacing'), pacingCalls);
});

test('相同 operationId 但 brief 漂移时失败关闭', async () => {
  const { service } = createService();
  await service.generate({ novelId: 'novel-1', brief, operationId: 'operation-conflict' });
  await assert.rejects(
    service.generate({
      novelId: 'novel-1',
      brief: { ...brief, endingPreference: '改成完全不同的开放式结局。' },
      operationId: 'operation-conflict',
    }),
    /请求不一致/,
  );
});
test('continuation coordinates append after baseline', async () => {
  const { service, provider } = createService();
  const baseline: AutonomousPlanningBaseline = {
    novelId: 'novel-continuation',
    capturedAt: '2026-07-27T12:00:00.000Z',
    structureHash: 'a'.repeat(64),
    existingVolumes: [{ id: 'volume-existing', orderIndex: 0, title: 'Existing volume' }],
    existingChapters: Array.from({ length: 10 }, (_, index) => ({
      id: `chapter-existing-${index + 1}`,
      volumeId: 'volume-existing',
      chapterNumber: index + 1,
      orderIndex: index,
      title: `Existing chapter ${index + 1}`,
      goal: `Existing goal ${index + 1}`,
      summary: `Existing ending ${index + 1}`,
    })),
    existingCharacters: [],
    existingWorldElements: [],
  };
  const plan = await service.generate({
    novelId: baseline.novelId,
    brief: { ...brief, targetChapterCount: 80 },
    planningMode: 'continuation',
    volumeStrategy: 'create_new_volume',
    baseline,
    operationId: 'operation-continuation',
  });
  assert.equal(plan.planningMode, 'continuation');
  assert.equal(plan.volumes[0].index, 1);
  assert.deepEqual(
    plan.chapters.map((chapter) => chapter.chapterNumber),
    Array.from({ length: 70 }, (_, index) => index + 11),
  );
  assert.deepEqual(provider.chapterBatchCalls[0].previousChapterNumbers, [8, 9, 10]);
  assert.ok(
    plan.characters.every((character) => character.beats.every((beat) => beat.chapterNumber >= 11)),
  );
  const resumed = await service.resume(plan.planId);
  assert.deepEqual(resumed, plan);
  const timestampReplay = await service.generate({
    novelId: baseline.novelId,
    brief: { ...brief, targetChapterCount: 80 },
    planningMode: 'continuation',
    volumeStrategy: 'create_new_volume',
    baseline: { ...baseline, capturedAt: '2026-07-28T12:00:00.000Z' },
    operationId: 'operation-continuation',
  });
  assert.deepEqual(timestampReplay, plan);
});

test('continuation can append to the last existing volume without renumbering it', async () => {
  const { service } = createService();
  const baseline: AutonomousPlanningBaseline = {
    novelId: 'novel-append-volume',
    capturedAt: '2026-07-27T12:00:00.000Z',
    structureHash: 'b'.repeat(64),
    existingVolumes: [
      { id: 'volume-first', orderIndex: 0, title: 'First volume' },
      { id: 'volume-last', orderIndex: 2, title: 'Last volume' },
    ],
    existingChapters: Array.from({ length: 10 }, (_, index) => ({
      id: `chapter-append-${index + 1}`,
      volumeId: index < 5 ? 'volume-first' : 'volume-last',
      chapterNumber: index + 1,
      orderIndex: index,
      title: `Existing chapter ${index + 1}`,
    })),
    existingCharacters: [],
    existingWorldElements: [],
  };
  const plan = await service.generate({
    novelId: baseline.novelId,
    brief: { ...brief, targetChapterCount: 80 },
    planningMode: 'continuation',
    volumeStrategy: 'append_to_last_volume',
    baseline,
    operationId: 'operation-append-volume',
  });
  assert.equal(plan.volumes[0].id, 'volume-last');
  assert.equal(plan.volumes[0].materialization, 'existing');
  assert.equal(plan.volumes[0].index, 2);
  assert.deepEqual(
    plan.volumes.slice(1).map((volume) => volume.index),
    [3, 4],
  );
  assert.equal(plan.chapters[0].volumeId, 'volume-last');
});
