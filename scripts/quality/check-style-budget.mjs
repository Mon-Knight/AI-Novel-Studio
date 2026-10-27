#!/usr/bin/env node
/**
 * 样式预算门禁（ratchet）
 *
 * 为什么需要它：`.ts/.tsx` 已有 500 行上限（check-component-size.mjs），但 CSS
 * 完全没有预算，`workbench.css` 曾涨到 3,152 行；同时 80 多个组件用内联 style
 * 写死了色值。样式是最容易无限膨胀、又最难在评审里被看见的一层。
 *
 * 规则（只能收紧，不能放宽）：
 * 1. 新增 CSS 文件不得超过 MAX_CSS_LINES。
 * 2. 已超限的历史文件冻结在当前行数（LEGACY_CSS_BASELINE），只允许变小；
 *    降到上限以内后必须从基线里删除，防止再次反弹。
 * 3. 组件里的硬编码十六进制色值冻结在当前数量（INLINE_COLOR_BASELINE），
 *    只允许变少；新文件出现任何硬编码色值直接失败。
 *
 * 用法：
 *   node scripts/quality/check-style-budget.mjs           # 检查
 *   node scripts/quality/check-style-budget.mjs --report  # 只打印当前统计，便于更新基线
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const MAX_CSS_LINES = 900;

/**
 * 历史 CSS 文件的行数冻结值。数字只能下调；不得新增条目。
 * 每一条都应该是一个待拆分清单项，而不是永久豁免。
 */
export const LEGACY_CSS_BASELINE = Object.freeze({
  'src/styles/workbench.css': 3066,
  'src/styles/right-dock.css': 1600,
  'src/styles/workbench-zcode.css': 1261,
  'src/styles/workspace.css': 1012,
  'src/styles/autonomous-planning.css': 971,
});

/**
 * 组件内硬编码色值冻结值。只允许减少；新组件一律使用 CSS 令牌。
 */
export const INLINE_COLOR_BASELINE = Object.freeze({
  'src/features/agent/DecisionTrace.tsx': 39,
  'src/components/right-dock/panels/GenerationTracePanel.tsx': 29,
  'src/features/agent/AgentChatWorkspace.tsx': 29,
  'src/components/right-dock/panels/MemoryInspectorPanel.tsx': 21,
  'src/features/agent/MessageList.tsx': 7,
  'src/features/agent/CurrentThinking.tsx': 4,
  'src/components/common/PanelErrorBoundary.tsx': 3,
  'src/components/import/ImportTxtDialog.tsx': 1,
  'src/components/import/ImportJsonDialog.tsx': 1,
});

/**
 * 仍以字面量写 px 的 font-size 总数量。七档字阶之外的每一处都应该被消化，
 * 这里先冻结存量，防止新增代码继续绕过令牌。
 */
export const HARDCODED_FONT_SIZE_BASELINE = 56;

const HEX_COLOR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/gu;
const HARDCODED_FONT_SIZE = /font-size:\s*\d+(?:\.\d+)?px/gu;

export function countLines(content) {
  if (!content) return 0;
  const lines = content.split(/\r\n|\r|\n/u);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

export function countInlineColors(content) {
  return (content.match(HEX_COLOR) ?? []).length;
}

function isProductionTsx(relativePath) {
  if (relativePath.includes('.test.')) return false;
  if (relativePath.split('/').includes('test')) return false;
  return relativePath.endsWith('.tsx');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    ),
  );
  return files.flat();
}

function toRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

export async function collectStyleStats() {
  const sourceRoot = path.join(repoRoot, 'src');
  const files = await walk(sourceRoot);
  const css = [];
  const inline = [];
  let hardcodedFontSizes = 0;

  for (const file of files) {
    const relativePath = toRelative(file);
    if (relativePath.endsWith('.css')) {
      const content = await readFile(file, 'utf8');
      css.push({ path: relativePath, lines: countLines(content) });
      hardcodedFontSizes += (content.match(HARDCODED_FONT_SIZE) ?? []).length;
    } else if (isProductionTsx(relativePath)) {
      const content = await readFile(file, 'utf8');
      const colors = countInlineColors(content);
      if (colors > 0) inline.push({ path: relativePath, colors });
    }
  }

  css.sort((a, b) => b.lines - a.lines);
  inline.sort((a, b) => b.colors - a.colors);
  return { css, inline, hardcodedFontSizes };
}

export function evaluateStyleStats({ css, inline, hardcodedFontSizes = 0 }) {
  const problems = [];

  if (hardcodedFontSizes > HARDCODED_FONT_SIZE_BASELINE) {
    problems.push(
      `CSS 中以字面量写死的 font-size 共 ${hardcodedFontSizes} 处，超过冻结值 ${HARDCODED_FONT_SIZE_BASELINE}；请改用 --font-size-* 七档令牌`,
    );
  }

  for (const file of css) {
    const baseline = LEGACY_CSS_BASELINE[file.path];
    if (baseline === undefined) {
      if (file.lines > MAX_CSS_LINES) {
        problems.push(
          `${file.path}: ${file.lines} 行，超过新文件上限 ${MAX_CSS_LINES} 行；请拆分或复用已有样式类`,
        );
      }
      continue;
    }
    if (file.lines > baseline) {
      problems.push(`${file.path}: ${file.lines} 行，超过冻结值 ${baseline} 行；该文件只能变小`);
    }
  }

  for (const file of inline) {
    const baseline = INLINE_COLOR_BASELINE[file.path];
    if (baseline === undefined) {
      problems.push(
        `${file.path}: 出现 ${file.colors} 处硬编码十六进制色值；请改用 src/styles/variables.css 里的语义令牌`,
      );
      continue;
    }
    if (file.colors > baseline) {
      problems.push(
        `${file.path}: ${file.colors} 处硬编码色值，超过冻结值 ${baseline}；该文件只能变少`,
      );
    }
  }

  return problems;
}

async function main() {
  const report = process.argv.includes('--report');
  const stats = await collectStyleStats();

  if (report) {
    console.log('CSS 行数：');
    for (const file of stats.css.slice(0, 15)) {
      console.log(`  ${String(file.lines).padStart(5)}  ${file.path}`);
    }
    console.log('内联硬编码色值：');
    for (const file of stats.inline) {
      console.log(`  ${String(file.colors).padStart(5)}  ${file.path}`);
    }
    console.log(
      `硬编码 font-size 总数：${stats.hardcodedFontSizes}（冻结值 ${HARDCODED_FONT_SIZE_BASELINE}）`,
    );
    return;
  }

  const problems = evaluateStyleStats(stats);
  if (problems.length === 0) {
    console.log(
      `[style-budget] 通过：${stats.css.length} 个 CSS 文件、${stats.inline.length} 个含内联色值的组件均在预算内。`,
    );
    return;
  }

  console.error('[style-budget] 样式预算超限：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
