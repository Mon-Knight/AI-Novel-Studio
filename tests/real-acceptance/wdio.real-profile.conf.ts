import path from 'node:path';
import { createProductionCarrierConfig } from './production-carrier';
import { REAL_PROFILE_ENV } from './real-profile-env';

/**
 * Real-profile acceptance carrier.
 *
 * Launches the production desktop binary against the operator's own profile: the saved
 * API model cards, the DPAPI credential vault and the production SQLite database. That is
 * the only way to exercise a model whose credential exists solely inside the desktop vault
 * without extracting the secret. Consequences the operator must accept before opting in:
 *
 * - the run performs real, billed provider calls with the model selected in the app;
 * - the run writes a dedicated fixture novel plus one task conversation into the
 *   production database (nothing outside that fixture is touched);
 * - the desktop app must be closed beforehand (single-instance guard).
 *
 * Opt-in: AI_NOVEL_STUDIO_REAL_PROFILE=1. The isolated E2E flag must be absent because
 * it blocks network access and redirects the data directory.
 */
export const config = createProductionCarrierConfig({
  specs: [path.resolve(import.meta.dirname, 'writing-subagent-real-profile.spec.ts')],
  enableEnv: REAL_PROFILE_ENV.enabled,
  appEnv: REAL_PROFILE_ENV.app,
  runIdEnv: REAL_PROFILE_ENV.runId,
  artifactsEnv: REAL_PROFILE_ENV.artifacts,
  driverPortEnv: REAL_PROFILE_ENV.driverPort,
  defaultDriverPort: 4470,
  artifactFolder: 'real-profile',
  specTimeoutMs: 30 * 60_000,
});

export default config;
