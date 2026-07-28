import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PRODUCTION_TSX_LINES = 500;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceRoot = path.join(repositoryRoot, 'src');

function isProductionTsx(filePath) {
  const relative = path.relative(sourceRoot, filePath);
  const segments = relative.split(path.sep);
  return (
    filePath.endsWith('.tsx') &&
    !filePath.endsWith('.test.tsx') &&
    !segments.includes('test') &&
    !segments.includes('__tests__')
  );
}

function countLines(content) {
  if (!content) return 0;
  const lines = content.split(/\r\n|\r|\n/u);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(target)));
    else if (entry.isFile() && isProductionTsx(target)) files.push(target);
  }
  return files;
}

const files = await collectFiles(sourceRoot);
const measured = await Promise.all(
  files.map(async (filePath) => ({
    filePath,
    lines: countLines(await readFile(filePath, 'utf8')),
  })),
);
const violations = measured
  .filter(({ lines }) => lines > MAX_PRODUCTION_TSX_LINES)
  .sort((left, right) => right.lines - left.lines);

if (violations.length > 0) {
  console.error(`Production TSX files must stay at or below ${MAX_PRODUCTION_TSX_LINES} lines:`);
  for (const violation of violations) {
    console.error(`- ${path.relative(repositoryRoot, violation.filePath)}: ${violation.lines}`);
  }
  process.exitCode = 1;
} else {
  const largest = measured.sort((left, right) => right.lines - left.lines)[0];
  console.log(
    `Component size gate passed for ${measured.length} production TSX files; ` +
      `largest is ${path.relative(repositoryRoot, largest.filePath)} (${largest.lines} lines).`,
  );
}
