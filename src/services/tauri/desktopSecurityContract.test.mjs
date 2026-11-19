import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { decideDesktopFileAccess, declaredLifecycleSidecarScope } from './scopedDesktopFs.ts';

const TAURI_ROOT = new URL('../../../src-tauri/', import.meta.url);
const config = JSON.parse(readFileSync(new URL('tauri.conf.json', TAURI_ROOT), 'utf8'));
const capabilitiesDirectory = new URL('capabilities/', TAURI_ROOT);
const capabilityFiles = readdirSync(capabilitiesDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort();
const capabilities = new Map(
  capabilityFiles.map((file) => [
    file,
    JSON.parse(readFileSync(new URL(file, capabilitiesDirectory), 'utf8')),
  ]),
);
const sidecarSource = readFileSync(
  new URL('../ai/runtime/modelLifecycleSidecar.ts', import.meta.url),
  'utf8',
);
const legacyStorageSource = readFileSync(
  new URL('src/legacy_local_storage.rs', TAURI_ROOT),
  'utf8',
);
const cargoManifest = readFileSync(new URL('Cargo.toml', TAURI_ROOT), 'utf8');
const sidecarName = sidecarSource.match(
  /export const LOCAL_MODEL_LIFECYCLE_SIDECAR_NAME = '([^']+)';/u,
)?.[1];

const FS_PERMISSIONS = [
  'fs:allow-read-file',
  'fs:allow-read-text-file',
  'fs:allow-write-file',
  'fs:allow-write-text-file',
  'fs:scope',
];
const CORE_WINDOW_PERMISSIONS = [
  'core:window:allow-close',
  'core:window:allow-maximize',
  'core:window:allow-minimize',
  'core:window:allow-start-dragging',
  'core:window:allow-toggle-maximize',
  'core:window:allow-unmaximize',
];
const DIALOG_PERMISSIONS = [
  'dialog:allow-ask',
  'dialog:allow-confirm',
  'dialog:allow-message',
  'dialog:allow-open',
  'dialog:allow-save',
];
// Tauri 2's notification default grants channels, listeners and batch APIs that did not exist
// in the v1 allowlist. These three commands are the v1 notification API surface.
const NOTIFICATION_PERMISSIONS = [
  'notification:allow-is-permission-granted',
  'notification:allow-notify',
  'notification:allow-request-permission',
];

function capability(file) {
  const value = capabilities.get(file);
  assert.ok(value, `capability ${file} must exist`);
  return value;
}

function permissionIds(entry) {
  return entry.permissions.map((permission) =>
    typeof permission === 'string' ? permission : permission.identifier,
  );
}

function scopedEntries(entry) {
  return entry.permissions.filter(
    (permission) => typeof permission === 'object' && permission?.identifier === 'fs:scope',
  );
}

function directives(policy) {
  assert.equal(typeof policy, 'string');
  assert.notEqual(policy.trim(), '');
  assert.notEqual(policy, 'null');
  const map = new Map();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens.shift();
    assert.equal(typeof name, 'string');
    assert.equal(map.has(name), false, `duplicate CSP directive: ${name}`);
    assert.equal(new Set(tokens).size, tokens.length, `duplicate source in CSP directive: ${name}`);
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

test('production FS scope is the declared sidecar file, not a v2 default app scope', () => {
  assert.equal(typeof sidecarName, 'string');
  const migrated = capability('migrated.json');
  assert.equal(migrated.identifier, 'migrated');
  assert.equal(migrated.local, true);
  assert.deepEqual(migrated.windows, ['main']);

  const ids = permissionIds(migrated);
  assert.equal(new Set(ids).size, ids.length, 'duplicate capability permission');

  const scopes = scopedEntries(migrated);
  assert.equal(scopes.length, 1, 'exactly one fs:scope capability');
  assert.deepEqual(scopes[0].allow, [declaredLifecycleSidecarScope(sidecarName)]);
  assert.deepEqual(scopes[0].deny ?? [], []);
  assert.equal((scopes[0].allow ?? []).some(isBroadScope), false);
  assert.deepEqual(
    [...ids].filter((id) => id.startsWith('fs:')).sort(),
    [...FS_PERMISSIONS].sort(),
  );

  // fs:default (Tauri 2) adds read-app-specific-dirs-recursive and create-app-specific-dirs,
  // widening the v1 scope from the single sidecar file to app config/data directories.
  assert.equal(ids.includes('fs:default'), false);
  for (const command of [
    'read-dir',
    'copy-file',
    'create-dir',
    'remove-dir',
    'remove-file',
    'rename-file',
    'exists',
    'mkdir',
    'stat',
    'open',
    'write',
  ]) {
    assert.equal(ids.includes(`fs:allow-${command}`), false, command);
  }
});

test('shell, dialog and notification permissions match the v1 least-privilege surface', () => {
  const ids = permissionIds(capability('migrated.json'));

  // shell:default is exactly shell:allow-open in plugin-shell 2.5.0; the open URL regex comes
  // from plugin-shell config, not from the default set, so the duplicate grant is unnecessary.
  assert.equal(ids.includes('shell:default'), false);
  assert.deepEqual(
    ids.filter((id) => id.startsWith('shell:')),
    ['shell:allow-open'],
  );
  for (const command of ['execute', 'spawn', 'kill', 'stdin-write']) {
    assert.equal(ids.includes(`shell:allow-${command}`), false, command);
  }

  // v1 dialog.all exposed open, save, message, ask and confirm. dialog:default only covers
  // message/save/open; ask and confirm stay explicit to mirror the v1 surface (they alias the
  // message command in plugin-dialog 2.8.3).
  assert.deepEqual(
    [...ids].filter((id) => id.startsWith('dialog:')).sort(),
    [...DIALOG_PERMISSIONS].sort(),
  );
  assert.equal(ids.includes('dialog:default'), false);

  assert.deepEqual(
    [...ids].filter((id) => id.startsWith('notification:')).sort(),
    [...NOTIFICATION_PERMISSIONS].sort(),
  );
  assert.equal(ids.includes('notification:default'), false);
});

test('IPC, event and core window permissions are explicit and sufficient', () => {
  const ids = permissionIds(capability('migrated.json'));

  // Tauri 2 core:default expands to the app/event/image/menu/path/resources/tray/webview/window
  // default sets, covering Tauri IPC, event listen/emit, path homeDir/join and window getters.
  // toggle-maximize is a v2-only command used by FrameBar through toggleMaximize().
  assert.equal(ids.includes('core:default'), true);
  assert.deepEqual(
    [...ids].filter((id) => id.startsWith('core:window:')).sort(),
    [...CORE_WINDOW_PERMISSIONS].sort(),
  );
  assert.equal(ids.includes('core:window:default'), false);

  assert.deepEqual(
    [...ids].sort(),
    [
      'core:default',
      ...FS_PERMISSIONS,
      ...CORE_WINDOW_PERMISSIONS,
      'shell:allow-open',
      ...DIALOG_PERMISSIONS,
      ...NOTIFICATION_PERMISSIONS,
    ].sort(),
  );
});

test('updater capability stays isolated in desktop.json', () => {
  assert.deepEqual(capabilityFiles, ['desktop.json', 'migrated.json']);
  const desktop = capability('desktop.json');
  assert.equal(desktop.identifier, 'desktop-capability');
  assert.deepEqual(desktop.platforms, ['macOS', 'windows', 'linux']);
  assert.deepEqual(desktop.windows, ['main']);
  // Updating is deliberately kept behind the version/channel-rechecking Rust commands;
  // the frontend does not receive direct plugin-updater IPC access.
  assert.deepEqual(desktop.permissions, []);
  assert.equal(permissionIds(capability('migrated.json')).includes('updater:default'), false);

  for (const [file, entry] of capabilities) {
    assert.notEqual(entry.local, false, `${file} must not be a remote capability`);
    assert.equal('remote' in entry, false, file);
  }
});

test('production and development CSP differ, and a non-null CSP is not an XSS proof', () => {
  // Tauri 2 selects the production CSP for the custom protocol and devCsp only for devUrl.
  // This test parses the configured policy; it does not launch a WebView and therefore does not
  // observe the injected header, script hashes or any exploit.
  const security = config.app.security;
  assert.equal(config.tauri, undefined);
  assert.notEqual(security.csp, security.devCsp);
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src']);
  assert.equal(security.dangerousDisableAssetCspModification.includes('script-src'), false);

  const production = directives(security.csp);
  const development = directives(security.devCsp);
  assert.deepEqual(production.get('script-src'), ["'self'"]);
  assert.equal(security.csp.includes('unsafe-eval'), false);
  assert.equal(production.get('script-src').includes("'unsafe-inline'"), false);
  assert.deepEqual(production.get('style-src'), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(production.get('style-src-attr'), ["'unsafe-inline'"]);
  assert.deepEqual(production.get('object-src'), ["'none'"]);
  assert.deepEqual(production.get('base-uri'), ["'self'"]);
  assert.deepEqual(production.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(
    [...production.get('connect-src')].sort(),
    [
      "'self'",
      'ipc:',
      'http://ipc.localhost',
      'https://ipc.localhost',
      'https:',
      'http:',
      'ws:',
      'wss:',
    ].sort(),
  );
  assert.deepEqual(
    [...production.get('img-src')].sort(),
    [
      "'self'",
      'data:',
      'blob:',
      'asset:',
      'http://asset.localhost',
      'https://asset.localhost',
    ].sort(),
  );
  assert.equal(development.get('script-src').includes("'unsafe-inline'"), true);
  assert.equal(development.get('script-src').includes("'unsafe-eval'"), true);
  assert.ok(development.get('connect-src').includes('ws://localhost:1420'));
  assert.equal(security.csp == null, false);
  assert.equal(production.get('connect-src').includes('https:'), true);
  assert.equal(production.get('style-src').includes("'unsafe-inline'"), true);
});

test('legacy LocalStorage migration is pinned to the hidden HTTP origin while production stays HTTPS', () => {
  assert.equal(config.app.windows[0].useHttpsScheme, true);
  assert.match(
    legacyStorageSource,
    /const LEGACY_STORAGE_ORIGIN: &str = "http:\/\/tauri\.localhost";/u,
  );
  assert.match(legacyStorageSource, /\.use_https_scheme\(false\)/u);
  assert.match(legacyStorageSource, /input\.origin != LEGACY_STORAGE_ORIGIN/u);
  assert.match(legacyStorageSource, /ensure_window_label\(&window, "main"\)/u);
  // The HTTP-only page receives only the staging/probe commands and never a
  // plugin/default capability, while the HTTPS shell performs the final merge.
  assert.equal(permissionIds(capability('migrated.json')).includes('fs:default'), false);
  assert.equal(permissionIds(capability('migrated.json')).includes('updater:default'), false);
});

test('signed-update acceptance code stays behind a non-default Cargo feature', () => {
  assert.match(cargoManifest, /^default = \["custom-protocol"\]$/mu);
  assert.match(cargoManifest, /^update-e2e = \[\]$/mu);
  assert.equal(cargoManifest.includes('update-e2e", "custom-protocol"'), false);
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  assert.equal(config.plugins.updater.pubkey, 'UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI');
});

test('useHttpsScheme, frontend URLs, updater config and updater artifacts stay in place', () => {
  assert.equal(config.app.windows.length, 1);
  assert.equal(config.app.windows[0].useHttpsScheme, true);
  assert.equal(config.app.withGlobalTauri, false);
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.build.devUrl, 'http://localhost:1420');
  assert.equal(config.bundle.targets, 'all');
  assert.equal(config.bundle.createUpdaterArtifacts, 'v1Compatible');

  const updater = config.plugins?.updater;
  assert.deepEqual(updater, {
    endpoints: [
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-stable/latest.json',
    ],
    pubkey: 'UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI',
    requireSignedVersion: true,
    windows: { installMode: 'passive', installerArgs: [] },
  });
  assert.equal('active' in updater, false);
  assert.equal('dialog' in updater, false);
});

test('dialog-selected fixture behavior stays available offline', () => {
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
