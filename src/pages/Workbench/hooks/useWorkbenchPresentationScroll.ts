import { useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import {
  groupWorkbenchRounds,
  presentationWindowStart,
  WORKBENCH_HISTORY_PAGE_SIZE,
  type WorkbenchArtifactFocusRequest,
  type WorkbenchPublicEvent,
} from '../../../features/workbench/workbenchPresentation';
import {
  readWorkbenchPresentationReading,
  saveWorkbenchPresentationReading,
  workbenchReadingKey,
} from '../../../features/workbench/workbenchPresentationReading';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function preferredUserScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function scrollToLatest(node: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight, behavior });
  else node.scrollTop = node.scrollHeight;
}

function publicNodes(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('[data-presentation-id]')];
}

export function expandWorkbenchAncestorDetails(target: HTMLElement): string[] {
  const opened: string[] = [];
  let node: HTMLElement | null = target;
  while (node) {
    if (node.tagName === 'DETAILS') {
      const details = node as HTMLDetailsElement;
      if (!details.open) {
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
        const key = details.dataset.disclosureKey;
        if (key) opened.push(key);
      }
    }
    node = node.parentElement;
  }
  return opened;
}

function openDisclosures(node: HTMLElement, disclosures: Record<string, boolean>): void {
  for (const detail of node.querySelectorAll<HTMLDetailsElement>('details[data-disclosure-key]')) {
    const key = detail.dataset.disclosureKey;
    if (!key || !disclosures[key] || detail.open) continue;
    detail.open = true;
    detail.dispatchEvent(new Event('toggle'));
  }
}

function captureOpenDisclosures(node: HTMLElement): Record<string, boolean> {
  const disclosures: Record<string, boolean> = {};
  for (const detail of node.querySelectorAll<HTMLDetailsElement>('details[data-disclosure-key]')) {
    const key = detail.dataset.disclosureKey;
    if (key && detail.open) disclosures[key] = true;
  }
  return disclosures;
}

/** UI-only DOM/RAF ownership. Persisted facts and candidate decisions never live here. */
export function useWorkbenchPresentationScroll({
  events,
  novelId,
  conversationId,
  artifactFocusRequest,
}: {
  events: readonly WorkbenchPublicEvent[];
  novelId: string;
  conversationId: string;
  artifactFocusRequest?: WorkbenchArtifactFocusRequest | null;
}) {
  const readingKey = workbenchReadingKey(novelId, conversationId);
  const [initialReading] = useState(() => readWorkbenchPresentationReading(readingKey));
  const readingRef = useRef(initialReading);
  const [historyWindow, setHistoryWindow] = useState(() => ({
    firstRoundId: initialReading.firstRoundId,
    visibleRoundCount: initialReading.visibleRoundCount,
  }));
  const scrollRef = useRef<HTMLElement>(null);
  const followLatestRef = useRef(initialReading.followLatest);
  const followFrameRef = useRef<number | null>(null);
  const initialRestoreRef = useRef(true);
  const pendingLocationRef = useRef<string | null>(null);
  const userJumpRef = useRef<{ kind: 'latest' | 'locate'; top: number } | null>(null);
  const historyRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const consumedFocusRequestRef = useRef(initialReading.handledFocusRequestId);
  const locateEventRef = useRef<(id: string) => boolean>(() => false);
  const performLayoutRef = useRef<() => void>(() => undefined);
  const reconcileLayoutRef = useRef<() => void>(() => undefined);
  const captureReadingRef = useRef<() => void>(() => undefined);
  const [showLatest, setShowLatest] = useState(!initialReading.followLatest);
  const [locatedId, setLocatedId] = useState('');
  const [locationNotice, setLocationNotice] = useState('');
  const [locationVersion, requestLocationRender] = useState(0);
  const rounds = useMemo(() => groupWorkbenchRounds(events), [events]);
  const hiddenRoundCount = presentationWindowStart(
    rounds,
    historyWindow.firstRoundId,
    historyWindow.visibleRoundCount,
  );
  const visibleRounds = rounds.slice(hiddenRoundCount);
  const visibleEvents = visibleRounds.flatMap((round) => round.events);

  const captureReading = () => {
    const node = scrollRef.current;
    if (!node) return;
    const nodes = publicNodes(node);
    const viewport = node.getBoundingClientRect();
    const anchorNode = nodes.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    const disclosures = captureOpenDisclosures(node);
    readingRef.current = {
      ...readingRef.current,
      firstRoundId: followLatestRef.current
        ? historyWindow.firstRoundId
        : (visibleRounds[0]?.id ?? null),
      visibleRoundCount: Math.max(WORKBENCH_HISTORY_PAGE_SIZE, visibleRounds.length),
      followLatest: followLatestRef.current,
      anchor: anchorNode
        ? {
            eventId: anchorNode.dataset.presentationId!,
            offset: anchorNode.getBoundingClientRect().top - viewport.top,
          }
        : null,
      scrollTop: node.scrollTop,
      disclosures,
    };
    saveWorkbenchPresentationReading(readingKey, readingRef.current);
  };
  captureReadingRef.current = captureReading;

  const restoreReading = () => {
    const node = scrollRef.current;
    if (!node) return;
    const anchor = readingRef.current.anchor;
    const target =
      anchor && publicNodes(node).find((item) => item.dataset.presentationId === anchor.eventId);
    if (target) expandWorkbenchAncestorDetails(target);
    if (target && anchor && target.getBoundingClientRect().height > 0) {
      node.scrollTop = Math.max(
        0,
        node.scrollTop +
          target.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          anchor.offset,
      );
    } else if (historyRestoreRef.current) {
      const previous = historyRestoreRef.current;
      node.scrollTop = previous.scrollTop + Math.max(0, node.scrollHeight - previous.scrollHeight);
    } else {
      node.scrollTop = readingRef.current.scrollTop;
    }
    historyRestoreRef.current = null;
  };

  const scheduleFollow = () => {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame?.(followFrameRef.current);
      window.clearTimeout(followFrameRef.current);
    }
    const flushFollow = () => {
      followFrameRef.current = null;
      const node = scrollRef.current;
      if (!node || !followLatestRef.current) return;
      scrollToLatest(node, 'auto');
      captureReadingRef.current();
    };
    followFrameRef.current = window.requestAnimationFrame
      ? window.requestAnimationFrame(flushFollow)
      : window.setTimeout(flushFollow, 0);
  };
  reconcileLayoutRef.current = () => {
    // Do not turn a deliberate smooth locate into an automatic layout jump.
    if (userJumpRef.current?.kind === 'locate') return;
    if (followLatestRef.current) scheduleFollow();
    else restoreReading();
  };

  const locateEvent = (id: string) => {
    const roundIndex = rounds.findIndex((round) => round.events.some((entry) => entry.id === id));
    if (roundIndex < 0) {
      setLocationNotice('这张候选尚未载入当前任务，请重新读取后再定位。');
      return false;
    }
    captureReading();
    followLatestRef.current = false;
    pendingLocationRef.current = id;
    setShowLatest(true);
    setLocationNotice('');
    setHistoryWindow({
      firstRoundId: rounds[Math.min(hiddenRoundCount, roundIndex)]?.id ?? null,
      visibleRoundCount: Math.max(visibleRounds.length, rounds.length - roundIndex),
    });
    requestLocationRender((current) => current + 1);
    return true;
  };

  locateEventRef.current = locateEvent;
  performLayoutRef.current = () => {
    const node = scrollRef.current;
    if (!node) return;
    if (initialRestoreRef.current) {
      initialRestoreRef.current = false;
      // Reopen only saved disclosures; hydration may resize them afterwards.
      openDisclosures(node, readingRef.current.disclosures);
    }
    const id = pendingLocationRef.current;
    const target = id && publicNodes(node).find((item) => item.dataset.presentationId === id);
    if (target && id) {
      const opened = expandWorkbenchAncestorDetails(target);
      pendingLocationRef.current = null;
      setLocatedId(id);
      const targetTop =
        node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top;
      const top = Math.min(
        Math.max(0, targetTop - 16),
        Math.max(0, node.scrollHeight - node.clientHeight),
      );
      const behavior = preferredUserScrollBehavior();
      userJumpRef.current =
        behavior === 'smooth' && Math.abs(node.scrollTop - top) > 1
          ? { kind: 'locate', top }
          : null;
      if (typeof node.scrollTo === 'function') node.scrollTo({ top, behavior });
      else node.scrollTop = top;
      // Focus changes only for an explicit locate action, never a refresh or hydration.
      target.focus({ preventScroll: true });
      readingRef.current = {
        ...readingRef.current,
        followLatest: false,
        scrollTop: top,
        firstRoundId: visibleRounds[0]?.id ?? null,
        visibleRoundCount: visibleRounds.length,
        anchor: { eventId: id, offset: targetTop - top },
        disclosures: {
          ...readingRef.current.disclosures,
          ...Object.fromEntries(opened.map((key) => [key, true])),
        },
      };
      saveWorkbenchPresentationReading(readingKey, readingRef.current);
      return;
    }
    reconcileLayoutRef.current();
  };
  useClientLayoutEffect(() => performLayoutRef.current(), [events, historyWindow, locationVersion]);

  useEffect(() => {
    if (
      !artifactFocusRequest ||
      artifactFocusRequest.conversationId !== conversationId ||
      consumedFocusRequestRef.current === artifactFocusRequest.requestId
    )
      return;
    if (locateEventRef.current('artifact:' + artifactFocusRequest.cardId)) {
      consumedFocusRequestRef.current = artifactFocusRequest.requestId;
      readingRef.current.handledFocusRequestId = artifactFocusRequest.requestId;
    }
  }, [artifactFocusRequest, conversationId, events]);

  const visibleIds = visibleEvents.map((entry) => entry.id).join('|');
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => reconcileLayoutRef.current());
    observer.observe(node);
    publicNodes(node).forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [visibleIds]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const finishJump = () => {
      userJumpRef.current = null;
      captureReadingRef.current();
    };
    node.addEventListener('scrollend', finishJump);
    return () => node.removeEventListener('scrollend', finishJump);
  }, []);

  useClientLayoutEffect(
    () => () => {
      captureReadingRef.current();
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame?.(followFrameRef.current);
        window.clearTimeout(followFrameRef.current);
      }
    },
    [],
  );

  const jumpToLatest = () => {
    const node = scrollRef.current;
    if (!node) return;
    pendingLocationRef.current = null;
    followLatestRef.current = true;
    setShowLatest(false);
    setLocatedId('');
    const behavior = preferredUserScrollBehavior();
    userJumpRef.current =
      behavior === 'smooth'
        ? { kind: 'latest', top: Math.max(0, node.scrollHeight - node.clientHeight) }
        : null;
    scrollToLatest(node, behavior);
    captureReading();
  };
  const loadEarlierTurns = () => {
    captureReading();
    const node = scrollRef.current;
    if (node)
      historyRestoreRef.current = { scrollHeight: node.scrollHeight, scrollTop: node.scrollTop };
    followLatestRef.current = false;
    setShowLatest(true);
    const firstIndex = Math.max(0, hiddenRoundCount - WORKBENCH_HISTORY_PAGE_SIZE);
    setHistoryWindow({
      firstRoundId: rounds[firstIndex]?.id ?? null,
      visibleRoundCount: rounds.length - firstIndex,
    });
  };
  const collapseEarlierTurns = () => {
    followLatestRef.current = true;
    setShowLatest(false);
    setLocatedId('');
    setHistoryWindow({ firstRoundId: null, visibleRoundCount: WORKBENCH_HISTORY_PAGE_SIZE });
  };
  const onUserScrollIntent = () => {
    userJumpRef.current = null;
  };
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const node = event.currentTarget;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    const jump = userJumpRef.current;
    if (jump) {
      if (Math.abs(node.scrollTop - jump.top) <= 1) userJumpRef.current = null;
      captureReading();
      return;
    }
    if (!nearBottom) {
      followLatestRef.current = false;
      setShowLatest(true);
      setHistoryWindow((current) =>
        current.firstRoundId
          ? current
          : {
              ...current,
              firstRoundId: visibleRounds[0]?.id ?? null,
            },
      );
    }
    captureReading();
  };

  return {
    scrollRef,
    rounds,
    hiddenRoundCount,
    visibleRounds,
    visibleEvents,
    showLatest,
    locatedId,
    locationNotice,
    followLatest: followLatestRef.current,
    locateEvent,
    jumpToLatest,
    loadEarlierTurns,
    collapseEarlierTurns,
    onScroll,
    onUserScrollIntent,
  };
}
