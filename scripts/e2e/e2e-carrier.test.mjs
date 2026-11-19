import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  DESKTOP_DSH_PINNED_COMMIT,
  desktopCarrierEnvironment,
  desktopCarrierPaths,
  prepareDesktopCarrier,
} from './e2e-carrier.mjs';

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
