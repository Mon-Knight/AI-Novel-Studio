import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const E2E_BUILD_STAMP_FILENAME = '.ans-e2e-build-stamp.json';

export const E2E_BUILD_INPUT_PATHS = [
  'src',
  'src-tauri',
  'scripts/dsh',
  'public',
  'contracts',
  'prompts',
  'index.html',
  'legacy-storage-migration.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'rust-toolchain.toml',
] as const;

const CARRIER_RESOURCE_PATHS = [
  'src-tauri/bin/unpack-payload.mjs',
  'src-tauri/bin/dsh-runtime.zip',
] as const;

const TEST_ONLY_PATH =
  /(?:\.(?:test|spec)\.(?:[cm]?js|ts|tsx)|(?:^|\/)(?:tests|[^/]+_tests)\.rs)$/u;

export interface E2eBuildStamp {
  inputFingerprint: string;
  appPath: string;
  binarySha256: string;
  size: number;
}

type GitRunner = (args: string[]) => string;

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function computeE2eBuildInputFingerprint(
  workspaceRoot: string,
  gitRunner?: GitRunner,
): string | null {
  const runGit: GitRunner =
    gitRunner ??
    ((args) =>
      execFileSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      }));

  try {
    const head = runGit(['rev-parse', 'HEAD']).trim();
    if (!head) return null;

    const changedRaw = runGit([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      'HEAD',
      '--',
      ...E2E_BUILD_INPUT_PATHS,
    ]);
    const untrackedRaw = runGit([
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...E2E_BUILD_INPUT_PATHS,
    ]);

    const dirtyPaths = [
      ...new Set(
        [...changedRaw.split('\0'), ...untrackedRaw.split('\0')]
          .map((entry) => entry.replaceAll('\\', '/'))
          .filter((entry) => entry && !TEST_ONLY_PATH.test(entry)),
      ),
    ].sort();

    const hash = createHash('sha256');
    hash.update(`head:${head}\n`);
    for (const relativePath of dirtyPaths) {
      const fullPath = path.join(workspaceRoot, relativePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        hash.update(`file:${relativePath}:${sha256File(fullPath)}\n`);
      } else {
        hash.update(`absent:${relativePath}\n`);
      }
    }
    for (const carrierPath of CARRIER_RESOURCE_PATHS) {
      const fullPath = path.join(workspaceRoot, carrierPath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        hash.update(`carrier:${carrierPath}:${sha256File(fullPath)}\n`);
      } else {
        hash.update(`carrier-absent:${carrierPath}\n`);
      }
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function canReuseE2eBuild({
  stampPath,
  appPath,
  inputFingerprint,
}: {
  stampPath: string;
  appPath: string;
  inputFingerprint: string | null;
}): boolean {
  if (!inputFingerprint || !fs.existsSync(stampPath) || !fs.existsSync(appPath)) {
    return false;
  }
  try {
    const stat = fs.statSync(appPath);
    if (!stat.isFile() || stat.size === 0) return false;
    const raw = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as Partial<E2eBuildStamp>;
    if (
      raw.inputFingerprint !== inputFingerprint ||
      typeof raw.appPath !== 'string' ||
      path.resolve(raw.appPath) !== path.resolve(appPath) ||
      typeof raw.size !== 'number' ||
      raw.size !== stat.size ||
      typeof raw.binarySha256 !== 'string'
    ) {
      return false;
    }
    return sha256File(appPath) === raw.binarySha256;
  } catch {
    return false;
  }
}

export function writeE2eBuildStamp({
  stampPath,
  appPath,
  inputFingerprint,
}: {
  stampPath: string;
  appPath: string;
  inputFingerprint: string;
}): E2eBuildStamp {
  const stat = fs.statSync(appPath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Cannot stamp missing or empty E2E binary: ${appPath}`);
  }
  const stamp: E2eBuildStamp = {
    inputFingerprint,
    appPath: path.resolve(appPath),
    binarySha256: sha256File(appPath),
    size: stat.size,
  };
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n', 'utf8');
  return stamp;
}
