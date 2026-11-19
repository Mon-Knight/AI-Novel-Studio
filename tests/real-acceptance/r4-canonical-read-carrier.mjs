/**
 * Opt-in R4 Canonical-only read carrier.
 *
 * This is not the WebdriverIO production-app carrier and not a Writing SubAgent
 * run. Cloud execution starts the pinned DSH + novel-domain-gateway + isolated
 * SQLite chain through one ignored Rust test. Direct chat completions are not a
 * substitute. Nothing here reads a user database or prints a credential.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANONICAL_READ_TOOLS = Object.freeze([
  'novel.read',
  'structure.read',
  'context.read',
  'memory.search',
]);

export const MAX_UPSTREAM_REQUESTS = 6;

export const R4_LIMITS = Object.freeze({
  timeoutSeconds: Object.freeze({ default: 15, min: 10, max: 20 }),
  maxOutputTokens: Object.freeze({ default: 2048, min: 256, max: 4096 }),
  tokenBudget: Object.freeze({ default: 120_000, min: 4096, max: 200_000 }),
  rateWindowSeconds: 55,
  absoluteDeadlineSeconds: 150,
});

export const RUNTIME_MARKERS = Object.freeze([
  'packages/examples/jsonrpc-demo/lib/bin.js',
  'packages/sdk/protocol/lib/index.js',
  'packages/core/agent/lib/index.js',
  'packages/session/session-persistence-jsonl/lib/index.js',
]);

export const EVIDENCE_SCHEMA = 'r4-canonical-read-evidence-v1';

export const PINNED_SOURCE_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';

export const CLOUD_TEST_PATH = 'services::dsh::tests::canonical_read_turn_cloud_profile';

const DPAPI_ENTROPY = 'ai-novel-studio.session-model-credentials.v1';
const SECRET_ENV = /(?:api[_-]?key|secret|token|password|authorization|credential|_key$)/i;
const LOOPBACK_SECRET_ENV = /(?:api[_-]?key|secret|token|password|authorization|credential)/i;
const LEGACY_NOT_RUN =
  'cloud Provider profile is not executed by this harness (fail closed, no network).';
const HASH_64 = /^[0-9a-f]{64}$/u;
const SAFE_TOOL = /^[A-Za-z0-9_.:-]{1,96}$/u;

export function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function redact(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      output = output.split(secret).join('[redacted]');
    }
  }
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gu, 'Bearer [redacted]');
  output = output.replace(/\bsk-[A-Za-z0-9]{8,}\b/gu, '[redacted]');
  return output;
}

function isLoopbackHost(host) {
  const normalized = String(host ?? '')
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

export function classifyEndpoint(raw) {
  const value = String(raw ?? '');
  const trimmed = value.trim();
  if (!trimmed || value !== trimmed) return { kind: 'invalid' };
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.username || url.password || url.search || url.hash) return { kind: 'invalid' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'invalid' };
  if (isLoopbackHost(url.hostname)) return { kind: 'loopback' };
  const normalized = trimmed.replace(/\/+$/u, '');
  if (!normalized || normalized !== normalized.trim()) return { kind: 'invalid' };
  if (url.protocol === 'https:') return { kind: 'https', normalized };
  return { kind: 'http', normalized };
}

function optionalBound(env, name, bound, invalidReason, rangeReason) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') {
    return { ok: true, value: bound.default };
  }
  const text = String(raw).trim();
  if (!/^\d{1,9}$/u.test(text)) return { ok: false, reason: invalidReason };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < bound.min || value > bound.max) {
    return { ok: false, reason: rangeReason };
  }
  return { ok: true, value };
}

function readBudget(env) {
  const requested = env.DSH_E2E_MAX_REQUESTS;
  if (requested !== undefined && String(requested).trim() !== '') {
    if (String(requested).trim() !== String(MAX_UPSTREAM_REQUESTS)) {
      return { ok: false, locked: true, reason: 'request_budget_locked' };
    }
  }
  const timeout = optionalBound(
    env,
    'DSH_E2E_TIMEOUT_SECONDS',
    R4_LIMITS.timeoutSeconds,
    'timeout_invalid',
    'timeout_out_of_range',
  );
  if (!timeout.ok) return timeout;
  const maxOutputTokens = optionalBound(
    env,
    'DSH_E2E_MAX_OUTPUT_TOKENS',
    R4_LIMITS.maxOutputTokens,
    'max_output_tokens_invalid',
    'max_output_tokens_out_of_range',
  );
  if (!maxOutputTokens.ok) return maxOutputTokens;
  const tokenBudget = optionalBound(
    env,
    'DSH_E2E_TOKEN_BUDGET',
    R4_LIMITS.tokenBudget,
    'token_budget_invalid',
    'token_budget_out_of_range',
  );
  if (!tokenBudget.ok) return tokenBudget;
  return {
    ok: true,
    value: {
      maxRequests: MAX_UPSTREAM_REQUESTS,
      timeoutSeconds: timeout.value,
      maxOutputTokens: maxOutputTokens.value,
      tokenBudget: tokenBudget.value,
    },
  };
}

function readIdentity(env) {
  const provider = String(env.DSH_E2E_PROVIDER ?? '').trim();
  if (!provider) return { ok: false, reason: 'provider_missing' };
  if (provider !== 'deepseek-official' && provider !== 'openai_compatible') {
    return { ok: false, reason: 'provider_invalid' };
  }
  const modelRaw = env.DSH_E2E_MODEL;
  if (modelRaw === undefined || String(modelRaw).trim() === '') {
    return { ok: false, reason: 'model_missing' };
  }
  const model = String(modelRaw);
  if (model !== model.trim() || model.length > 200 || !/^[\w.:/+-]{1,200}$/u.test(model)) {
    return { ok: false, reason: 'model_invalid' };
  }
  return { ok: true, value: { provider, model } };
}

export function decide(env) {
  const baseUrl = String(env.DSH_E2E_BASE_URL ?? '').trim();
  const profile = String(env.DSH_E2E_CLOUD_PROFILE ?? '').trim() === '1';
  const force = String(env.DSH_E2E_FORCE_CLOUD ?? '').trim() === '1';
  const e2e = String(env.AI_NOVEL_STUDIO_E2E ?? '').trim() === '1';
  if (!baseUrl) {
    return { kind: 'not_run', reason: 'DSH_E2E_BASE_URL is not set' };
  }
  const endpoint = classifyEndpoint(baseUrl);
  if (endpoint.kind === 'loopback') {
    if (profile) {
      return { kind: 'fail_closed', exitCode: 2, reason: 'cloud_profile_rejects_loopback' };
    }
    return { kind: 'loopback' };
  }
  if (!profile) {
    return {
      kind: force ? 'fail_closed' : 'not_run',
      exitCode: force ? 2 : 0,
      reason: LEGACY_NOT_RUN,
    };
  }
  if (endpoint.kind === 'invalid') {
    return { kind: 'fail_closed', exitCode: 2, reason: 'endpoint_invalid' };
  }
  if (endpoint.kind !== 'https') {
    return { kind: 'fail_closed', exitCode: 2, reason: 'endpoint_not_https' };
  }
  if (e2e) return { kind: 'fail_closed', exitCode: 2, reason: 'e2e_network_block_active' };
  const identity = readIdentity(env);
  if (!identity.ok) return { kind: 'not_run', reason: identity.reason };
  const budget = readBudget(env);
  if (!budget.ok) {
    return {
      kind: budget.locked ? 'fail_closed' : 'not_run',
      exitCode: budget.locked ? 2 : 0,
      reason: budget.reason,
    };
  }
  return {
    kind: 'cloud',
    endpoint: endpoint.normalized,
    identity: identity.value,
    budget: budget.value,
  };
}

export function nativeCredentialPath(env) {
  const root = String(env.APPDATA ?? '').trim();
  if (!root) return '';
  return path.win32.join(root, 'com.ainovelstudio.app', 'session-model-credentials.dpapi');
}

function canonicalProviderId(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'deepseek' || normalized === 'deepseek-official') return 'deepseek-official';
  return normalized;
}

function credentialEndpoint(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/u, '');
}

export function validCredential(value) {
  const key = String(value ?? '').trim();
  return (
    key.length >= 8 &&
    key.length <= 16_384 &&
    key === String(value ?? '').trim() &&
    ![...key].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  );
}

export function selectVaultKey(vault, identity) {
  if (!vault || vault.version !== 1 || !Array.isArray(vault.credentials)) {
    return { ok: false, reason: 'credential_invalid' };
  }
  if (vault.credentials.length === 0 || vault.credentials.length > 256) {
    return { ok: false, reason: 'credential_invalid' };
  }
  const provider = canonicalProviderId(identity.provider);
  const endpoint = credentialEndpoint(identity.endpoint);
  const model = String(identity.model ?? '').trim();
  const matches = [];
  for (const record of vault.credentials) {
    if (!record || typeof record !== 'object') continue;
    if (String(record.scope ?? '').trim() !== 'provider') continue;
    if (canonicalProviderId(record.providerId) !== provider) continue;
    if (credentialEndpoint(record.baseUrl) !== endpoint) continue;
    if (String(record.modelId ?? '').trim() !== model) continue;
    const apiKey = String(record.apiKey ?? '').trim();
    if (!validCredential(apiKey)) continue;
    matches.push(apiKey);
  }
  if (matches.length > 1) return { ok: false, reason: 'credential_identity_ambiguous' };
  if (matches.length === 0) return { ok: false, reason: 'credential_identity_mismatch' };
  return { ok: true, apiKey: matches[0] };
}

function readNamedYamlValue(text, name) {
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(name)) return '';
  const match = new RegExp(`(?:^|\\n)\\s*${name}\\s*:\\s*(.+?)\\s*(?:\\n|$)`, 'u').exec(text);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/gu, '');
}

async function runDpapi(mode, filePath, plaintext, deps) {
  const directory = deps.mkdtemp();
  const scriptPath = path.join(directory, 'dpapi.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$mode = $env:ANS_R4_DPAPI_MODE
$path = $env:ANS_R4_VAULT_PATH
$entropy = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
try {
  if ($mode -eq 'unprotect') {
    $bytes = [IO.File]::ReadAllBytes($path)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
    [Console]::Out.Write([Convert]::ToBase64String($plain))
    exit 0
  }
  if ($mode -eq 'protect') {
    $encoded = [Console]::In.ReadToEnd().Trim()
    $plain = [Convert]::FromBase64String($encoded)
    $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, $scope)
    [IO.File]::WriteAllBytes($path, $protected)
    exit 0
  }
  throw 'bad mode'
} catch {
  [Console]::Error.WriteLine('DPAPI_FAILED')
  exit 2
}
`;
  deps.writeFile(scriptPath, script);
  try {
    const executable = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const result = deps.spawnSync(
      executable,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000,
        input: mode === 'protect' ? Buffer.from(plaintext).toString('base64') : undefined,
        env: {
          ...cleanProcessEnv(process.env),
          ANS_R4_DPAPI_MODE: mode,
          ANS_R4_VAULT_PATH: filePath,
        },
      },
    );
    if (result.status !== 0) return { ok: false, reason: 'credential_unavailable' };
    return { ok: true, stdout: String(result.stdout ?? '').trim() };
  } finally {
    deps.rm(directory);
  }
}

export async function protectDpapiFile(filePath, plaintext, deps = createDefaultDeps()) {
  const result = await runDpapi('protect', filePath, plaintext, deps);
  if (!result.ok) {
    throw new Error('DPAPI_FAILED');
  }
}

export async function unprotectDpapiFile(filePath, deps = createDefaultDeps()) {
  const result = await runDpapi('unprotect', filePath, '', deps);
  if (!result.ok || !result.stdout) return { ok: false, reason: 'credential_unavailable' };
  try {
    const json = Buffer.from(result.stdout, 'base64').toString('utf8');
    return { ok: true, vault: JSON.parse(json) };
  } catch {
    return { ok: false, reason: 'credential_invalid' };
  }
}

function cleanProcessEnv(parent) {
  const kept = {};
  for (const name of ['PATH', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'WINDIR']) {
    if (parent[name]) kept[name] = parent[name];
  }
  return kept;
}

async function resolveCredential(env, identity, endpoint, deps) {
  const explicit = String(env.DSH_E2E_API_KEY ?? '').trim();
  if (explicit) {
    if (!validCredential(explicit)) return { ok: false, reason: 'credential_invalid' };
    return { ok: true, apiKey: explicit, source: 'env' };
  }
  const file = String(env.DSH_E2E_CREDENTIAL_FILE ?? '').trim();
  if (file) {
    if (!deps.isFile(file)) return { ok: false, reason: 'credential_unavailable' };
    const size = deps.size(file);
    if (!Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 * 1024) {
      return { ok: false, reason: 'credential_invalid' };
    }
    const lower = file.toLowerCase();
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      const name = String(env.DSH_E2E_CREDENTIAL_NAME ?? 'DEEPSEEK_API_KEY').trim();
      const value = readNamedYamlValue(deps.readText(file), name || 'DEEPSEEK_API_KEY');
      if (!validCredential(value)) return { ok: false, reason: 'credential_invalid' };
      return { ok: true, apiKey: value, source: 'file' };
    }
    if (lower.endsWith('.dpapi')) {
      const opened = await deps.unprotectDpapiFile(file, deps);
      if (!opened.ok) return opened;
      const selected = selectVaultKey(opened.vault, { ...identity, endpoint });
      if (!selected.ok) return selected;
      return { ok: true, apiKey: selected.apiKey, source: 'file' };
    }
    return { ok: false, reason: 'credential_file_unsupported' };
  }
  if (String(env.USE_SAVED_CREDENTIAL ?? '').trim() !== '1') {
    return { ok: false, reason: 'credential_unavailable' };
  }
  const nativePath = nativeCredentialPath(env);
  if (!nativePath || !deps.isFile(nativePath)) {
    return { ok: false, reason: 'credential_unavailable' };
  }
  const opened = await deps.unprotectDpapiFile(nativePath, deps);
  if (!opened.ok) return { ok: false, reason: 'credential_unavailable' };
  const selected = selectVaultKey(opened.vault, { ...identity, endpoint });
  if (!selected.ok) return selected;
  return { ok: true, apiKey: selected.apiKey, source: 'native' };
}

function fileSha256(deps, file) {
  if (typeof deps.sha256File === 'function') return String(deps.sha256File(file)).toLowerCase();
  return createHash('sha256').update(deps.readText(file)).digest('hex');
}

export function inspectCarrier(env, deps = createDefaultDeps()) {
  const root = String(env.DSH_RUNTIME_ROOT ?? '').trim();
  if (!root || !deps.isDirectory(root)) return { ok: false, reason: 'runtime_root_missing' };
  for (const marker of RUNTIME_MARKERS) {
    if (!deps.isFile(path.join(root, marker))) {
      return { ok: false, reason: 'runtime_root_incomplete' };
    }
  }
  const gateway = String(env.DSH_GATEWAY_BIN ?? '').trim();
  if (!gateway || !deps.isFile(gateway)) return { ok: false, reason: 'gateway_missing' };
  const matrixPath = path.join(root, 'VERSION_MATRIX.json');
  const binPath = path.join(root, RUNTIME_MARKERS[0]);
  const carrierGateway = path.join(root, 'gateway', 'novel-domain-gateway.exe');
  if (!deps.isFile(matrixPath) || !deps.isFile(binPath) || !deps.isFile(carrierGateway)) {
    return { ok: false, reason: 'runtime_pin_missing' };
  }
  let matrix;
  try {
    matrix = JSON.parse(deps.readText(matrixPath));
  } catch {
    return { ok: false, reason: 'runtime_pin_invalid' };
  }
  if (matrix?.sourceCommit !== PINNED_SOURCE_COMMIT) {
    return { ok: false, reason: 'runtime_pin_mismatch' };
  }
  const recorded = String(matrix.runtimeBinSha256 ?? '').toLowerCase();
  if (!HASH_64.test(recorded)) return { ok: false, reason: 'runtime_bin_mismatch' };
  const recordedGateway = String(matrix.gatewaySha256 ?? '').toLowerCase();
  if (!HASH_64.test(recordedGateway)) return { ok: false, reason: 'gateway_hash_mismatch' };
  let binHash = '';
  let carrierHash = '';
  let explicitHash = '';
  try {
    binHash = fileSha256(deps, binPath);
    carrierHash = fileSha256(deps, carrierGateway);
    explicitHash = fileSha256(deps, gateway);
  } catch {
    return { ok: false, reason: 'runtime_bin_mismatch' };
  }
  if (!HASH_64.test(binHash) || binHash !== recorded) {
    return { ok: false, reason: 'runtime_bin_mismatch' };
  }
  if (
    !HASH_64.test(carrierHash) ||
    !HASH_64.test(explicitHash) ||
    carrierHash !== explicitHash ||
    carrierHash !== recordedGateway
  ) {
    return { ok: false, reason: 'gateway_hash_mismatch' };
  }
  return {
    ok: true,
    runtimeRoot: root,
    gatewayBin: gateway,
    sourceCommit: PINNED_SOURCE_COMMIT,
  };
}

function loopbackEnv(parent) {
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (LOOPBACK_SECRET_ENV.test(key)) delete env[key];
  }
  delete env.DSH_E2E_API_KEY;
  delete env.DSH_E2E_BASE_URL;
  return env;
}

function cloudChildEnv(parent, assignments) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value !== 'string') continue;
    if (SECRET_ENV.test(key)) continue;
    if (
      key === 'AI_NOVEL_STUDIO_E2E' ||
      key === 'AI_NOVEL_STUDIO_E2E_DATA_DIR' ||
      key === 'AI_NOVEL_STUDIO_E2E_RUN_ID' ||
      key === 'DSH_E2E_API_KEY' ||
      key === 'DSH_E2E_BASE_URL' ||
      key === 'DSH_E2E_MODEL' ||
      key === 'DSH_E2E_PROVIDER' ||
      key === 'APPDATA' ||
      key === 'LOCALAPPDATA' ||
      key === 'USE_SAVED_CREDENTIAL'
    ) {
      continue;
    }
    env[key] = value;
  }
  return { ...env, ...assignments };
}

export function buildCloudPlan({
  parentEnv,
  repoRoot,
  runtimeRoot,
  gatewayBin,
  endpoint,
  identity,
  budget,
  apiKey,
  evidencePath,
  isolatedAppData,
}) {
  const endpointHash = sha256Hex(endpoint);
  const env = cloudChildEnv(parentEnv, {
    ANS_R4_CLOUD_PROFILE: '1',
    ANS_R4_PROVIDER: identity.provider,
    ANS_R4_MODEL: identity.model,
    ANS_R4_BASE_URL: endpoint,
    ANS_R4_API_KEY: apiKey,
    ANS_R4_MAX_REQUESTS: String(MAX_UPSTREAM_REQUESTS),
    ANS_R4_TIMEOUT_SECONDS: String(budget.timeoutSeconds),
    ANS_R4_MAX_OUTPUT_TOKENS: String(budget.maxOutputTokens),
    ANS_R4_TOKEN_BUDGET: String(budget.tokenBudget),
    ANS_R4_EVIDENCE_PATH: evidencePath,
    ANS_R4_GATEWAY_BIN: gatewayBin,
    DSH_RUNTIME_ROOT: runtimeRoot,
    DSH_GATEWAY_BIN: gatewayBin,
    LOCALAPPDATA: isolatedAppData,
    APPDATA: isolatedAppData,
  });
  return {
    command: 'cargo',
    args: [
      'test',
      '--locked',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '-p',
      'ai-novel-studio',
      CLOUD_TEST_PATH,
      '--',
      '--ignored',
      '--exact',
      '--test-threads=1',
    ],
    cwd: repoRoot,
    env,
    evidencePath,
    secret: apiKey,
    frozen: {
      provider: identity.provider,
      model: identity.model,
      endpoint,
      endpointHash,
    },
  };
}

export function inspectPlan(plan) {
  return {
    command: plan.command,
    args: [...plan.args],
    cwd: plan.cwd,
    evidencePath: plan.evidencePath,
    provider: plan.frozen.provider,
    model: plan.frozen.model,
    endpointHash: plan.frozen.endpointHash,
    maxRequests: plan.env.ANS_R4_MAX_REQUESTS,
    timeoutSeconds: plan.env.ANS_R4_TIMEOUT_SECONDS,
    maxOutputTokens: plan.env.ANS_R4_MAX_OUTPUT_TOKENS,
    tokenBudget: plan.env.ANS_R4_TOKEN_BUDGET,
    runtimeRoot: plan.env.DSH_RUNTIME_ROOT,
    gatewayBin: plan.env.DSH_GATEWAY_BIN,
  };
}

export function createHardRequestGate(limit = MAX_UPSTREAM_REQUESTS) {
  if (limit !== MAX_UPSTREAM_REQUESTS) {
    throw new Error('request_budget_locked');
  }
  let used = 0;
  return {
    used() {
      return used;
    },
    async reserve(forward) {
      if (used >= limit) {
        return { status: 429, forwarded: false, code: 'UPSTREAM_BUDGET_EXCEEDED' };
      }
      used += 1;
      const result = await forward();
      return { status: result.status, forwarded: true, code: 'OK' };
    },
  };
}

function hashField(value) {
  return typeof value === 'string' && HASH_64.test(value);
}

export function evaluateEvidence(evidence, frozen) {
  const problems = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['evidence_invalid'];
  }
  if (evidence.schema !== EVIDENCE_SCHEMA || evidence.profile !== 'cloud') {
    problems.push('evidence_schema');
  }
  if (evidence.provider !== frozen.provider || evidence.model !== frozen.model) {
    problems.push('identity_mismatch');
  }
  if (evidence.endpointHash !== frozen.endpointHash || !hashField(evidence.endpointHash)) {
    problems.push('endpoint_mismatch');
  }
  if (evidence.sourceCommit !== PINNED_SOURCE_COMMIT) problems.push('source_commit_invalid');
  if (evidence.runStatus !== 'completed') problems.push('run_not_completed');
  if (evidence.errorCode !== null) problems.push('error_present');
  if (evidence.cancelled !== false) problems.push('cancelled');
  if (!Array.isArray(evidence.tools) || evidence.tools.length > 32) {
    problems.push('tool_list_unbounded');
  } else if (evidence.toolCount !== evidence.tools.length) {
    problems.push('tool_count_mismatch');
  } else {
    const names = [];
    for (const tool of evidence.tools) {
      if (
        !tool ||
        !SAFE_TOOL.test(String(tool.name ?? '')) ||
        !SAFE_TOOL.test(String(tool.status ?? ''))
      ) {
        problems.push('tool_name_invalid');
        break;
      }
      if (!CANONICAL_READ_TOOLS.includes(tool.name) || tool.status !== 'succeeded') {
        problems.push('tool_contract');
        break;
      }
      names.push(tool.name);
    }
    if (!problems.includes('tool_contract') && !problems.includes('tool_name_invalid')) {
      for (const required of CANONICAL_READ_TOOLS) {
        if (!names.includes(required)) problems.push('canonical_tool_missing');
      }
    }
  }
  if (
    !Number.isSafeInteger(evidence.upstreamRequests) ||
    evidence.upstreamRequests < 1 ||
    evidence.upstreamRequests > MAX_UPSTREAM_REQUESTS
  ) {
    problems.push('upstream_budget_exceeded');
  }
  if (
    !Number.isSafeInteger(evidence.upstreamReservations) ||
    evidence.upstreamReservations < evidence.upstreamRequests
  ) {
    problems.push('upstream_accounting');
  }
  for (const field of [
    'resultArtifactWrites',
    'artifactCards',
    'adoptedDraftWrites',
    'chapterDraftWrites',
    'chapterWordCount',
  ]) {
    if (evidence[field] !== 0) problems.push('formal_write');
  }
  for (const field of ['promptTokens', 'completionTokens', 'runtimeEventCount']) {
    if (!Number.isSafeInteger(evidence[field]) || evidence[field] < 0)
      problems.push('counter_invalid');
  }
  for (const field of [
    'goalHash',
    'novelIdHash',
    'chapterIdHash',
    'workerIdHash',
    'sessionIdHash',
    'argumentsHash',
    'resultHash',
  ]) {
    if (!hashField(evidence[field])) problems.push('hash_invalid');
  }
  if (
    !evidence.secrets ||
    evidence.secrets.apiKeyPersisted !== false ||
    evidence.secrets.apiKeyInEvidence !== false
  ) {
    problems.push('secret_persisted');
  }
  return [...new Set(problems)];
}

function summaryTokens(evidence) {
  const tools = Array.isArray(evidence?.tools)
    ? evidence.tools
        .map((tool) => (SAFE_TOOL.test(String(tool?.name ?? '')) ? tool.name : 'invalid'))
        .join(',')
    : '';
  const fields = [
    ['tools', tools],
    ['toolCount', evidence?.toolCount],
    ['upstreamRequests', evidence?.upstreamRequests],
    ['upstreamReservations', evidence?.upstreamReservations],
    ['runStatus', evidence?.runStatus],
    ['promptTokens', evidence?.promptTokens],
    ['completionTokens', evidence?.completionTokens],
    ['resultArtifactWrites', evidence?.resultArtifactWrites],
    ['artifactCards', evidence?.artifactCards],
    ['adoptedDraftWrites', evidence?.adoptedDraftWrites],
    ['chapterDraftWrites', evidence?.chapterDraftWrites],
    ['chapterWordCount', evidence?.chapterWordCount],
    ['endpointHash', evidence?.endpointHash],
    ['goalHash', evidence?.goalHash],
    ['novelIdHash', evidence?.novelIdHash],
    ['chapterIdHash', evidence?.chapterIdHash],
    ['argumentsHash', evidence?.argumentsHash],
    ['resultHash', evidence?.resultHash],
    ['workerIdHash', evidence?.workerIdHash],
    ['sessionIdHash', evidence?.sessionIdHash],
    ['cancelled', evidence?.cancelled],
  ];
  return fields
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

export function proveCargoExecution(output) {
  const text = String(output ?? '').replace(/\r/g, '');
  const executed = [
    ...text.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)(?:\s+\([\d.]+s\))?$/gm),
  ].filter((match) => match[2] !== 'ignored');
  const results = [...text.matchAll(/test result: (ok|FAILED)\. (\d+) passed; (\d+) failed;/g)];
  if (results.length === 0 || executed.length === 0) {
    return { ok: false, reason: 'cargo_zero_tests' };
  }
  if (executed.length !== 1 || executed[0][1] !== CLOUD_TEST_PATH || executed[0][2] !== 'ok') {
    return {
      ok: false,
      reason: executed.some((match) => match[1] === CLOUD_TEST_PATH)
        ? 'cargo_failed'
        : 'cargo_zero_tests',
    };
  }
  const passed = results.reduce((sum, match) => sum + Number(match[2]), 0);
  const failed = results.reduce((sum, match) => sum + Number(match[3]), 0);
  if (passed < 1 || failed !== 0) return { ok: false, reason: 'cargo_zero_tests' };
  return { ok: true, passed, failed };
}

export function interpretCloudResult({
  exitCode,
  evidenceText,
  evidenceHadSecret,
  cancelled,
  frozen,
  cargoOutput,
}) {
  if (evidenceHadSecret) {
    return { status: 'FAIL', exitCode: 2, line: 'FAIL: evidence_secret\n' };
  }
  const cargo = proveCargoExecution(cargoOutput);
  if (!cargo.ok && !cancelled) {
    return {
      status: 'FAIL',
      exitCode: exitCode && exitCode !== 0 ? exitCode : 2,
      line: `FAIL: ${cargo.reason}\n`,
    };
  }
  let evidence;
  if (evidenceText) {
    try {
      evidence = JSON.parse(evidenceText);
    } catch {
      evidence = undefined;
    }
  }
  if (cancelled) {
    const detail = evidence ? ` ${summaryTokens(evidence)}` : '';
    return { status: 'CANCELLED', exitCode: 3, line: `CANCELLED:${detail}\n` };
  }
  if (!evidence) {
    return {
      status: 'FAIL',
      exitCode: exitCode && exitCode !== 0 ? exitCode : 1,
      line: 'FAIL: evidence_missing\n',
    };
  }
  const problems = evaluateEvidence(evidence, frozen);
  if (exitCode === 0 && problems.length === 0 && cargo.ok) {
    return { status: 'PASS', exitCode: 0, line: `PASS ${summaryTokens(evidence)}\n` };
  }
  const reason = problems[0] ?? 'cargo_failed';
  const code = exitCode && exitCode !== 0 ? exitCode : 1;
  return {
    status: 'FAIL',
    exitCode: code,
    line: `FAIL: ${reason} ${summaryTokens(evidence)}\n`,
  };
}

export async function executeCloud(plan, deps, signal) {
  if (signal?.aborted) {
    return {
      exitCode: 3,
      stdout: '',
      stderr: '',
      evidenceText: '',
      evidenceHadSecret: false,
      cancelled: true,
    };
  }
  let child;
  try {
    child = deps.spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return {
      exitCode: 1,
      stdout: '',
      stderr: '',
      evidenceText: '',
      evidenceHadSecret: false,
      cancelled: false,
      spawnFailed: true,
    };
  }
  const stdout = [];
  const stderr = [];
  const collect = (bucket, chunk) => {
    bucket.push(Buffer.from(chunk));
    let size = bucket.reduce((sum, item) => sum + item.length, 0);
    while (size > 200_000 && bucket.length > 1) {
      size -= bucket.shift().length;
    }
  };
  child.stdout?.on('data', (chunk) => collect(stdout, chunk));
  child.stderr?.on('data', (chunk) => collect(stderr, chunk));
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    if (child.pid) deps.killTree(child.pid);
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const exitCode = await new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code === null ? 1 : code));
  });
  if (signal) signal.removeEventListener('abort', onAbort);
  const secret = plan.secret;
  const rawStdout = Buffer.concat(stdout).toString('utf8');
  const rawStderr = Buffer.concat(stderr).toString('utf8');
  const rawEvidence =
    plan.evidencePath && deps.exists(plan.evidencePath) ? deps.readText(plan.evidencePath) : '';
  const secretPresent = (value) =>
    typeof secret === 'string' && secret.length >= 8 && value.includes(secret);
  const evidenceHadSecret = secretPresent(rawEvidence);
  return {
    exitCode,
    stdout: redact(rawStdout, [secret]),
    stderr: redact(rawStderr, [secret]),
    evidenceText: evidenceHadSecret ? '' : redact(rawEvidence, [secret]),
    evidenceHadSecret,
    logHadSecret: secretPresent(rawStdout) || secretPresent(rawStderr),
    cancelled,
  };
}

function lines(kind, reason) {
  if (kind === 'not_run') return { exitCode: 0, stdout: `NOT_RUN: ${reason}\n`, stderr: '' };
  return { exitCode: 2, stdout: '', stderr: `FAIL: ${reason}\n` };
}

function runLoopback(env, deps) {
  const result = deps.spawnSync(
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
      cwd: deps.repoRoot,
      env: loopbackEnv(env),
      stdio: 'inherit',
    },
  );
  if (result.error) {
    return { exitCode: 1, stdout: '', stderr: `${redact(result.error.message, [])}\n` };
  }
  return {
    exitCode: result.status === null || result.status === undefined ? 1 : result.status,
    stdout: '',
    stderr: '',
  };
}

async function runCloud(env, decision, deps) {
  const carrier = inspectCarrier(env, deps);
  if (!carrier.ok) return lines('fail_closed', carrier.reason);
  const credential = await resolveCredential(env, decision.identity, decision.endpoint, deps);
  if (!credential.ok) return lines('not_run', credential.reason);
  const directory = deps.mkdtemp();
  const evidencePath = path.join(directory, 'evidence.json');
  const isolatedAppData = path.join(directory, 'app-data');
  deps.mkdir(isolatedAppData);
  try {
    const plan = buildCloudPlan({
      parentEnv: env,
      repoRoot: deps.repoRoot,
      runtimeRoot: carrier.runtimeRoot,
      gatewayBin: carrier.gatewayBin,
      endpoint: decision.endpoint,
      identity: decision.identity,
      budget: decision.budget,
      apiKey: credential.apiKey,
      evidencePath,
      isolatedAppData,
    });
    const execution = await executeCloud(plan, deps, deps.signal);
    if (execution.spawnFailed) return lines('fail_closed', 'spawn_failed');
    const cargoOutput = `${execution.stdout}\n${execution.stderr}`;
    if (execution.logHadSecret) return lines('fail_closed', 'log_secret');
    const interpreted = interpretCloudResult({
      exitCode: execution.exitCode,
      evidenceText: execution.evidenceText,
      evidenceHadSecret: execution.evidenceHadSecret,
      cancelled: execution.cancelled,
      frozen: plan.frozen,
      cargoOutput,
    });
    if (interpreted.status === 'PASS') {
      return { exitCode: 0, stdout: interpreted.line, stderr: '' };
    }
    return { exitCode: interpreted.exitCode, stdout: '', stderr: interpreted.line };
  } finally {
    deps.rm(directory);
  }
}

export function createDefaultDeps() {
  return {
    repoRoot: defaultRepoRoot(),
    spawn,
    spawnSync,
    killTree(pid) {
      return spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    },
    isFile(file) {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    },
    isDirectory(directory) {
      try {
        return fs.statSync(directory).isDirectory();
      } catch {
        return false;
      }
    },
    exists(file) {
      return fs.existsSync(file);
    },
    size(file) {
      try {
        return fs.statSync(file).size;
      } catch {
        return -1;
      }
    },
    readText(file) {
      return fs.readFileSync(file, 'utf8');
    },
    sha256File(file) {
      return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    },
    writeFile(file, data) {
      fs.writeFileSync(file, data);
    },
    mkdir(directory) {
      fs.mkdirSync(directory, { recursive: true });
    },
    rm(directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    },
    mkdtemp() {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'ans-r4-evidence-'));
    },
    unprotectDpapiFile,
    signal: undefined,
  };
}

export async function runAgentRuntimeReal(env, deps = createDefaultDeps()) {
  const decision = decide(env);
  if (decision.kind === 'not_run' || decision.kind === 'fail_closed') {
    return lines(decision.kind, decision.reason);
  }
  if (decision.kind === 'loopback') return runLoopback(env, deps);
  return runCloud(env, decision, deps);
}
