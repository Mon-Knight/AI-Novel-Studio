import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CoCreationStageRail from '../../components/co-creation/CoCreationStageRail';
import CoCreationChat from '../../components/co-creation/CoCreationChat';
import CoCreationDraftPanel from '../../components/co-creation/CoCreationDraftPanel';
import { useCoCreationController } from '../../features/co-creation/useCoCreationController';
import type { CoCreationTurnOutputV1 } from '../../types/coCreation';
import type { CoCreationGenerationRecordV1 } from '../../types/coCreation';
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { isTauri } from '../../services/database/db';
import {
  buildWorkspaceDeepLink,
  parseCoCreationNavigationState,
} from '../../features/co-creation/deepLink';
import '../../styles/co-creation-workspace.css';

function lastTurn(payload: Record<string, unknown> | undefined): CoCreationTurnOutputV1 | undefined {
  const value = payload?.lastTurn;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as CoCreationTurnOutputV1;
}

export default function CoCreationPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const chapterId = searchParams.get('chapterId') || undefined;
  const discussionHandoff = useMemo(() => novelId
    ? parseCoCreationNavigationState(location.state, novelId, chapterId)
    : undefined, [chapterId, location.state, novelId]);
  const controller = useCoCreationController(novelId, chapterId, discussionHandoff);
  const snapshot = controller.snapshot;
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const turn = useMemo(() => lastTurn(snapshot?.activeDraft?.payload), [snapshot?.activeDraft?.payload]);

  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    void Promise.all([
      volumeRepository.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
    ]).then(([nextVolumes, nextChapters]) => {
      if (cancelled) return;
      setVolumes(nextVolumes);
      setChapters(nextChapters);
    }).catch(() => {
      if (cancelled) return;
      setVolumes([]);
      setChapters([]);
    });
    return () => { cancelled = true; };
  }, [novelId]);

  if (controller.loading) {
    return <div className="co-creation-loading" role="status">正在恢复 AI 共创会话…</div>;
  }
  if (!snapshot || !novelId) {
    return (
      <div className="co-creation-loading is-error">
        <strong>无法打开 AI 共创</strong>
        <span>{controller.error || '作品或会话不存在'}</span>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>返回作品库</button>
      </div>
    );
  }

  const workspaceUrl = buildWorkspaceDeepLink({
    novelId,
    chapterId,
    ...(searchParams.get('review') === 'candidate' ? {
      review: 'candidate' as const,
      artifactId: searchParams.get('artifactId') || undefined,
      taskId: searchParams.get('taskId') || undefined,
    } : {}),
  });
  const openHandoff = (record: CoCreationGenerationRecordV1) => {
    const receipt = record.receipt;
    if (receipt?.receiptType !== 'chapter_generation_handoff') return;
    navigate(
      `/novels/${encodeURIComponent(novelId)}/workspace?chapterId=${encodeURIComponent(receipt.chapterId)}`
      + `&panel=ai-generate&handoffId=${encodeURIComponent(receipt.handoffId)}`,
    );
  };

  return (
    <div className="co-creation-workspace">
      <header className="co-creation-topbar">
        <div>
          <button type="button" className="co-creation-back" onClick={() => navigate(`/novels/${novelId}`)}>
            ← 作品详情
          </button>
          <span className="co-creation-title-divider" />
          <strong>{controller.novelTitle || 'AI 共创'}</strong>
          <span>AI 共创工作区</span>
        </div>
        <div>
          {chapterId && <span className="co-creation-context-chip">已定位当前章节</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(workspaceUrl)}>
            在工作台完整审查
          </button>
        </div>
      </header>
      {controller.error && (
        <div className="co-creation-alert is-error" role="alert">
          <span>{controller.error}</span>
          <button type="button" onClick={controller.clearError}>关闭</button>
        </div>
      )}
      {controller.notice && <div className="co-creation-alert" role="status">{controller.notice}</div>}
      <main className="co-creation-three-column">
        <CoCreationStageRail
          currentStage={snapshot.session.currentStage}
          progress={snapshot.session.stageProgress}
          disabled={controller.sending || controller.applying || controller.generationBusy}
          onSelect={(stage) => void controller.changeStage(stage)}
        />
        <CoCreationChat
          messages={snapshot.messages}
          lastTurn={turn}
          sending={controller.sending || controller.applying || controller.generationBusy}
          onSend={controller.sendMessage}
        />
        <CoCreationDraftPanel
          payload={snapshot.activeDraft?.payload}
          busy={controller.sending || controller.applying || controller.generationBusy}
          onEditField={controller.editField}
          onAccept={controller.acceptSuggestion}
          onReject={controller.rejectSuggestion}
          onAcceptAll={controller.acceptAllSuggestions}
          applyPreparation={controller.applyPreparation}
          lastApplyResult={controller.lastApplyResult}
          onPrepareApply={controller.prepareFormalApply}
          onConfirmApply={controller.confirmFormalApply}
          onCancelApply={controller.cancelFormalApply}
          onPrepareUndo={controller.prepareFormalUndo}
          currentStage={snapshot.session.currentStage}
          objectContext={snapshot.session.objectContext}
          volumes={volumes}
          chapters={chapters}
          generationRecords={controller.generationRecords}
          desktopRuntime={isTauri()}
          onStartGeneration={controller.startGeneration}
          onRetryGeneration={controller.retryGeneration}
          onOpenTasks={() => navigate('/ai-tasks')}
          onOpenHandoff={openHandoff}
        />
      </main>
    </div>
  );
}
