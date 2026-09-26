import { describe, expect, it } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';
import {
  findConversationById,
  findFirstActiveConversation,
  isArchivedConversation,
  mergeConversationDirectoryItems,
  resolveChapterSelection,
  resolveInitialConversationSelection,
  resolvePreferredTaskRecovery,
  resolveProjectSelection,
  updateConversationInDirectory,
} from './workbenchConversationSelection';

function task(
  id: string,
  novelId: string,
  extra: Partial<TaskConversation> = {},
): TaskConversation {
  return {
    conversationId: id,
    novelId,
    title: id,
    status: 'waiting_user',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    ...extra,
  };
}

function novel(id: string): Novel {
  return { id, title: id, updatedAt: '2026-09-10T00:00:00Z' } as Novel;
}

function chapter(id: string): Chapter {
  return { id } as Chapter;
}

describe('workbench conversation selection', () => {
  it('treats archivedAt or the archived status as archived', () => {
    expect(isArchivedConversation(task('a1', 'a'))).toBe(false);
    expect(isArchivedConversation(task('a1', 'a', { archivedAt: '2026-09-10T00:00:00Z' }))).toBe(
      true,
    );
    expect(isArchivedConversation(task('a1', 'a', { status: 'archived' }))).toBe(true);
  });

  it('merges the directory newest first, replacing known rows and leaving inputs untouched', () => {
    const known = [task('a1', 'a', { updatedAt: '2026-09-09T00:00:00Z' })];
    const incoming = [
      task('a1', 'a', { title: 'renamed', updatedAt: '2026-09-11T00:00:00Z' }),
      task('b1', 'b'),
    ];
    const merged = mergeConversationDirectoryItems(known, incoming);
    expect(merged.map((item) => item.conversationId)).toEqual(['a1', 'b1']);
    expect(merged[0].title).toBe('renamed');
    expect(known.map((item) => item.conversationId)).toEqual(['a1']);
    expect(incoming.map((item) => item.conversationId)).toEqual(['a1', 'b1']);
  });

  it('finds a conversation by id and the first active conversation of a project', () => {
    const archived = task('a1', 'a', { archivedAt: '2026-09-10T00:00:00Z' });
    const active = task('a2', 'a');
    const other = task('b1', 'b');
    const directory = [archived, active, other];
    expect(findConversationById(directory, 'a2')).toBe(active);
    expect(findConversationById(directory, 'missing')).toBeUndefined();
    expect(findFirstActiveConversation(directory, 'a')).toBe(active);
    expect(findFirstActiveConversation(directory, 'b')).toBe(other);
    expect(findFirstActiveConversation(directory, 'missing')).toBeUndefined();
  });

  it('replaces one conversation and re-sorts the directory by recency only', () => {
    const first = task('a1', 'a', { updatedAt: '2026-09-11T00:00:00Z' });
    const second = task('a2', 'a');
    const other = task('b1', 'b', { updatedAt: '2026-09-09T00:00:00Z' });
    const directory = [first, second, other];
    const updated = { ...second, title: 'renamed', updatedAt: '2026-09-12T00:00:00Z' };
    const next = updateConversationInDirectory(directory, 'a2', updated);
    expect(next.map((item) => item.conversationId)).toEqual(['a2', 'a1', 'b1']);
    expect(next[0].title).toBe('renamed');
    expect(directory.map((item) => item.conversationId)).toEqual(['a1', 'a2', 'b1']);
  });

  it('prefers the remembered chapter, then the project chapter, then the first chapter', () => {
    const chapters = [chapter('c1'), chapter('c2')];
    expect(resolveChapterSelection(chapters, 'c2', 'c1')).toBe('c2');
    expect(resolveChapterSelection(chapters, 'missing', 'c2')).toBe('c2');
    expect(resolveChapterSelection(chapters, undefined, undefined)).toBe('c1');
    expect(resolveChapterSelection([], 'c1', 'c1')).toBeUndefined();
  });

  it('recovers the remembered task only for an existing project and a missing directory row', () => {
    const novels = [novel('a'), novel('b')];
    const directory = [task('b1', 'b')];
    expect(resolvePreferredTaskRecovery(novels, directory, null)).toBeNull();
    expect(resolvePreferredTaskRecovery(novels, directory, { novelId: 'a' })).toBeNull();
    expect(
      resolvePreferredTaskRecovery(novels, directory, { novelId: 'missing', conversationId: 'a1' }),
    ).toBeNull();
    expect(
      resolvePreferredTaskRecovery(novels, directory, { novelId: 'b', conversationId: 'b1' }),
    ).toBeNull();
    expect(
      resolvePreferredTaskRecovery(novels, directory, { novelId: 'a', conversationId: 'a1' }),
    ).toEqual({ novelId: 'a', conversationId: 'a1' });
  });

  it('resolves the initial project and task from the persisted preference', () => {
    const novels = [novel('a'), novel('b')];
    const directory = [task('a1', 'a'), task('b1', 'b')];
    expect(
      resolveInitialConversationSelection({
        novels,
        conversations: directory,
        resolvedSelection: { novelId: 'b', conversationId: 'b1' },
        selectedDuringLoad: null,
        selectionChanged: false,
      }),
    ).toEqual({ novel: novels[1], conversation: directory[1] });
  });

  it('keeps a selection made while the initial load was still running', () => {
    const novels = [novel('a'), novel('b')];
    const directory = [task('a1', 'a'), task('b1', 'b')];
    const result = resolveInitialConversationSelection({
      novels,
      conversations: directory,
      resolvedSelection: { novelId: 'b', conversationId: 'b1' },
      selectedDuringLoad: { novelId: 'a', conversationId: 'a1' },
      selectionChanged: true,
    });
    expect(result.novel).toBe(novels[0]);
    expect(result.conversation).toBe(directory[0]);
  });

  it('ignores an archived preference and falls back to the first active task', () => {
    const novels = [novel('a')];
    const archived = task('a1', 'a', { archivedAt: '2026-09-10T00:00:00Z' });
    const active = task('a2', 'a');
    const directory = [archived, active];
    expect(
      resolveInitialConversationSelection({
        novels,
        conversations: directory,
        resolvedSelection: { novelId: 'a', conversationId: 'a1' },
        selectedDuringLoad: null,
        selectionChanged: false,
      }),
    ).toEqual({ novel: novels[0], conversation: undefined });
    expect(
      resolveInitialConversationSelection({
        novels,
        conversations: directory,
        resolvedSelection: { novelId: 'a', conversationId: 'a1' },
        selectedDuringLoad: null,
        selectionChanged: true,
      }).conversation,
    ).toBe(active);
  });

  it('falls back to the first project when the preference names an unknown project', () => {
    const novels = [novel('a')];
    const directory = [task('a1', 'a')];
    const result = resolveInitialConversationSelection({
      novels,
      conversations: directory,
      resolvedSelection: { novelId: 'missing', conversationId: 'x' },
      selectedDuringLoad: { novelId: 'missing', conversationId: 'x' },
      selectionChanged: true,
    });
    expect(result.novel).toBe(novels[0]);
    expect(result.conversation).toBe(directory[0]);
  });

  it('retains a valid selected task and treats an empty project id as a no-op', () => {
    const directory = [task('a1', 'a'), task('a2', 'a')];
    const recent = new Map([['a', 'a1']]);
    expect(resolveProjectSelection('a', 'a', 'a2', directory, recent)).toBeNull();
    expect(resolveProjectSelection('', 'a', 'a2', directory, recent)).toBeNull();
  });
  it('restores the remembered task per project without mutating its inputs', () => {
    const directory = [task('a1', 'a'), task('a2', 'a'), task('b1', 'b')];
    const recent = new Map([['a', 'a2']]);
    const plan = resolveProjectSelection('a', 'b', 'b1', directory, recent);
    expect(plan?.conversation).toBe(directory[1]);
    expect(plan?.preference).toEqual({ novelId: 'a', conversationId: 'a2' });
    expect(directory.map((item) => item.conversationId)).toEqual(['a1', 'a2', 'b1']);
    expect([...recent]).toEqual([['a', 'a2']]);
  });
  it('ignores archived, missing or foreign memories and still selects an empty project', () => {
    const directory = [task('a1', 'a'), task('a2', 'a'), task('b1', 'b')];
    const archived = task('a3', 'a', { status: 'archived' });
    for (const remembered of ['a3', 'missing', 'b1']) {
      const plan = resolveProjectSelection(
        'a',
        'b',
        'b1',
        [...directory, archived],
        new Map([['a', remembered]]),
      );
      expect(plan?.conversation).toBe(directory[0]);
    }
    expect(resolveProjectSelection('empty', 'a', 'a1', directory, new Map())).toEqual({
      conversation: undefined,
      preference: { novelId: 'empty', conversationId: undefined },
    });
  });
});
