import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectAiGenerateSource } from './check-ai-request-options.mjs';

test('accepts direct and factory-created AI clients with explicit options', () => {
  const result = inspectAiGenerateSource(
    `
      await client.generate(request, options);
      await createAiClient(settings).generate(request, { signal, requestId });
      await this.client.generate(request, aiOptions);
    `,
  );
  assert.equal(result.calls.length, 3);
  assert.deepEqual(result.violations, []);
});

test('rejects omitted, undefined, and null request options', () => {
  const result = inspectAiGenerateSource(
    `
      await client.generate(request);
      await client.generate(request, undefined);
      await createAiClient(settings).generate(request, null);
    `,
  );
  assert.equal(result.calls.length, 3);
  assert.deepEqual(
    result.violations.map(({ line }) => line),
    [2, 3, 4],
  );
});

test('ignores domain services that happen to expose a generate method', () => {
  const result = inspectAiGenerateSource(
    `
      await autonomousStoryService.generate(input);
      await settingSuggestionService.generate(input);
    `,
  );
  assert.deepEqual(result, { calls: [], violations: [] });
});

test('reports stable TSX source coordinates', () => {
  const result = inspectAiGenerateSource(
    `const View = () => <button onClick={() => client.generate(request)}>Run</button>;`,
    'View.tsx',
  );
  assert.deepEqual(result.violations, [{ file: 'View.tsx', line: 1, column: 43 }]);
});
