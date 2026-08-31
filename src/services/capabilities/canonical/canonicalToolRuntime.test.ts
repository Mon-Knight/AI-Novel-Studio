import assert from 'node:assert/strict';
import test from 'node:test';

import { getCanonicalToolManifest } from './canonicalToolProjection';
import {
  executeCanonicalTool,
  executeCanonicalToolForHostValidation,
} from './canonicalToolRuntime';

test('runtime fails closed on manifest, version, exposure, allowlist and permission drift', async () => {
  const manifest = await getCanonicalToolManifest();
  const call = {
    name: 'novel.read',
    version: '1',
    argumentsJson: { novelId: 'novel-1' },
    expectedProjectionHash: manifest.projectionHash,
  };
  const context = {
    invocationId: 'runtime-gate-test',
    allowedTools: ['novel.read@1'],
    novelId: 'novel-1',
    grantedPermissions: ['novel.read'],
  };

  const staleHash = await executeCanonicalToolForHostValidation(
    { ...call, expectedProjectionHash: '0'.repeat(64) },
    context,
  );
  assert.equal(staleHash.error?.code, 'INTEGRITY_ERROR');

  const wrongVersion = await executeCanonicalToolForHostValidation(
    { ...call, version: '2' },
    context,
  );
  assert.equal(wrongVersion.error?.code, 'NOT_FOUND');

  const missingInvocation = await executeCanonicalToolForHostValidation(call, {
    ...context,
    invocationId: '',
  });
  assert.equal(missingInvocation.error?.code, 'INVALID_ARGUMENT');

  const agentAudience = await executeCanonicalTool(call, context);
  assert.equal(agentAudience.error?.code, 'PERMISSION_DENIED');
  assert.match(agentAudience.error?.message ?? '', /尚未向 Main Agent 放行/);

  const absentFromRunAllowlist = await executeCanonicalToolForHostValidation(call, {
    ...context,
    allowedTools: [],
  });
  assert.equal(absentFromRunAllowlist.error?.code, 'PERMISSION_DENIED');
  assert.match(absentFromRunAllowlist.error?.message ?? '', /不在本次宿主 allowlist/);

  const missingPermission = await executeCanonicalToolForHostValidation(call, {
    ...context,
    grantedPermissions: [],
  });
  assert.equal(missingPermission.error?.code, 'PERMISSION_DENIED');
  assert.match(missingPermission.error?.message ?? '', /缺少宿主权限/);

  const legacyAlias = await executeCanonicalToolForHostValidation(
    { ...call, name: 'novel.read_context' },
    { ...context, allowedTools: ['novel.read_context@1'] },
  );
  assert.equal(legacyAlias.error?.code, 'NOT_FOUND');
});

test('runtime validates arguments and cancellation before entering a fixed adapter', async () => {
  const manifest = await getCanonicalToolManifest();
  const call = {
    name: 'novel.read',
    version: '1',
    argumentsJson: { novelId: 'novel-1', repository: 'forbidden' },
    expectedProjectionHash: manifest.projectionHash,
  };
  const context = {
    invocationId: 'runtime-input-test',
    allowedTools: ['novel.read@1'],
    novelId: 'novel-1',
    grantedPermissions: ['novel.read'],
  };

  const invalidArguments = await executeCanonicalToolForHostValidation(call, context);
  assert.equal(invalidArguments.error?.code, 'INVALID_ARGUMENT');

  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeCanonicalToolForHostValidation(
    { ...call, argumentsJson: { novelId: 'novel-1' } },
    { ...context, signal: controller.signal },
  );
  assert.equal(cancelled.error?.code, 'UPSTREAM_FAILURE');
  assert.match(cancelled.error?.message ?? '', /取消/);
});
