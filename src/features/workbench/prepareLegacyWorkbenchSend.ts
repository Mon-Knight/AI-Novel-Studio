import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import type { TaskModelSnapshot } from '../../types/conversation';
import { verifyArtifactRevisionSource } from '../../services/conversation/artifactRevisionSourceService';
import {
  assertTaskGoalExecutable,
  classifyTaskIntent,
  isConversationalGoal,
} from '../../services/conversation/taskGoalRouting';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { ensurePersistedChapterGoalTurn } from '../../services/conversation/chapterAssetRecoveryPersistence';

interface LegacySendRequest {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  goal: string;
  modelSnapshot: TaskModelSnapshot;
  revisionSource?: ArtifactRevisionSource;
}

interface LegacySendDependencies {
  resolveChapterTarget: (request: {
    novelId: string;
    chapterId?: string;
    goal: string;
  }) => Promise<{ complete: boolean; chapterId?: string }>;
  validateModel: (model: TaskModelSnapshot) => Promise<TaskModelSnapshot>;
  onModelFailure: (error: unknown) => void;
  onComplete: () => void;
  ensureAssetsReady: (request: LegacySendRequest & { turnId?: string }) => Promise<boolean>;
}

/** Preserve the deterministic/mock and exact-source preflight without gating real dialogue. */
export async function prepareLegacyWorkbenchSend(
  request: LegacySendRequest,
  dependencies: LegacySendDependencies,
): Promise<{ chapterId?: string; turnId?: string; modelSnapshot: TaskModelSnapshot } | null> {
  await verifyArtifactRevisionSource(request);
  assertTaskGoalExecutable(request.goal, request.revisionSource);
  const target = request.revisionSource
    ? { complete: false, chapterId: request.revisionSource.chapterId }
    : await dependencies.resolveChapterTarget(request);
  if (target.complete) {
    dependencies.onComplete();
    return null;
  }
  let modelSnapshot = request.modelSnapshot;
  if (!isConversationalGoal(request.goal)) {
    try {
      modelSnapshot = await dependencies.validateModel(modelSnapshot);
    } catch (error) {
      dependencies.onModelFailure(error);
      return null;
    }
  }
  let turnId: string | undefined;
  if (classifyTaskIntent(request.goal, request.revisionSource) === 'chapter_write') {
    const turn = request.revisionSource
      ? await taskConversationService.appendTurn(
          request.conversationId,
          'user',
          request.goal,
          request.revisionSource,
        )
      : await ensurePersistedChapterGoalTurn({
          conversationId: request.conversationId,
          goal: request.goal,
        });
    turnId = turn.turnId;
  }
  const ready = await dependencies.ensureAssetsReady({
    ...request,
    chapterId: target.chapterId,
    turnId,
    modelSnapshot,
  });
  return ready ? { chapterId: target.chapterId, turnId, modelSnapshot } : null;
}
