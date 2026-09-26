import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import type { TaskConversationBundle } from '../../types/conversation';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { verifyArtifactRevisionSource } from './artifactRevisionSourceService';

async function fixture() {
  const content = '精确绑定旧候选A，不使用后来生成的B。';
  const hash = await computeContentSha256(content);
  const source: ArtifactRevisionSource = {
    conversationId: 'task-a',
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    artifactId: 'artifact-a',
    cardId: 'card-a',
    runId: 'run-a',
    artifactHash: hash,
    artifactType: 'chapter_text',
    title: 'A',
  };
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: 'task-a',
      novelId: 'novel-a',
      title: '任务',
      status: 'waiting_user',
      createdAt: '',
      updatedAt: '',
    },
    turns: [],
    toolEvents: [],
    runs: [
      {
        runId: 'run-a',
        conversationId: 'task-a',
        turnId: 'turn-a',
        workerId: 'worker-a',
        status: 'completed',
        modelSnapshot: {
          providerId: 'mock',
          modelId: 'Mock',
          runtimeMode: 'mock',
          capabilities: [],
          options: {},
          capturedAt: '',
        },
        createdAt: '',
        updatedAt: '',
      },
    ],
    artifacts: ['a', 'b'].map((id) => ({
      cardId: 'card-' + id,
      artifactId: 'artifact-' + id,
      runId: 'run-a',
      conversationId: 'task-a',
      artifactType: 'chapter_text',
      title: id,
      summary: '',
      status: 'candidate',
      createdAt: id,
    })),
  };
  const artifact: ResultArtifactBundle = {
    artifact: {
      artifactId: 'artifact-a',
      taskId: 'ai-a',
      attemptId: 'attempt-a',
      sourceInputSnapshotId: 'snapshot-a',
      artifactType: 'chapter_text',
      schemaVersion: 1,
      rawContentRefId: 'raw-a',
      sourceNovelId: 'novel-a',
      sourceChapterId: 'chapter-a',
      contentHash: hash,
      contentLength: content.length,
      processingStatus: 'valid',
      createdAt: '',
    },
    rawContent: content,
    issues: [],
  };
  bundle.decisions = [
    {
      decisionId: 'revise-a',
      artifactId: source.artifactId,
      artifactHash: source.artifactHash,
      cardId: source.cardId,
      conversationId: source.conversationId,
      decision: 'request_revision',
      idempotencyKey: 'revise-a',
      actor: 'user',
      targetType: 'chapter',
      targetId: 'chapter-a',
      createdAt: '',
    },
  ];
  return { content, source, bundle, artifact };
}
test('A stays the source when B exists; title order never selects another candidate', async () => {
  const f = await fixture();
  const requested: string[] = [];
  const result = await verifyArtifactRevisionSource(
    { ...f.source, revisionSource: f.source },
    {
      persistent: true,
      getConversation: async () => f.bundle,
      getArtifact: async (id) => {
        requested.push(id);
        return f.artifact;
      },
    },
  );
  assert.deepEqual(requested, ['artifact-a']);
  assert.equal(result?.content, f.content);
  assert.equal(result?.contentHash, f.source.artifactHash);
});
test('scope, run, hash and corrupted body changes fail closed instead of choosing B', async () => {
  for (const change of ['chapter', 'run', 'hash', 'body']) {
    const f = await fixture();
    if (change === 'chapter') f.source.chapterId = 'other-chapter';
    if (change === 'run') f.source.runId = 'other-run';
    if (change === 'hash') f.source.artifactHash = '0'.repeat(64);
    if (change === 'body') f.artifact.rawContent = '被篡改';
    await assert.rejects(
      verifyArtifactRevisionSource(
        {
          conversationId: 'task-a',
          novelId: 'novel-a',
          chapterId: 'chapter-a',
          revisionSource: f.source,
        },
        {
          persistent: true,
          getConversation: async () => f.bundle,
          getArtifact: async () => f.artifact,
        },
      ),
      /修订来源已失效/,
    );
  }
});
test('browser wrapper identity differs from the unwrapped prose hash', async () => {
  const f = await fixture();
  const wrapper = JSON.stringify({
    data: { novelId: 'novel-a', chapterId: 'chapter-a', text: f.content },
  });
  f.source.artifactHash = await computeContentSha256(wrapper);
  f.bundle.artifacts[0].content = wrapper;
  f.bundle.decisions![0].artifactHash = f.source.artifactHash;
  const result = await verifyArtifactRevisionSource(
    { ...f.source, revisionSource: f.source },
    {
      persistent: false,
      getConversation: async () => f.bundle,
    },
  );
  assert.equal(result?.content, f.content);
  assert.equal(result?.contentHash, await computeContentSha256(f.content));
  assert.notEqual(result?.contentHash, result?.source.artifactHash);
});
