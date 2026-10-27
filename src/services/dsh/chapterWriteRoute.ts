import { isTauri } from '../database/db';
import { isWritingSubAgentDshEnabled } from '../agents/writingSubAgentContract';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { stagedScenePlanFromSnapshot } from '../conversation/workbenchStagedChapterWrite';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';

export type ChapterWriteHost = 'dsh' | 'writer';

export interface ChapterWriteRouteInput {
  novelId: string;
  chapterId?: string;
  retrySourceRunId?: string;
  revisionSource?: ArtifactRevisionSource;
  workflowAction?: string;
  modelSnapshot?: TaskModelSnapshot;
}

export interface ChapterWriteRouteDependencies {
  isTauri?: () => boolean;
  dshEnabled?: (runtimeMode: TaskModelSnapshot['runtimeMode'] | undefined) => boolean;
  hasAppliedSceneOnlyPlan?: (novelId: string, chapterId: string) => Promise<boolean>;
}

async function readAppliedSceneOnlyPlan(_novelId: string, chapterId: string): Promise<boolean> {
  const bundle = await chapterEngineeringService.getBundle(chapterId);
  const scenes = bundle.activeState?.scenePlan;
  return Boolean(
    scenes &&
    stagedScenePlanFromSnapshot({
      compiledContext: { activeEngineeringState: bundle.activeState } as never,
    }),
  );
}

/** Applied Scene-only plans use the deterministic staged writer. Retries and other chapters keep DSH. */
export async function selectChapterWriteHost(
  input: ChapterWriteRouteInput,
  dependencies: ChapterWriteRouteDependencies = {},
): Promise<ChapterWriteHost> {
  const tauri = (dependencies.isTauri ?? isTauri)();
  const runtimeMode = input.modelSnapshot?.runtimeMode;
  const dshEnabled =
    dependencies.dshEnabled?.(runtimeMode) ??
    (tauri &&
      isWritingSubAgentDshEnabled({
        isTauri: true,
        modelRuntimeMode: runtimeMode ?? 'api',
      }));
  const dsh = Boolean(tauri && input.chapterId && (input.retrySourceRunId || dshEnabled));
  if (!dsh) return 'writer';
  if (input.retrySourceRunId || input.revisionSource || input.workflowAction === 'polish_chapter') {
    return 'dsh';
  }
  const hasPlan = dependencies.hasAppliedSceneOnlyPlan ?? readAppliedSceneOnlyPlan;
  if (input.chapterId && (await hasPlan(input.novelId, input.chapterId))) return 'writer';
  return 'dsh';
}
