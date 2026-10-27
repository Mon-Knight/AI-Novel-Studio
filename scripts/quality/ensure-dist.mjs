#!/usr/bin/env node
/**
 * Makes sure `dist/index.html` exists before Rust compiles.
 *
 * `tauri::generate_context!` panics at compile time when the configured `distDir`
 * is missing, so `cargo check` / `cargo test` on a fresh checkout (the CI native lane
 * runs on its own machine) needs a frontend build first. When a build already exists
 * — for example because the frontend lane just produced it in the same invocation —
 * this is a no-op, so the `all` lane never builds twice.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { npmCommand } from './verification-process.mjs';

export function ensureDist(root = process.cwd(), run = spawnSync, command = npmCommand) {
  const marker = path.join(root, 'dist', 'index.html');
  if (existsSync(marker)) return { built: false, marker };
  // Node 22+ on Windows refuses to spawn `npm.cmd` without a shell (EINVAL); run the npm
  // CLI through the current node binary exactly like the selector does.
  const { executable, args } = command('build');
  const result = run(executable, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`frontend build failed while preparing dist/ (exit ${String(result.status)})`);
  }
  if (!existsSync(marker)) {
    throw new Error('frontend build finished but dist/index.html is still missing');
  }
  return { built: true, marker };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { built } = ensureDist();
    process.stdout.write(
      `${built ? '[ensure-dist] built dist/ for Rust compilation' : '[ensure-dist] dist/ already present'}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[ensure-dist] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
