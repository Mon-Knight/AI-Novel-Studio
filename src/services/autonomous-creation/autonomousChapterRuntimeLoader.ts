import { isTauri } from '../database/db';
import { autonomousPlanPersistence } from './autonomousPersistence';
import { submitProductionAiEntry } from './productionAiEntryService';

type AutonomousChapterWorkflow =
  (typeof import('./autonomousChapterRuntime'))['autonomousChapterWorkflow'];

let runtimePromise: Promise<AutonomousChapterWorkflow> | undefined;

function loadWorkflow(): Promise<AutonomousChapterWorkflow> {
  runtimePromise ??= import('./autonomousChapterRuntime').then(
    ({ autonomousChapterWorkflow }) => autonomousChapterWorkflow,
  );
  return runtimePromise;
}

export const autonomousChapterRuntimeLoader = {
  async generateNextCandidate(
    ...args: Parameters<AutonomousChapterWorkflow['generateNextCandidate']>
  ): ReturnType<AutonomousChapterWorkflow['generateNextCandidate']> {
    if (isTauri()) {
      const [planId, options = {}] = args;
      const plan = await autonomousPlanPersistence.getPlan(planId);
      if (!plan || plan.status !== 'applied') throw new Error('必须先确认应用全书计划。');
      const chapter = plan.chapters.find(
        (chapter) =>
          chapter.status !== 'adopted' &&
          (options.selection !== 'next_missing_candidate' ||
            !plan.chapterRuns?.some(
              (run) =>
                run.chapterId === chapter.id && ['candidate_ready', 'adopted'].includes(run.status),
            )),
      );
      if (!chapter) throw new Error('全书章节均已采用或已有候选。');
      const previous = [...(plan.chapterRuns ?? [])]
        .reverse()
        .find((run) => run.chapterId === chapter.id);
      await submitProductionAiEntry({
        novelId: plan.novelId,
        chapterId: chapter.id,
        conversationId: previous?.runtimeConversationId,
        modelSnapshot: previous?.runtimeModelSnapshot,
        goal: `根据已应用全书计划生成第 ${chapter.chapterNumber} 章候选并进行受控专家评审。`,
        entry: { kind: 'autonomous_chapter', planId, selection: options.selection },
        signal: options.signal,
      });
      const current = await autonomousPlanPersistence.getPlan(planId);
      const run = [...(current?.chapterRuns ?? [])]
        .reverse()
        .find((run) => run.chapterId === chapter.id);
      if (!current || !run || !['candidate_ready', 'adopted'].includes(run.status))
        throw new Error('章节候选未完成，请查看统一任务阶段与停止原因。');
      options.onProgress?.(current);
      return {
        plan: current,
        chapter: current.chapters.find((item) => item.id === chapter.id)!,
        run,
      };
    }
    return (await loadWorkflow()).generateNextCandidate(...args);
  },

  async generateAllCandidates(
    ...args: Parameters<AutonomousChapterWorkflow['generateAllCandidates']>
  ): ReturnType<AutonomousChapterWorkflow['generateAllCandidates']> {
    if (isTauri()) {
      const [planId, options = {}] = args;
      const plan = await autonomousPlanPersistence.getPlan(planId);
      if (!plan || plan.status !== 'applied') throw new Error('必须先确认应用全书计划。');
      const [{ autonomousSchedulerWorker }, { createDefaultAutonomousPolicy }] = await Promise.all([
        import('./autonomousSchedulerWorker'),
        import('./autonomousSchedulerService'),
      ]);
      if (!('waitForRun' in autonomousSchedulerWorker)) throw new Error('桌面统一调度宿主不可用。');
      const run = await autonomousSchedulerWorker.start(
        plan,
        createDefaultAutonomousPolicy(plan, 'draft_night'),
      );
      const cancel = () => {
        void autonomousSchedulerWorker.stop(run);
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        options.signal?.throwIfAborted();
        await autonomousSchedulerWorker.waitForRun(run.runId);
        const current = await autonomousPlanPersistence.getPlan(planId);
        if (!current) throw new Error('无法读取调度结果。');
        options.onProgress?.(current);
        const count = current.chapters.filter(
          (chapter) =>
            chapter.status === 'adopted' ||
            current.chapterRuns?.some(
              (run) => run.chapterId === chapter.id && run.status === 'candidate_ready',
            ),
        ).length;
        return { plan: current, generatedChapterCount: count, candidateChapterCount: count };
      } finally {
        options.signal?.removeEventListener('abort', cancel);
      }
    }
    return (await loadWorkflow()).generateAllCandidates(...args);
  },
};
