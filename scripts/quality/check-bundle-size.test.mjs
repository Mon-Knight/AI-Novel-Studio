import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BUNDLE_LIMITS, BundleSizeError, inspectBundle } from './check-bundle-size.mjs';

const ENTRY_FILE = 'assets/index-testhash.js';
const VENDOR_FILES = {
  'vendor-react': 'assets/vendor-react-testhash.js',
  'vendor-router': 'assets/vendor-router-testhash.js',
  'vendor-zustand': 'assets/vendor-zustand-testhash.js',
  'vendor-tauri': 'assets/vendor-tauri-testhash.js',
};

async function createFixture(t) {
  const distDirectory = await mkdtemp(path.join(os.tmpdir(), 'bundle-size-gate-'));
  t.after(() => rm(distDirectory, { force: true, recursive: true }));
  await mkdir(path.join(distDirectory, '.vite'), { recursive: true });
  await mkdir(path.join(distDirectory, 'assets'), { recursive: true });

  const manifest = {
    'index.html': {
      file: ENTRY_FILE,
      isEntry: true,
      name: 'index',
      src: 'index.html',
    },
  };
  await writeFile(path.join(distDirectory, ...ENTRY_FILE.split('/')), 'console.log("entry");\n');

  for (const [name, file] of Object.entries(VENDOR_FILES)) {
    manifest[`_${name}.js`] = { file, name };
    await writeFile(path.join(distDirectory, ...file.split('/')), `/* ${name} */\n`);
  }

  const writeManifest = async () => {
    await writeFile(
      path.join(distDirectory, '.vite', 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  };
  await writeManifest();

  return { distDirectory, manifest, writeManifest };
}

test('measures the single manifest entry and all emitted JavaScript', async (t) => {
  const fixture = await createFixture(t);
  const result = await inspectBundle({ distDir: fixture.distDirectory });

  assert.equal(result.entry.file, ENTRY_FILE);
  assert.equal(result.chunks.length, 5);
  assert.deepEqual(result.vendorChunks, VENDOR_FILES);
  assert.ok(result.entry.bytes > 0);
  assert.ok(result.entry.gzipBytes > 0);
});

test('fails closed when the Vite manifest is missing', async (t) => {
  const distDirectory = await mkdtemp(path.join(os.tmpdir(), 'bundle-size-no-manifest-'));
  t.after(() => rm(distDirectory, { force: true, recursive: true }));

  await assert.rejects(
    inspectBundle({ distDir: distDirectory }),
    (error) =>
      error instanceof BundleSizeError && error.message.includes('Vite manifest is missing'),
  );
});

test('fails closed when manifest entry ownership is ambiguous', async (t) => {
  const fixture = await createFixture(t);
  fixture.manifest['secondary.html'] = {
    file: 'assets/secondary-testhash.js',
    isEntry: true,
    name: 'secondary',
    src: 'secondary.html',
  };
  await writeFile(
    path.join(fixture.distDirectory, 'assets', 'secondary-testhash.js'),
    'console.log("secondary");\n',
  );
  await fixture.writeManifest();

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory }),
    /Expected exactly one JavaScript entry.*found 2/,
  );
});

test('fails closed for unsafe manifest paths', async (t) => {
  const fixture = await createFixture(t);
  fixture.manifest['index.html'].file = '../outside.js';
  await fixture.writeManifest();

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory }),
    /must reference a normalized assets\/ path/,
  );
});

test('fails closed when emitted JavaScript is absent from the manifest', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    path.join(fixture.distDirectory, 'assets', 'unexpected.js'),
    'console.log("unexpected");\n',
  );

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory }),
    /not represented by manifest: assets\/unexpected\.js/,
  );
});

test('fails closed when production JavaScript contains an E2E probe marker', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    path.join(fixture.distDirectory, ...ENTRY_FILE.split('/')),
    'globalThis.runDomainFacadeSqliteSmoke = () => undefined;\n',
  );

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory }),
    /contains forbidden E2E marker: runDomainFacadeSqliteSmoke/,
  );
});

test('enforces the entry raw-byte threshold using file contents', async (t) => {
  const fixture = await createFixture(t);
  const strictLimits = {
    ...BUNDLE_LIMITS,
    entryBytes: 1,
  };

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory, limits: strictLimits }),
    /above the .* entry raw limit/,
  );
});

test('enforces the entry gzip threshold using a real gzip-9 result', async (t) => {
  const fixture = await createFixture(t);
  const strictLimits = {
    ...BUNDLE_LIMITS,
    entryGzipBytes: 1,
  };

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory, limits: strictLimits }),
    /above the .* entry gzip-9 limit/,
  );
});

test('enforces the raw-byte threshold for a non-entry chunk', async (t) => {
  const fixture = await createFixture(t);
  const routerFile = path.join(fixture.distDirectory, ...VENDOR_FILES['vendor-router'].split('/'));
  await writeFile(routerFile, 'x'.repeat(256));
  const strictLimits = {
    ...BUNDLE_LIMITS,
    chunkBytes: 128,
  };

  await assert.rejects(
    inspectBundle({ distDir: fixture.distDirectory, limits: strictLimits }),
    /Chunk assets\/vendor-router-testhash\.js.*per-chunk raw limit/,
  );
});
