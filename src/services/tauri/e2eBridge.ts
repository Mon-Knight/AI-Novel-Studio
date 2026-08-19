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

type E2eLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface E2eConsoleEntry {
  level: E2eLogLevel;
  message: string;
  at: string;
}

interface E2eBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
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

const E2E_ENABLED = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';
const MAX_ENTRIES = 200;
const SAFE_COMMANDS = new Set([
  'get_e2e_diagnostics',
  'get_all_novels',
  'get_novel_by_id',
  'get_chapter_by_id',
  'get_chapters_by_novel_id',
  'get_drafts_by_chapter_id',
  'count_drafts_by_chapter_id',
  'get_adopted_draft_by_chapter_id',
  'get_chapter_summary',
  'get_chapter_summaries_by_novel',
  'get_context_records',
  'get_ai_task_records_by_chapter_id',
  'list_ai_tasks',
  'get_ai_task',
  'list_agent_plans_by_chapter',
  'get_agent_plan',
  'create_agent_plan',
  'acquire_agent_plan_lease',
  'claim_agent_plan_step',
  'get_result_artifact',
  'prepare_placement_proposal',
  'get_placement_proposal',
  'apply_placement_plan',
  'get_world_settings',
  'list_faction_assets',
  'get_quality_check_issues',
  'list_quality_check_reports',
  'get_quality_check_report_snapshot',
  'get_generation_jobs_by_chapter_id',
  'get_generation_step_results',
  'get_e2e_novel_commit_state',
  'get_e2e_large_text_draft_state',
  'corrupt_e2e_large_text_chunk',
]);

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
      if (!SAFE_COMMANDS.has(command)) {
        throw new Error(`E2E bridge command is not allowlisted: ${command}`);
      }
      return invoke(command, args);
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
