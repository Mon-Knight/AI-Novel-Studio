import { useCallback, useRef, useState } from 'react';
import type {
  ConversationWindowCursor,
  ConversationWindowPage,
  ConversationWindowQuery,
  TaskConversation,
  TaskConversationBundle,
} from '../../../types/conversation';
import { startupCoordinator } from '../../../services/startup/startupCoordinator';
import { taskConversationWindow } from '../../../services/conversation/taskConversationWindow';
import {
  CONVERSATION_WINDOW_DEFAULT_LIMIT,
  CONVERSATION_WINDOW_PAGE_LIMIT,
  CONVERSATION_WINDOW_REFRESH_LIMIT,
  cursorAfterWindow,
  mergeConversationWindow,
} from '../../../services/conversation/conversationWindow';
import {
  readWorkbenchPresentationReading,
  workbenchReadingKey,
} from '../../../features/workbench/workbenchPresentationReading';
import { decodeWorkbenchTurnContent } from '../../../services/conversation/workbenchTurnOrigin';

type BundleRequest =
  { kind: 'refresh' } | { kind: 'older' } | { kind: 'latest' } | { kind: 'focus'; cardId: string };

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function readingFocus(novelId: string, conversationId: string): ConversationWindowQuery | null {
  if (!novelId) return null;
  const reading = readWorkbenchPresentationReading(workbenchReadingKey(novelId, conversationId));
  if (reading.followLatest || !reading.firstRoundId?.startsWith('turn:')) return null;
  return {
    conversationId,
    focusTurnId: reading.firstRoundId.slice('turn:'.length),
    limit: Math.min(
      CONVERSATION_WINDOW_PAGE_LIMIT,
      Math.max(CONVERSATION_WINDOW_DEFAULT_LIMIT, reading.visibleRoundCount),
    ),
  };
}

export function useWorkbenchConversationBundle(input: {
  selectedConversationRef: React.MutableRefObject<string>;
  selectedNovelRef: React.MutableRefObject<string>;
  setConversationsError: (message: string) => void;
  onLoaded: (bundle: TaskConversationBundle, page: ConversationWindowPage) => void;
}) {
  const [bundle, setBundle] = useState<TaskConversationBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleStaleError, setBundleStaleError] = useState('');
  const [historyHasOlder, setHistoryHasOlder] = useState(false);
  const [historyHasNewer, setHistoryHasNewer] = useState(false);
  const [historyExpandToken, setHistoryExpandToken] = useState(0);
  const bundleRef = useRef<TaskConversationBundle | null>(null);
  const requestRef = useRef(0);
  const cursorRef = useRef<ConversationWindowCursor | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const publish = useCallback(
    (next: TaskConversationBundle | null, cursor: ConversationWindowCursor | null = null) => {
      bundleRef.current = next;
      setBundle(next);
      setHistoryHasOlder(cursor?.hasOlder ?? false);
      setHistoryHasNewer(cursor?.hasNewer ?? false);
    },
    [],
  );

  const clearBundle = useCallback(() => {
    requestRef.current += 1;
    cursorRef.current = null;
    setBundleLoading(false);
    setBundleStaleError('');
    publish(null);
  }, [publish]);

  const invalidate = useCallback(() => {
    requestRef.current += 1;
  }, []);

  const applyConversationUpdate = useCallback(
    (conversation: TaskConversation) => {
      if (inputRef.current.selectedConversationRef.current !== conversation.conversationId) return;
      // A read started before a successful save must not restore the old next-turn choice.
      requestRef.current += 1;
      setBundleLoading(false);
      const current = bundleRef.current;
      if (current?.conversation.conversationId === conversation.conversationId) {
        publish({ ...current, conversation }, cursorRef.current);
      }
    },
    [publish],
  );

  const loadBundle = useCallback(
    async (conversationId: string, request: BundleRequest) => {
      if (!conversationId || inputRef.current.selectedConversationRef.current !== conversationId) {
        return;
      }
      const cursor =
        cursorRef.current?.conversationId === conversationId ? cursorRef.current : null;
      const query = buildQuery(
        conversationId,
        inputRef.current.selectedNovelRef.current,
        request,
        cursor,
        oldestUserTurnId(previousBundle(conversationId, bundleRef.current)),
      );
      if (!query) return;
      const requestId = ++requestRef.current;
      const previous =
        bundleRef.current?.conversation.conversationId === conversationId
          ? bundleRef.current
          : null;
      const replacing = !previous;
      if (replacing) setBundleLoading(true);
      if (request.kind !== 'older') inputRef.current.setConversationsError('');

      try {
        await startupCoordinator.waitForConversationRecovery();
        const window = await taskConversationWindow.read(query, {
          allowStaleFocusFallback: request.kind === 'refresh' && Boolean(query.focusTurnId),
        });
        if (
          requestId !== requestRef.current ||
          inputRef.current.selectedConversationRef.current !== conversationId
        ) {
          return;
        }
        if (!window || window.bundle.conversation.conversationId !== conversationId) {
          cursorRef.current = null;
          setBundleStaleError('');
          publish(null);
          inputRef.current.setConversationsError('创作任务内容不存在或已移除。');
          return;
        }
        const merged = mergeConversationWindow(previous, window.bundle, window.page);
        const nextCursor = cursorAfterWindow(
          conversationId,
          merged,
          window.page,
          cursor,
          request.kind === 'older' ? 'older' : request.kind === 'focus' ? 'focus' : 'refresh',
        );
        cursorRef.current = nextCursor;
        setBundleStaleError('');
        publish(merged, nextCursor);
        if (request.kind === 'older' && window.page.userRoundCount > 0) {
          setHistoryExpandToken((token) => token + 1);
        }
        inputRef.current.onLoaded(merged, window.page);
      } catch (error) {
        if (
          requestId !== requestRef.current ||
          inputRef.current.selectedConversationRef.current !== conversationId
        ) {
          return;
        }
        if (previous) {
          setBundleStaleError(
            readableError(error, '任务内容暂时没有刷新，当前仍显示上次读取的记录。'),
          );
          return;
        }
        publish(null);
        inputRef.current.setConversationsError(readableError(error, '创作任务读取失败，请重试。'));
      } finally {
        if (requestId === requestRef.current && replacing) setBundleLoading(false);
      }
    },
    [publish],
  );

  const refreshBundle = useCallback(
    (conversationId: string) => loadBundle(conversationId, { kind: 'refresh' }),
    [loadBundle],
  );
  const loadOlderHistory = useCallback(() => {
    const conversationId = inputRef.current.selectedConversationRef.current;
    return loadBundle(conversationId, { kind: 'older' });
  }, [loadBundle]);
  const loadLatestHistory = useCallback(() => {
    const conversationId = inputRef.current.selectedConversationRef.current;
    return loadBundle(conversationId, { kind: 'latest' });
  }, [loadBundle]);
  const ensureArtifactLoaded = useCallback(
    (cardId: string) => {
      const conversationId = inputRef.current.selectedConversationRef.current;
      const current = bundleRef.current;
      if (
        current?.conversation.conversationId === conversationId &&
        current.artifacts.some(
          (card) => card.cardId === cardId && (card.artifactEvidence || card.content),
        )
      ) {
        return Promise.resolve();
      }
      return loadBundle(conversationId, { kind: 'focus', cardId });
    },
    [loadBundle],
  );

  return {
    bundle,
    bundleLoading,
    bundleStaleError,
    historyHasOlder,
    historyHasNewer,
    historyExpandToken,
    refreshBundle,
    loadOlderHistory,
    loadLatestHistory,
    ensureArtifactLoaded,
    clearBundle,
    invalidate,
    applyConversationUpdate,
  };
}

function previousBundle(
  conversationId: string,
  bundle: TaskConversationBundle | null,
): TaskConversationBundle | null {
  return bundle?.conversation.conversationId === conversationId ? bundle : null;
}

function oldestUserTurnId(bundle: TaskConversationBundle | null): string | undefined {
  let oldest: { sequence: number; turnId: string } | undefined;
  for (const turn of bundle?.turns ?? []) {
    if (turn.role !== 'user' || decodeWorkbenchTurnContent(turn.content).origin) continue;
    if (!oldest || turn.sequence < oldest.sequence) {
      oldest = { sequence: turn.sequence, turnId: turn.turnId };
    }
  }
  return oldest?.turnId;
}

function buildQuery(
  conversationId: string,
  novelId: string,
  request: BundleRequest,
  cursor: ConversationWindowCursor | null,
  oldestTurnId: string | undefined,
): ConversationWindowQuery | null {
  if (request.kind === 'older') {
    if (cursor?.oldestUserSequence == null) return null;
    return {
      conversationId,
      beforeUserSequence: cursor.oldestUserSequence,
      limit: CONVERSATION_WINDOW_DEFAULT_LIMIT,
    };
  }
  if (request.kind === 'focus') {
    return {
      conversationId,
      focusCardId: request.cardId,
      limit: CONVERSATION_WINDOW_DEFAULT_LIMIT,
    };
  }
  if (request.kind === 'refresh' && cursor?.hasNewer && oldestTurnId) {
    return {
      conversationId,
      focusTurnId: oldestTurnId,
      limit: Math.min(
        CONVERSATION_WINDOW_PAGE_LIMIT,
        Math.max(CONVERSATION_WINDOW_DEFAULT_LIMIT, cursor.loadedUserRounds),
      ),
    };
  }
  if (
    request.kind === 'refresh' &&
    cursor?.oldestUserSequence != null &&
    !cursor.hasNewer &&
    cursor.loadedUserRounds > CONVERSATION_WINDOW_DEFAULT_LIMIT
  ) {
    return {
      conversationId,
      minUserSequence: cursor.oldestUserSequence,
      limit: Math.min(CONVERSATION_WINDOW_REFRESH_LIMIT, cursor.loadedUserRounds),
    };
  }
  if (request.kind === 'latest') {
    return { conversationId, limit: CONVERSATION_WINDOW_DEFAULT_LIMIT };
  }
  return (
    readingFocus(novelId, conversationId) ?? {
      conversationId,
      limit: CONVERSATION_WINDOW_DEFAULT_LIMIT,
    }
  );
}
