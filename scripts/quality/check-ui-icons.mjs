import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const characterIconPattern = /[✕✖✓✔★☆➕▲▼●○◉×]/u;
const emojiPattern = /\p{Extended_Pictographic}/u;
const legacySymbolPattern = /[\u2300-\u23ff\u25a0-\u27ff\u2800-\u28ff\u2b00-\u2bff]/u;
const handwrittenSvgPattern = /<\/?(?:svg|path|use|symbol)(?:\s|>)/iu;
const forbiddenIconLibraryPattern =
  /^(?:react-icons(?:\/|$)|@heroicons\/|@fortawesome\/|@mui\/icons-material|@ant-design\/icons|@iconify\/|phosphor-react|feather-icons|iconoir-react|material-icons)/u;
const iconContextPattern = /(?:^|[-_])(icon|glyph|symbol|spinner)(?:$|[-_])/iu;

function productionPathSegments(filePath, root) {
  return path.relative(root, filePath).split(path.sep);
}

function isExcludedProductionPath(filePath, root) {
  const segments = productionPathSegments(filePath, root);
  return (
    filePath.endsWith('.d.ts') ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(filePath) ||
    segments.includes('test') ||
    segments.includes('__tests__')
  );
}

export function isProductionTsx(filePath, root = sourceRoot) {
  return filePath.endsWith('.tsx') && !isExcludedProductionPath(filePath, root);
}

export function isProductionUiSource(filePath, root = sourceRoot) {
  return sourceExtensions.has(path.extname(filePath)) && !isExcludedProductionPath(filePath, root);
}

async function collectFiles(directory, predicate, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(target, predicate, root)));
    else if (entry.isFile() && predicate(target, root)) files.push(target);
  }
  return files;
}

function decodeNumericEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hexadecimal) =>
      String.fromCodePoint(Number.parseInt(hexadecimal, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(times|check|star|rarr|larr|uarr|darr);/giu, (entity) => {
      const entities = {
        '&times;': '×',
        '&check;': '✓',
        '&star;': '★',
        '&rarr;': '→',
        '&larr;': '←',
        '&uarr;': '↑',
        '&darr;': '↓',
      };
      return entities[entity.toLocaleLowerCase()] ?? entity;
    });
}

function visibleSymbolKinds(value) {
  const decoded = decodeNumericEntities(value);
  const hasEmoji = emojiPattern.test(decoded);
  const hasCharacterIcon = characterIconPattern.test(decoded);
  const kinds = [];
  if (hasEmoji) kinds.push('emoji');
  if (hasCharacterIcon) kinds.push('character-icon');
  if (!hasEmoji && !hasCharacterIcon && legacySymbolPattern.test(decoded)) {
    kinds.push('symbol-icon');
  }
  return kinds;
}

function isStandaloneGlyph(value) {
  const normalized = decodeNumericEntities(value).replace(/\s+/gu, '');
  if (!normalized || Array.from(normalized).length > 4) return false;
  return /^[\p{Extended_Pictographic}\p{S}\p{P}]+$/u.test(normalized) || /^[xX]$/u.test(normalized);
}

function jsxAttribute(node, sourceFile, name) {
  return node.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name,
  );
}

function jsxAttributeValue(attribute, sourceFile) {
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return '';
  return attribute.initializer.getText(sourceFile).replace(/^[{'"]+|[}'"]+$/gu, '');
}

function jsxTagName(node, sourceFile) {
  return node.tagName.getText(sourceFile);
}

function nodeLine(node, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function iconNamedContext(node, sourceFile) {
  let current = node.parent;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) {
      const name = current.name?.getText(sourceFile) ?? '';
      if (iconContextPattern.test(name)) return true;
    }
    if (ts.isJsxAttribute(current)) {
      const name = current.name.getText(sourceFile);
      if (iconContextPattern.test(name)) return true;
    }
  }
  return false;
}

function isInsideInteractiveElement(node, sourceFile) {
  let current = node.parent;
  while (current && current !== sourceFile) {
    if (ts.isJsxElement(current)) {
      if (['button', 'a'].includes(jsxTagName(current.openingElement, sourceFile))) return true;
    } else if (ts.isJsxSelfClosingElement(current)) {
      if (['button', 'a'].includes(jsxTagName(current, sourceFile))) return true;
    }
    current = current.parent;
  }
  return false;
}

function glyphOnlyUiSlotText(node, sourceFile) {
  const opening = node.openingElement;
  const tagName = jsxTagName(opening, sourceFile).toLocaleLowerCase();
  const className = jsxAttributeValue(jsxAttribute(opening, sourceFile, 'className'), sourceFile);
  const ariaHidden = jsxAttributeValue(
    jsxAttribute(opening, sourceFile, 'aria-hidden'),
    sourceFile,
  );
  const textParts = [];
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      textParts.push(child.text);
      continue;
    }
    if (
      ts.isJsxExpression(child) &&
      child.expression &&
      (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression))
    ) {
      textParts.push(child.expression.text);
      continue;
    }
    return '';
  }
  const authoredText = textParts.join('');
  return (ariaHidden === 'true' ||
    ['button', 'a'].includes(tagName) ||
    iconContextPattern.test(className)) &&
    isStandaloneGlyph(authoredText)
    ? authoredText
    : '';
}

export function inspectUiSource(content, filePath = 'unknown.tsx') {
  const violations = [];
  const extension = path.extname(filePath).toLocaleLowerCase();
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const lucideNames = new Set();
  const lucideNamespaces = new Set();

  const addViolation = (node, kinds, source) => {
    violations.push({ filePath, line: nodeLine(node, sourceFile), kinds, source });
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    if (forbiddenIconLibraryPattern.test(moduleName)) {
      addViolation(
        statement,
        ['non-lucide-icon-library'],
        'Icon imports must use lucide-react, received ' + moduleName,
      );
    }
    if (/\.svg(?:\?|$)/iu.test(moduleName)) {
      addViolation(
        statement,
        ['svg-icon-import'],
        'SVG UI imports are not part of the Lucide icon language: ' + moduleName,
      );
    }
    if (moduleName !== 'lucide-react' || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) lucideNames.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      lucideNamespaces.add(bindings.name.text);
    }
  }

  const inspectAuthoredText = (node, value) => {
    const kinds = visibleSymbolKinds(value);
    if (kinds.length > 0) {
      addViolation(node, kinds, value.trim());
      return;
    }
    if (iconNamedContext(node, sourceFile) && isStandaloneGlyph(value)) {
      addViolation(node, ['standalone-character-icon'], value.trim());
    }
  };

  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      inspectAuthoredText(node, node.text);
    }

    if (ts.isJsxElement(node)) {
      const glyphText = glyphOnlyUiSlotText(node, sourceFile);
      if (glyphText && visibleSymbolKinds(glyphText).length === 0) {
        addViolation(
          node.openingElement,
          ['standalone-character-icon'],
          'Standalone UI glyphs must use lucide-react',
        );
      }
    }

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = jsxTagName(node, sourceFile);
      const isDirectLucide =
        (ts.isIdentifier(node.tagName) && lucideNames.has(node.tagName.text)) ||
        (ts.isPropertyAccessExpression(node.tagName) &&
          ts.isIdentifier(node.tagName.expression) &&
          lucideNamespaces.has(node.tagName.expression.text));

      if (isDirectLucide) {
        const strokeWidth = jsxAttribute(node, sourceFile, 'strokeWidth');
        const size = jsxAttribute(node, sourceFile, 'size');
        const fill = jsxAttribute(node, sourceFile, 'fill');
        if (jsxAttributeValue(strokeWidth, sourceFile) !== '1.8') {
          addViolation(
            node,
            ['lucide-stroke-width'],
            '<' + tagName + '> must set strokeWidth={1.8}',
          );
        }
        if (!size) {
          addViolation(
            node,
            ['lucide-size'],
            '<' + tagName + '> must set an explicit contextual size',
          );
        }
        const fillValue = jsxAttributeValue(fill, sourceFile);
        if (fill && fillValue !== 'none') {
          addViolation(
            node,
            ['lucide-fill'],
            '<' + tagName + '> must remain an unfilled line icon',
          );
        }
        if (node.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) {
          addViolation(
            node,
            ['lucide-prop-spread'],
            '<' + tagName + '> cannot accept unchecked spread props',
          );
        }
      }

      if (['svg', 'path', 'use', 'symbol'].includes(tagName.toLocaleLowerCase())) {
        addViolation(
          node,
          ['handwritten-svg'],
          '<' + tagName + '> must be replaced with lucide-react',
        );
      }

      if (tagName.toLocaleLowerCase() === 'img') {
        const className = jsxAttributeValue(
          jsxAttribute(node, sourceFile, 'className'),
          sourceFile,
        );
        const role = jsxAttributeValue(jsxAttribute(node, sourceFile, 'role'), sourceFile);
        const alt = jsxAttributeValue(jsxAttribute(node, sourceFile, 'alt'), sourceFile);
        if (
          iconContextPattern.test(className) ||
          iconContextPattern.test(role) ||
          iconContextPattern.test(alt) ||
          isInsideInteractiveElement(node, sourceFile)
        ) {
          addViolation(node, ['image-icon'], '<img> cannot be used as an application control icon');
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (
    handwrittenSvgPattern.test(content) &&
    !violations.some((item) => item.kinds.includes('handwritten-svg'))
  ) {
    const matchIndex = content.search(handwrittenSvgPattern);
    const line = content.slice(0, matchIndex).split(/\r\n|\r|\n/u).length;
    violations.push({
      filePath,
      line,
      kinds: ['handwritten-svg'],
      source: 'handwritten SVG markup',
    });
  }
  return violations;
}

export function inspectUiStylesheet(content, filePath = 'unknown.css') {
  const violations = [];
  const lines = content.split(/\r\n|\r|\n/u);
  lines.forEach((line, index) => {
    const contentDeclaration = line.match(/(?<![-\w])content\s*:\s*([^;]+);/iu);
    if (contentDeclaration) {
      const value = contentDeclaration[1].trim().replace(/^['"]|['"]$/gu, '');
      if (value && value !== 'none' && value !== 'normal' && isStandaloneGlyph(value)) {
        violations.push({
          filePath,
          line: index + 1,
          kinds: ['css-character-icon'],
          source: line.trim(),
        });
      }
    }
    if (
      /\b(?:background-image|mask|mask-image)\s*:[^;]*url\([^)]*(?:\.svg|\.ico|data:image)/iu.test(
        line,
      )
    ) {
      violations.push({
        filePath,
        line: index + 1,
        kinds: ['css-image-icon'],
        source: line.trim(),
      });
    }
  });

  for (const match of content.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = match[1].trim();
    const body = match[2];
    if (
      /(?:spinner|loading-icon|loader-icon)/iu.test(selector) &&
      /\bborder(?:-top)?(?:-color)?\s*:/iu.test(body) &&
      /\bborder-radius\s*:\s*50%/iu.test(body)
    ) {
      const line = content.slice(0, match.index).split(/\r\n|\r|\n/u).length;
      violations.push({
        filePath,
        line,
        kinds: ['css-custom-spinner'],
        source: selector + ' must use LoaderCircle from lucide-react',
      });
    }
  }
  return violations;
}

export async function scanUiIcons(root = sourceRoot) {
  const sourceFiles = await collectFiles(root, isProductionUiSource);
  const stylesheets = await collectFiles(root, (filePath) => filePath.endsWith('.css'));
  const violations = [];
  for (const filePath of sourceFiles) {
    violations.push(...inspectUiSource(await readFile(filePath, 'utf8'), filePath));
  }
  for (const filePath of stylesheets) {
    violations.push(...inspectUiStylesheet(await readFile(filePath, 'utf8'), filePath));
  }
  return { files: [...sourceFiles, ...stylesheets], sourceFiles, stylesheets, violations };
}

async function runCli() {
  const { sourceFiles, stylesheets, violations } = await scanUiIcons();
  if (violations.length > 0) {
    console.error(
      'UI icon gate failed. Application controls must use the sidebar Lucide line-icon language:',
    );
    for (const violation of violations) {
      console.error(
        '- ' +
          path.relative(repositoryRoot, violation.filePath) +
          ':' +
          violation.line +
          ' [' +
          violation.kinds.join(', ') +
          '] ' +
          violation.source,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    'UI icon gate passed for ' +
      sourceFiles.length +
      ' production source files and ' +
      stylesheets.length +
      ' stylesheets.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
