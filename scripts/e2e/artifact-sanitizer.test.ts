import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  redactLogText,
  sanitizeArtifactDirectory,
  sanitizeJsonText,
  sanitizeSecrets,
} from './artifact-sanitizer.ts';

test('structured sanitization preserves multiline JSON while removing secrets and Windows paths', () => {
  const source = {
    logs: [{
      level: 'info',
      message: 'first line\nfile C:\\Users\\writer\\draft.txt\nAuthorization: Bearer private-token',
    }],
    apiKey: 'sk-1234567890abcdef',
    nested: {
      prompt: 'sensitive full prompt',
      databasePath: 'C:\\Users\\writer\\AppData\\Local\\Temp\\e2e\\ai-novel-studio.db',
    },
  };

  const sanitized = sanitizeSecrets(source);
  const serialized = JSON.stringify(sanitized);
  const reparsed = JSON.parse(serialized) as typeof sanitized;

  assert.equal(reparsed.apiKey, '[REDACTED]');
  assert.equal(reparsed.nested.prompt, '[REDACTED]');
  assert.equal(reparsed.nested.databasePath, '[REDACTED_PATH]');
  assert.equal(reparsed.logs[0].message, 'first line\nfile [REDACTED_PATH]\nAuthorization: [REDACTED]');
  assert.doesNotMatch(serialized, /writer|private-token|sensitive full prompt|sk-123/i);
});

test('JSON text sanitization remains valid across repeated passes', () => {
  const source = JSON.stringify({
    message: 'candidate review\nC:\\Users\\writer\\result.json"next\nnext line',
    detail: 'token=private-token"next',
    authorization: 'Bearer top-secret-token',
  }, null, 2);

  const once = sanitizeJsonText(source);
  const twice = sanitizeJsonText(once);
  const parsed = JSON.parse(twice) as { message: string; detail: string; authorization: string };

  assert.equal(parsed.message, 'candidate review\n[REDACTED_PATH]"next\nnext line');
  assert.equal(parsed.detail, 'token=[REDACTED]"next');
  assert.equal(parsed.authorization, '[REDACTED]');
});

test('artifact directory emits parseable safe JSON and sanitizes text logs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-studio-sanitizer-'));
  try {
    const diagnosticsPath = path.join(root, 'frontend-diagnostics.json');
    const invalidPath = path.join(root, 'invalid.json');
    const logPath = path.join(root, 'rust-backend.log');
    fs.writeFileSync(diagnosticsPath, JSON.stringify({
      logs: [{ message: 'line one\nC:\\Users\\writer\\chapter.txt\nline three' }],
      errors: [],
      networkAttempts: { installed: true, total: 0 },
      token: 'private-token',
    }), 'utf8');
    fs.writeFileSync(invalidPath, '{"message":"truncated', 'utf8');
    fs.writeFileSync(logPath, 'API_KEY=sk-1234567890abcdef\nC:\\Users\\writer\\app.log', 'utf8');

    const issues = await sanitizeArtifactDirectory(root);

    const diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8')) as {
      logs: Array<{ message: string }>;
      token: string;
    };
    const invalid = JSON.parse(fs.readFileSync(invalidPath, 'utf8')) as { error: string };
    const log = fs.readFileSync(logPath, 'utf8');

    assert.equal(diagnostics.logs[0].message, 'line one\n[REDACTED_PATH]\nline three');
    assert.equal(diagnostics.token, '[REDACTED]');
    assert.equal(invalid.error, 'Invalid JSON artifact was omitted during sanitization.');
    assert.equal(log, 'API_KEY=[REDACTED]\n[REDACTED_PATH]');
    assert.deepEqual(issues, ['invalid.json: invalid JSON']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('plain text redaction does not cross real newline boundaries', () => {
  assert.equal(
    redactLogText('C:\\Users\\writer\\one.txt\nC:\\Users\\writer\\two.txt'),
    '[REDACTED_PATH]\n[REDACTED_PATH]',
  );
});
