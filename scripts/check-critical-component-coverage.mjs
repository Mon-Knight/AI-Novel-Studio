import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const threshold = 60;
const summaryPath = path.resolve('coverage/critical-components/coverage-summary.json');
const groups = {
  CheckPanel: [
    'src/components/right-dock/panels/CheckPanel.tsx',
    'src/components/right-dock/panels/CheckPanelView.tsx',
  ],
  AiGeneratePanel: [
    'src/components/right-dock/panels/AiGeneratePanel.tsx',
    'src/components/right-dock/panels/AiGeneratePanelView.tsx',
  ],
  DraftHistory: ['src/components/right-dock/panels/DraftHistoryPanel.tsx'],
  VolumeTree: ['src/components/workspace/VolumeTree.tsx'],
  WritingWorkspace: [
    'src/pages/WritingWorkspace/WritingWorkspacePage.tsx',
    'src/pages/WritingWorkspace/WritingWorkspaceView.tsx',
  ],
  StoryAssets: [
    'src/pages/StoryAssets/CrossChapterBatchPanel.tsx',
    'src/pages/StoryAssets/StoryAssetForms.tsx',
    'src/pages/StoryAssets/StoryAssetsPage.tsx',
    'src/pages/StoryAssets/TransactionReview.tsx',
  ],
  AutonomousPlanning: [
    'src/pages/AutonomousPlanning/AutonomousApplyBar.tsx',
    'src/pages/AutonomousPlanning/AutonomousBriefPanel.tsx',
    'src/pages/AutonomousPlanning/AutonomousExecutionPanel.tsx',
    'src/pages/AutonomousPlanning/AutonomousPlanContent.tsx',
    'src/pages/AutonomousPlanning/AutonomousPlanProgress.tsx',
    'src/pages/AutonomousPlanning/AutonomousSchedulerControls.tsx',
  ],
};
const metricNames = ['lines', 'statements', 'functions', 'branches'];

if (!fs.existsSync(summaryPath)) {
  throw new Error(`Critical component coverage summary is missing: ${summaryPath}`);
}

const rawSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const bySourcePath = new Map(
  Object.entries(rawSummary)
    .filter(([file]) => file !== 'total')
    .map(([file, metrics]) => [file.replaceAll('\\', '/').replace(/^.*?(src\/)/, '$1'), metrics]),
);

let failed = false;
process.stdout.write(`Critical component coverage gate (each group >= ${threshold}%)\n`);
process.stdout.write('Group                 Lines   Statements   Functions   Branches\n');

for (const [groupName, files] of Object.entries(groups)) {
  const totals = Object.fromEntries(
    metricNames.map((metric) => [metric, { covered: 0, total: 0 }]),
  );
  for (const file of files) {
    const metrics = bySourcePath.get(file);
    if (!metrics) {
      process.stderr.write(`Missing coverage entry: ${file}\n`);
      failed = true;
      continue;
    }
    for (const metric of metricNames) {
      totals[metric].covered += metrics[metric].covered;
      totals[metric].total += metrics[metric].total;
    }
  }

  const percentages = Object.fromEntries(
    metricNames.map((metric) => {
      const value =
        totals[metric].total === 0 ? 100 : (totals[metric].covered / totals[metric].total) * 100;
      if (value < threshold) failed = true;
      return [metric, value];
    }),
  );
  process.stdout.write(
    `${groupName.padEnd(21)} ${percentages.lines.toFixed(2).padStart(6)}% ` +
      `${percentages.statements.toFixed(2).padStart(10)}% ` +
      `${percentages.functions.toFixed(2).padStart(10)}% ` +
      `${percentages.branches.toFixed(2).padStart(9)}%\n`,
  );
}

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write('Critical component coverage gate passed.\n');
}
