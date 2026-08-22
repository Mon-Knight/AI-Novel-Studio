import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { endpointId } from './local-model-benchmark-lib.mjs';

const DEFAULT_SIDECAR = path.join(os.homedir(), '.ai-novel-studio-local-model-lifecycle.json');
const ALLOWED = new Set(['TRAINING', 'TESTING', 'FAILED', 'DISABLED']);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--'))
      throw new Error('arguments must use --name value pairs');
    values[key.slice(2)] = value;
    index += 1;
  }
  const lifecycle = String(values.lifecycle ?? '').toUpperCase();
  if (!ALLOWED.has(lifecycle))
    throw new Error(
      '--lifecycle must be TRAINING, TESTING, FAILED or DISABLED; AVAILABLE requires benchmark',
    );
  if (!values.model) throw new Error('--model is required');
  return {
    providerId: values['provider-id'] ?? 'local_llama_cpp',
    modelId: values.model,
    lifecycle,
    sidecarPath: values.sidecar ?? DEFAULT_SIDECAR,
    failureReason: values.reason,
  };
}

async function writeSidecar(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp-' + process.pid;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    await rename(temporary, filePath);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EEXIST') throw error;
    await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }
}

export async function markLocalModelLifecycle(options) {
  const now = new Date().toISOString();
  const sidecar = {
    schemaVersion: 1,
    endpointId: endpointId(options.providerId, options.modelId),
    providerId: options.providerId,
    modelId: options.modelId,
    lifecycle: options.lifecycle,
    updatedAt: now,
    ...(options.failureReason
      ? { failureReason: String(options.failureReason).slice(0, 500) }
      : {}),
  };
  await writeSidecar(options.sidecarPath, sidecar);
  return sidecar;
}

async function main() {
  const sidecar = await markLocalModelLifecycle(parseArgs(process.argv.slice(2)));
  console.log(
    JSON.stringify({
      endpointId: sidecar.endpointId,
      lifecycle: sidecar.lifecycle,
      updatedAt: sidecar.updatedAt,
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[local-model-lifecycle] ' + (error instanceof Error ? error.message : 'failed'));
    process.exitCode = 2;
  });
}
