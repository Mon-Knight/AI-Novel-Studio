import { describe, expect, it } from 'vitest';
import { acceptSuggestionToDraft } from '../../features/co-creation/draftState';
import type { CoCreationFieldSuggestionV1 } from '../../types/coCreation';

const suggestion: CoCreationFieldSuggestionV1 = {
  suggestionId: 'suggestion-1',
  target: { objectType: 'protagonist', fieldPath: 'protagonist.identity' },
  originalValue: '医师',
  suggestedValue: '边城医师',
  fieldState: 'ai_suggested',
  sourceType: 'author_message',
  sourceReferences: [{ sourceType: 'author_message', sourceId: 'message-1' }],
  confidence: 0.8,
  conflicts: [],
  baseDataRevision: 2,
  decision: 'pending',
  candidateHash: 'hash',
};

describe('co-creation working draft safety', () => {
  it('does not overwrite author-confirmed content in fill-empty mode', () => {
    expect(() => acceptSuggestionToDraft({
      fields: { 'protagonist.identity': { value: '医师', state: 'user_confirmed' } },
      suggestions: [suggestion],
    }, suggestion.suggestionId, { expectedDataRevision: 2 }))
      .toThrow('不得覆盖用户已确认内容');
  });

  it('blocks stale suggestions before changing the draft', () => {
    expect(() => acceptSuggestionToDraft({ fields: {}, suggestions: [suggestion] }, suggestion.suggestionId, {
      expectedDataRevision: 3,
    })).toThrow('旧的数据版本');
  });

  it('allows explicit author replacement and stores the edited value', () => {
    const result = acceptSuggestionToDraft({
      fields: { 'protagonist.identity': { value: '医师', state: 'user_confirmed' } },
      suggestions: [suggestion],
    }, suggestion.suggestionId, {
      expectedDataRevision: 2,
      allowReplaceConfirmed: true,
      editedValue: '流亡的边城医师',
    });
    expect(result.fields['protagonist.identity']).toEqual({
      value: '流亡的边城医师', state: 'user_confirmed',
    });
    expect(result.suggestions[0].decision).toBe('accepted_to_draft');
  });
});
