import assert from 'node:assert/strict';
import test from 'node:test';
import { createUniqueId } from './uniqueId';

test('createUniqueId prefers a runtime random UUID', () => {
  const expected = '12345678-1234-4123-8123-123456789abc';
  assert.equal(createUniqueId({ randomUUID: () => expected }), expected);
});

test('createUniqueId builds an RFC 4122 v4 UUID from random bytes', () => {
  const id = createUniqueId({
    getRandomValues(bytes) {
      bytes.fill(0xab);
      return bytes;
    },
  });
  assert.equal(id, 'abababab-abab-4bab-abab-abababababab');
});

test('createUniqueId monotonic fallback remains unique without crypto', () => {
  const first = createUniqueId(null);
  const second = createUniqueId(null);
  assert.notEqual(first, second);
  assert.match(first, /^fallback-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(second, /^fallback-[a-z0-9]+-[a-z0-9]+$/);
});
