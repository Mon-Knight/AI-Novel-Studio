import { invoke } from '@tauri-apps/api/tauri';
import {
  advanceMockAiForE2e,
  getMockAiGateStateForE2e,
  pauseMockAiForE2e,
  releaseMockAiForE2e,
  type E2eMockAiGateState,
} from '../ai/mockAiClient';
import { redactDiagnosticText, serializeConsoleArguments } from './e2eDiagnosticSanitizer';
import {
  installE2eNetworkGuard,
  type E2eNetworkAttempts,
  type E2eNetworkGuard,
} from './e2eNetworkGuard';
import { isE2eBridgeCommandAllowed } from './e2eBridgePolicy';

type E2eLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface E2eConsoleEntry {
  level: E2eLogLevel;
  message: string;
  at: string;
}

interface E2eBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** E2E-only direct exercise of the real Domain Facade + SQLite chain. */
  runDomainFacadeSqliteSmoke: (options: { allowMutation: true }) => Promise<unknown>;
  getDiagnostics: () => Promise<unknown>;
  getConsoleLogs: () => E2eConsoleEntry[];
  getUnhandledErrors: () => string[];
  getNetworkAttempts: () => E2eNetworkAttempts;
  getMockAiGateState: () => E2eMockAiGateState;
  pauseMockAi: () => E2eMockAiGateState;
  advanceMockAi: () => E2eMockAiGateState;
  releaseMockAi: () => E2eMockAiGateState;
  clearDiagnostics: () => void;
}

const E2E_ENABLED = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';
const MAX_ENTRIES = 200;
let consoleEntries: E2eConsoleEntry[] = [];
let unhandledErrors: string[] = [];
let installed = false;
let networkGuard: E2eNetworkGuard | undefined;

function record(level: E2eLogLevel, args: unknown[]): void {
  const message = serializeConsoleArguments(args);
  consoleEntries = [...consoleEntries, { level, message, at: new Date().toISOString() }].slice(
    -MAX_ENTRIES,
  );
}

function getNetworkAttempts(): E2eNetworkAttempts {
  if (!networkGuard) throw new Error('E2E network guard is unavailable');
  return networkGuard.getAttempts();
}

function installCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const consoleObject = window.console;
  (['debug', 'info', 'warn', 'error'] as const).forEach((level) => {
    const original = consoleObject[level].bind(consoleObject);
    consoleObject[level] = ((...args: unknown[]) => {
      record(level, args);
      original(...args);
    }) as (typeof consoleObject)[typeof level];
  });

  window.addEventListener('error', (event) => {
    unhandledErrors = [
      ...unhandledErrors,
      redactDiagnosticText(event.error?.message ?? event.message),
    ].slice(-MAX_ENTRIES);
  });
  window.addEventListener('unhandledrejection', (event) => {
    unhandledErrors = [...unhandledErrors, redactDiagnosticText(event.reason)].slice(-MAX_ENTRIES);
  });
}

function createBridge(): E2eBridge {
  return {
    async invoke(command, args) {
      if (!isE2eBridgeCommandAllowed(command)) {
        throw new Error(`E2E bridge command is not allowlisted: ${command}`);
      }
      return invoke(command, args);
    },
    async runDomainFacadeSqliteSmoke(options) {
      // Keep the probe branch compile-time gated so normal production builds
      // do not ship the E2E fixture module as a reachable chunk.
      if (import.meta.env.VITE_AI_NOVEL_STUDIO_E2E !== '1') {
        throw new Error('Domain Facade E2E probe is disabled.');
      }
      if (!options || options.allowMutation !== true) {
        throw new Error('Domain Facade E2E probe requires explicit allowMutation=true.');
      }
      const diagnostics = await invoke('get_e2e_diagnostics');
      if (
        !diagnostics ||
        typeof diagnostics !== 'object' ||
        (diagnostics as { enabled?: unknown }).enabled !== true ||
        (diagnostics as { schemaReady?: unknown }).schemaReady !== true ||
        (diagnostics as { integrityCheck?: unknown }).integrityCheck !== 'ok' ||
        (diagnostics as { networkBlocked?: unknown }).networkBlocked !== true
      ) {
        throw new Error('Domain Facade E2E probe requires healthy isolated desktop diagnostics.');
      }
      const { runDomainFacadeSqliteSmoke } = await import('./e2eDomainFacadeProbe');
      return runDomainFacadeSqliteSmoke();
    },
    async getDiagnostics() {
      const backend = await invoke('get_e2e_diagnostics');
      return {
        ...(backend && typeof backend === 'object' ? backend : { backend }),
        webviewNetwork: getNetworkAttempts(),
      };
    },
    getConsoleLogs: () => [...consoleEntries],
    getUnhandledErrors: () => [...unhandledErrors],
    getNetworkAttempts,
    getMockAiGateState: getMockAiGateStateForE2e,
    pauseMockAi: pauseMockAiForE2e,
    advanceMockAi: advanceMockAiForE2e,
    releaseMockAi: releaseMockAiForE2e,
    clearDiagnostics: () => {
      consoleEntries = [];
      unhandledErrors = [];
      networkGuard?.clear();
    },
  };
}

export function installE2eBridge(): void {
  if (!E2E_ENABLED || typeof window === 'undefined') return;
  networkGuard = installE2eNetworkGuard(window);
  installCapture();
  Object.defineProperty(window, '__AI_NOVEL_STUDIO_E2E__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: createBridge(),
  });
}

installE2eBridge();
