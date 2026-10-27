import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_PRODUCTION_LINES = 500;

/**
 * Production `.ts` modules predate this gate. Each entry freezes the size the
 * module had when the budget was introduced: the file may shrink, but it may
 * never grow, and once it reaches the limit its entry must be deleted so the
 * budget can only ratchet down. New modules are never added here.
 */
export const LEGACY_TS_BASELINE = Object.freeze({
  'src/pages/Workbench/hooks/useWorkbenchTaskRunner.ts': 1834,
  'src/services/ai/qualityFixService.ts': 1418,
  'src/services/ai/mockAiClient.ts': 1246,
  'src/services/generation/chapterGenerationPipeline.ts': 1186,
  'src/services/prompt/contextBuilder.ts': 1106,
  'src/services/conversation/taskConversationService.ts': 1084,
  'src/services/ai/orchestrator/beatTextValidator.ts': 1013,
  'src/services/conversation/workbenchAssetScopeService.ts': 1008,
  'src/services/ai/realAiClient.ts': 933,
  'src/services/ai/aiSettingsStore.ts': 904,
  'src/services/ai/aiExecutionPipeline.ts': 917,
  'src/services/autonomous-creation/autonomousStoryService.ts': 916,
  'src/services/conversation/workbenchChapterWriter.ts': 857,
  'src/services/generation/generationContextCompiler.ts': 853,
  'src/services/ai/promptBuilder.ts': 845,
  'src/services/database/draftVersionService.ts': 804,
  'src/services/generation/chapterCandidateIntegrity.ts': 701,
  'src/components/workspace/editor-area/useEditorDocumentController.ts': 693,
  'src/services/ai/aiTaskService.ts': 682,
  'src/services/ai/orchestrator/beatRepairService.ts': 673,
  'src/services/capabilities/capabilityCatalog.ts': 635,
  'src/services/autonomous-creation/autonomousPlanBuilder.ts': 623,
  'src/services/conversation/taskRuntimeAdapter.ts': 616,
  'src/services/agent/agentPlanner.ts': 606,
  'src/services/ai/aiRequestPolicyService.ts': 606,
  'src/pages/Workbench/workbenchContextReceiptModel.ts': 596,
  'src/pages/Workbench/hooks/useWorkbenchConversations.ts': 572,
  'src/services/capabilities/main-agent/mainAgentRuntimeService.ts': 566,
  'src/services/autonomous-creation/autonomousSchedulerWorker.ts': 541,
  'src/services/context/novelContextCompressionProvider.ts': 529,
  'src/services/quality/qualityCheckService.ts': 527,
  'src/services/agent-tools/productionToolRegistry.ts': 518,
  'src/services/references/referenceLibraryService.ts': 510,
});

export function countLines(content) {
  if (!content) return 0;
  const lines = content.split(/\r\n|\r|\n/u);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

export function isProductionSource(relativePath) {
  const segments = relativePath.split('/');
  if (segments.includes('test') || segments.includes('__tests__')) return false;
  if (/\.test\.tsx?$/u.test(relativePath)) return false;
  return /\.tsx?$/u.test(relativePath);
}

/**
 * `.tsx` components carry a hard limit. `.ts` modules share the same limit
 * unless they are frozen in the baseline, in which case their recorded size is
 * the ceiling until the module reaches the hard limit.
 */

export function evaluate({ files, baseline = LEGACY_TS_BASELINE, limit = MAX_PRODUCTION_LINES }) {
  const violations = [];
  for (const { file, lines } of files) {
    const budget = file.endsWith('.tsx') ? limit : (baseline[file] ?? limit);
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
    else if (entry.isFile() && isProductionSource(relative)) {
      const content = await readFile(path.join(root, relative), 'utf8');
      files.push({ file: relative, lines: countLines(content) });
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = await collectFiles(repositoryRoot, 'src', []);
  const { violations, staleBaseline } = evaluate({ files });

  if (violations.length > 0) {
    console.error(`Production sources must stay at or below their size budget:`);
    for (const violation of violations) {
      console.error(
        `- ${violation.file}: ${violation.lines} lines exceeds ${violation.budget}` +
          `${violation.reason === 'over-baseline' ? ' (frozen baseline; this file may only shrink)' : ''}`,
      );
    }
  }
  if (staleBaseline.length > 0) {
    console.error('Remove these entries from LEGACY_TS_BASELINE; they no longer need a waiver:');
    for (const entry of staleBaseline) {
      console.error(`- ${entry.file}: ${entry.lines ?? 'file removed'}`);
    }
  }
  if (violations.length > 0 || staleBaseline.length > 0) {
    process.exitCode = 1;
  } else {
    const tsx = files.filter(({ file }) => file.endsWith('.tsx'));
    const largestTsx = [...tsx].sort((left, right) => right.lines - left.lines)[0];
    console.log(
      `Component size gate passed for ${files.length} production sources ` +
        `(${tsx.length} TSX, largest ${largestTsx.file} at ${largestTsx.lines} lines); ` +
        `${Object.keys(LEGACY_TS_BASELINE).length} legacy TS modules held at their frozen budget.`,
    );
  }
}
