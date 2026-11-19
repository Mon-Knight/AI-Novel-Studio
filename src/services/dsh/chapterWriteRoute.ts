import { isTauri } from '../database/db';
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
  /** Legacy adapter inputs are ignored: neither a flag nor a plan can select a desktop host. */
  dshEnabled?: (runtimeMode: TaskModelSnapshot['runtimeMode'] | undefined) => boolean;
  hasAppliedSceneOnlyPlan?: (novelId: string, chapterId: string) => Promise<boolean>;
}

/**
 * Desktop writing has one lifecycle authority: the native Task Runtime.
 * An applied Scene/Beat plan is an input to a governed capability, never a reason
 * to leave that authority. The Writer result is a browser-development adapter only.
 */
export async function selectChapterWriteHost(
  _input: ChapterWriteRouteInput,
  dependencies: ChapterWriteRouteDependencies = {},
): Promise<ChapterWriteHost> {
  return (dependencies.isTauri ?? isTauri)() ? 'dsh' : 'writer';
}
