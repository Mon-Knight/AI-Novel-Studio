import type {
  ChapterAssetRecovery,
  ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import { WorkbenchModelUnavailableError } from '../../services/conversation/workbenchModelAvailability';
import { classifyTaskIntent } from '../../services/conversation/taskGoalRouting';
import {
  resolveWorkbenchChapterTarget,
  shouldResolveWorkbenchChapterTarget,
} from '../../services/conversation/workbenchChapterTarget';
import type { TaskModelSnapshot } from '../../types/conversation';

export const STORY_PLAN_COMPLETE_MESSAGE =
  '全书规划中的最后一章已经采用，当前故事已写到规划终点。请先扩展全书规划，再继续生成新章节。';

export const CORE_ASSET_ARTIFACT_TYPE: Record<ChapterCoreAsset, string> = {
  story_plan: 'outline',
  world_setting: 'setting_candidates',
  rule_system: 'setting_candidates',
  protagonist: 'character_candidates',
  chapter_outline: 'outline',
};

export interface AssetDecisionSettlementInput {
  conversationId: string;
  artifactId: string;
  decision: 'confirm' | 'reject' | 'request_revision' | 'request_apply';
  applied: boolean;
  selectedChapterId?: string;
}

export function isCurrentAssetPreparation(
  current: ChapterAssetRecovery | null,
  started: ChapterAssetRecovery,
  asset: ChapterCoreAsset,
): current is ChapterAssetRecovery {
  return Boolean(
    current &&
    current.conversationId === started.conversationId &&
    current.novelId === started.novelId &&
    current.chapterId === started.chapterId &&
    current.sourceTurnId === started.sourceTurnId &&
    current.originalGoal === started.originalGoal &&
    current.missingAssets[0] === asset &&
    current.orchestration.asset === asset &&
    current.orchestration.phase === 'generating',
  );
}

export function formatModelDirectoryFailure(error: unknown): string {
  if (error instanceof WorkbenchModelUnavailableError) return error.message;
  return 'Runtime 模型目录刷新失败，草稿已保留，请稍后重试。';
}

export interface ChapterTargetResolverDependencies {
  ensureAssetReadiness: (request: {
    conversationId: string;
    novelId: string;
    chapterId?: string;
    goal: string;
    sourceTurnId?: string;
    modelSnapshot: TaskModelSnapshot;
  }) => Promise<boolean>;
  selectChapter: (chapterId: string) => Promise<void>;
}

/** Chapter targeting stays a pure resolution; no Store, DOM or provider side effects. */
export function createChapterTargetResolvers(dependencies: ChapterTargetResolverDependencies) {
  const ensureChapterAssetsReady = async (request: {
    conversationId: string;
    novelId: string;
    chapterId?: string;
    turnId?: string;
    goal: string;
    modelSnapshot: TaskModelSnapshot;
  }): Promise<boolean> => {
    if (classifyTaskIntent(request.goal) !== 'chapter_write') return true;
    return dependencies.ensureAssetReadiness({
      conversationId: request.conversationId,
      novelId: request.novelId,
      chapterId: request.chapterId,
      goal: request.goal,
      sourceTurnId: request.turnId,
      modelSnapshot: request.modelSnapshot,
    });
  };

  const resolveChapterTarget = async (request: {
    novelId: string;
    chapterId?: string;
    goal: string;
  }) => {
    if (!shouldResolveWorkbenchChapterTarget(request.goal)) {
      return { complete: false, chapterId: request.chapterId };
    }
    const resolution = await resolveWorkbenchChapterTarget({
      novelId: request.novelId,
      currentChapterId: request.chapterId,
      goal: request.goal,
    });
    if (resolution.status === 'complete') {
      return { complete: true, chapterId: request.chapterId };
    }
    const targetChapterId = resolution.chapterId ?? request.chapterId;
    if (targetChapterId && targetChapterId !== request.chapterId) {
      await dependencies.selectChapter(targetChapterId);
    }
    return { complete: false, chapterId: targetChapterId };
  };

  return { ensureChapterAssetsReady, resolveChapterTarget };
}
