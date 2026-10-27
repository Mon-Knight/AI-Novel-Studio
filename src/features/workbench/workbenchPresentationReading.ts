import { WORKBENCH_HISTORY_PAGE_SIZE } from './workbenchPresentation';

export interface WorkbenchReadingAnchor {
  eventId: string;
  offset: number;
}

export interface WorkbenchReadingState {
  firstRoundId: string | null;
  visibleRoundCount: number;
  followLatest: boolean;
  anchor: WorkbenchReadingAnchor | null;
  scrollTop: number;
  disclosures: Record<string, boolean>;
  handledFocusRequestId: string | null;
}

// Session-only presentation data: no user text, candidate decisions, or persisted domain state.
const readingByConversation = new Map<string, WorkbenchReadingState>();
const MAX_READING_CONVERSATIONS = 100;

export function workbenchReadingKey(novelId: string, conversationId: string): string {
  return JSON.stringify([novelId, conversationId]);
}

export function readWorkbenchPresentationReading(key: string): WorkbenchReadingState {
  const stored = readingByConversation.get(key);
  return stored
    ? {
        ...stored,
        anchor: stored.anchor ? { ...stored.anchor } : null,
        disclosures: { ...stored.disclosures },
      }
    : {
        firstRoundId: null,
        visibleRoundCount: WORKBENCH_HISTORY_PAGE_SIZE,
        followLatest: true,
        anchor: null,
        scrollTop: 0,
        disclosures: {},
        handledFocusRequestId: null,
      };
}

export function saveWorkbenchPresentationReading(key: string, state: WorkbenchReadingState): void {
  readingByConversation.delete(key);
  readingByConversation.set(key, {
    ...state,
    anchor: state.anchor ? { ...state.anchor } : null,
    disclosures: { ...state.disclosures },
  });
  while (readingByConversation.size > MAX_READING_CONVERSATIONS) {
    const oldest = readingByConversation.keys().next().value;
    if (oldest === undefined) break;
    readingByConversation.delete(oldest);
  }
}

/** Clears only ephemeral reading metadata, also used for isolated presentation tests. */
export function clearWorkbenchPresentationReading(): void {
  readingByConversation.clear();
}
