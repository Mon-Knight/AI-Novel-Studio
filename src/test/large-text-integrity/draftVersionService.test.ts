import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/tauri/runtime', () => ({
  isTauriRuntime: () => true,
  tauriInvoke: runtimeMocks.invoke,
}));

import { draftVersionService } from '../../services/database/draftVersionService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

function persistedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-a',
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    title: '第一章',
    content: '数据库中的 500 字预览',
    source: 'user_edited',
    versionNo: 2,
    wordCount: 500,
    isAdopted: false,
    largeTextRefId: 'document-a',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:01:00.000Z',
    ...overrides,
  };
}

describe('draft persistence reliability facade', () => {
  beforeEach(() => {
    runtimeMocks.invoke.mockReset();
  });

  it('maps an unavailable large-text response without putting its preview in draft.content', async () => {
    runtimeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_latest_draft_by_chapter_id') return persistedDraft();
      if (command === 'read_chapter_draft_content') {
        return {
          draftId: 'draft-a',
          draftVersion: 2,
          contentState: {
            status: 'unavailable',
            preview: '服务端预览也不能进入正文',
            errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
            retryable: true,
            expectedHash: 'expected',
            actualHash: 'actual',
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const draft = await draftVersionService.getLatestByChapterId('chapter-a');

    expect(draft?.content).toBe('');
    expect(draft?.contentState).toEqual(expect.objectContaining({
      status: 'unavailable',
      errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
      retryable: true,
      expectedHash: 'expected',
      actualHash: 'actual',
    }));
    expect(draft?.contentState?.status === 'unavailable' && draft.contentState.preview)
      .toBe('数据库中的 500 字预览');
  });

  it('uses the single atomic IPC boundary and validates the returned document identity', async () => {
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe('save_chapter_draft_atomic');
      const input = args.input as Record<string, unknown>;
      expect(input).toEqual(expect.objectContaining({
        novelId: 'novel-a',
        chapterId: 'chapter-a',
        content: '待保存完整正文',
        source: 'user_edited',
      }));
      expect(input.operationId).toEqual(expect.stringMatching(/^operation-/));
      expect(input.traceId).toEqual(expect.stringMatching(/^draft-save-/));
      expect(input.currentContentHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
      return {
        operationId: input.operationId,
        traceId: input.traceId,
        contentHash: input.currentContentHash,
        contentLength: (input.content as string).length,
        storageMode: 'inline',
        idempotentReplay: false,
        draft: persistedDraft({
          id: 'draft-created',
          content: '待保存完整正文',
          largeTextRefId: undefined,
          versionNo: 1,
          wordCount: 8,
        }),
      };
    });

    const draft = await draftVersionService.create({
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      title: '第一章',
      content: '待保存完整正文',
      source: 'user_edited',
    });

    expect(runtimeMocks.invoke).toHaveBeenCalledTimes(1);
    expect(draft.id).toBe('draft-created');
    expect(draft.content).toBe('待保存完整正文');
    expect(draft.contentState?.status).toBe('ready');
  });

  it('uses Unicode scalar length and reuses operationId when the same update is retried', async () => {
    const content = '正文🙂重试';
    const baseContent = '旧正文';
    const baseHash = await computeContentSha256(baseContent);
    const operationIds: string[] = [];
    let attempt = 0;
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'get_drafts_by_chapter_id') {
        return [persistedDraft({ content: baseContent, largeTextRefId: undefined })];
      }
      expect(command).toBe('save_chapter_draft_atomic');
      const input = args.input as Record<string, unknown>;
      operationIds.push(String(input.operationId));
      expect(input).toEqual(expect.objectContaining({
        draftId: 'draft-a',
        draftVersion: 2,
        baseContentHash: baseHash,
        content,
      }));
      attempt += 1;
      if (attempt === 1) {
        throw {
          code: 'DATABASE_BUSY',
          message: 'database busy',
          retryable: true,
          operationId: input.operationId,
        };
      }
      return {
        operationId: input.operationId,
        traceId: input.traceId,
        contentHash: input.currentContentHash,
        contentLength: Array.from(content).length,
        storageMode: 'inline',
        idempotentReplay: false,
        draft: persistedDraft({ content, largeTextRefId: undefined }),
      };
    });

    const base = persistedDraft({
      content: baseContent,
      contentState: {
        status: 'ready',
        content: baseContent,
        contentHash: baseHash,
        contentLength: 3,
      },
    });

    await expect(draftVersionService.update(
      'draft-a', 'chapter-a', content, 'user_edited', undefined, base as any,
    )).rejects.toEqual(expect.objectContaining({ code: 'DATABASE_BUSY' }));
    const saved = await draftVersionService.update(
      'draft-a', 'chapter-a', content, 'user_edited', undefined, base as any,
    );

    expect(operationIds).toHaveLength(2);
    expect(operationIds[1]).toBe(operationIds[0]);
    expect(saved.contentState).toEqual(expect.objectContaining({
      status: 'ready',
      contentLength: Array.from(content).length,
    }));
  });

  it('accepts a new candidate id when adoption commits during editing', async () => {
    const baseContent = '采用前正文';
    const editedContent = '采用期间继续编辑的正文';
    const baseHash = await computeContentSha256(baseContent);
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'get_drafts_by_chapter_id') {
        return [
          persistedDraft({
            id: 'unrelated-history',
            content: 'unrelated preview',
            largeTextRefId: 'unrelated-document',
            versionNo: 1,
          }),
          persistedDraft({
            content: baseContent,
            largeTextRefId: undefined,
            isAdopted: true,
          }),
        ];
      }
      expect(command).toBe('save_chapter_draft_atomic');
      const input = args.input as Record<string, unknown>;
      expect(input.draftId).toBe('draft-a');
      expect(input.baseContentHash).toBe(baseHash);
      return {
        operationId: input.operationId,
        traceId: input.traceId,
        contentHash: input.currentContentHash,
        contentLength: Array.from(editedContent).length,
        storageMode: 'inline',
        idempotentReplay: false,
        draft: persistedDraft({
          id: 'draft-after-adoption',
          content: editedContent,
          largeTextRefId: undefined,
          versionNo: 3,
          isAdopted: false,
        }),
      };
    });
    const staleEditorBase = persistedDraft({
      content: baseContent,
      isAdopted: false,
      contentState: {
        status: 'ready',
        content: baseContent,
        contentHash: baseHash,
        contentLength: Array.from(baseContent).length,
      },
    });

    const saved = await draftVersionService.update(
      'draft-a', 'chapter-a', editedContent, 'user_edited', undefined, staleEditorBase as any,
    );

    expect(saved.id).toBe('draft-after-adoption');
    expect(saved.isAdopted).toBe(false);
    expect(saved.content).toBe(editedContent);
  });
});
