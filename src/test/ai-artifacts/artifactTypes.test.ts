import { beforeEach, describe, expect, it } from 'vitest';
import { unifiedAiPipeline } from '../../services/ai-tasks/unifiedAiPipeline';
import { aiTaskStore } from '../../store/aiTaskStore';
import type { ResultArtifact } from '../../types/result-artifact';

describe('result artifact frontend contract', () => {
  beforeEach(() => localStorage.clear());

  it('keeps processing state separate from application state', () => {
    const artifact: ResultArtifact = {
      artifactId: 'artifact-a', taskId: 'task-a', attemptId: 'attempt-a',
      artifactType: 'chapter_text', schemaVersion: 1, rawContentRefId: 'document-a',
      contentHash: 'hash', contentLength: 10, processingStatus: 'valid', issues: [],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    expect(artifact.processingStatus).toBe('valid');
    expect(artifact).not.toHaveProperty('applied');
  });

  it('keeps malformed browser provider output as an invalid raw artifact', async () => {
    let taskId = '';
    await expect(unifiedAiPipeline.run({
      taskType: 'quality_check',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      draftId: 'draft-a',
      scopeType: 'draft',
      inputSnapshot: {
        schemaVersion: 1,
        inputType: 'quality_check_input',
        payloadJson: {},
        sourceDraftId: 'draft-a',
        sourceDraftVersion: 2,
        baseContentHash: 'base-hash',
      },
      contextSnapshot: {
        schemaVersion: 1,
        sourceManifestJson: {},
        budgetJson: {},
        compilerVersion: 'test',
      },
      constraintSnapshot: {
        schemaVersion: 1,
        payloadJson: {},
        promptTemplateId: 'quality-check-test',
        promptTemplateVersion: '1',
        promptTemplateHash: 'template-hash',
        providerOptionsJson: {},
      },
      artifactType: 'quality_report',
      timeoutMs: 1000,
      client: { generate: async () => ({ text: 'not-json', raw: { payload: 'complete raw response' } }) },
      request: { messages: [{ role: 'user', content: 'test' }] },
      onTaskCreated: (task) => { taskId = task.taskId; },
    })).rejects.toEqual(expect.objectContaining({ code: 'ARTIFACT_VALIDATION_FAILED' }));

    const summary = aiTaskStore.get(taskId);
    expect(summary).toEqual(expect.objectContaining({ status: 'failed', artifactId: expect.any(String) }));
    const stored = JSON.parse(localStorage.getItem(
      `ai_novel_studio_result_artifact_${summary?.artifactId}`,
    ) || '{}');
    expect(stored).toEqual(expect.objectContaining({
      processingStatus: 'invalid',
      rawContent: JSON.stringify({ payload: 'complete raw response' }),
    }));
  });
});
