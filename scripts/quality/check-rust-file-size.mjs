import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_RUST_LINES = 500;

/**
 * Production Rust modules predate this gate. Each entry freezes the size the
 * module had when the budget was introduced: the file may shrink, but it may
 * never grow, and once it reaches the limit its entry must be deleted so the
 * budget can only ratchet down. New modules are never added here, and a module
 * on this list is expected to sit above the limit until it is split.
 */
export const LEGACY_RUST_BASELINE = Object.freeze({
  'src-tauri/src/project_backup.rs': 5157,
  'src-tauri/src/services/structured_artifact_apply_service.rs': 4936,
  'src-tauri/src/repositories/conversation_repository.rs': 4693,
  'src-tauri/src/migrations.rs': 4546,
  'src-tauri/src/services/dsh/task_runtime.rs': 4311,
  'src-tauri/src/commands.rs': 3789,
  'src-tauri/src/services/ai_task_service.rs': 3129,
  'src-tauri/src/services/autonomous_scheduler_service.rs': 2595,
  'src-tauri/src/ai.rs': 2473,
  'src-tauri/src/services/memory_service.rs': 2390,
  'src-tauri/src/db.rs': 1921,
  'src-tauri/src/services/dsh/commands.rs': 1838,
  'src-tauri/src/services/ai_request_policy_service.rs': 1806,
  'src-tauri/src/services/autonomous_story_service.rs': 1726,
  'src-tauri/src/services/agent_plan_service.rs': 1477,
  'src-tauri/src/services/reference_library_service.rs': 1425,
  'src-tauri/src/large_text_save.rs': 1389,
  'src-tauri/src/outline_commands.rs': 1301,
  'src-tauri/src/services/content_transaction_service.rs': 1262,
  'src-tauri/src/services/draft_service.rs': 1252,
  'src-tauri/src/runtime.rs': 1186,
  'src-tauri/src/services/placement_service.rs': 1007,
  'src-tauri/src/services/artifact_service.rs': 956,
  'src-tauri/src/services/multi_agent_service.rs': 956,
  'src-tauri/src/services/chapter_context_bundle_service.rs': 879,
  'src-tauri/src/services/ai_task_record_service.rs': 809,
  'src-tauri/src/services/dsh/supervisor.rs': 797,
  'src-tauri/src/commands/local_assets.rs': 745,
  'src-tauri/src/repositories/ai_task_repository.rs': 697,
  'src-tauri/src/services/chapter_service.rs': 697,
  'src-tauri/src/repositories/memory_repository.rs': 678,
  'src-tauri/src/services/quality_check_service.rs': 678,
  'src-tauri/src/domain/ai.rs': 640,
  'src-tauri/src/services/conversation_service.rs': 615,
  'src-tauri/src/session_credentials.rs': 599,
  'src-tauri/src/commands/output_profiles.rs': 565,
  'src-tauri/src/main.rs': 563,
  'src-tauri/src/services/ai_fact_security.rs': 562,
  'src-tauri/src/services/character_asset_service.rs': 551,
  'src-tauri/src/services/context_record_service.rs': 550,
  'src-tauri/src/services/chapter_summary_service.rs': 534,
  'src-tauri/src/services/legacy_migration_service.rs': 534,
  'src-tauri/src/services/dsh/proposal_validator.rs': 517,
});

export function countLines(content) {
  if (!content) return 0;
  const lines = content.split(/\r\n|\r|\n/u);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

/**
 * Production sources are the `.rs` modules that ship in the desktop binary.
 * Cargo `target/` output, generated artefacts and Rust test-only modules
 * (`tests.rs` and `*_tests.rs`, which are compiled behind `#[cfg(test)]`) are
 * excluded so the budget keeps ratcheting down the code that actually ships.
 */
export function isRustSource(relativePath) {
  if (!/\.rs$/u.test(relativePath)) return false;
  const segments = relativePath.split('/');
  if (
    segments.some((segment) =>
      ['target', 'test', 'tests', '__tests__', 'fixtures', 'testdata', 'test_data'].includes(
        segment,
      ),
    )
  )
    return false;
  const basename = segments.at(-1);
  if (basename === 'tests.rs' || basename.endsWith('_tests.rs')) return false;
  return true;
}

/**
 * A module is held to the hard limit unless it is frozen in the baseline, in
 * which case its recorded size is the ceiling. Any baseline entry that no
 * longer sits above the limit (because the file shrank, was removed, or was
 * mis-recorded) is reported as stale so the waiver can only ratchet down.
 */
export function evaluate({ files, baseline = LEGACY_RUST_BASELINE, limit = MAX_RUST_LINES }) {
  const violations = [];
  for (const { file, lines } of files) {
    const budget = baseline[file] ?? limit;
    if (lines > budget) {
      violations.push({
        file,
        lines,
        budget,
        reason: budget === limit ? 'over-limit' : 'over-baseline',
      });
    }
  }

  const present = new Map(files.map(({ file, lines }) => [file, lines]));
  const staleBaseline = Object.entries(baseline)
    .filter(([file, budget]) => {
      const lines = present.get(file);
      return lines === undefined || budget <= limit || lines <= limit;
    })
    .map(([file]) => ({ file, lines: present.get(file) }));

  return {
    violations: violations.sort((left, right) => right.lines - left.lines),
    staleBaseline: staleBaseline.sort((left, right) => left.file.localeCompare(right.file)),
  };
}

async function collectFiles(root, directory, files) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectFiles(root, relative, files);
    else if (entry.isFile() && isRustSource(relative)) {
      const content = await readFile(path.join(root, relative), 'utf8');
      files.push({ file: relative, lines: countLines(content) });
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = await collectFiles(repositoryRoot, 'src-tauri/src', []);
  const { violations, staleBaseline } = evaluate({ files });

  if (violations.length > 0) {
    console.error('Rust sources must stay at or below their size budget:');
    for (const violation of violations) {
      console.error(
        `- ${violation.file}: ${violation.lines} lines exceeds ${violation.budget}` +
          `${violation.reason === 'over-baseline' ? ' (frozen baseline; this file may only shrink)' : ''}`,
      );
    }
  }
  if (staleBaseline.length > 0) {
    console.error('Remove these entries from LEGACY_RUST_BASELINE; they no longer need a waiver:');
    for (const entry of staleBaseline) {
      console.error(`- ${entry.file}: ${entry.lines ?? 'file removed'}`);
    }
  }
  if (violations.length > 0 || staleBaseline.length > 0) {
    process.exitCode = 1;
  } else {
    const largest = [...files].sort((left, right) => right.lines - left.lines)[0];
    console.log(
      `Rust file size gate passed for ${files.length} production sources ` +
        `(largest ${largest.file} at ${largest.lines} lines); ` +
        `${Object.keys(LEGACY_RUST_BASELINE).length} legacy modules held at their frozen budget.`,
    );
  }
}
