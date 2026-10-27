import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decideDesktopFileAccess, declaredLifecycleSidecarScope } from './scopedDesktopFs.ts';

const config = JSON.parse(
  readFileSync(new URL('../../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const sidecarSource = readFileSync(
  new URL('../ai/runtime/modelLifecycleSidecar.ts', import.meta.url),
  'utf8',
);
const sidecarName = sidecarSource.match(
  /export const LOCAL_MODEL_LIFECYCLE_SIDECAR_NAME = '([^']+)';/u,
)?.[1];

function directives(policy) {
  assert.equal(typeof policy, 'string');
  assert.notEqual(policy.trim(), '');
  assert.notEqual(policy, 'null');
  const map = new Map();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(' ').filter(Boolean);
    const name = tokens.shift();
    assert.equal(typeof name, 'string');
    assert.equal(map.has(name), false, name);
    map.set(name, tokens);
  }
  return map;
}

function isBroadScope(entry) {
  const value = String(entry).replaceAll('\\', '/');
  if (value.includes('**') || value.endsWith('/*') || /[*?[\]{}]/u.test(value)) return true;
  return [
    '$HOME',
    '$DOCUMENT',
    '$DOWNLOAD',
    '$DESKTOP',
    '$TEMP',
    '$APP',
    '$APPDATA',
    '$APPLOCALDATA',
    '$APPCONFIG',
    '$RESOURCE',
  ].some((root) => value === root || value === `${root}/`);
}

test('production FS scope is the declared sidecar file, not a home-wide glob', () => {
  assert.equal(typeof sidecarName, 'string');
  const scope = config.tauri.allowlist.fs.scope;
  const expected = declaredLifecycleSidecarScope(sidecarName);
  assert.deepEqual(scope.allow, [expected]);
  assert.deepEqual(scope.deny, []);
  assert.equal(scope.requireLiteralLeadingDot, true);
  assert.equal(scope.allow.some(isBroadScope), false);
  assert.equal(config.tauri.allowlist.fs.all, false);
  assert.equal(config.tauri.allowlist.fs.readFile, true);
  assert.equal(config.tauri.allowlist.fs.writeFile, true);
  for (const key of [
    'readDir',
    'copyFile',
    'createDir',
    'removeDir',
    'removeFile',
    'renameFile',
    'exists',
  ]) {
    assert.notEqual(config.tauri.allowlist.fs[key], true, key);
  }
  assert.equal(config.tauri.allowlist.dialog.all, true);
  assert.equal(config.tauri.allowlist.shell.open, true);
});

test('production and development CSP differ, and a non-null CSP is not an XSS proof', () => {
  // Tauri 1.8.3 selects security.csp when the custom-protocol feature is compiled.
  // This crate enables that feature by default, so devCsp is the non-custom-protocol
  // policy only. devPath remains an external Vite URL; this test does not launch a WebView
  // and therefore does not observe the injected header, script hashes, or any exploit.
  const security = config.tauri.security;
  const production = directives(security.csp);
  const development = directives(security.devCsp);
  assert.notEqual(security.csp, security.devCsp);
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src']);
  assert.equal(security.dangerousDisableAssetCspModification.includes('script-src'), false);
  assert.deepEqual(production.get('script-src'), ["'self'"]);
  assert.equal(security.csp.includes('unsafe-eval'), false);
  assert.equal(production.get('script-src').includes("'unsafe-inline'"), false);
  assert.deepEqual(production.get('style-src'), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(production.get('style-src-attr'), ["'unsafe-inline'"]);
  assert.deepEqual(production.get('object-src'), ["'none'"]);
  assert.deepEqual(production.get('base-uri'), ["'self'"]);
  assert.deepEqual(production.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(production.get('connect-src'), [
    "'self'",
    'ipc:',
    'http://ipc.localhost',
    'https://ipc.localhost',
    'https:',
    'http:',
    'ws:',
    'wss:',
  ]);
  assert.ok(production.get('img-src').includes('asset:'));
  assert.ok(production.get('img-src').includes('https://asset.localhost'));
  assert.ok(production.get('img-src').includes('blob:'));
  assert.equal(development.get('script-src').includes("'unsafe-inline'"), true);
  assert.equal(development.get('script-src').includes("'unsafe-eval'"), true);
  assert.ok(development.get('connect-src').includes('ws://localhost:1420'));
  assert.equal(config.build.devPath, 'http://localhost:1420');
  assert.equal(config.build.withGlobalTauri, false);
  assert.equal(security.csp == null, false);
  assert.equal(production.get('connect-src').includes('https:'), true);
  assert.equal(production.get('style-src').includes("'unsafe-inline'"), true);
});

test('updater and dialog-selected fixture behavior stay available offline', () => {
  assert.deepEqual(config.tauri.updater, {
    active: true,
    dialog: false,
    endpoints: [
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-stable/latest.json',
    ],
    pubkey: 'UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI',
    windows: { installMode: 'passive', installerArgs: [] },
  });
  const fixture = 'C:\\Users\\Writer\\reference.txt';
  for (const mode of ['production', 'development']) {
    assert.equal(
      decideDesktopFileAccess({
        mode,
        kind: 'dialog-read',
        candidate: 'C:\\Users\\Writer\\secrets.txt',
        dialogGrant: fixture,
      }).allowed,
      false,
    );
    assert.deepEqual(
      decideDesktopFileAccess({
        mode,
        kind: 'dialog-read',
        candidate: fixture,
        dialogGrant: fixture,
      }),
      { allowed: true, path: fixture },
    );
  }
});
