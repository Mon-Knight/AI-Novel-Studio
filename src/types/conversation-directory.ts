import type { TaskConversation } from './conversation';

export type ConversationArchiveFilter = 'active' | 'archived' | 'all';

export interface ConversationListCursor {
  updatedAt: string;
  conversationId: string;
}

export interface ConversationDirectoryQuery {
  novelId?: string;
  archive?: ConversationArchiveFilter;
  query?: string;
  limit?: number;
  cursor?: ConversationListCursor;
}

export interface ConversationDirectoryPage {
  items: TaskConversation[];
  nextCursor?: ConversationListCursor;
}
