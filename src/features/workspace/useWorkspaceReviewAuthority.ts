import { useCallback, useRef, useState } from 'react';
import type { ReviewAuthorization } from '../../types/conversation';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';

/** Effective authority is a projection only. Changing it never changes loader inputs or document source keys. */
export function useWorkspaceReviewAuthority(input: {
  requestedAuthorizationId?: string;
  requestedArtifactId?: string;
  novelId?: string;
  chapterId: string;
  loadedAuthorizationId?: string;
}) {
  const key = JSON.stringify([
    input.requestedAuthorizationId,
    input.requestedArtifactId,
    input.novelId,
    input.chapterId,
  ]);
  const scope = useRef({ key, version: 0 });
  if (scope.current.key !== key) {
    scope.current.key = key;
    scope.current.version += 1;
  }
  const version = scope.current.version;
  const [renewed, setRenewed] = useState<{
    key: string;
    version: number;
    value: ReviewAuthorization;
  }>();
  const authorizationId =
    renewed?.key === key && renewed.version === version
      ? renewed.value.authorizationId
      : (input.loadedAuthorizationId ?? input.requestedAuthorizationId);
  const onRenewed = useCallback(
    (value: ReviewAuthorization) => {
      if (
        scope.current.version !== version ||
        scope.current.key !== key ||
        value.novelId !== input.novelId ||
        value.chapterId !== input.chapterId ||
        (input.requestedArtifactId && value.artifactId !== input.requestedArtifactId)
      )
        return;
      setRenewed({ key, version, value });
    },
    [input.chapterId, input.novelId, input.requestedArtifactId, key, version],
  );
  const beforeAdopt = useCallback(
    async (draftId: string) => {
      if (authorizationId) await artifactDecisionService.consume(authorizationId, draftId);
    },
    [authorizationId],
  );
  return { authorizationId, onRenewed, beforeAdopt };
}
