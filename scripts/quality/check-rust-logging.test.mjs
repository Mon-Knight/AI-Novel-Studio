import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditRustLogging } from './check-rust-logging.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-studio-rust-logging-'));
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, 'utf8');
  }
  return root;
}

test('accepts only the structured errors.rs stderr sink', (context) => {
  const root = fixture({
    'errors.rs': 'fn sink(serialized: &str) { eprintln!("{serialized}"); }',
    'services/example.rs': 'fn work() { let _value = 1; }',
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(auditRustLogging(root), []);
});

test('rejects raw production and test print macros', (context) => {
  const root = fixture({
    'errors.rs': 'fn sink(serialized: &str) { eprintln!("{serialized}"); }',
    'commands.rs': 'fn command() { println!("raw id={}", 1); }',
    'services/example.rs': '#[test] fn test_log() { dbg!("raw"); }',
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const violations = auditRustLogging(root);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /commands\.rs:1/);
  assert.match(violations[1], /services\/example\.rs:1/);
});

test('fails closed when the structured sink is missing or duplicated', (context) => {
  const missing = fixture({ 'errors.rs': 'fn sink() {}' });
  const duplicate = fixture({
    'errors.rs':
      'fn one(serialized: &str) { eprintln!("{serialized}"); }\nfn two(serialized: &str) { eprintln!("{serialized}"); }',
  });
  context.after(() => {
    fs.rmSync(missing, { recursive: true, force: true });
    fs.rmSync(duplicate, { recursive: true, force: true });
  });
  assert.match(auditRustLogging(missing)[0], /found 0/);
  assert.match(auditRustLogging(duplicate)[0], /found 2/);
});
