import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectWindowsReleaseArtifacts } from './release-artifacts.mjs';

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid release artifact argument near ${key ?? '<end>'}.`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function assertTargets(targets) {
  const includes = (target) =>
    targets === 'all' || (Array.isArray(targets) && targets.includes(target));
  if (!includes('msi') || !includes('nsis')) {
    throw new Error('Release bundles must include the msi and nsis targets.');
  }
}

export async function selectReleaseArtifactsFromConfig({
  bundleRoot,
  configPath = path.join('src-tauri', 'tauri.conf.json'),
  expectedVersion = null,
}) {
  if (!bundleRoot) throw new Error('Missing --bundle-root.');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.bundle?.active !== true) {
    throw new Error('Tauri bundling must be active to select release artifacts.');
  }
  assertTargets(config.bundle?.targets);
  if (config.bundle?.createUpdaterArtifacts !== 'v1Compatible') {
    throw new Error(
      'Release artifacts require bundle.createUpdaterArtifacts = "v1Compatible" for Tauri 1 updater clients.',
    );
  }
  if (typeof config.productName !== 'string' || !config.productName.trim()) {
    throw new Error('Tauri config is missing productName.');
  }
  if (typeof config.version !== 'string' || !config.version.trim()) {
    throw new Error('Tauri config is missing version.');
  }
  if (expectedVersion && config.version !== expectedVersion) {
    throw new Error(
      `Tauri config version ${config.version} does not match release version ${expectedVersion}.`,
    );
  }
  return selectWindowsReleaseArtifacts({
    bundleRoot,
    productName: config.productName,
    version: config.version,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = argumentsMap(process.argv.slice(2));
    const bundleRoot = values.get('bundle-root')?.trim();
    if (!bundleRoot) throw new Error('Missing --bundle-root.');
    const selection = await selectReleaseArtifactsFromConfig({
      bundleRoot,
      configPath: values.get('config')?.trim() || path.join('src-tauri', 'tauri.conf.json'),
      expectedVersion: values.get('version')?.trim() || null,
    });
    process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
