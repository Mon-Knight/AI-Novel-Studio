import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { AiSettings } from '../../types/ai';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const { getAiSettings, maskAiApiKey, normalizeAiSettings, saveAiSettings } =
  await import('./aiSettingsStore');

beforeEach(() => storage.clear());

test('settings normalization preserves runtime selection and hard governance bounds', () => {
  const normalized = normalizeAiSettings({
    runtimeMode: 'api',
    mockMode: false,
    provider: 'deepseek',
    maxRequestsPerMinute: 999,
    maxConcurrentAiRequests: 0,
    budgetWarningPercent: 1,
    dailyCostBudgetUsd: 10,
  });

  assert.equal(normalized.runtimeMode, 'api');
  assert.equal(normalized.provider, 'deepseek');
  assert.equal(normalized.maxRequestsPerMinute, 120);
  assert.equal(normalized.maxConcurrentAiRequests, 1);
  assert.equal(normalized.budgetWarningPercent, 50);
  assert.equal(normalized.dailyCostBudgetUsd, undefined);
});

test('settings persistence returns the same normalized pricing snapshot without the pipeline module', () => {
  const settings: AiSettings = {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: '1234567890abcdef',
    modelName: 'model',
    temperature: 0.5,
    maxTokens: 4096,
    timeoutSeconds: 60,
    inputPricePerMillionTokens: 1.25,
    outputPricePerMillionTokens: 2.5,
    maxRequestsPerMinute: 20,
    maxConcurrentAiRequests: 3,
    dailyTokenBudget: 100_000,
    dailyCostBudgetUsd: 5,
    budgetWarningPercent: 75,
    mockMode: false,
  };

  saveAiSettings(settings);

  assert.deepEqual(getAiSettings(), settings);
  assert.equal(maskAiApiKey(settings.apiKey), '1234...cdef');
});

test('local chapter model settings normalize to the verified scene protocol', () => {
  const normalized = normalizeAiSettings({
    runtimeMode: 'mock',
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    mockMode: true,
    localChapterModel: {
      enabled: true,
      providerId: ' local_llama_cpp ',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 9999,
      contextTokens: 128000,
      maxTokens: 12000,
      temperature: 3,
      topP: 2,
      topK: 5000,
      repeatPenalty: 4,
      seed: 42,
    },
  });

  assert.equal(normalized.localChapterModel?.enabled, true);
  assert.equal(normalized.localChapterModel?.providerId, 'local_llama_cpp');
  assert.equal(normalized.localChapterModel?.contextTokens, 4096);
  assert.equal(normalized.localChapterModel?.maxTokens, 1024);
  assert.equal(normalized.localChapterModel?.temperature, 2);
  assert.equal(normalized.localChapterModel?.topP, 1);
  assert.equal(normalized.localChapterModel?.topK, 4096);
  assert.equal(normalized.localChapterModel?.repeatPenalty, 3);
  assert.equal(normalized.localChapterModel?.seed, 42);
});
