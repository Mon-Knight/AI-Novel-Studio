import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  adoptLocalSuggestion,
  suggestionCandidateHash,
  SUGGESTION_KEY,
  withSuggestionLock,
} from './settingSuggestionLocalStore';
import type {
  SettingSuggestionRecord,
  SettingSuggestionTargetType,
} from '../../types/settingSuggestion';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  failFinalDecision = false;
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    if (
      this.failFinalDecision &&
      key === SUGGESTION_KEY &&
      (JSON.parse(value) as SettingSuggestionRecord[]).some((record) => record.status === 'adopted')
    ) {
      this.failFinalDecision = false;
      throw new Error('injected final decision failure');
    }
    this.values.set(key, value);
  }
}
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
});
function record(
  type: SettingSuggestionRecord['suggestionType'] = 'character',
): SettingSuggestionRecord {
  return {
    id: 'candidate-1',
    novelId: 'novel-1',
    suggestionType: type,
    worldType: '',
    referenceStyle: '',
    prompt: 'frozen input',
    resultJson: '{"name":"甲"}',
    item: { name: '甲' },
    status: 'pending',
    createdAt: 't',
    updatedAt: 't',
  };
}
async function input(type: SettingSuggestionRecord['suggestionType'] = 'character') {
  const candidate = record(type);
  storage.setItem(SUGGESTION_KEY, JSON.stringify([candidate]));
  const targetType: SettingSuggestionTargetType =
    type === 'character' ? 'character' : type === 'rule' ? 'rule_system' : 'world_setting';
  return {
    record: candidate,
    item: candidate.item,
    edited: false,
    candidateHash: await suggestionCandidateHash(candidate),
    requestHash: 'exact-authorized-request',
    targetType,
    target: { id: 'target-1', novelId: candidate.novelId, name: '甲', updatedAt: 't' },
  };
}
const keyFor = (type: SettingSuggestionTargetType) =>
  type === 'character'
    ? 'ai_novel_studio_characters'
    : type === 'rule_system'
      ? 'ai_novel_studio_rule_systems'
      : 'ai_novel_studio_world_settings';

test('browser target success followed by decision failure retries one deterministic target', async () => {
  const request = await input();
  storage.failFinalDecision = true;
  await assert.rejects(
    withSuggestionLock(request.record.id, () => adoptLocalSuggestion(request)),
    /injected/,
  );
  assert.equal(
    (JSON.parse(storage.getItem(SUGGESTION_KEY)!) as SettingSuggestionRecord[])[0].status,
    'pending',
  );
  assert.equal((JSON.parse(storage.getItem(keyFor(request.targetType))!) as unknown[]).length, 1);
  const result = await withSuggestionLock(request.record.id, () => adoptLocalSuggestion(request));
  assert.equal(result.record.status, 'adopted');
  assert.equal((JSON.parse(storage.getItem(keyFor(request.targetType))!) as unknown[]).length, 1);
});

test('browser concurrent callers and refresh replay never create a second formal asset for any legacy type', async () => {
  for (const type of ['character', 'rule', 'faction', 'location'] as const) {
    storage.clear();
    const request = await input(type);
    const [first, second] = await Promise.all(
      [1, 2].map(() => withSuggestionLock(request.record.id, () => adoptLocalSuggestion(request))),
    );
    assert.equal(first.targetId, second.targetId);
    const persisted = (
      JSON.parse(storage.getItem(SUGGESTION_KEY)!) as SettingSuggestionRecord[]
    )[0];
    const replay = await adoptLocalSuggestion({ ...request, record: persisted });
    assert.equal(replay.targetId, first.targetId);
    assert.equal((JSON.parse(storage.getItem(keyFor(request.targetType))!) as unknown[]).length, 1);
  }
});

test('browser replay fails closed for edited authorization, foreign novel and mutated target', async () => {
  const request = await input();
  await assert.rejects(
    adoptLocalSuggestion({ ...request, record: { ...request.record, novelId: 'foreign' } }),
    /CAS_CONFLICT/,
  );
  await adoptLocalSuggestion(request);
  await assert.rejects(
    adoptLocalSuggestion({ ...request, requestHash: 'different-edit-authorization' }),
    /REPLAY_CONFLICT/,
  );
  storage.setItem(
    keyFor(request.targetType),
    JSON.stringify([{ ...request.target, name: 'mutated' }]),
  );
  await assert.rejects(adoptLocalSuggestion(request), /TARGET_CHANGED/);
});

test('browser final synchronous rule CAS is honored before journal or target writes', async () => {
  const request = await input('rule');
  await assert.rejects(
    adoptLocalSuggestion({
      ...request,
      validate: async () => () => {
        throw new Error('RULE_SET_BASE_CONFLICT');
      },
    }),
    /RULE_SET_BASE_CONFLICT/,
  );
  assert.equal(storage.getItem(keyFor(request.targetType)), null);
  assert.equal(
    (JSON.parse(storage.getItem(SUGGESTION_KEY)!) as SettingSuggestionRecord[])[0].resultJson,
    request.record.resultJson,
  );
});
