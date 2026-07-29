import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function isProductionSource(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return (
    /\.(?:ts|tsx)$/u.test(normalized) &&
    !/\.d\.ts$/u.test(normalized) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(normalized) &&
    !normalized.startsWith('test/')
  );
}

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else if (isProductionSource(relative)) files.push({ absolute, relative });
  }
  return files;
}

function isAiClientExpression(expression) {
  if (ts.isIdentifier(expression)) return expression.text === 'client';
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'client';
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'createAiClient'
  );
}

function isMissingOptions(call) {
  if (call.arguments.length < 2) return true;
  const options = call.arguments[1];
  return (
    options.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(options) && options.text === 'undefined')
  );
}

export function inspectAiGenerateSource(source, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls = [];
  const violations = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'generate' &&
      isAiClientExpression(node.expression.expression)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const record = { file: fileName, line: position.line + 1, column: position.character + 1 };
      calls.push(record);
      if (isMissingOptions(node)) violations.push(record);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { calls, violations };
}

export function inspectProductionAiGenerateOptions(workspaceRoot = process.cwd()) {
  const sourceRoot = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(sourceRoot))
    throw new Error(`Production source directory is missing: ${sourceRoot}`);
  const files = walk(sourceRoot);
  const calls = [];
  const violations = [];
  for (const file of files) {
    const result = inspectAiGenerateSource(
      fs.readFileSync(file.absolute, 'utf8'),
      path.join('src', file.relative).replaceAll('\\', '/'),
    );
    calls.push(...result.calls);
    violations.push(...result.violations);
  }
  return { filesScanned: files.length, calls, violations };
}

function runCli() {
  const result = inspectProductionAiGenerateOptions(process.cwd());
  if (result.calls.length === 0) {
    throw new Error(
      'No production AI client generate calls were found; the governance scan failed closed.',
    );
  }
  if (result.violations.length > 0) {
    const details = result.violations
      .map((item) => `${item.file}:${item.line}:${item.column}`)
      .join('\n');
    throw new Error(
      `Production AI client calls must pass an explicit AiGenerateOptions argument:\n${details}`,
    );
  }
  process.stdout.write(
    `[ai-request-governance] PASS — ${result.calls.length} guarded client.generate calls across ${result.filesScanned} production TS/TSX files.\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) runCli();
