import fs from 'node:fs';
import path from 'node:path';
import { browser } from '@wdio/globals';
import { config as isolatedE2eConfig } from '../e2e/wdio.conf';
import { E2E_BRIDGE_CALL_TIMEOUT_MS } from '../e2e/helpers';
import {
  readRealConversationAcceptanceProfile,
  REAL_ACCEPTANCE_ENV,
} from '../../scripts/e2e/real-conversation-acceptance-profile.ts';

const profile = readRealConversationAcceptanceProfile(process.env);
const evidenceDirectory = process.env.AI_NOVEL_STUDIO_REAL_E2E_EVIDENCE_DIR?.trim();
if (!evidenceDirectory) {
  throw new Error('AI_NOVEL_STUDIO_REAL_E2E_EVIDENCE_DIR is required.');
}
fs.mkdirSync(evidenceDirectory, { recursive: true });

const isolatedOnPrepare = isolatedE2eConfig.onPrepare;
const isolatedBefore = isolatedE2eConfig.before;
// Browser bridge calls stop themselves at 15 seconds; keep the driver above that limit while
// bounding renderer stalls well below the 300-second native-driver timeout.
const REAL_ACCEPTANCE_WEBDRIVER_SCRIPT_TIMEOUT_MS = E2E_BRIDGE_CALL_TIMEOUT_MS + 15_000;

export const config = {
  ...isolatedE2eConfig,
  specs: [path.resolve(import.meta.dirname, 'conversation-60000.spec.ts')],
  exclude: [],
  maxInstances: 1,
  logLevel: 'error' as const,
  mochaOpts: {
    ...isolatedE2eConfig.mochaOpts,
    timeout: profile.mode === 'full' ? 4 * 60 * 60_000 : 60 * 60_000,
    fullTrace: true,
  },

  async onPrepare() {
    if (process.env.AI_NOVEL_STUDIO_E2E !== '1') {
      throw new Error('Real acceptance must retain the isolated Cargo E2E carrier.');
    }
    if (process.env[REAL_ACCEPTANCE_ENV.enabled] !== '1') {
      throw new Error('Real acceptance runtime opt-in is unavailable.');
    }

    // The WDIO worker needs the credential so it can type it into Settings.
    // The driver and application must not inherit it from the process environment.
    const credential = process.env[REAL_ACCEPTANCE_ENV.apiKey];
    delete process.env[REAL_ACCEPTANCE_ENV.apiKey];
    try {
      await isolatedOnPrepare();
    } finally {
      if (credential !== undefined) process.env[REAL_ACCEPTANCE_ENV.apiKey] = credential;
    }
  },

  async before() {
    await browser.setTimeout({ script: REAL_ACCEPTANCE_WEBDRIVER_SCRIPT_TIMEOUT_MS });
    await isolatedBefore();
  },
};

export default config;
