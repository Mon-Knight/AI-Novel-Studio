import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export const criticalComponentFiles = [
  'src/components/right-dock/panels/CheckPanel.tsx',
  'src/components/right-dock/panels/CheckPanelView.tsx',
  'src/components/right-dock/panels/AiGeneratePanel.tsx',
  'src/components/right-dock/panels/AiGeneratePanelView.tsx',
  'src/components/right-dock/panels/DraftHistoryPanel.tsx',
  'src/components/workspace/VolumeTree.tsx',
  'src/pages/WritingWorkspace/WritingWorkspacePage.tsx',
  'src/pages/WritingWorkspace/WritingWorkspaceView.tsx',
  'src/pages/StoryAssets/CrossChapterBatchPanel.tsx',
  'src/pages/StoryAssets/StoryAssetForms.tsx',
  'src/pages/StoryAssets/StoryAssetsPage.tsx',
  'src/pages/StoryAssets/TransactionReview.tsx',
  'src/pages/AutonomousPlanning/AutonomousApplyBar.tsx',
  'src/pages/AutonomousPlanning/AutonomousBriefPanel.tsx',
  'src/pages/AutonomousPlanning/AutonomousExecutionPanel.tsx',
  'src/pages/AutonomousPlanning/AutonomousPlanContent.tsx',
  'src/pages/AutonomousPlanning/AutonomousPlanProgress.tsx',
  'src/pages/AutonomousPlanning/AutonomousSchedulerControls.tsx',
] as const;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/test/critical-components/**/*.test.tsx',
      'src/test/components/CheckPanelCancellation.test.tsx',
      'src/test/story-assets/StoryAssetsPage.test.tsx',
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [...criticalComponentFiles],
      reportsDirectory: 'coverage/critical-components',
      reporter: ['text', 'json', 'json-summary'],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
