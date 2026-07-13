import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCall: vi.fn(async (_command: string, args: any) => ({
    workflowId: 'workflow-a', rootTaskId: 'root-a', childTaskIds: args.input.steps.map((_: unknown, index: number) => `child-${index}`),
  })),
  configureFromLocalSettings: vi.fn(async () => undefined),
}));

vi.mock('../../services/database/db', () => ({ isTauri: () => true, dbCall: mocks.dbCall }));
vi.mock('../../services/ai/aiSettingsService', () => ({
  aiSettingsService: { getSettings: () => ({
    provider: 'mock', runtimeMode: 'mock', modelName: 'ignored', temperature: 0.4,
    maxTokens: 2048, timeoutSeconds: 30,
  }) },
}));
vi.mock('../../services/ai-tasks/aiWorkerClientService', () => ({
  aiWorkerClientService: { configureFromLocalSettings: mocks.configureFromLocalSettings },
}));

import { aiWorkflowService, type BackgroundWorkflowStep, type CreateBackgroundWorkflowInput } from '../../services/ai-tasks/aiWorkflowService';

function spec(taskType: BackgroundWorkflowStep['taskType']): CreateBackgroundWorkflowInput {
  return {
    workflowName: taskType,
    taskType,
    novelId: 'novel-a',
    scopeType: 'novel',
    inputPayloadJson: {},
    sourceManifestJson: [],
    steps: [{
      stepKey: taskType,
      taskType,
      agentRole: '测试',
      artifactType: taskType === 'chapter_polish' ? 'chapter_text'
        : taskType === 'chapter_summary' ? 'chapter_summary'
          : taskType === 'volume_summary' ? 'volume_summary' : 'outline_text',
      messages: [{ role: 'user', content: 'frozen prompt' }],
      reviewOutput: true,
    }],
  };
}

describe('stage 2D background workflow submission', () => {
  beforeEach(() => { mocks.dbCall.mockClear(); mocks.configureFromLocalSettings.mockClear(); });

  it.each(['chapter_polish', 'chapter_summary', 'volume_summary', 'outline_generate'] as const)(
    'submits %s to the existing Rust workflow command and returns immediately',
    async (taskType) => {
      const created = await aiWorkflowService.createBackground(spec(taskType));
      expect(created.rootTaskId).toBe('root-a');
      expect(mocks.configureFromLocalSettings).toHaveBeenCalledOnce();
      expect(mocks.dbCall).toHaveBeenCalledOnce();
      const [command, args] = mocks.dbCall.mock.calls[0];
      expect(command).toBe('create_background_ai_workflow');
      expect(args.input.taskType).toBe(taskType);
      expect(args.input.steps[0].messages[0].content).toBe('frozen prompt');
      expect(args.input.providerOptionsJson).not.toHaveProperty('apiKey');
    },
  );
});
