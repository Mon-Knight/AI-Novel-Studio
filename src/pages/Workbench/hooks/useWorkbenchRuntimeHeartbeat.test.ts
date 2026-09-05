import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setsEqual } from './useWorkbenchRuntimeHeartbeat';

test('setsEqual compares set contents regardless of insertion order', () => {
  const setA = new Set(['a', 'b', 'c']);
  const setB = new Set(['c', 'b', 'a']);
  const setC = new Set(['a', 'b']);
  const setD = new Set(['a', 'b', 'd']);

  assert.equal(setsEqual(setA, setA), true);
  assert.equal(setsEqual(setA, setB), true);
  assert.equal(setsEqual(setA, setC), false);
  assert.equal(setsEqual(setA, setD), false);
});
