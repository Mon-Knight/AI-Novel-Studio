import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW_MACRO_PATTERN = /\b(?:dbg|print|eprint|println|eprintln)!\s*\([^;]*\);?/gs;
const ALLOWED_SINK_PATTERN = /^eprintln!\(\s*"\{serialized\}"\s*\);?$/s;

function listRustFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.rs')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split(/\r?\n/u).length;
}

export function auditRustLogging(sourceRoot) {
  const root = path.resolve(sourceRoot);
  const violations = [];
  let sinkCount = 0;

  for (const file of listRustFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    for (const match of source.matchAll(RAW_MACRO_PATTERN)) {
      const macro = match[0].trim();
      if (relative === 'errors.rs' && ALLOWED_SINK_PATTERN.test(macro)) {
        sinkCount += 1;
        continue;
      }
      violations.push(
        `${relative}:${lineNumber(source, match.index ?? 0)} ${macro.split(/\r?\n/u)[0]}`,
      );
    }
  }

  if (sinkCount !== 1) {
    violations.push(
      `errors.rs must contain exactly one structured stderr sink; found ${sinkCount}`,
    );
  }
  return violations;
}

function main() {
  const sourceRoot = path.resolve(process.cwd(), 'src-tauri', 'src');
  const violations = auditRustLogging(sourceRoot);
  if (violations.length > 0) {
    console.error('Rust logging gate failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log('Rust logging gate passed: one structured sink, no raw print/debug macros.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
