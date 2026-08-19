import type { ChapterDraft } from '../../types/ai';
import type { AutonomousChapterRun, AutonomousStoryPlan } from '../../types/autonomousCreation';

interface AutonomousAdoptionReconcilerDependencies {
  getAdoptedDraft(chapterId: string): Promise<ChapterDraft | null>;
  markAdopted(draft: ChapterDraft): Promise<AutonomousStoryPlan | null>;
}

export interface AutonomousAdoptionReconciliation {
  plan: AutonomousStoryPlan;
  draftsRequiringAnalysis: ChapterDraft[];
}

function latestRunByChapter(plan: AutonomousStoryPlan): Map<string, AutonomousChapterRun> {
  return new Map((plan.chapterRuns ?? []).map((run) => [run.chapterId, run]));
}

function reconciliationTargets(plan: AutonomousStoryPlan): string[] {
  const targets = new Set((plan.chapterRuns ?? []).map((run) => run.chapterId));
  const nextChapter = plan.chapters.find((chapter) => chapter.status !== 'adopted');
  if (nextChapter) targets.add(nextChapter.id);
  return [...targets];
}

export async function reconcileAutonomousAdoptions(
  initialPlan: AutonomousStoryPlan,
  dependencies: AutonomousAdoptionReconcilerDependencies,
): Promise<AutonomousAdoptionReconciliation> {
  if (initialPlan.status !== 'applied') {
    return { plan: initialPlan, draftsRequiringAnalysis: [] };
  }

  let plan = initialPlan;
  const draftsRequiringAnalysis: ChapterDraft[] = [];

  for (const chapterId of reconciliationTargets(initialPlan)) {
    const adoptedDraft = await dependencies.getAdoptedDraft(chapterId);
    if (!adoptedDraft) continue;

    const chapter = plan.chapters.find((item) => item.id === chapterId);
    const run = latestRunByChapter(plan).get(chapterId);
    const synchronized =
      chapter?.status === 'adopted' &&
      run?.status === 'adopted' &&
      run.adoptedDraftId === adoptedDraft.id;
    if (synchronized) continue;

    const updated = await dependencies.markAdopted(adoptedDraft);
    if (!updated) continue;
    plan = updated;
    draftsRequiringAnalysis.push(adoptedDraft);
  }

  return { plan, draftsRequiringAnalysis };
}
