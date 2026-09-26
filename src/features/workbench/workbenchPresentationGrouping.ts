import type { ToolCallEvent } from '../../types/conversation';
import type { WorkbenchPublicEvent } from './workbenchPresentation';

/**
 * Presentation-only segments. The underlying public event projection remains untouched; a
 * segment only controls how adjacent, already-persisted read facts occupy the conversation.
 */
export type WorkbenchDisplaySegment =
  | { kind: 'event'; event: WorkbenchPublicEvent }
  | { kind: 'completed-read'; events: Array<Extract<WorkbenchPublicEvent, { kind: 'tool' }>> };

const COMPACTABLE_READ_TOOLS = new Set([
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
  'query_world_state',
  'query_character_state',
  'query_chapter_info',
  'novel.read',
  'structure.read',
  'context.read',
  'memory.search',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasUnknownStatus(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    ['unknown', 'unavailable', 'unverified', 'not_checked', 'incomplete', 'warning'].includes(value)
  );
}

function hasUnknownReceiptRisk(event: ToolCallEvent): boolean {
  const result = event.result;
  if (!isRecord(result)) return false;
  if (hasUnknownStatus(result.status) || hasUnknownStatus(result.receiptStatus)) return true;
  const receipt = isRecord(result.contextReceipt) ? result.contextReceipt : undefined;
  if (
    receipt &&
    (receipt.evidence === 'unavailable' ||
      hasUnknownStatus(receipt.status) ||
      hasUnknownStatus(receipt.evidence))
  )
    return true;
  return false;
}

/** Public context warnings make a read fact important enough to remain individually visible. */
function hasReadPresentationWarning(event: ToolCallEvent): boolean {
  const result = event.result;
  if (!isRecord(result)) return false;
  if (result.incomplete === true || result.contextIncomplete === true) return true;
  if (result.coverageIncomplete === true || result.complete === false) return true;
  if (hasUnknownStatus(result.status)) return true;
  if (result.warning || (Array.isArray(result.warnings) && result.warnings.length > 0)) return true;

  const data = isRecord(result.data) ? result.data : undefined;
  const contexts = [result.generationContext, data?.generationContext].filter(isRecord);
  for (const context of contexts) {
    if (context.incomplete === true || context.coverageComplete === false) return true;
    if (Array.isArray(context.integrityWarnings) && context.integrityWarnings.length > 0)
      return true;
    const constraints = isRecord(context.taskConstraints) ? context.taskConstraints : undefined;
    if (constraints && Number(constraints.omittedBudget) > 0) return true;
    const providerEvidence = isRecord(context.providerRequestEvidence)
      ? context.providerRequestEvidence
      : undefined;
    const providerStatuses = [
      providerEvidence?.providerSourceStatus,
      providerEvidence?.snapshotRequestSourceStatus,
    ];
    if (providerStatuses.some((status) => typeof status === 'string' && status !== 'included'))
      return true;
    const generationStatuses = isRecord(providerEvidence?.generationSourceStatuses)
      ? Object.values(providerEvidence.generationSourceStatuses)
      : [];
    if (generationStatuses.some((status) => status !== 'included')) return true;
    const sourceItems = [context.sources, context.contextSources].flatMap((items) =>
      Array.isArray(items) ? items : [],
    );
    if (
      sourceItems.some(
        (item) =>
          isRecord(item) &&
          typeof item.status === 'string' &&
          [
            'snapshot',
            'truncated',
            'omitted',
            'missing',
            'fallback',
            'unknown',
            'unverified',
          ].includes(item.status),
      )
    )
      return true;
  }
  return false;
}

function canCompactReadEvent(
  entry: WorkbenchPublicEvent,
): entry is Extract<WorkbenchPublicEvent, { kind: 'tool' }> {
  return (
    entry.kind === 'tool' &&
    entry.event.status === 'succeeded' &&
    !entry.event.error &&
    COMPACTABLE_READ_TOOLS.has(entry.event.toolName) &&
    !hasReadPresentationWarning(entry.event) &&
    !hasUnknownReceiptRisk(entry.event)
  );
}

export function completedReadDisclosureKey(eventIds: readonly string[]): string {
  return 'completed-read:' + eventIds.join(',');
}

/** Group only contiguous successful read facts; never sort, reparent, or hide a public event. */
export function groupWorkbenchDisplaySegments(
  events: readonly WorkbenchPublicEvent[],
): WorkbenchDisplaySegment[] {
  const segments: WorkbenchDisplaySegment[] = [];
  let index = 0;
  while (index < events.length) {
    const entry = events[index];
    if (!canCompactReadEvent(entry)) {
      segments.push({ kind: 'event', event: entry });
      index += 1;
      continue;
    }
    const readEvents = [entry];
    let next = index + 1;
    while (next < events.length) {
      const candidate = events[next];
      if (
        !canCompactReadEvent(candidate) ||
        candidate.runId !== entry.runId ||
        candidate.turnId !== entry.turnId
      )
        break;
      readEvents.push(candidate);
      next += 1;
    }
    segments.push(
      readEvents.length > 1
        ? { kind: 'completed-read', events: readEvents }
        : { kind: 'event', event: entry },
    );
    index = next;
  }
  return segments;
}
