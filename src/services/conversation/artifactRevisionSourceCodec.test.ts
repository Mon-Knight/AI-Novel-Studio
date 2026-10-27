import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeArtifactRevisionTurn,
  encodeArtifactRevisionTurn,
} from './artifactRevisionSourceCodec';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';

const source: ArtifactRevisionSource = {
  conversationId: 'task-a',
  novelId: 'novel-a',
  chapterId: 'chapter-a',
  cardId: 'card-a',
  artifactId: 'artifact-a',
  artifactHash: 'a'.repeat(64),
  artifactType: 'chapter_text',
  runId: 'run-a',
  title: '第一版候选',
  sourceDraftVersion: 2,
};
test('revision envelope preserves prose byte-for-byte and restores immutable source', () => {
  const content = '  修订这一版。\n保留尾部空格。  \n';
  assert.deepEqual(decodeArtifactRevisionTurn(encodeArtifactRevisionTurn(content, source)), {
    content,
    revisionSource: source,
  });
  assert.equal(encodeArtifactRevisionTurn(content), content);
});
test('literal user text resembling the envelope is escaped once without interpreting it', () => {
  const text = '[[ANS_ARTIFACT_REVISION_TURN:v1]]\n{"content":"不是元数据","revisionSource":null}';
  assert.deepEqual(decodeArtifactRevisionTurn(encodeArtifactRevisionTurn(text)), { content: text });
});
test('malformed, unknown-key and empty-identity envelopes fail closed', () => {
  const prefix = '[[ANS_ARTIFACT_REVISION_TURN:v1]]\n';
  for (const suffix of [
    '{}',
    '{',
    JSON.stringify({ content: '修改', revisionSource: { ...source, artifactId: '' } }),
    JSON.stringify({ content: '修改', revisionSource: source, extra: 'untrusted' }),
    JSON.stringify({ content: '修改', revisionSource: { ...source, sourceDraftVersion: null } }),
  ]) {
    assert.throws(() => decodeArtifactRevisionTurn(prefix + suffix), /修订来源记录无效/);
  }
  const ordinary = '示例 [[ANS_ARTIFACT_REVISION_TURN:v2]] 不应修改';
  assert.deepEqual(decodeArtifactRevisionTurn(ordinary), { content: ordinary });
});
test('real IPC null evidence is normalized before the strict envelope is built', async () => {
  const { captureArtifactRevisionSource } = await import('./artifactRevisionSourceService');
  const card = {
    cardId: 'card-null',
    conversationId: 'task-null',
    artifactId: 'artifact-null',
    artifactType: 'chapter_text',
    title: '生成型候选',
    runId: null,
    artifactEvidence: {
      sourceNovelId: 'novel-null',
      sourceChapterId: null,
      sourceDraftId: null,
      sourceDraftVersion: null,
      baseContentHash: null,
      processingStatus: 'valid',
      validationIssues: [],
    },
  } as unknown as Parameters<typeof captureArtifactRevisionSource>[0];
  const captured = captureArtifactRevisionSource(card, 'novel-null', 'b'.repeat(64));
  assert.equal(captured.chapterId, undefined);
  assert.equal(captured.runId, undefined);
  assert.equal(captured.sourceDraftVersion, undefined);
  assert.doesNotThrow(() => encodeArtifactRevisionTurn('修订意见', captured));
});
