import { chapterCandidateEvidenceFromCards } from '../../features/workbench/chapterWorkflowStageTreeMapping';
import { useChapterWorkflowStageTree } from '../../features/workbench/useChapterWorkflowStageTree';
import type { ChapterStageAnchor } from '../../features/workbench/chapterStageProjection';
import type { TaskConversationBundle } from '../../types/conversation';
import { chapterStageProgressScopeFromBundle } from './chapterStageProgressScope';
import { WorkbenchChapterStageTree } from './WorkbenchChapterStageTree';

interface WorkbenchChapterStageProgressProps {
  readonly novelId: string;
  readonly chapterId?: string;
  readonly chapterTitle?: string;
  readonly bundle: TaskConversationBundle | null | undefined;
  readonly bundleReady: boolean;
  readonly onLocateArtifact: (cardId: string) => void;
}

function locatePublicRecord(
  anchor: ChapterStageAnchor,
  onLocateArtifact: (cardId: string) => void,
) {
  if (anchor.kind === 'artifact') {
    onLocateArtifact(anchor.id);
    return;
  }
  if (anchor.kind !== 'run' || typeof document === 'undefined') return;
  document.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(anchor.id)}"]`)?.scrollIntoView({
    block: 'nearest',
  });
}

/** Read-only projection. Empty SQLite results stay hidden so legacy whole-chapter tasks are unchanged. */
export function WorkbenchChapterStageProgress({
  novelId,
  chapterId,
  chapterTitle,
  bundle,
  bundleReady,
  onLocateArtifact,
}: WorkbenchChapterStageProgressProps) {
  const scope = bundleReady
    ? chapterStageProgressScopeFromBundle(novelId, chapterId, bundle)
    : null;
  const evidence = chapterCandidateEvidenceFromCards(bundle?.artifacts ?? []);
  const tree = useChapterWorkflowStageTree({
    enabled: Boolean(scope),
    scope,
    refreshToken: bundle?.conversation.updatedAt,
    candidateEvidence: evidence,
  });
  if (!scope || tree.reason === 'browser' || tree.reason === 'disabled') return null;
  if (tree.reason === 'error') {
    return (
      <p
        className="workbench-inline-error"
        role="status"
        data-testid="workbench-chapter-stage-error"
      >
        {tree.error || '章节写作进度暂时无法读取。'}
      </p>
    );
  }
  if (!tree.loading && tree.stages.length === 0) return null;
  return (
    <WorkbenchChapterStageTree
      chapterTitle={chapterTitle}
      stages={tree.stages}
      historyNotice={tree.read?.notice}
      onLocate={(anchor) => locatePublicRecord(anchor, onLocateArtifact)}
    />
  );
}
