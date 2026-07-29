import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import type { AiSettings, AiTaskType } from '../../types/ai';

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

Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

const vite = await createServer({
  appType: 'custom',
  define: {
    'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
  },
  server: { middlewareMode: true, hmr: false },
});
const { createAiClient } = (await vite.ssrLoadModule(
  '/src/services/ai/aiClient.ts',
)) as typeof import('./aiClient');

after(async () => {
  await vite.close();
});

const governedTaskTypes: AiTaskType[] = [
  'chapter_generate',
  'autonomous_plot_plan',
  'autonomous_character_evolution',
  'autonomous_world_build',
  'autonomous_conflict_generate',
  'autonomous_pacing_control',
  'autonomous_chapter_batch',
];

const settings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 8000,
  timeoutSeconds: 60,
  mockMode: true,
};

test('direct client calls fail closed for every governed task type', async () => {
  const client = createAiClient(settings);
  for (const taskType of governedTaskTypes) {
    await assert.rejects(
      client.generate({
        taskType,
        messages: [{ role: 'user', content: 'test' }],
      }),
      new RegExp(`Task ${taskType} must run through executeAiTask`),
    );
  }
});
