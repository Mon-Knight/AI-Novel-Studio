#!/usr/bin/env node
/**
 * Opt-in Main Agent Runtime probe.
 *
 * Default CI / npm test / test:workbench never invoke this script and must not
 * require API keys. When DSH_E2E_BASE_URL is unset the process prints NOT_RUN
 * and exits 0 so CI stays green (no network).
 *
 * Loopback URL (127.0.0.1 / localhost): run the in-tree Rust filter
 * `canonical_read_turn` against the loopback mock DSH Canonical read-turn.
 * That cargo test starts its own mock; this harness does not send cloud
 * requests and does not print API keys.
 *
 * Non-loopback URL: cloud Provider profile is not executed here (fail closed,
 * no network). Exit 0 with NOT_RUN unless DSH_E2E_FORCE_CLOUD=1, then exit 2.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SECRET_ENV = /(?:api[_-]?key|secret|token|password|authorization|credential)/i;

const baseUrl = String(process.env.DSH_E2E_BASE_URL ?? '').trim();

if (!baseUrl) {
  console.log('NOT_RUN: DSH_E2E_BASE_URL is not set');
  process.exit(0);
}

function forceCloud() {
  return String(process.env.DSH_E2E_FORCE_CLOUD ?? '').trim() === '1';
}

function loopbackHost(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return host;
  const octets = host.split('.');
  const ipv4Loopback =
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127;
  return ipv4Loopback ? host : null;
}

function skipCloudProfile() {
  console.log(
    'NOT_RUN: cloud Provider profile is not executed by this harness (fail closed, no network).',
  );
  process.exit(0);
}

function rejectCloudProfile() {
  console.error(
    'FAIL: cloud Provider profile is not executed by this harness (fail closed, no network).',
  );
  process.exit(2);
}

if (!loopbackHost(baseUrl)) {
  if (forceCloud()) rejectCloudProfile();
  skipCloudProfile();
}

function cargoEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (SECRET_ENV.test(key)) delete env[key];
  }
  delete env.DSH_E2E_API_KEY;
  delete env.DSH_E2E_BASE_URL;
  return env;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(
  'cargo',
  [
    'test',
    '--locked',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    'canonical_read_turn',
    '--',
    '--test-threads=1',
  ],
  {
    cwd: repoRoot,
    env: cargoEnv(),
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
