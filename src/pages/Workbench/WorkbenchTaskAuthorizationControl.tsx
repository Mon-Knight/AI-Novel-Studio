import { useState } from 'react';
import type { Chapter } from '../../types/chapter';
import type { TaskConversation, TaskConversationBundle } from '../../types/conversation';
import { isTauri } from '../../services/database/db';
import { useWorkbenchTaskAuthorization } from '../../features/workbench/useWorkbenchTaskAuthorization';
import { projectTaskAuthorizationContext } from '../../features/workbench/taskAuthorizationProjection';
import { WorkbenchTaskAuthorizationDialog } from './WorkbenchTaskAuthorizationDialog';
import { WorkbenchTaskAuthorizationStatus } from './WorkbenchTaskAuthorizationStatus';

interface Props {
  conversation: TaskConversation;
  novelTitle: string;
  chapters: Chapter[];
  activeChapterId?: string;
  bundle: TaskConversationBundle | null | undefined;
  bundleReady: boolean;
  effectiveStatus?: string;
}

/** Compose task authorization feedback; native actions remain in the feature/service boundary. */
function DesktopTaskAuthorizationControl({
  conversation,
  novelTitle,
  chapters,
  activeChapterId,
  bundle,
  bundleReady,
  effectiveStatus,
}: Props) {
  const projection = projectTaskAuthorizationContext(
    bundleReady ? bundle : null,
    conversation.conversationId,
  );
  const scope = `${conversation.conversationId}:${projection.sourceTurnId}`;
  const [openScope, setOpenScope] = useState<string>();
  const authorization = useWorkbenchTaskAuthorization({
    conversationId: bundleReady ? conversation.conversationId : undefined,
    novelId: bundleReady ? conversation.novelId : undefined,
    refreshKey: projection.refreshKey,
  });
  return (
    <>
      <WorkbenchTaskAuthorizationStatus
        authorizations={authorization.authorizations}
        receipts={authorization.receipts}
        sourceTurnId={projection.sourceTurnId}
        loading={!bundleReady || authorization.loading}
        error={authorization.error}
        stage={projection.stage}
        stopReason={projection.stopReason}
        conversationStatus={effectiveStatus}
        onManage={() => setOpenScope(scope)}
      />
      {openScope === scope && (
        <WorkbenchTaskAuthorizationDialog
          conversationId={conversation.conversationId}
          novelId={conversation.novelId}
          sourceTurnId={projection.sourceTurnId}
          novelTitle={novelTitle}
          chapters={chapters.filter((chapter) => chapter.novelId === conversation.novelId)}
          activeChapterId={activeChapterId}
          authorizations={authorization.authorizations}
          receipts={authorization.receipts}
          loading={!bundleReady || authorization.loading}
          busy={authorization.busy}
          error={authorization.error}
          stage={projection.stage}
          stopReason={projection.stopReason}
          onIssue={authorization.issue}
          onRevoke={authorization.revoke}
          onRefresh={authorization.refresh}
          onDismiss={() => setOpenScope(undefined)}
        />
      )}
    </>
  );
}

export function WorkbenchTaskAuthorizationControl(props: Props) {
  if (!isTauri())
    return (
      <span
        className="workbench-chapter-hint"
        data-testid={props.effectiveStatus ? 'workbench-conversation-status' : undefined}
        data-status={props.effectiveStatus}
        title="浏览器开发模式不具备原生任务预授权与正式写入能力"
      >
        人工确认
      </span>
    );
  return <DesktopTaskAuthorizationControl key={props.conversation.conversationId} {...props} />;
}
