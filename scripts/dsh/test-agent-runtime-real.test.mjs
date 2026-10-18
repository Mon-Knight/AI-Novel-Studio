import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_READ_TOOLS,
  CLOUD_TEST_PATH,
  createDefaultDeps,
  decide,
  evaluateEvidence,
  inspectPlan,
  nativeCredentialPath,
  PINNED_SOURCE_COMMIT,
  proveCargoExecution,
  redact,
  runAgentRuntimeReal,
  selectVaultKey,
  sha256Hex,
} from '../../tests/real-acceptance/r4-canonical-read-carrier.mjs';

const BIN_HASH = 'a'.repeat(64);
const GATEWAY_HASH = 'b'.repeat(64);
const KEY = 'sk-test-key-not-real';
const ENDPOINT = 'https://api.example.test/v1';
const MODEL = 'frozen-model';
const PROVIDER = 'deepseek-official';
const SCRIPT = fileURLToPath(new URL('./test-agent-runtime-real.mjs', import.meta.url));
const PROXY = fileURLToPath(new URL('./model-proxy.mjs', import.meta.url));
const RUST_TESTS = fileURLToPath(
  new URL('../../src-tauri/src/services/dsh/tests.rs', import.meta.url),
);

function cloudEnv(extra = {}) {
  return {
    DSH_E2E_CLOUD_PROFILE: '1',
    DSH_E2E_BASE_URL: ENDPOINT,
    DSH_E2E_PROVIDER: PROVIDER,
    DSH_E2E_MODEL: MODEL,
    DSH_E2E_API_KEY: KEY,
    DSH_RUNTIME_ROOT: 'F:\\runtime-root',
    DSH_GATEWAY_BIN: 'F:\\gateway\\novel-domain-gateway.exe',
    APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local',
    DEEPSEEK_API_KEY: 'should-not-leak',
    ...extra,
  };
}

function cargoOk() {
  return [
    'running 1 test',
    `test ${CLOUD_TEST_PATH} ... ok`,
    'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out',
    '',
  ].join('\n');
}

function passingEvidence(overrides = {}) {
  return {
    schema: 'r4-canonical-read-evidence-v1',
    profile: 'cloud',
    provider: PROVIDER,
    model: MODEL,
    endpointHash: sha256Hex(ENDPOINT),
    sourceCommit: PINNED_SOURCE_COMMIT,
    runStatus: 'completed',
    errorCode: null,
    tools: CANONICAL_READ_TOOLS.map((name) => ({ name, status: 'succeeded' })),
    toolCount: 4,
    runtimeEventCount: 1,
    upstreamRequests: 4,
    upstreamReservations: 4,
    promptTokens: 11,
    completionTokens: 7,
    resultArtifactWrites: 0,
    artifactCards: 0,
    adoptedDraftWrites: 0,
    chapterDraftWrites: 0,
    chapterWordCount: 0,
    goalHash: sha256Hex('goal'),
    novelIdHash: sha256Hex('novel'),
    chapterIdHash: sha256Hex('chapter'),
    workerIdHash: sha256Hex('worker'),
    sessionIdHash: sha256Hex('session'),
    argumentsHash: sha256Hex('args'),
    resultHash: sha256Hex('result'),
    cancelled: false,
    secrets: { apiKeyPersisted: false, apiKeyInEvidence: false },
    ...overrides,
  };
}

function fakeChild({ exitCode = 0, stdout = '', stderr = '', hold = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  if (!hold) {
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', exitCode, null);
    });
  }
  return child;
}

function harness(extra = {}) {
  const spawned = [];
  const reads = [];
  const unprotected = [];
  let child = null;
  const deps = {
    ...createDefaultDeps(),
    repoRoot: path.resolve('repo'),
    isDirectory: () => true,
    isFile(file) {
      const value = String(file).replaceAll('/', '\\');
      if (extra.files?.has(value)) return true;
      return (
        value.endsWith('\\bin.js') ||
        value.endsWith('\\index.js') ||
        value.endsWith('\\VERSION_MATRIX.json') ||
        value.endsWith('novel-domain-gateway.exe')
      );
    },
    readText(file) {
      reads.push(file);
      if (String(file).replaceAll('/', '\\').endsWith('\\VERSION_MATRIX.json')) {
        if (extra.matrixText !== undefined) return extra.matrixText;
        return JSON.stringify({
          sourceCommit: extra.sourceCommit ?? PINNED_SOURCE_COMMIT,
          runtimeBinSha256: extra.recordedBinHash ?? BIN_HASH,
          gatewaySha256: extra.recordedGatewayHash ?? GATEWAY_HASH,
        });
      }
      if (extra.readText) return extra.readText(file);
      return fs.readFileSync(file, 'utf8');
    },
    sha256File(file) {
      if (extra.sha256File) return extra.sha256File(file);
      const value = String(file).replaceAll('/', '\\');
      if (value.endsWith('\\bin.js'))
        return extra.actualBinHash ?? extra.recordedBinHash ?? BIN_HASH;
      if (value.includes('\\runtime-root\\gateway\\')) {
        return extra.carrierGatewayHash ?? GATEWAY_HASH;
      }
      return extra.explicitGatewayHash ?? GATEWAY_HASH;
    },
    async unprotectDpapiFile(file) {
      unprotected.push(file);
      return extra.unprotect?.(file) ?? { ok: false, reason: 'credential_unavailable' };
    },
    spawn(command, args, options) {
      spawned.push({ command, args, env: options.env });
      child = extra.spawn
        ? extra.spawn(command, args, options)
        : fakeChild({ stdout: cargoOk(), exitCode: 0 });
      if (!extra.spawn) {
        const evidence = options.env.ANS_R4_EVIDENCE_PATH;
        fs.mkdirSync(path.dirname(evidence), { recursive: true });
        fs.writeFileSync(evidence, JSON.stringify(passingEvidence()));
      }
      return child;
    },
    killTree(pid) {
      extra.onKill?.(pid, child);
      return fakeChild({ exitCode: 0, stdout: '' });
    },
    signal: extra.signal,
  };
  return {
    deps,
    spawned,
    reads,
    unprotected,
    get child() {
      return child;
    },
  };
}

test('default and legacy cloud refusal stay non-executing', async () => {
  assert.deepEqual(decide({}), { kind: 'not_run', reason: 'DSH_E2E_BASE_URL is not set' });
  const missing = await runAgentRuntimeReal({});
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.stdout, 'NOT_RUN: DSH_E2E_BASE_URL is not set\n');

  const remote = await runAgentRuntimeReal({ DSH_E2E_BASE_URL: ENDPOINT });
  assert.equal(remote.exitCode, 0);
  assert.match(remote.stdout, /^NOT_RUN: cloud Provider profile is not executed/);

  const forced = await runAgentRuntimeReal({
    DSH_E2E_BASE_URL: ENDPOINT,
    DSH_E2E_FORCE_CLOUD: '1',
  });
  assert.equal(forced.exitCode, 2);
  assert.match(forced.stderr, /^FAIL: cloud Provider profile is not executed/);
});

test('cloud profile rejects loopback, http, userinfo, and the e2e network block', () => {
  assert.equal(
    decide({ DSH_E2E_CLOUD_PROFILE: '1', DSH_E2E_BASE_URL: 'http://127.0.0.1:9/v1' }).reason,
    'cloud_profile_rejects_loopback',
  );
  assert.equal(
    decide({ DSH_E2E_CLOUD_PROFILE: '1', DSH_E2E_BASE_URL: 'http://api.example.test/v1' }).reason,
    'endpoint_not_https',
  );
  assert.equal(
    decide({
      DSH_E2E_CLOUD_PROFILE: '1',
      DSH_E2E_BASE_URL: 'https://user:secret@api.example.test/v1',
    }).reason,
    'endpoint_invalid',
  );
  assert.equal(
    decide({
      ...cloudEnv(),
      AI_NOVEL_STUDIO_E2E: '1',
    }).reason,
    'e2e_network_block_active',
  );
});

test('identity and request budget are explicit and cannot be raised', () => {
  assert.equal(decide({ ...cloudEnv(), DSH_E2E_PROVIDER: 'deepseek' }).reason, 'provider_invalid');
  assert.equal(decide({ ...cloudEnv(), DSH_E2E_MODEL: '' }).reason, 'model_missing');
  assert.equal(
    decide({ ...cloudEnv(), DSH_E2E_MAX_REQUESTS: '7' }).reason,
    'request_budget_locked',
  );
  assert.equal(decide({ ...cloudEnv(), DSH_E2E_MAX_REQUESTS: '7' }).kind, 'fail_closed');
  assert.equal(
    decide({ ...cloudEnv(), DSH_E2E_TIMEOUT_SECONDS: '90' }).reason,
    'timeout_out_of_range',
  );
});

test('saved app credentials are not read unless USE_SAVED_CREDENTIAL=1', async () => {
  const native = nativeCredentialPath({ APPDATA: 'C:\\Users\\example\\AppData\\Roaming' });
  const blocked = harness({
    files: new Set([native]),
    unprotect: async () => {
      throw new Error('native vault was opened');
    },
  });
  const result = await runAgentRuntimeReal({ ...cloudEnv(), DSH_E2E_API_KEY: '' }, blocked.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'NOT_RUN: credential_unavailable\n');
  assert.equal(blocked.unprotected.length, 0);
  assert.equal(blocked.spawned.length, 0);

  const allowed = harness({
    files: new Set([native]),
    unprotect: async () => ({
      ok: true,
      vault: {
        version: 1,
        credentials: [
          {
            scope: 'provider',
            providerId: 'deepseek',
            baseUrl: `${ENDPOINT}/`,
            modelId: MODEL,
            apiKey: KEY,
          },
        ],
      },
    }),
  });
  const opened = await runAgentRuntimeReal(
    { ...cloudEnv(), DSH_E2E_API_KEY: '', USE_SAVED_CREDENTIAL: '1' },
    allowed.deps,
  );
  assert.equal(allowed.unprotected.length, 1);
  assert.equal(allowed.unprotected[0], native);
  assert.equal(opened.exitCode, 0);
  assert.match(opened.stdout, /^PASS /);
});

test('explicit env credential skips files and the cargo plan keeps the frozen identity', async () => {
  const state = harness();
  const result = await runAgentRuntimeReal(cloudEnv(), state.deps);
  assert.equal(state.unprotected.length, 0);
  assert.equal(
    state.reads.some((file) => /credential|dpapi|yaml|yml/iu.test(String(file))),
    false,
  );
  assert.equal(state.spawned.length, 1);
  const plan = state.spawned[0];
  assert.deepEqual(plan.args, [
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
  ]);
  assert.equal(plan.env.ANS_R4_MAX_REQUESTS, '6');
  assert.equal(plan.env.ANS_R4_PROVIDER, PROVIDER);
  assert.equal(plan.env.ANS_R4_MODEL, MODEL);
  assert.equal(plan.env.ANS_R4_BASE_URL, ENDPOINT);
  assert.equal(plan.env.ANS_R4_API_KEY, KEY);
  assert.equal(plan.env.DEEPSEEK_API_KEY, undefined);
  assert.notEqual(plan.env.APPDATA, cloudEnv().APPDATA);
  assert.equal(plan.env.PROXY_UPSTREAM_KEY, undefined);
  const visible = inspectPlan({
    command: plan.command,
    args: plan.args,
    cwd: state.deps.repoRoot,
    evidencePath: plan.env.ANS_R4_EVIDENCE_PATH,
    env: plan.env,
    frozen: {
      provider: PROVIDER,
      model: MODEL,
      endpoint: ENDPOINT,
      endpointHash: sha256Hex(ENDPOINT),
    },
  });
  assert.equal(JSON.stringify(visible).includes(KEY), false);
  assert.equal(JSON.stringify(visible).includes(ENDPOINT), false);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^PASS /);
  assert.equal(result.stdout.includes(KEY), false);
  assert.equal(result.stdout.includes(ENDPOINT), false);
  assert.match(result.stdout, /upstreamRequests=4/);
  assert.match(result.stdout, new RegExp(`endpointHash=${sha256Hex(ENDPOINT)}`));
});

test('a zero-test cargo exit cannot pass and a seventh send cannot pass', async () => {
  assert.equal(
    proveCargoExecution('running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored').ok,
    false,
  );
  const zero = harness({
    spawn(_command, _args, options) {
      const evidence = options.env.ANS_R4_EVIDENCE_PATH;
      fs.mkdirSync(path.dirname(evidence), { recursive: true });
      fs.writeFileSync(evidence, JSON.stringify(passingEvidence()));
      return fakeChild({
        exitCode: 0,
        stdout: 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored\n',
      });
    },
  });
  const zeroResult = await runAgentRuntimeReal(cloudEnv(), zero.deps);
  assert.equal(zeroResult.exitCode, 2);
  assert.match(zeroResult.stderr, /^FAIL: cargo_zero_tests/);
  assert.equal(zeroResult.stdout, '');

  const seventh = harness({
    spawn(_command, _args, options) {
      const evidence = options.env.ANS_R4_EVIDENCE_PATH;
      fs.mkdirSync(path.dirname(evidence), { recursive: true });
      fs.writeFileSync(
        evidence,
        JSON.stringify(passingEvidence({ upstreamRequests: 7, upstreamReservations: 7 })),
      );
      return fakeChild({ exitCode: 0, stdout: cargoOk() });
    },
  });
  const seventhResult = await runAgentRuntimeReal(cloudEnv(), seventh.deps);
  assert.match(seventhResult.stderr, /upstream_budget_exceeded/);
  assert.equal(seventh.spawned.length, 1);
});

test('reservation count below actual sends fails, and a secret log is not a pass', async () => {
  const under = evaluateEvidence(
    passingEvidence({ upstreamRequests: 4, upstreamReservations: 3 }),
    { provider: PROVIDER, model: MODEL, endpointHash: sha256Hex(ENDPOINT) },
  );
  assert.ok(under.includes('upstream_accounting'));

  const leaked = harness({
    spawn() {
      return fakeChild({ exitCode: 0, stdout: `${cargoOk()}\n${KEY}\n` });
    },
  });
  const result = await runAgentRuntimeReal(cloudEnv(), leaked.deps);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /^FAIL: log_secret/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(KEY), false);
});

test('cancel before spawn and during the run is not a pass', { timeout: 5_000 }, async () => {
  const early = new AbortController();
  early.abort();
  const before = harness({ signal: early.signal });
  const beforeResult = await runAgentRuntimeReal(cloudEnv(), before.deps);
  assert.equal(beforeResult.exitCode, 3);
  assert.match(beforeResult.stderr, /^CANCELLED:/);
  assert.equal(before.spawned.length, 0);

  const during = new AbortController();
  const running = harness({
    signal: during.signal,
    spawn() {
      const child = fakeChild({ hold: true });
      setTimeout(() => during.abort(), 10);
      return child;
    },
    onKill(_pid, child) {
      child?.emit('exit', 1, null);
    },
  });
  const duringResult = await runAgentRuntimeReal(cloudEnv(), running.deps);
  assert.equal(duringResult.exitCode, 3);
  assert.match(duringResult.stderr, /^CANCELLED:/);
  assert.equal(running.spawned.length, 1);
});

test('a failed model run is not retried through the mock canonical test', async () => {
  const failed = harness({
    spawn(_command, _args, options) {
      const evidence = options.env.ANS_R4_EVIDENCE_PATH;
      fs.mkdirSync(path.dirname(evidence), { recursive: true });
      fs.writeFileSync(
        evidence,
        JSON.stringify(passingEvidence({ runStatus: 'failed', errorCode: 'UPSTREAM_UNAVAILABLE' })),
      );
      return fakeChild({
        exitCode: 1,
        stdout: `test ${CLOUD_TEST_PATH} ... FAILED\ntest result: FAILED. 0 passed; 1 failed; 0 ignored\n`,
      });
    },
  });
  const result = await runAgentRuntimeReal(cloudEnv(), failed.deps);
  assert.equal(failed.spawned.length, 1);
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /canonical_read_turn /);
  assert.match(result.stderr, /^FAIL: /);
});

test('vault selection is exact and redaction covers the credential', () => {
  const identity = { provider: PROVIDER, endpoint: ENDPOINT, model: MODEL };
  const mismatch = selectVaultKey(
    {
      version: 1,
      credentials: [
        {
          scope: 'provider',
          providerId: 'deepseek-official',
          baseUrl: 'https://other.example.test/v1',
          modelId: MODEL,
          apiKey: KEY,
        },
      ],
    },
    identity,
  );
  assert.equal(mismatch.reason, 'credential_identity_mismatch');
  const wrongScope = selectVaultKey(
    {
      version: 1,
      credentials: [
        {
          scope: 'gateway',
          providerId: 'deepseek-official',
          baseUrl: ENDPOINT,
          modelId: MODEL,
          apiKey: KEY,
        },
        {
          scope: 'local_chapter_model',
          providerId: 'deepseek',
          baseUrl: `${ENDPOINT}/`,
          modelId: MODEL,
          apiKey: 'sk-chapter-account-key',
        },
      ],
    },
    identity,
  );
  assert.equal(wrongScope.reason, 'credential_identity_mismatch');
  const ambiguous = selectVaultKey(
    {
      version: 1,
      credentials: [
        {
          scope: 'provider',
          providerId: 'deepseek-official',
          baseUrl: ENDPOINT,
          modelId: MODEL,
          apiKey: KEY,
        },
        {
          scope: 'provider',
          providerId: 'deepseek',
          baseUrl: `${ENDPOINT}/`,
          modelId: MODEL,
          apiKey: 'sk-other-account-key',
        },
      ],
    },
    identity,
  );
  assert.equal(ambiguous.reason, 'credential_identity_ambiguous');
  assert.equal(ambiguous.apiKey, undefined);
  const selected = selectVaultKey(
    {
      version: 1,
      credentials: [
        {
          scope: 'local_chapter_model',
          providerId: PROVIDER,
          baseUrl: ENDPOINT,
          modelId: MODEL,
          apiKey: 'sk-chapter-account-key',
        },
        {
          scope: 'provider',
          providerId: 'deepseek',
          baseUrl: ENDPOINT,
          modelId: MODEL,
          apiKey: KEY,
        },
      ],
    },
    identity,
  );
  assert.equal(selected.apiKey, KEY);
  assert.equal(redact(`Bearer ${KEY} and ${KEY}`, [KEY]).includes(KEY), false);
});

test('carrier pin and binary hashes fail closed before credentials or spawn', async () => {
  const wrongPin = harness({ sourceCommit: 'a'.repeat(40) });
  const pinResult = await runAgentRuntimeReal(cloudEnv(), wrongPin.deps);
  assert.equal(pinResult.exitCode, 2);
  assert.match(pinResult.stderr, /^FAIL: runtime_pin_mismatch/);
  assert.equal(wrongPin.spawned.length, 0);
  assert.equal(wrongPin.unprotected.length, 0);

  const drifted = harness({ recordedBinHash: BIN_HASH, actualBinHash: 'c'.repeat(64) });
  const driftResult = await runAgentRuntimeReal(cloudEnv(), drifted.deps);
  assert.match(driftResult.stderr, /^FAIL: runtime_bin_mismatch/);
  assert.equal(drifted.spawned.length, 0);

  const gateway = harness({
    carrierGatewayHash: GATEWAY_HASH,
    explicitGatewayHash: 'd'.repeat(64),
  });
  const gatewayResult = await runAgentRuntimeReal(cloudEnv(), gateway.deps);
  assert.match(gatewayResult.stderr, /^FAIL: gateway_hash_mismatch/);
  assert.equal(gateway.spawned.length, 0);
  assert.equal(gateway.unprotected.length, 0);

  const staleRecordedGateway = harness({ recordedGatewayHash: 'e'.repeat(64) });
  const staleRecordedResult = await runAgentRuntimeReal(cloudEnv(), staleRecordedGateway.deps);
  assert.match(staleRecordedResult.stderr, /^FAIL: gateway_hash_mismatch/);
  assert.equal(staleRecordedGateway.spawned.length, 0);
  assert.equal(staleRecordedGateway.unprotected.length, 0);
});

test('evidence rejects a drifted commit and names that only look canonical', () => {
  const frozen = { provider: PROVIDER, model: MODEL, endpointHash: sha256Hex(ENDPOINT) };
  assert.ok(
    evaluateEvidence(passingEvidence({ sourceCommit: 'a'.repeat(40) }), frozen).includes(
      'source_commit_invalid',
    ),
  );
  const tools = CANONICAL_READ_TOOLS.map((name) => ({ name, status: 'succeeded' }));
  tools[0] = { name: 'evilnovel.read', status: 'succeeded' };
  assert.ok(evaluateEvidence(passingEvidence({ tools }), frozen).includes('tool_contract'));
  tools[0] = { name: 'novel_read', status: 'succeeded' };
  assert.ok(evaluateEvidence(passingEvidence({ tools }), frozen).includes('tool_contract'));
  tools[0] = { name: 'prefix.novel.read', status: 'succeeded' };
  assert.ok(evaluateEvidence(passingEvidence({ tools }), frozen).includes('tool_contract'));
});

test('loopback keeps the historical cargo filter and strips secrets', async () => {
  const calls = [];
  const deps = {
    ...createDefaultDeps(),
    spawnSync(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { status: 0 };
    },
  };
  const result = await runAgentRuntimeReal(
    {
      DSH_E2E_BASE_URL: 'http://127.0.0.1:9/v1',
      DSH_E2E_API_KEY: KEY,
      OPENAI_API_KEY: KEY,
    },
    deps,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes('canonical_read_turn'), true);
  assert.equal(calls[0].args.includes(CLOUD_TEST_PATH), false);
  assert.equal(calls[0].env.DSH_E2E_API_KEY, undefined);
  assert.equal(calls[0].env.OPENAI_API_KEY, undefined);
});

test('the rust source locks the ignored full-path test and the proxy send boundary', () => {
  const rust = fs.readFileSync(RUST_TESTS, 'utf8');
  const proxy = fs.readFileSync(PROXY, 'utf8');
  assert.match(
    rust,
    /#\[ignore = "R4 cloud canonical read; explicit ANS_R4_CLOUD_PROFILE=1 only"\]/,
  );
  assert.match(rust, /fn canonical_read_turn_cloud_profile\(\)/);
  assert.match(rust, /const R4_MAX_REQUESTS: i64 = 6;/);
  assert.match(rust, /const R4_RATE_WINDOW: Duration = Duration::from_secs\(55\);/);
  assert.match(rust, /const R4_ABSOLUTE_DEADLINE: Duration = Duration::from_secs\(150\);/);
  assert.match(rust, /max_requests_per_minute: R4_MAX_REQUESTS/);
  assert.match(rust, /task_kind: "read"/);
  assert.match(rust, /expected_tool: None/);
  assert.match(rust, /PROXY_UPSTREAM_REQUEST_BUDGET/);
  assert.match(rust, /PROXY_FROZEN_UPSTREAM/);
  assert.match(rust, /const R4_PINNED_COMMIT: &str = "47f943859bef60e4160492346772ded9b24f765a";/);
  assert.match(rust, /fn r4_verify_carrier/);
  assert.match(rust, /fn r4_exact_canonical_tool/);
  const exactStart = rust.indexOf('fn r4_exact_canonical_tool');
  const exactEnd = rust.indexOf('fn r4_public_tool_name');
  const exactBody = rust.slice(exactStart, exactEnd);
  assert.equal(exactBody.includes('ends_with'), false);
  assert.equal(exactBody.includes('contains'), false);
  assert.match(rust, /r4_verify_carrier\(&root, &gateway\);\s*let api_key = r4_api_key\(\);/);
  assert.match(rust, /source_commit: R4_PINNED_COMMIT\.to_string\(\)/);
  assert.match(proxy, /function claimUpstreamSend/);
  assert.match(proxy, /redirect: 'error'/);
  assert.match(proxy, /raw !== '6'/);
});

test('cli subprocesses do not execute cloud or read saved credentials by default', async () => {
  const clean = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  const unset = await runNode(SCRIPT, clean);
  assert.equal(unset.status, 0);
  assert.equal(unset.stdout, 'NOT_RUN: DSH_E2E_BASE_URL is not set\n');

  const forced = await runNode(SCRIPT, {
    ...clean,
    DSH_E2E_BASE_URL: ENDPOINT,
    DSH_E2E_FORCE_CLOUD: '1',
    DSH_E2E_API_KEY: KEY,
    USE_SAVED_CREDENTIAL: '1',
  });
  assert.equal(forced.status, 2);
  assert.match(forced.stderr, /^FAIL: cloud Provider profile is not executed/);
  assert.equal(`${forced.stdout}${forced.stderr}`.includes(KEY), false);

  const missingCarrier = await runNode(SCRIPT, {
    ...clean,
    DSH_E2E_CLOUD_PROFILE: '1',
    DSH_E2E_BASE_URL: ENDPOINT,
    DSH_E2E_PROVIDER: PROVIDER,
    DSH_E2E_MODEL: MODEL,
    DSH_E2E_API_KEY: KEY,
    DSH_RUNTIME_ROOT: 'F:\\missing-r4-runtime',
    DSH_GATEWAY_BIN: 'F:\\missing-r4-gateway.exe',
    USE_SAVED_CREDENTIAL: '1',
    APPDATA: process.env.APPDATA,
  });
  assert.equal(missingCarrier.status, 2);
  assert.match(missingCarrier.stderr, /^FAIL: runtime_root_missing/);
  assert.equal(`${missingCarrier.stdout}${missingCarrier.stderr}`.includes(KEY), false);
});

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('exit', (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6697, 10080,
]);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      if (FETCH_FORBIDDEN_PORTS.has(port)) {
        server.close(() => resolve(listen(server)));
        return;
      }
      resolve(port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function startProxy({ upstream, budgetFile, frozenUpstream, model = MODEL, budget = '6' }) {
  const child = spawn(process.execPath, [PROXY], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PROXY_PORT: '0',
      PROXY_UPSTREAM: frozenUpstream,
      PROXY_UPSTREAM_KEY: KEY,
      PROXY_MODEL: model,
      PROXY_UPSTREAM_REQUEST_BUDGET: budget,
      PROXY_UPSTREAM_BUDGET_FILE: budgetFile,
      PROXY_FROZEN_UPSTREAM: frozenUpstream,
      PROXY_FROZEN_MODEL: model,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  const deadline = Date.now() + 5_000;
  let match;
  while (Date.now() < deadline) {
    match = output.match(/\[model-proxy\] listening on 127\.0\.0\.1:(\d+)/);
    if (match || child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return {
    child,
    output: () => output,
    url: match ? `http://127.0.0.1:${match[1]}` : '',
    async stop() {
      if (child.exitCode === null) child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      await close(upstream);
    },
  };
}

async function post(url, model = MODEL) {
  const response = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

test(
  'proxy send boundary rejects the seventh request, redirects, and a changed model',
  { timeout: 20_000 },
  async () => {
    const hits = [];
    const redirected = [];
    const upstream = http.createServer((request, response) => {
      hits.push(new URL(request.url, 'http://127.0.0.1').pathname);
      request.resume();
      if (hits.length === 1) {
        response.writeHead(302, { location: 'http://127.0.0.1:9/stolen' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
    const steal = http.createServer((request, response) => {
      redirected.push(request.url);
      request.resume();
      response.end('stolen');
    });
    const upstreamPort = await listen(upstream);
    await listen(steal);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-r4-budget-'));
    const budgetFile = path.join(directory, 'sends.txt');
    const frozen = `http://127.0.0.1:${upstreamPort}/v1`;
    const proxy = await startProxy({ upstream, budgetFile, frozenUpstream: frozen });
    try {
      assert.ok(proxy.url, proxy.output());
      const first = await post(proxy.url);
      assert.notEqual(first.status, 200);
      assert.equal(redirected.length, 0);
      assert.equal(hits.length, 1);
      for (let index = 0; index < 5; index += 1) {
        const response = await post(proxy.url);
        assert.equal(response.status, 200);
      }
      assert.equal(hits.length, 6);
      assert.equal(fs.readFileSync(budgetFile, 'utf8').trim(), '6');
      const blocked = await post(proxy.url);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error.code, 'UPSTREAM_BUDGET_EXCEEDED');
      assert.equal(hits.length, 6);
      const wrongModel = await post(proxy.url, 'other-model');
      assert.equal(wrongModel.status, 409);
      assert.equal(hits.length, 6);
      assert.equal(proxy.output().includes(KEY), false);
    } finally {
      await proxy.stop();
      await close(steal);
      fs.rmSync(directory, { recursive: true, force: true });
    }

    const restartHits = [];
    const restartUpstream = http.createServer((request, response) => {
      restartHits.push(1);
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const restartPort = await listen(restartUpstream);
    const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-r4-budget-'));
    const restartFile = path.join(restartDir, 'sends.txt');
    fs.writeFileSync(restartFile, '6');
    const restarted = await startProxy({
      upstream: restartUpstream,
      budgetFile: restartFile,
      frozenUpstream: `http://127.0.0.1:${restartPort}/v1`,
    });
    try {
      const refused = await post(restarted.url);
      assert.equal(refused.status, 429);
      assert.equal(restartHits.length, 0);
      assert.equal(fs.readFileSync(restartFile, 'utf8').trim(), '6');
    } finally {
      await restarted.stop();
      fs.rmSync(restartDir, { recursive: true, force: true });
    }
  },
);
