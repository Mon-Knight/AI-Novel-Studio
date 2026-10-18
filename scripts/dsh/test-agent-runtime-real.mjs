/**
 * Opt-in Canonical-only read acceptance.
 *
 * No base URL: NOT_RUN, exit 0, no network.
 * Loopback: the existing in-process mock test only.
 * Cloud: DSH_E2E_CLOUD_PROFILE=1 plus a frozen https identity. The carrier
 * starts services::dsh::tests::canonical_read_turn_cloud_profile and does not
 * fall back to the mock. Saved DPAPI credentials are read only when
 * USE_SAVED_CREDENTIAL=1 is also set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentRuntimeReal } from '../../tests/real-acceptance/r4-canonical-read-carrier.mjs';

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isDirectExecution()) {
  runAgentRuntimeReal(process.env)
    .then((result) => {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exit(result.exitCode);
    })
    .catch(() => {
      process.stderr.write('FAIL: harness_failed\n');
      process.exit(1);
    });
}
