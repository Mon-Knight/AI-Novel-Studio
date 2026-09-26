import type { Chapter } from '../../types/chapter';
import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';
import type { WorkbenchSelection } from '../../services/conversation/workbenchSelectionStore';
import { compareConversations } from '../../services/conversation/conversationDirectoryQuery';

/**
 * Pure project/task selection helpers for the workbench conversation hook.
 *
 * Everything here is synchronous and free of React, storage and service calls, so
 * `useWorkbenchConversations` keeps ownership of state, refs and side effects and only
 * asks this module what it should select or merge.
 */

/** An archived conversation must never become the active selection. */
export function isArchivedConversation(conversation: TaskConversation): boolean {
  return Boolean(conversation.archivedAt || conversation.status === 'archived');
}

/** Newest-first directory merge that keeps every already known conversation. */
export function mergeConversationDirectoryItems(
  known: readonly TaskConversation[],
  items: readonly TaskConversation[],
): TaskConversation[] {
  const merged = new Map(known.map((item) => [item.conversationId, item]));
  for (const item of items) merged.set(item.conversationId, item);
  return [...merged.values()].sort(compareConversations);
}

export interface ProjectSelectionPlan {
  conversation: TaskConversation | undefined;
  preference: { novelId: string; conversationId: string | undefined };
}

/**
 * Selecting a project is navigation, not a refresh or an implicit task reset: re-selecting the
 * current project keeps its active task, otherwise the remembered task wins and the first
 * active task of that project is the fallback. Returns null when the click is a no-op.
 */
export function resolveProjectSelection(
  novelId: string,
  selectedNovelId: string,
  selectedConversationId: string,
  conversations: readonly TaskConversation[],
  recentTaskByProject: ReadonlyMap<string, string>,
): ProjectSelectionPlan | null {
  if (!novelId) return null;
  if (
    selectedNovelId === novelId &&
    conversations.some(
      (item) => item.novelId === novelId && item.conversationId === selectedConversationId,
    )
  ) {
    return null;
  }
  const rememberedId = recentTaskByProject.get(novelId);
  const activeTasks = conversations.filter(
    (conversation) => conversation.novelId === novelId && !isArchivedConversation(conversation),
  );
  const conversation =
    activeTasks.find((task) => task.conversationId === rememberedId) ?? activeTasks[0];
  return { conversation, preference: { novelId, conversationId: conversation?.conversationId } };
}

export function findConversationById(
  conversations: readonly TaskConversation[],
  conversationId: string,
): TaskConversation | undefined {
  return conversations.find((conversation) => conversation.conversationId === conversationId);
}

/** First non-archived conversation of one project; the archive fallback for navigation. */
export function findFirstActiveConversation(
  conversations: readonly TaskConversation[],
  novelId: string,
): TaskConversation | undefined {
  return conversations.find(
    (conversation) => conversation.novelId === novelId && !isArchivedConversation(conversation),
  );
}

/**
 * Replaces one conversation with its updated record and keeps the directory ordered by
 * most recent activity, matching the previous inline map/sort.
 */
export function updateConversationInDirectory(
  conversations: readonly TaskConversation[],
  conversationId: string,
  updated: TaskConversation,
): TaskConversation[] {
  return conversations
    .map((item) => (item.conversationId === conversationId ? updated : item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Remembered chapter wins, then the project's current chapter, then the first planned
 * chapter; `undefined` means "no chapter", exactly like the previous inline comparison.
 */
export function resolveChapterSelection(
  chapters: readonly Chapter[],
  rememberedChapterId: string | undefined,
  currentChapterId: string | undefined,
): string | undefined {
  if (chapters.some((chapter) => chapter.id === rememberedChapterId)) return rememberedChapterId;
  if (chapters.some((chapter) => chapter.id === currentChapterId)) return currentChapterId;
  return chapters[0]?.id;
}

export interface PreferredTaskRecovery {
  novelId: string;
  conversationId: string;
}

/**
 * The last-used task is re-read from storage only when its project still exists and the
 * loaded directory page does not already carry it.
 */
export function resolvePreferredTaskRecovery(
  novels: readonly Novel[],
  conversations: readonly TaskConversation[],
  preference: WorkbenchSelection | null,
): PreferredTaskRecovery | null {
  if (!preference) return null;
  const { conversationId } = preference;
  if (!conversationId) return null;
  if (!novels.some((novel) => novel.id === preference.novelId)) return null;
  if (conversations.some((item) => item.conversationId === conversationId)) return null;
  return { novelId: preference.novelId, conversationId };
}

export interface InitialConversationSelectionInput {
  novels: readonly Novel[];
  conversations: readonly TaskConversation[];
  /** Selection resolved from the persisted preference and the loaded directory. */
  resolvedSelection: WorkbenchSelection | null;
  /** Non-null when the user picked a project or task while the initial load was running. */
  selectedDuringLoad: WorkbenchSelection | null;
  selectionChanged: boolean;
}

export interface InitialConversationSelection {
  novel: Novel;
  conversation: TaskConversation | undefined;
}

/**
 * Resolves the project/task the initial load lands on. The caller guarantees a non-empty
 * project list (it returns early for an empty library), so `novels[0]` is the same
 * fallback the hook used inline.
 */
export function resolveInitialConversationSelection(
  input: InitialConversationSelectionInput,
): InitialConversationSelection {
  const { novels, conversations, resolvedSelection, selectedDuringLoad, selectionChanged } = input;
  const targetSelection = selectedDuringLoad?.novelId ? selectedDuringLoad : resolvedSelection;
  const novel = novels.find((item) => item.id === targetSelection?.novelId) ?? novels[0];
  const selected = conversations.find(
    (conversation) =>
      conversation.conversationId === targetSelection?.conversationId &&
      conversation.novelId === novel.id &&
      !isArchivedConversation(conversation),
  );
  const conversation =
    selected ??
    (selectionChanged
      ? conversations.find((item) => item.novelId === novel.id && !isArchivedConversation(item))
      : undefined);
  return { novel, conversation };
}
