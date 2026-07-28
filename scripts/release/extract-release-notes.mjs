import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const RELEASE_HEADING_PATTERN =
  /^##\s+v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b[^\r\n]*$/gmu;

export function extractReleaseNotes(changelog, version) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`Invalid semantic version: ${version}`);

  const headings = [...changelog.matchAll(RELEASE_HEADING_PATTERN)];
  const matches = headings.filter((heading) => heading.groups?.version === version);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one CHANGELOG section for v${version}, found ${matches.length}.`,
    );
  }

  const start = matches[0].index;
  const nextHeading = headings.find((heading) => (heading.index ?? 0) > start);
  const end = nextHeading?.index ?? changelog.length;
  const section = changelog.slice(start, end).trim();
  if (!section || !/^##\s+v/u.test(section)) {
    throw new Error(`CHANGELOG section for v${version} is empty.`);
  }
  return `${section}\n`;
}

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid release-note argument near ${key ?? '<end>'}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

async function main() {
  const values = argumentsMap(process.argv.slice(2));
  const version = values.get('version')?.trim();
  const input = values.get('input')?.trim() || 'CHANGELOG.md';
  const output = values.get('output')?.trim();
  if (!version) throw new Error('Missing --version.');
  if (!output) throw new Error('Missing --output.');

  const notes = extractReleaseNotes(await readFile(path.resolve(input), 'utf8'), version);
  const outputPath = path.resolve(output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, notes, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
