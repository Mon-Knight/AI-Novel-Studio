import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Starts a lightweight middleware-mode Vite SSR server for node:test files
 * without reading root vite.config.ts or triggering optimizeDeps crawls.
 */
export async function createTestViteServer(
  overrides: Pick<InlineConfig, 'define'> = {},
): Promise<ViteDevServer> {
  const e2eEnabled =
    overrides.define?.['import.meta.env.VITE_AI_NOVEL_STUDIO_E2E'] === JSON.stringify('1') ||
    process.env.VITE_AI_NOVEL_STUDIO_E2E === '1';

  return createServer({
    root: repoRoot,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: '@/services/tauri/e2eBridge',
          replacement: path.resolve(
            repoRoot,
            e2eEnabled
              ? 'src/services/tauri/e2eBridge.ts'
              : 'src/services/tauri/e2eBridgeDisabled.ts',
          ),
        },
        {
          find: '@',
          replacement: path.resolve(repoRoot, 'src'),
        },
      ],
    },
    define: overrides.define,
    optimizeDeps: {
      noDiscovery: true,
      include: [],
      entries: [],
    },
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
  });
}
