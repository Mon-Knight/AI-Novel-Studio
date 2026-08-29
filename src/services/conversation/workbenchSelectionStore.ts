import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';

const STORAGE_KEY = 'ai_novel_studio_workbench_selection';
const STORAGE_VERSION = 1;

export interface WorkbenchSelection {
  novelId: string;
  conversationId?: string;
}

interface StoredWorkbenchSelection extends WorkbenchSelection {
  version: typeof STORAGE_VERSION;
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeSelection(value: unknown): WorkbenchSelection | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<StoredWorkbenchSelection>;
  if (item.version !== STORAGE_VERSION || typeof item.novelId !== 'string') return null;

  const novelId = item.novelId.trim();
  if (!novelId) return null;
  const conversationId =
    typeof item.conversationId === 'string' ? item.conversationId.trim() : undefined;
  return conversationId ? { novelId, conversationId } : { novelId };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function latestByUpdatedAt<T extends { updatedAt: string }>(items: readonly T[]): T | undefined {
  return items.reduce<T | undefined>((latest, item) => {
    if (!latest || timestamp(item.updatedAt) > timestamp(latest.updatedAt)) return item;
    return latest;
  }, undefined);
}

function isActiveConversation(conversation: TaskConversation): boolean {
  return conversation.status !== 'archived' && !conversation.archivedAt;
}

export function load(): WorkbenchSelection | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const selection = normalizeSelection(JSON.parse(raw));
    if (!selection) clear();
    return selection;
  } catch {
    return null;
  }
}

export function save(selection: WorkbenchSelection): void {
  const storage = getStorage();
  if (!storage) return;

  const novelId = selection.novelId.trim();
  if (!novelId) {
    clear();
    return;
  }
  const conversationId = selection.conversationId?.trim();
  const stored: StoredWorkbenchSelection = {
    version: STORAGE_VERSION,
    novelId,
    ...(conversationId ? { conversationId } : {}),
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Selection persistence is optional and must never block the workbench.
  }
}

export function clear(): void {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable or quota-restricted storage.
  }
}

export function resolve(
  novels: readonly Novel[],
  conversations: readonly TaskConversation[],
  preference: WorkbenchSelection | null = load(),
): WorkbenchSelection | null {
  const novelIds = new Set(novels.map((novel) => novel.id));
  const activeConversations = conversations.filter(
    (conversation) => novelIds.has(conversation.novelId) && isActiveConversation(conversation),
  );

  if (preference && novelIds.has(preference.novelId)) {
    if (!preference.conversationId) return { novelId: preference.novelId };
    const preferredConversation = activeConversations.find(
      (conversation) =>
        conversation.conversationId === preference.conversationId &&
        conversation.novelId === preference.novelId,
    );
    if (preferredConversation) {
      return {
        novelId: preferredConversation.novelId,
        conversationId: preferredConversation.conversationId,
      };
    }
  }

  const latestConversation = latestByUpdatedAt(activeConversations);
  if (latestConversation) {
    return {
      novelId: latestConversation.novelId,
      conversationId: latestConversation.conversationId,
    };
  }

  const latestNovel = latestByUpdatedAt(novels);
  return latestNovel ? { novelId: latestNovel.id } : null;
}
