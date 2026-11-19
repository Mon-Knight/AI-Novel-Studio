import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { npmCommand } from '../quality/verification-process.mjs';
import { verifyExtractedCarrierGateway } from '../dsh/carrier-freshness.mjs';

export const DESKTOP_DSH_PINNED_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';

export function desktopCarrierPaths(root) {
  const extractedRoot = path.join(root, 'src-tauri', '.payload-verify');
  return {
    extractedRoot,
    runtimeRoot: path.join(extractedRoot, 'dsh-runtime'),
    gateway: path.join(root, 'src-tauri', 'target', 'release', 'novel-domain-gateway.exe'),
  };
}

export function desktopCarrierEnvironment(paths) {
  return {
    DSH_RUNTIME_ROOT: paths.runtimeRoot,
    DSH_GATEWAY_BIN: paths.gateway,
  };
}

function runProcess(executable, args, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Desktop carrier preparation failed with exit ${String(code)}.`));
    });
  });
}

/** Prepare and verify the pinned offline carrier before any desktop application starts. */
export async function prepareDesktopCarrier(root, dependencies = {}) {
  const paths = desktopCarrierPaths(root);
  const run = dependencies.run ?? runProcess;
  const verify = dependencies.verify ?? verifyExtractedCarrierGateway;
  const exists = dependencies.exists ?? fs.existsSync;
  const command = npmCommand('dsh:assets');
  await run(command.executable, command.args, root);
  verify({
    extractedRoot: paths.extractedRoot,
    currentGateway: paths.gateway,
    pinnedCommit: DESKTOP_DSH_PINNED_COMMIT,
  });
  const runtimeBin = path.join(
    paths.runtimeRoot,
    'packages',
    'examples',
    'jsonrpc-demo',
    'lib',
    'bin.js',
  );
  if (!exists(runtimeBin)) {
    throw new Error('The verified desktop DeepSeek carrier has no runtime entry point.');
  }
  return paths;
}
