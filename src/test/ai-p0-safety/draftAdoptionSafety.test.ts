import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const runtimeMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../../services/tauri/runtime', () => ({
  isTauriRuntime: () => true,
  tauriInvoke: runtimeMocks.invoke,
}));

import { draftVersionService } from '../../services/database/draftVersionService';

function draft(id: string, content: string, versionNo: number) {
  return {
    id,
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    content,
    source: 'ai_generated',
    versionNo,
    wordCount: content.length,
    isAdopted: false,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('AI result target safety', () => {
  beforeEach(() => {
    runtimeMocks.invoke.mockReset();
  });

  it('passes task/artifact/note/source fields through the one atomic draft command', async () => {
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, any>) => {
      expect(command).toBe('save_chapter_draft_atomic');
      expect(args.input).toEqual(expect.objectContaining({
        aiTaskId: 'task-a',
        artifactId: 'artifact-a',
        note: 'validated',
        sourceType: 'ai_task_artifact',
        sourceId: 'artifact-a',
        sourceDraftId: 'source-a',
        sourceDraftVersion: 3,
        baseContentHash: 'base-hash',
      }));
      return {
        operationId: args.input.operationId,
        traceId: args.input.traceId,
        contentHash: args.input.currentContentHash,
        contentLength: Array.from(args.input.content).length,
        storageMode: 'inline',
        draft: { ...draft('candidate-a', args.input.content, 4), ...args.input },
      };
    });
    const saved = await draftVersionService.create({
      novelId: 'novel-a', chapterId: 'chapter-a', content: '候选正文', source: 'ai_generated',
      aiTaskId: 'task-a', artifactId: 'artifact-a', note: 'validated',
      sourceType: 'ai_task_artifact', sourceId: 'artifact-a', sourceDraftId: 'source-a',
      sourceDraftVersion: 3, baseContentHash: 'base-hash',
    });
    expect(saved.aiTaskId).toBe('task-a');
    expect(saved.artifactId).toBe('artifact-a');
  });

  it('adopts the displayed draft A even when a newer draft B exists and never queries latest', async () => {
    const hashA = await computeContentSha256('草稿 A');
    const hashB = await computeContentSha256('草稿 B');
    const a = draft('draft-a', '草稿 A', 1);
    const b = draft('draft-b', '草稿 B', 2);
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, any>) => {
      if (command === 'get_drafts_by_chapter_id') return [a, b];
      if (command === 'adopt_chapter_draft_safe') {
        expect(args.input).toEqual(expect.objectContaining({
          novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a',
          draftVersion: 1, contentHash: hashA,
        }));
        return {
          operationId: args.input.operationId,
          traceId: args.input.traceId,
          contentHash: hashA,
          draft: { ...a, isAdopted: true },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const adopted = await draftVersionService.adoptExact({
      novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a', draftVersion: 1, contentHash: hashA,
    });
    expect(adopted.id).toBe('draft-a');
    expect(hashB).not.toBe(hashA);
    expect(runtimeMocks.invoke.mock.calls.map(([command]) => command)).not.toContain('get_latest_draft_by_chapter_id');
  });

  it('coalesces rapid duplicate adoption into one authoritative command', async () => {
    const contentHash = await computeContentSha256('草稿 A');
    const a = draft('draft-a', '草稿 A', 1);
    let adoptCalls = 0;
    runtimeMocks.invoke.mockImplementation(async (command: string, args: Record<string, any>) => {
      if (command === 'get_drafts_by_chapter_id') return [a];
      if (command === 'adopt_chapter_draft_safe') {
        adoptCalls += 1;
        await Promise.resolve();
        return {
          operationId: args.input.operationId,
          traceId: args.input.traceId,
          contentHash,
          draft: { ...a, isAdopted: true },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const input = {
      novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a', draftVersion: 1, contentHash,
    };
    const [first, second] = await Promise.all([
      draftVersionService.adoptExact(input),
      draftVersionService.adoptExact(input),
    ]);
    expect(first.id).toBe(second.id);
    expect(adoptCalls).toBe(1);
  });
});
