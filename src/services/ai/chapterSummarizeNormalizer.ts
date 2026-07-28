import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import type { ContextRecordType } from '../../types/context';

function normalizeImportance(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 3;
  return Math.min(5, Math.max(1, number)) as 1 | 2 | 3 | 4 | 5;
}

function normalizeContextType(value: unknown): ContextRecordType {
  const allowed: ContextRecordType[] = [
    'chapter_summary',
    'volume_summary',
    'character_state',
    'foreshadow',
    'rule',
    'relationship',
    'plot_progress',
    'other',
  ];
  return allowed.includes(value as ContextRecordType) ? (value as ContextRecordType) : 'other';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function normalizeChapterSummarizeResult(
  result: Partial<ChapterSummarizeResult>,
  fallbackText: string,
): ChapterSummarizeResult {
  return {
    summary: result.summary?.trim() || fallbackText.slice(0, 800) || '模型返回了空总结。',
    summaryTitle: result.summaryTitle?.trim() || undefined,
    keyEvents: stringArray(result.keyEvents),
    coreEvents: stringArray(result.coreEvents),
    protagonistStateChange: result.protagonistStateChange?.trim() || undefined,
    importantCharacterChanges: Array.isArray(result.importantCharacterChanges)
      ? result.importantCharacterChanges
          .map((item) => ({
            name: String(item.name || '').trim(),
            change: String(item.change || '').trim(),
          }))
          .filter((item) => item.name && item.change)
      : [],
    characterChanges: Array.isArray(result.characterChanges)
      ? result.characterChanges
          .map((item) => ({
            characterName: String(item.characterName || '未命名角色'),
            characterId: typeof item.characterId === 'string' ? item.characterId : undefined,
            stateSummary: String(item.stateSummary || ''),
            relationshipChanges: item.relationshipChanges
              ? String(item.relationshipChanges)
              : undefined,
            goalChanges: item.goalChanges ? String(item.goalChanges) : undefined,
            location: item.location ? String(item.location) : undefined,
            healthState: item.healthState ? String(item.healthState) : undefined,
            knowledgeState: item.knowledgeState ? String(item.knowledgeState) : undefined,
          }))
          .filter((item) => item.stateSummary)
      : [],
    relationshipChanges: Array.isArray(result.relationshipChanges)
      ? result.relationshipChanges
          .map((item) => ({
            fromCharacterName: String(item.fromCharacterName || ''),
            toCharacterName: String(item.toCharacterName || ''),
            change: String(item.change || ''),
          }))
          .filter((item) => item.fromCharacterName || item.toCharacterName || item.change)
      : [],
    settingChanges: stringArray(result.settingChanges),
    newLocations: stringArray(result.newLocations),
    newItemsOrAbilities: stringArray(result.newItemsOrAbilities),
    newForeshadows: stringArray(result.newForeshadows),
    resolvedForeshadows: stringArray(result.resolvedForeshadows),
    foreshadowing: stringArray(result.foreshadowing),
    unresolvedQuestions: stringArray(result.unresolvedQuestions),
    factsMustRemember: stringArray(result.factsMustRemember),
    nextChapterHints: result.nextChapterHints?.trim() || '',
    nextChapterHook: result.nextChapterHook?.trim() || undefined,
    contextRecords: Array.isArray(result.contextRecords)
      ? result.contextRecords
          .map((item) => ({
            contextType: normalizeContextType(item.contextType),
            title: String(item.title || '上下文记录'),
            content: String(item.content || ''),
            importance: normalizeImportance(item.importance),
          }))
          .filter((item) => item.content)
      : [],
  };
}
