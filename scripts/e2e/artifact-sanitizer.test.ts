import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertAdoptedContentHashes,
  redactLogText,
  sanitizeArtifactDirectory,
  sanitizeJsonText,
  sanitizeSecrets,
} from './artifact-sanitizer.ts';

test('adopted novel text remains byte-faithful while surrounding diagnostics are sanitized', () => {
  const adoptedContent = '线索写着 token: fictional-value。\n旧电脑路径是 C:\\archive\\case.txt。';
  const adoptedHash = createHash('sha256').update(adoptedContent, 'utf8').digest('hex');
  const sanitized = sanitizeJsonText(
    JSON.stringify({
      apiKey: 'sk-1234567890abcdef',
      chapters: [{ status: 'passed', adoptedContent, adoptedHash }],
    }),
  );
  const parsed = JSON.parse(sanitized) as {
    apiKey: string;
    chapters: Array<{ adoptedContent: string }>;
  };

  assert.equal(parsed.apiKey, '[REDACTED]');
  assert.equal(parsed.chapters[0]?.adoptedContent, adoptedContent);
  assert.doesNotThrow(() => assertAdoptedContentHashes(sanitized));
  assert.throws(
    () =>
      assertAdoptedContentHashes(
        JSON.stringify({
          chapters: [{ status: 'passed', adoptedContent: `${adoptedContent}改`, adoptedHash }],
        }),
      ),
    /changed during sanitization/,
  );
});

test('structured sanitization preserves multiline JSON while removing secrets and Windows paths', () => {
  const snapshotCompiledPromptSha256 = 'a'.repeat(64);
  const source = {
    logs: [
      {
        level: 'info',
        message:
          'first line\nfile C:\\Users\\writer\\draft.txt\nAuthorization: Bearer private-token',
      },
    ],
    apiKey: 'sk-1234567890abcdef',
    nested: {
      prompt: 'sensitive full prompt',
      snapshotCompiledPromptSha256,
      invalidSnapshotCompiledPromptSha256: 'not-a-hash',
      databasePath: 'C:\\Users\\writer\\AppData\\Local\\Temp\\e2e\\ai-novel-studio.db',
    },
  };

  const sanitized = sanitizeSecrets(source);
  const serialized = JSON.stringify(sanitized);
  const reparsed = JSON.parse(serialized) as typeof sanitized;

  assert.equal(reparsed.apiKey, '[REDACTED]');
  assert.equal(reparsed.nested.prompt, '[REDACTED]');
  assert.equal(reparsed.nested.snapshotCompiledPromptSha256, snapshotCompiledPromptSha256);
  assert.equal(reparsed.nested.invalidSnapshotCompiledPromptSha256, '[REDACTED]');
  assert.equal(reparsed.nested.databasePath, '[REDACTED_PATH]');
  assert.equal(
    reparsed.logs[0].message,
    'first line\nfile [REDACTED_PATH]\nAuthorization: [REDACTED]',
  );
  assert.doesNotMatch(serialized, /writer|private-token|sensitive full prompt|sk-123/i);
});

test('JSON text sanitization remains valid across repeated passes', () => {
  const source = JSON.stringify(
    {
      message: 'candidate review\nC:\\Users\\writer\\result.json"next\nnext line',
      detail: 'token=private-token"next',
      authorization: 'Bearer top-secret-token',
    },
    null,
    2,
  );

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
    fs.writeFileSync(
      diagnosticsPath,
      JSON.stringify({
        logs: [{ message: 'line one\nC:\\Users\\writer\\chapter.txt\nline three' }],
        errors: [],
        networkAttempts: { installed: true, total: 0 },
        token: 'private-token',
      }),
      'utf8',
    );
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

test('plain text redaction removes agt-prefixed credentials from WebDriver diagnostics', () => {
  const credential = `agt_${'A1_b'.repeat(8)}`;

  const sanitized = redactLogText(`webdriver value=${credential}`);

  assert.equal(sanitized, 'webdriver value=[REDACTED_KEY]');
  assert.doesNotMatch(sanitized, /agt_/i);
});

test('plain text redaction preserves model selector diagnostics', () => {
  assert.equal(
    redactLogText('data-testid=workbench-new-task-model-status'),
    'data-testid=workbench-new-task-model-status',
  );
});
