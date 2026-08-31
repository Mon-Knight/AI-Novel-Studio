import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(api[_-]?key|authorization|token|password|secret|cookie|prompt)/i;
const VERBATIM_CONTENT_KEYS = new Set(['adoptedContent']);
const SAFE_HASH_EVIDENCE_KEYS = new Set(['snapshotCompiledPromptSha256']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SANITIZATION_ERROR = 'Invalid JSON artifact was omitted during sanitization.';

export function redactLogText(value: string): string {
  return value
    .replace(
      /("(?:api[_-]?key|authorization|token|password|secret|cookie|prompt)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
    .replace(/\bagt_[A-Za-z0-9_-]{16,}/gi, '[REDACTED_KEY]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:api[_-]?key|token|password|secret|cookie|prompt)\s*[:=]\s*)[^\s,"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, '[REDACTED_PATH]');
}

export function sanitizeSecrets<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') {
      return typeof item === 'string' ? redactLogText(item) : item;
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [
        key,
        SAFE_HASH_EVIDENCE_KEYS.has(key) && typeof child === 'string' && SHA256_PATTERN.test(child)
          ? child
          : SENSITIVE_KEY.test(key)
            ? '[REDACTED]'
            : VERBATIM_CONTENT_KEYS.has(key) && typeof child === 'string'
              ? child
              : visit(child),
      ]),
    );
  };
  return visit(value) as T;
}

export function sanitizeJsonText(value: string): string {
  return JSON.stringify(sanitizeSecrets(JSON.parse(value) as unknown), null, 2);
}

export function assertAdoptedContentHashes(value: string | Uint8Array): void {
  const parsed = JSON.parse(
    typeof value === 'string' ? value : Buffer.from(value).toString('utf8'),
  ) as { chapters?: unknown };
  if (!Array.isArray(parsed.chapters)) return;
  parsed.chapters.forEach((chapter, index) => {
    if (!chapter || typeof chapter !== 'object') return;
    const record = chapter as Record<string, unknown>;
    if (record.status !== 'passed') return;
    if (typeof record.adoptedContent !== 'string' || typeof record.adoptedHash !== 'string') {
      throw new Error(`Chapter ${index + 1} adopted-content evidence is incomplete.`);
    }
    const actualHash = createHash('sha256').update(record.adoptedContent, 'utf8').digest('hex');
    if (actualHash !== record.adoptedHash) {
      throw new Error(`Chapter ${index + 1} adopted-content evidence changed during sanitization.`);
    }
  });
}

export async function sanitizeArtifactDirectory(root: string): Promise<string[]> {
  const issues: string[] = [];
  await sanitizeDirectory(root, root, issues);
  return issues;
}

async function sanitizeDirectory(root: string, current: string, issues: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(current, { withFileTypes: true });
  } catch (error) {
    issues.push(
      `${relativeArtifactPath(root, current)}: could not be listed (${safeErrorName(error)})`,
    );
    return;
  }

  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await sanitizeDirectory(root, target, issues);
      continue;
    }
    if (!entry.isFile() || !/\.(json|html|log|txt)$/i.test(entry.name)) continue;

    let contents: string;
    try {
      contents = await fs.promises.readFile(target, 'utf8');
    } catch (error) {
      issues.push(
        `${relativeArtifactPath(root, target)}: could not be read (${safeErrorName(error)})`,
      );
      continue;
    }

    let sanitized: string;
    if (path.extname(entry.name).toLowerCase() === '.json') {
      try {
        sanitized = sanitizeJsonText(contents);
      } catch {
        sanitized = JSON.stringify({ error: SANITIZATION_ERROR }, null, 2);
        issues.push(`${relativeArtifactPath(root, target)}: invalid JSON`);
      }
    } else {
      sanitized = redactLogText(contents);
    }

    try {
      await fs.promises.writeFile(target, sanitized, 'utf8');
    } catch (error) {
      issues.push(
        `${relativeArtifactPath(root, target)}: could not be rewritten (${safeErrorName(error)})`,
      );
    }
  }
}

function relativeArtifactPath(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/') || '.';
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
