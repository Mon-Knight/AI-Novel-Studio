import { afterEach, expect, test, vi } from 'vitest';
import { isE2eLegacyWorkspacePanelsEnabled, isWorkspaceAiPanelRetired } from './rightSidebar';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});
test('ordinary desktop E2E keeps the production interface', () => {
  vi.stubEnv('VITE_AI_NOVEL_STUDIO_E2E', '1');
  expect(isE2eLegacyWorkspacePanelsEnabled()).toBe(false);
  expect(isWorkspaceAiPanelRetired('ai-generate')).toBe(true);
  expect(isWorkspaceAiPanelRetired('chapter-summary')).toBe(false);
});
test('only an explicit compatibility fixture in an E2E build restores retired panels', () => {
  localStorage.setItem('ai_novel_studio_e2e_legacy_workspace_panels', 'enabled');
  vi.stubEnv('VITE_AI_NOVEL_STUDIO_E2E', '0');
  expect(isWorkspaceAiPanelRetired('ai-generate')).toBe(true);
  vi.stubEnv('VITE_AI_NOVEL_STUDIO_E2E', '1');
  expect(isE2eLegacyWorkspacePanelsEnabled()).toBe(true);
  expect(isWorkspaceAiPanelRetired('ai-generate')).toBe(false);
  expect(isWorkspaceAiPanelRetired('multi-agent')).toBe(true);
});
