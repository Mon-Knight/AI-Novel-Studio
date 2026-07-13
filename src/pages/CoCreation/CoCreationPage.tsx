import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CoCreationStageRail from '../../components/co-creation/CoCreationStageRail';
import CoCreationChat from '../../components/co-creation/CoCreationChat';
import CoCreationDraftPanel from '../../components/co-creation/CoCreationDraftPanel';
import { useCoCreationController } from '../../features/co-creation/useCoCreationController';
import type { CoCreationTurnOutputV1 } from '../../types/coCreation';
import '../../styles/co-creation-workspace.css';

function lastTurn(payload: Record<string, unknown> | undefined): CoCreationTurnOutputV1 | undefined {
  const value = payload?.lastTurn;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as CoCreationTurnOutputV1;
}

export default function CoCreationPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chapterId = searchParams.get('chapterId') || undefined;
  const controller = useCoCreationController(novelId, chapterId);
  const snapshot = controller.snapshot;
  const turn = useMemo(() => lastTurn(snapshot?.activeDraft?.payload), [snapshot?.activeDraft?.payload]);

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

  const workspaceUrl = chapterId
    ? `/novels/${encodeURIComponent(novelId)}/workspace?chapterId=${encodeURIComponent(chapterId)}`
    : `/novels/${encodeURIComponent(novelId)}/workspace`;

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
          disabled={controller.sending}
          onSelect={(stage) => void controller.changeStage(stage)}
        />
        <CoCreationChat
          messages={snapshot.messages}
          lastTurn={turn}
          sending={controller.sending}
          onSend={controller.sendMessage}
        />
        <CoCreationDraftPanel
          payload={snapshot.activeDraft?.payload}
          busy={controller.sending}
          onEditField={controller.editField}
          onAccept={controller.acceptSuggestion}
          onReject={controller.rejectSuggestion}
          onAcceptAll={controller.acceptAllSuggestions}
        />
      </main>
    </div>
  );
}
