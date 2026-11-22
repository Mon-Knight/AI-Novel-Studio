import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import {
  criticalComponentFiles,
  criticalCoverageExclude,
} from './vitest.critical-components.config';

delete process.env.NODE_V8_COVERAGE;

const collectCriticalCoverage =
  process.env.ANS_COLLECT_CRITICAL_COVERAGE === '1' &&
  process.env.ANS_SKIP_CRITICAL_COMPONENT_COVERAGE !== '1';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'src-tauri/**', 'src/**/*.test.mjs'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      enabled: collectCriticalCoverage,
      provider: 'v8',
      include: [...criticalComponentFiles],
      exclude: [...criticalCoverageExclude],
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
