import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(api[_-]?key|authorization|token|password|secret|cookie|prompt)/i;
const SANITIZATION_ERROR = 'Invalid JSON artifact was omitted during sanitization.';

export function redactLogText(value: string): string {
  return value
    .replace(
      /("(?:api[_-]?key|authorization|token|password|secret|cookie|prompt)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
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
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : visit(child),
      ]),
    );
  };
  return visit(value) as T;
}

export function sanitizeJsonText(value: string): string {
  return JSON.stringify(sanitizeSecrets(JSON.parse(value) as unknown), null, 2);
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
