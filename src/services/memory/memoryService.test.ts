import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRetrieveMemoryInput, validateEmbeddingVector } from './memoryService';

test('真实 embedding 必须有有限、非零且维度一致的显式向量', () => {
  assert.doesNotThrow(() => validateEmbeddingVector([1, 0, -0.25], 3));
  assert.throws(() => validateEmbeddingVector([1, 0], 3), /维度不匹配/);
  assert.throws(() => validateEmbeddingVector([0, 0], 2), /范数无效/);
  assert.throws(() => validateEmbeddingVector([1, Number.NaN], 2), /非有限/);
});

test('无 embedding 的检索保留显式 structured/lexical 参数且受预算约束', () => {
  const normalized = normalizeRetrieveMemoryInput({
    requestId: ' request-a ',
    novelId: ' novel-a ',
    query: ' 铜钥匙 ',
    topK: 5,
    candidateLimit: 40,
    tokenBudget: 1200,
  });
  assert.equal(normalized.requestId, 'request-a');
  assert.equal(normalized.novelId, 'novel-a');
  assert.equal(normalized.query, '铜钥匙');
  assert.equal(normalized.queryEmbedding, undefined);
  assert.equal(normalized.tokenBudget, 1200);
  assert.throws(
    () => normalizeRetrieveMemoryInput({ requestId: 'a', novelId: 'n', query: '', topK: 5 }),
    /至少需要/,
  );
  assert.throws(
    () =>
      normalizeRetrieveMemoryInput({
        requestId: 'a',
        novelId: 'n',
        query: 'x',
        topK: 51,
      }),
    /参数无效/,
  );
});

test('查询 embedding 的模型身份和维度在 IPC 前校验', () => {
  assert.doesNotThrow(() =>
    normalizeRetrieveMemoryInput({
      requestId: 'request-semantic',
      novelId: 'novel-a',
      queryEmbedding: {
        provider: 'provider-a',
        model: 'embed-v1',
        dimension: 2,
        vector: [0.5, 0.5],
      },
    }),
  );
  assert.throws(
    () =>
      normalizeRetrieveMemoryInput({
        requestId: 'request-semantic-bad',
        novelId: 'novel-a',
        queryEmbedding: {
          provider: 'provider-a',
          model: 'embed-v1',
          dimension: 3,
          vector: [0.5, 0.5],
        },
      }),
    /维度不匹配/,
  );
});
