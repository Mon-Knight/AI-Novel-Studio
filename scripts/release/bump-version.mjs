import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const nextVersion = process.argv[2]?.trim();
if (!nextVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  throw new Error('Usage: npm run version:bump -- <semantic-version>');
}

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), 'utf8');
const write = (file, value) => writeFile(path.join(root, file), value, 'utf8');

const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const previousVersion = packageJson.version;
packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;
await write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
await write('package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`);

function replaceOnce(content, pattern, replacement, file) {
  if (!pattern.test(content)) throw new Error(`Version marker not found in ${file}.`);
  return content.replace(pattern, replacement);
}

let cargo = await read('src-tauri/Cargo.toml');
cargo = replaceOnce(
  cargo,
  /^version\s*=\s*"[^"]+"/m,
  `version = "${nextVersion}"`,
  'src-tauri/Cargo.toml',
);
await write('src-tauri/Cargo.toml', cargo);

let cargoLock = await read('src-tauri/Cargo.lock');
cargoLock = replaceOnce(
  cargoLock,
  /(\[\[package\]\]\s*\nname\s*=\s*"ai-novel-studio"\s*\nversion\s*=\s*)"[^"]+"/m,
  `$1"${nextVersion}"`,
  'src-tauri/Cargo.lock',
);
await write('src-tauri/Cargo.lock', cargoLock);

const tauri = JSON.parse(await read('src-tauri/tauri.conf.json'));
tauri.package.version = nextVersion;
await write('src-tauri/tauri.conf.json', `${JSON.stringify(tauri, null, 2)}\n`);

let versionSource = await read('src/constants/version.ts');
versionSource = replaceOnce(
  versionSource,
  /APP_VERSION\s*=\s*'v[^']+'/,
  `APP_VERSION = 'v${nextVersion}'`,
  'src/constants/version.ts',
);
await write('src/constants/version.ts', versionSource);

let readme = await read('README.md');
readme = replaceOnce(readme, /(\*\*当前版本：v)[^*]+(\*\*)/, `$1${nextVersion}$2`, 'README.md');
await write('README.md', readme);

let changelog = await read('CHANGELOG.md');
if (
  !new RegExp(`^##\\s+v${nextVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(
    changelog,
  )
) {
  const heading = `## v${nextVersion} (${new Date().toISOString().slice(0, 10)}) - 待发布\n\n### 变更\n\n- 待填写。\n\n### 验证\n\n- 待填写。\n\n`;
  changelog = changelog.replace(/^(# [^\n]+\n+)/, `$1\n${heading}`);
}
await write('CHANGELOG.md', changelog);

let roadmap = await read('docs/version-roadmap.md');
roadmap = replaceOnce(
  roadmap,
  /^(>\s*当前版本：v)[^\s（]+/m,
  `$1${nextVersion}`,
  'docs/version-roadmap.md',
);
await write('docs/version-roadmap.md', roadmap);

let testing = await read('docs/technical/testing.md');
testing = replaceOnce(
  testing,
  /^(>[^\n]*?v)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/m,
  `$1${nextVersion}`,
  'docs/technical/testing.md',
);
await write('docs/technical/testing.md', testing);

let docsIndex = await read('docs/README.md');
docsIndex = replaceOnce(
  docsIndex,
  /(\|\s*\[testing\.md\][^\n]*?v)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
  `$1${nextVersion}`,
  'docs/README.md',
);
await write('docs/README.md', docsIndex);

process.stdout.write(`Version files updated: ${previousVersion} -> ${nextVersion}\n`);
process.stdout.write(
  'Complete the CHANGELOG entry, then run npm run test:version-sync. Release notes are extracted from CHANGELOG during publishing.\n',
);
