import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
  // Use a dedicated Cargo target directory for the non-e2e production carrier
  // so it never collides with `.e2e-tools/target` (`--features e2e`) or the user's release EXE.
  const target = path.join(root, '.e2e-tools', 'target-production');
  const appPath = path.resolve(root, app || path.join(target, 'release', 'AI Novel Studio.exe'));
  const steps = skipBuild
    ? []
    : [
        {
          id: 'production-carrier-build',
          executable: process.execPath,
          args: ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--no-bundle', '--ci'],
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

function canBindPort(port, host, allowUnavailableAddress) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      resolve(
        allowUnavailableAddress && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error?.code ?? ''),
      );
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => resolve(!error));
    });
  });
}

async function isPortAvailable(port) {
  if (!(await canBindPort(port, '127.0.0.1', false))) return false;
  return canBindPort(port, '::1', true);
}

/** Pick a free driver/native port pair outside Windows Hyper-V excluded ranges. */
export async function findAvailableFaultDriverPort() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = randomInt(20_000, 40_000);
    if ((await isPortAvailable(base)) && (await isPortAvailable(base + 1000))) {
      return base;
    }
  }
  throw new Error('Unable to reserve an available local driver/native port pair.');
}

export async function executeWritingFaultPlan(
  plan,
  run = runStep,
  exists = fs.existsSync,
  selectDriverPort = findAvailableFaultDriverPort,
) {
  for (const step of plan.steps) {
    let resolvedStep = step;
    if (step.id === 'isolated-writing-faults') {
      if (!exists(plan.appPath))
        throw new Error('The freshly built production fault-injection executable is missing.');
      if (!step.env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT) {
        const driverPort = await selectDriverPort();
        resolvedStep = {
          ...step,
          env: { ...step.env, AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT: String(driverPort) },
        };
      }
    }
    console.log(`[writing-faults] ${resolvedStep.id}`);
    const code = await run(resolvedStep, plan.root);
    if (code !== 0)
      throw new Error(`Writing fault verification failed at ${resolvedStep.id} (exit ${code}).`);
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
