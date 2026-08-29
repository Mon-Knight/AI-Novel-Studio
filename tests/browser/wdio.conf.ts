import path from 'node:path';
import fs from 'node:fs';
import { createServer, type ViteDevServer } from 'vite';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');
const host = '127.0.0.1';
const port = Number(process.env.BROWSER_E2E_PORT ?? '4173');
const baseUrl = `http://${host}:${port}`;
let viteServer: ViteDevServer | undefined;

function localEdgeDriver(): string | undefined {
  const configured = process.env.BROWSER_E2E_DRIVER?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform !== 'win32') return undefined;
  const toolsRoot = path.join(workspaceRoot, '.e2e-tools');
  if (!fs.existsSync(toolsRoot)) return undefined;
  return fs
    .readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('edgedriver-'))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
    .map((entry) => path.join(toolsRoot, entry.name, 'msedgedriver.exe'))
    .find((candidate) => fs.existsSync(candidate));
}

const edgeDriver = localEdgeDriver();
const browserArgs = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1440,1000',
];
const browserCapability = edgeDriver
  ? {
      browserName: 'MicrosoftEdge',
      'ms:edgeOptions': { args: browserArgs },
      'wdio:edgedriverOptions': { binary: edgeDriver },
      'wdio:enforceWebDriverClassic': true,
    }
  : {
      browserName: 'chrome',
      'goog:chromeOptions': { args: browserArgs },
      'wdio:enforceWebDriverClassic': true,
    };

if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error(`BROWSER_E2E_PORT must be an unprivileged TCP port, received ${String(port)}.`);
}

export const config = {
  runner: 'local',
  specs: [path.resolve(import.meta.dirname, '*.browser.spec.ts')],
  maxInstances: 1,
  capabilities: [browserCapability],
  logLevel: process.env.BROWSER_E2E_LOG_LEVEL ?? 'warn',
  framework: 'mocha',
  reporters: [['spec', { stdout: true }]],
  mochaOpts: {
    timeout: 60_000,
    fullTrace: true,
  },
  baseUrl,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  injectGlobals: true,

  async onPrepare() {
    viteServer = await createServer({
      root: workspaceRoot,
      configFile: path.join(workspaceRoot, 'vite.config.ts'),
      optimizeDeps: {
        noDiscovery: true,
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react/jsx-dev-runtime',
          'react/jsx-runtime',
        ],
      },
      server: {
        host,
        port,
        strictPort: true,
        hmr: false,
      },
    });
    await viteServer.listen();
    await waitForVite();
  },

  async onComplete() {
    const server = viteServer;
    viteServer = undefined;
    await server?.close();
  },
};

async function waitForVite(): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: 'manual' });
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite browser fixture did not become ready: ${String(lastError ?? 'timeout')}`);
}

export default config;
