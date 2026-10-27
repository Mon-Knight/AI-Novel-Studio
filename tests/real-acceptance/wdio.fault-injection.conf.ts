import path from 'node:path';
import { createProductionCarrierConfig } from './production-carrier';
import { FAULT_INJECTION_ENV } from './real-profile-env';

/**
 * Fault-injection carrier (Writing SubAgent gate E-4b).
 *
 * Runs the production desktop binary with an isolated profile: `LOCALAPPDATA`, `APPDATA`
 * and the WebView2 user data folder are redirected below the run's artifact directory, so
 * the operator's settings, credential vault and database are never opened. The model is a
 * deterministic loopback upstream (`scripts/dsh/mock-workbench-upstream.mjs`) started by the
 * spec, which can script over-privileged tool calls, cross-novel candidates, provider
 * failures and hung completions. Everything else — DSH runtime carrier, gateway, Rust host,
 * production UI — is the real stack. No network, no credential, no billed call.
 *
 * Opt-in: AI_NOVEL_STUDIO_FAULT_INJECTION=1. The isolated E2E flag must be absent. The
 * operator's desktop app may stay open: the isolated profile owns its own single-instance
 * lock, database and WebView2 folder.
 */
export const config = createProductionCarrierConfig({
  specs: [path.resolve(import.meta.dirname, 'writing-subagent-fault-injection.spec.ts')],
  enableEnv: FAULT_INJECTION_ENV.enabled,
  appEnv: FAULT_INJECTION_ENV.app,
  runIdEnv: FAULT_INJECTION_ENV.runId,
  artifactsEnv: FAULT_INJECTION_ENV.artifacts,
  driverPortEnv: FAULT_INJECTION_ENV.driverPort,
  defaultDriverPort: 4480,
  artifactFolder: 'fault-injection',
  specTimeoutMs: 40 * 60_000,
  isolatedProfile: { dshRuntimeRootEnv: FAULT_INJECTION_ENV.dshRuntimeRoot },
  driverPidEnv: FAULT_INJECTION_ENV.driverPid,
});

export default config;
