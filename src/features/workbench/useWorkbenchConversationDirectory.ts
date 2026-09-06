import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskConversation } from '../../types/conversation';
import type { ConversationListCursor } from '../../types/conversation-directory';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { startupCoordinator } from '../../services/startup/startupCoordinator';

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 200;

export function useWorkbenchConversationDirectory(onItems: (items: TaskConversation[]) => void) {
  const [items, setItems] = useState<TaskConversation[]>([]);
  const [query, setQueryValue] = useState('');
  const [archive, setArchiveValue] = useState<'active' | 'archived'>('active');
  const [displayScope, setDisplayScope] = useState({
    query: '',
    archive: 'active' as 'active' | 'archived',
  });
  const [nextCursor, setNextCursor] = useState<ConversationListCursor>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const queryRef = useRef({ query: '', archive: 'active' as 'active' | 'archived' });
  const itemsRef = useRef(items);
  const cursorRef = useRef(nextCursor);
  const loadingRef = useRef(false);
  const onItemsRef = useRef(onItems);
  const windowSizeRef = useRef(PAGE_SIZE);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  onItemsRef.current = onItems;

  useEffect(
    () => () => {
      requestRef.current += 1;
      clearTimeout(searchTimerRef.current);
    },
    [],
  );

  const read = useCallback(async (append: boolean) => {
    if (append && (loadingRef.current || !cursorRef.current)) return itemsRef.current;
    const request = ++requestRef.current;
    const scope = { ...queryRef.current };
    let cursor = append ? cursorRef.current : undefined;
    const collected = append ? [...itemsRef.current] : [];
    const wanted = append ? collected.length + PAGE_SIZE : windowSizeRef.current;
    const visited = new Set<string>();
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      await startupCoordinator.waitForConversationRecovery();
      if (request !== requestRef.current) return null;
      do {
        const page = await taskConversationService.listPage({ ...scope, limit: PAGE_SIZE, cursor });
        if (request !== requestRef.current) return null;
        const known = new Set(collected.map((item) => item.conversationId));
        for (const item of page.items)
          if (!known.has(item.conversationId)) {
            collected.push(item);
            known.add(item.conversationId);
          }
        cursor = page.nextCursor;
        if (cursor) {
          const key = JSON.stringify(cursor);
          if (visited.has(key)) throw new Error('任务分页未能推进，请重试。');
          visited.add(key);
        }
      } while (cursor && collected.length < wanted);
      if (request !== requestRef.current) return null;
      itemsRef.current = collected;
      cursorRef.current = cursor;
      windowSizeRef.current = Math.max(PAGE_SIZE, collected.length);
      setItems(collected);
      setDisplayScope(scope);
      setNextCursor(cursor);
      onItemsRef.current(collected);
      return collected;
    } catch (failure) {
      if (request !== requestRef.current) return null;
      if (request === requestRef.current) {
        setError(failure instanceof Error ? failure.message : '任务目录读取失败，请重试。');
      }
      throw failure;
    } finally {
      if (request === requestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    clearTimeout(searchTimerRef.current);
    return read(false);
  }, [read]);
  const loadMore = useCallback(() => {
    void read(true).catch(() => undefined);
  }, [read]);
  const changeQuery = useCallback(
    (next: typeof queryRef.current, delay: number) => {
      clearTimeout(searchTimerRef.current);
      // Invalidate an old request immediately, including the debounce interval.
      requestRef.current += 1;
      queryRef.current = next;
      setQueryValue(next.query);
      setArchiveValue(next.archive);
      windowSizeRef.current = PAGE_SIZE;
      cursorRef.current = undefined;
      setNextCursor(undefined);
      loadingRef.current = true;
      setLoading(true);
      setError('');
      searchTimerRef.current = setTimeout(() => {
        void read(false).catch(() => undefined);
      }, delay);
    },
    [read],
  );
  const setQuery = useCallback(
    (value: string) => changeQuery({ ...queryRef.current, query: value }, SEARCH_DELAY_MS),
    [changeQuery],
  );
  const setArchive = useCallback(
    (value: 'active' | 'archived') => changeQuery({ ...queryRef.current, archive: value }, 0),
    [changeQuery],
  );

  return {
    items,
    query,
    archive,
    displayQuery: displayScope.query,
    displayArchive: displayScope.archive,
    loading,
    error,
    hasMore: Boolean(nextCursor),
    setQuery,
    setArchive,
    refresh,
    loadMore,
  };
}

export type WorkbenchConversationDirectory = ReturnType<typeof useWorkbenchConversationDirectory>;
