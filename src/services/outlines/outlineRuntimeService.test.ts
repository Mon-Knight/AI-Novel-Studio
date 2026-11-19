import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import type { OutlineRuntimeEntry } from '../../types/outlineGeneration';
const state = vi.hoisted(() => ({ submit: vi.fn(), artifact: vi.fn(), conversation: vi.fn() }));
vi.mock('../autonomous-creation/productionAiEntryService', () => ({
  submitProductionAiEntry: state.submit,
}));
vi.mock('../ai-tasks/aiTaskRuntimeService', () => ({
  aiTaskRuntimeService: { getArtifact: state.artifact },
}));
vi.mock('../conversation/taskConversationService', () => ({
  taskConversationService: { get: state.conversation },
}));
vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: async (body: string) =>
    (await import('node:crypto')).createHash('sha256').update(body).digest('hex'),
}));
import { generateNativeOutline } from './outlineRuntimeService';

async function artifact(
  request: OutlineRuntimeEntry,
  payload: unknown,
): Promise<ResultArtifactBundle> {
  const rawContent = JSON.stringify({
    entryKind: 'outline_generate',
    stageKey: request.format,
    payload,
  });
  const contentHash = (await import('node:crypto'))
    .createHash('sha256')
    .update(rawContent)
    .digest('hex');
  return {
    artifact: {
      artifactId: 'artifact',
      taskId: 'ai-task',
      attemptId: 'attempt',
      sourceInputSnapshotId: 'snapshot',
      rawContentRefId: 'document',
      artifactType: 'generic_json',
      schemaVersion: 1,
      sourceNovelId: 'novel',
      sourceChapterId:
        request.outlineType === 'chapter' && request.format === 'editor_text'
          ? request.targetId
          : undefined,
      contentHash,
      contentLength: rawContent.length,
      processingStatus: 'valid',
      createdAt: 'frozen',
    },
    rawContent,
    issues: [],
  };
}
const editor: OutlineRuntimeEntry = {
  kind: 'outline_generate',
  outlineType: 'chapter',
  format: 'editor_text',
  targetId: 'chapter',
  targetTitle: '目标章节',
  targetIndex: 7,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.submit.mockResolvedValue({
    conversationId: 'task',
    run: { runId: 'run', turnId: 'turn', status: 'completed' },
    artifactIds: ['artifact'],
  });
  state.conversation.mockResolvedValue({
    conversation: { conversationId: 'task', novelId: 'novel' },
    artifacts: [{ cardId: 'card', artifactId: 'artifact', runId: 'run', turnId: 'turn' }],
  });
});
describe('native live outline candidate adapter', () => {
  it('uses the existing task ingress once, returns editable text and immutable provenance, never applies', async () => {
    const source = vi.fn();
    state.artifact.mockResolvedValue(
      await artifact(editor, { title: '模型标题', content: '完整原生大纲候选，尚未保存或采用。' }),
    );
    const result = await generateNativeOutline('novel', editor, { onCandidate: source });
    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledWith(
      expect.objectContaining({ novelId: 'novel', chapterId: 'chapter', entry: editor }),
    );
    expect(result.format).toBe('editor_text');
    expect(result.value).toBe('完整原生大纲候选，尚未保存或采用。');
    expect(result.source).toEqual(
      expect.objectContaining({
        version: 1,
        novelId: 'novel',
        conversationId: 'task',
        turnId: 'turn',
        runId: 'run',
        artifactId: 'artifact',
        cardId: 'card',
        request: editor,
      }),
    );
    expect(source).toHaveBeenCalledOnce();
  });
  it('preserves typed single-volume and bounded batch responses without returning the envelope as editable text', async () => {
    const volume: OutlineRuntimeEntry = {
      kind: 'outline_generate',
      outlineType: 'volume',
      format: 'volume_candidate',
      targetId: 'volume',
    };
    state.artifact.mockResolvedValue(
      await artifact(volume, {
        title: '第一卷',
        summary: '卷摘要',
        goal: '卷目标',
        mainConflict: '主要冲突',
      }),
    );
    expect((await generateNativeOutline('novel', volume)).value).toEqual({
      title: '第一卷',
      summary: '卷摘要',
      goal: '卷目标',
      mainConflict: '主要冲突',
    });
    const batch: OutlineRuntimeEntry = {
      kind: 'outline_generate',
      outlineType: 'chapter',
      format: 'chapter_candidates',
      volumeId: 'volume',
      chapterCount: 3,
    };
    state.artifact.mockResolvedValue(
      await artifact(batch, {
        chapters: [
          { title: '开端', outline: '完整提纲', targetWordCount: 2600 },
          { title: '发展', outline: '第二份提纲', goal: '发现线索' },
        ],
      }),
    );
    const result = await generateNativeOutline('novel', batch);
    expect(result.value).toEqual([
      { title: '开端', outline: '完整提纲', targetWordCount: 2600, runtimeIndex: 0 },
      { title: '发展', outline: '第二份提纲', goal: '发现线索', runtimeIndex: 1 },
    ]);
    expect(state.submit.mock.calls[1][0].chapterId).toBeUndefined();
  });
  it('rejects foreign candidates, wrong hashes, wrong phases and absent unique artifacts', async () => {
    const valid = await artifact(editor, { title: '标题', content: '候选正文' });
    for (const changed of [
      { ...valid, artifact: { ...valid.artifact, sourceNovelId: 'foreign' } },
      { ...valid, artifact: { ...valid.artifact, contentHash: '0'.repeat(64) } },
      { ...valid, artifact: { ...valid.artifact, processingStatus: 'invalid' } },
    ]) {
      state.artifact.mockResolvedValue(changed);
      await expect(generateNativeOutline('novel', editor)).rejects.toThrow(/OUTLINE_CANDIDATE_/);
    }
    state.artifact.mockResolvedValue(
      await artifact(
        { ...editor, format: 'volume_candidate' },
        { title: '标题', content: '不匹配阶段' },
      ),
    );
    await expect(generateNativeOutline('novel', editor)).rejects.toThrow('SCOPE_MISMATCH');
    state.submit.mockResolvedValueOnce({
      conversationId: 'task',
      run: { runId: 'run', turnId: 'turn' },
      artifactIds: [],
    });
    await expect(generateNativeOutline('novel', editor)).rejects.toThrow(
      'OUTLINE_CANDIDATE_REQUIRED',
    );
  });
  it('rejects oversized batches and malformed output instead of falling back to raw model text', async () => {
    const batch: OutlineRuntimeEntry = {
      kind: 'outline_generate',
      outlineType: 'chapter',
      format: 'chapter_candidates',
      volumeId: 'volume',
      chapterCount: 1,
    };
    state.artifact.mockResolvedValue(
      await artifact(batch, {
        chapters: [
          { title: '一', outline: '一' },
          { title: '二', outline: '二' },
        ],
      }),
    );
    await expect(generateNativeOutline('novel', batch)).rejects.toThrow('COUNT_INVALID');
    state.artifact.mockResolvedValue(await artifact(editor, { title: '标题', content: 42 }));
    await expect(generateNativeOutline('novel', editor)).rejects.toThrow('SCHEMA_INVALID');
  });
  it('does not publish a UI candidate after cancellation or retry a native model failure', async () => {
    const source = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateNativeOutline('novel', editor, { signal: controller.signal, onCandidate: source }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.submit).not.toHaveBeenCalled();
    state.submit.mockRejectedValueOnce(new Error('NATIVE_SCOPE_CONFLICT'));
    await expect(generateNativeOutline('novel', editor, { onCandidate: source })).rejects.toThrow(
      'NATIVE_SCOPE_CONFLICT',
    );
    expect(state.submit).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled();
  });
});
