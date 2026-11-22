import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DESKTOP_DSH_PINNED_COMMIT,
  desktopCarrierEnvironment,
  desktopCarrierPaths,
  desktopCarrierStampPath,
  prepareDesktopCarrier,
} from './e2e-carrier.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function withCarrierFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-e2e-carrier-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function populateValidCarrierWorkspace(
  root,
  {
    zipBytes = 'carrier-zip-v1',
    gatewayBytes = 'gateway-v1',
    runtimeBytes = 'runtime-v1',
    unpackerBytes = '// unpack-payload v1\n',
    junctions = [{ link: 'packages/alias', target: 'packages/sdk/protocol' }],
  } = {},
) {
  const paths = desktopCarrierPaths(root);
  const binDir = path.join(root, 'src-tauri', 'bin');
  const scriptDir = path.join(root, 'scripts', 'dsh');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.gateway), { recursive: true });
  fs.mkdirSync(paths.runtimeRoot, { recursive: true });

  const gatewayHash = sha256(gatewayBytes);
  const runtimeHash = sha256(runtimeBytes);
  fs.writeFileSync(paths.gateway, gatewayBytes);
  fs.writeFileSync(path.join(binDir, 'dsh-runtime.zip'), zipBytes);
  fs.writeFileSync(path.join(binDir, 'gateway-sha256.txt'), `${gatewayHash}\n`);
  fs.writeFileSync(path.join(binDir, 'unpack-payload.mjs'), unpackerBytes);
  fs.writeFileSync(path.join(scriptDir, 'unpack-payload.mjs'), unpackerBytes);

  const requiredFiles = {
    'packages/examples/jsonrpc-demo/lib/bin.js': runtimeBytes,
    'packages/sdk/protocol/lib/index.js': 'protocol',
    'packages/core/agent/lib/index.js': 'agent',
    'packages/llm/llm/lib/index.js': 'llm',
    'packages/core/session/lib/index.js': 'session',
    'packages/examples/jsonrpc-demo/node_modules/@deepseek-ai/dsh-app-boot/index.js': 'boot',
    'gateway/novel-domain-gateway.exe': gatewayBytes,
  };
  for (const [relative, content] of Object.entries(requiredFiles)) {
    const file = path.join(paths.runtimeRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  for (const junction of junctions) {
    const linkPath = path.join(paths.runtimeRoot, junction.link);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.mkdirSync(linkPath, { recursive: true });
  }
  fs.writeFileSync(
    path.join(paths.runtimeRoot, 'VERSION_MATRIX.json'),
    JSON.stringify({
      sourceCommit: DESKTOP_DSH_PINNED_COMMIT,
      runtimeBinSha256: runtimeHash,
      gatewaySha256: gatewayHash,
    }),
  );
  fs.writeFileSync(path.join(paths.runtimeRoot, 'JUNCTIONS.json'), JSON.stringify(junctions));
  return paths;
}

test('desktop carrier environment binds the verified runtime and current Gateway', () => {
  const root = path.resolve('fixture-root');
  const paths = desktopCarrierPaths(root);
  assert.deepEqual(desktopCarrierEnvironment(paths), {
    DSH_RUNTIME_ROOT: paths.runtimeRoot,
    DSH_GATEWAY_BIN: paths.gateway,
  });
  assert.notEqual(paths.runtimeRoot, path.join(root, 'untrusted-checkout'));
});

test('desktop preparation assembles, verifies and returns one consistent carrier', async () => {
  const root = path.resolve('fixture-root');
  const calls = [];
  const paths = await prepareDesktopCarrier(root, {
    run: async (executable, args, cwd) => calls.push({ executable, args, cwd }),
    verify: (input) => calls.push({ verify: input }),
    exists: () => true,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(-2), ['run', 'dsh:assets']);
  assert.equal(calls[0].cwd, root);
  assert.deepEqual(calls[1], {
    verify: {
      extractedRoot: paths.extractedRoot,
      currentGateway: paths.gateway,
      pinnedCommit: DESKTOP_DSH_PINNED_COMMIT,
    },
  });
});

test('desktop preparation fails closed when the verified carrier has no entry point', async () => {
  await assert.rejects(
    prepareDesktopCarrier(path.resolve('fixture-root'), {
      run: async () => {},
      verify: () => {},
      exists: () => false,
    }),
    /no runtime entry point/,
  );
});

test('desktop preparation writes carrier stamp on cold run and reuses unchanged carrier on warm runs', async () => {
  await withCarrierFixture(async (root) => {
    populateValidCarrierWorkspace(root);
    let assetsRuns = 0;
    let gatewayBuilds = 0;
    const logs = [];

    const options = {
      enableStampReuse: true,
      env: {},
      run: async () => {
        assetsRuns += 1;
      },
      buildGateway: async () => {
        gatewayBuilds += 1;
      },
      log: (msg) => logs.push(msg),
    };

    const first = await prepareDesktopCarrier(root, options);
    assert.equal(assetsRuns, 1);
    assert.equal(gatewayBuilds, 0);
    assert.equal(fs.existsSync(desktopCarrierStampPath(root)), true);

    const second = await prepareDesktopCarrier(root, options);
    assert.deepEqual(second, first);
    assert.equal(assetsRuns, 1);
    assert.equal(gatewayBuilds, 1);
    assert.match(logs.at(-1) ?? '', /reusing verified desktop DSH carrier/);
  });
});

test('desktop carrier reuse fails closed and reruns dsh:assets when gateway, zip, unpacker, junctions or env overrides invalidate it', async () => {
  for (const scenario of [
    {
      name: 'changed gateway binary',
      mutate: (root, paths) => fs.writeFileSync(paths.gateway, 'gateway-v2'),
      repair: (root) => populateValidCarrierWorkspace(root, { gatewayBytes: 'gateway-v2' }),
    },
    {
      name: 'changed dsh-runtime.zip',
      mutate: (root) =>
        fs.writeFileSync(path.join(root, 'src-tauri', 'bin', 'dsh-runtime.zip'), 'carrier-zip-v2'),
      repair: (root) => populateValidCarrierWorkspace(root, { zipBytes: 'carrier-zip-v2' }),
    },
    {
      name: 'changed scripts/dsh/unpack-payload.mjs',
      mutate: (root) =>
        fs.writeFileSync(path.join(root, 'scripts', 'dsh', 'unpack-payload.mjs'), '// v2\n'),
      repair: (root) => populateValidCarrierWorkspace(root, { unpackerBytes: '// v2\n' }),
    },
    {
      name: 'missing junction entry',
      mutate: (root, paths) =>
        fs.rmSync(path.join(paths.runtimeRoot, 'packages', 'alias'), {
          recursive: true,
          force: true,
        }),
      repair: (root) => populateValidCarrierWorkspace(root),
    },
    {
      name: 'DSH_CHECKOUT override',
      env: { DSH_CHECKOUT: 'F:/custom-dsh' },
      mutate: () => {},
      repair: (root) => populateValidCarrierWorkspace(root),
    },
    {
      name: 'AI_NOVEL_STUDIO_FORCE_DSH_ASSETS=1',
      env: { AI_NOVEL_STUDIO_FORCE_DSH_ASSETS: '1' },
      mutate: () => {},
      repair: (root) => populateValidCarrierWorkspace(root),
    },
  ]) {
    await withCarrierFixture(async (root) => {
      const paths = populateValidCarrierWorkspace(root);
      let assetsRuns = 0;
      const runCold = async () => {
        assetsRuns += 1;
        if (assetsRuns > 1) {
          scenario.repair(root, paths);
        }
      };

      await prepareDesktopCarrier(root, {
        enableStampReuse: true,
        env: {},
        run: runCold,
        buildGateway: async () => {},
        log: () => {},
      });
      assert.equal(assetsRuns, 1, `${scenario.name}: cold seeding`);

      scenario.mutate(root, paths);
      await prepareDesktopCarrier(root, {
        enableStampReuse: true,
        env: scenario.env ?? {},
        run: runCold,
        buildGateway: async () => {},
        log: () => {},
      });
      assert.equal(assetsRuns, 2, `${scenario.name}: must invalidate reuse`);

      await prepareDesktopCarrier(root, {
        enableStampReuse: true,
        env: {},
        run: runCold,
        buildGateway: async () => {},
        log: () => {},
      });
      assert.equal(assetsRuns, 2, `${scenario.name}: repaired carrier must be reusable again`);
    });
  }
});
