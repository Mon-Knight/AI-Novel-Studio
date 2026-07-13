import type {
  CoCreationFieldSuggestionV1,
  CoCreationTurnOutputV1,
} from '../../types/coCreation';
import type { CoCreationFieldValue } from './stageMachine';

export interface CoCreationWorkingDraftState {
  fields: Record<string, CoCreationFieldValue>;
  suggestions: CoCreationFieldSuggestionV1[];
}

export function mergeTurnIntoWorkingDraft(
  previous: CoCreationWorkingDraftState,
  output: CoCreationTurnOutputV1,
): CoCreationWorkingDraftState {
  const fields = { ...previous.fields };
  for (const extracted of output.extractedInformation) {
    const path = extracted.target.fieldPath;
    const existing = fields[path];
    if (existing?.state === 'user_confirmed' && extracted.fieldState !== 'user_confirmed') continue;
    fields[path] = { value: extracted.value, state: extracted.fieldState };
  }
  const byId = new Map(previous.suggestions.map((item) => [item.suggestionId, item]));
  output.changeSuggestions.forEach((item) => byId.set(item.suggestionId, item));
  return { fields, suggestions: [...byId.values()] };
}

export function acceptSuggestionToDraft(
  previous: CoCreationWorkingDraftState,
  suggestionId: string,
  options: {
    editedValue?: unknown;
    allowReplaceConfirmed?: boolean;
    acknowledgeConflicts?: boolean;
    expectedDataRevision: number;
  },
): CoCreationWorkingDraftState {
  const suggestion = previous.suggestions.find((item) => item.suggestionId === suggestionId);
  if (!suggestion) throw new Error('待确认建议不存在');
  if (suggestion.decision !== 'pending') throw new Error('待确认建议已经处理');
  if (suggestion.baseDataRevision !== options.expectedDataRevision) {
    throw new Error('建议基于旧的数据版本，必须重新生成或合并');
  }
  if (suggestion.conflicts.some((item) => item.severity === 'blocking') && !options.acknowledgeConflicts) {
    throw new Error('建议存在阻断冲突，必须先确认影响');
  }
  const existing = previous.fields[suggestion.target.fieldPath];
  if (existing?.state === 'user_confirmed' && !options.allowReplaceConfirmed) {
    throw new Error('只补全空白模式不得覆盖用户已确认内容');
  }
  const fields = {
    ...previous.fields,
    [suggestion.target.fieldPath]: {
      value: options.editedValue === undefined ? suggestion.suggestedValue : options.editedValue,
      state: 'user_confirmed' as const,
    },
  };
  const suggestions = previous.suggestions.map((item) => item.suggestionId === suggestionId
    ? {
        ...item,
        decision: 'accepted_to_draft' as const,
        conflictsAcknowledged: options.acknowledgeConflicts === true,
        confirmedReplacement: options.allowReplaceConfirmed === true,
      }
    : item);
  return { fields, suggestions };
}

export function rejectSuggestion(
  previous: CoCreationWorkingDraftState,
  suggestionId: string,
): CoCreationWorkingDraftState {
  if (!previous.suggestions.some((item) => item.suggestionId === suggestionId)) {
    throw new Error('待确认建议不存在');
  }
  return {
    ...previous,
    suggestions: previous.suggestions.map((item) => item.suggestionId === suggestionId
      ? { ...item, decision: 'rejected' as const }
      : item),
  };
}

export function serializeWorkingDraft(state: CoCreationWorkingDraftState): Record<string, unknown> {
  return {
    fields: state.fields,
    suggestions: state.suggestions,
  };
}

export function deserializeWorkingDraft(payload?: Record<string, unknown>): CoCreationWorkingDraftState {
  const fields = payload?.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields)
    ? payload.fields as Record<string, CoCreationFieldValue>
    : {};
  const suggestions = Array.isArray(payload?.suggestions)
    ? payload.suggestions as CoCreationFieldSuggestionV1[]
    : [];
  return { fields, suggestions };
}
