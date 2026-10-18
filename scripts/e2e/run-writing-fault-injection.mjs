import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { npmCommand } from '../quality/verification-process.mjs';
import { verifyExtractedCarrierGateway } from '../dsh/carrier-freshness.mjs';

// This runner never selects the real-profile spec or forwards cloud credentials.
// Its only model is the loopback upstream owned by the isolated fault-injection spec.
export function writingFaultEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (
      /api[_-]?key|secret|token|password|authorization|credential/iu.test(key) ||
      /^(?:DSH_E2E_|ANS_R4_|PROXY_)/u.test(key) ||
      /^AI_NOVEL_STUDIO_REAL_PROFILE/u.test(key) ||
      /^AI_NOVEL_STUDIO_FAULT_INJECTION/u.test(key) ||
      [
        'AI_NOVEL_STUDIO_E2E',
        'VITE_AI_NOVEL_STUDIO_E2E',
        'CARGO_TARGET_DIR',
        'DSH_RUNTIME_ROOT',
        'NODE_TEST_CONTEXT',
      ].includes(key)
    )
      delete result[key];
  }
  return result;
}

export function writingFaultPlan({
  root,
  platform = process.platform,
  env = process.env,
  skipBuild = false,
  app,
} = {}) {
  if (platform !== 'win32')
    throw new Error('Writing fault injection requires the real Windows desktop carrier.');
  if (skipBuild && !app)
    throw new Error('--skip-build requires an explicitly freshly built --app.');
  if (app && !skipBuild) throw new Error('--app requires explicit --skip-build reuse.');
  const environment = writingFaultEnvironment(env);
  // Reuse the desktop test dependency cache, never overwrite the user's release executable.
  const target = path.join(root, '.e2e-tools', 'target');
  const appPath = path.resolve(root, app || path.join(target, 'release', 'AI Novel Studio.exe'));
  const steps = skipBuild
    ? []
    : [
        { id: 'assets', ...npmCommand('dsh:assets'), env: environment },
        {
          id: 'production-carrier-build',
          executable: process.execPath,
          args: ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--bundles', 'none', '--ci'],
          env: { ...environment, CARGO_TARGET_DIR: target },
        },
      ];
  steps.push({
    id: 'isolated-writing-faults',
    executable: process.execPath,
    args: [
      'node_modules/@wdio/cli/bin/wdio.js',
      'run',
      'tests/real-acceptance/wdio.fault-injection.conf.ts',
    ],
    env: {
      ...environment,
      AI_NOVEL_STUDIO_FAULT_INJECTION: '1',
      AI_NOVEL_STUDIO_FAULT_INJECTION_APP: appPath,
      AI_NOVEL_STUDIO_FAULT_INJECTION_DSH_RUNTIME_ROOT: path.join(
        root,
        'src-tauri',
        '.payload-verify',
        'dsh-runtime',
      ),
      // The production test binary lives in .e2e-tools and does not sit beside the
      // verified Gateway. Isolated profiles also hide the operator's unpacked copy.
      DSH_GATEWAY_BIN: path.join(
        root,
        'src-tauri',
        'target',
        'release',
        'novel-domain-gateway.exe',
      ),
      ...(env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT
        ? {
            AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT:
              env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT,
          }
        : {}),
    },
  });
  return { root, appPath, steps };
}

async function runStep(step, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.executable, step.args, {
      cwd: root,
      env: step.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else child.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const cleanup = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}

export function verifyWritingFaultCarrier(root) {
  return verifyExtractedCarrierGateway({
    extractedRoot: path.join(root, 'src-tauri', '.payload-verify'),
    currentGateway: path.join(root, 'src-tauri', 'target', 'release', 'novel-domain-gateway.exe'),
    pinnedCommit: '47f943859bef60e4160492346772ded9b24f765a',
  });
}

export async function executeWritingFaultPlan(
  plan,
  run = runStep,
  exists = fs.existsSync,
  verifyCarrier = verifyWritingFaultCarrier,
) {
  for (const step of plan.steps) {
    if (step.id === 'isolated-writing-faults') {
      if (!exists(plan.appPath))
        throw new Error('The freshly built production fault-injection executable is missing.');
      verifyCarrier(plan.root);
    }
    console.log(`[writing-faults] ${step.id}`);
    const code = await run(step, plan.root);
    if (code !== 0)
      throw new Error(`Writing fault verification failed at ${step.id} (exit ${code}).`);
  }
}

export function parseWritingFaultArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--skip-build') result.skipBuild = true;
    else if (args[index] === '--app') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('--app requires a path.');
      result.app = value;
    } else throw new Error(`Unknown writing fault option: ${args[index]}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await executeWritingFaultPlan(
      writingFaultPlan({ root: process.cwd(), ...parseWritingFaultArgs(process.argv.slice(2)) }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
