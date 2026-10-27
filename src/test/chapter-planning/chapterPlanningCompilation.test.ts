import { describe, expect, test } from 'vitest';
import type { AiSettings } from '../../types/ai';
import { compileProductionAiExecution } from '../../services/ai/compilation/productionCompilationRegistry';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'compilation-test-secret',
  modelName: 'deepseek-v4-flash',
  temperature: 0.4,
  maxTokens: 4096,
  timeoutSeconds: 30,
  mockMode: false,
};

const hash = 'b'.repeat(64);

function contextSource(content: string) {
  return {
    sourceType: 'request_context' as const,
    sourceId: 'source-1',
    sourceVersion: hash,
    origin: 'request' as const,
    label: 'Frozen planning context',
    content,
    order: 0,
    priority: 100,
    required: true,
    requireFull: true,
  };
}

const scope = { scopeType: 'chapter' as const, novelId: 'novel-1', chapterId: 'chapter-1' };

describe('chapter planning compilation registration', () => {
  test('compiles the Scene-only v2 contract without Beats instructions', async () => {
    const contract = await compileProductionAiExecution({
      taskType: 'chapter_scene_plan_v2_generate',
      scope,
      compilation: {
        taskInput: {
          chapterTitle: '第十二章 城门',
          targetWordCount: 2500,
          contextHash: hash,
          maxScenes: 12,
        },
        sources: [contextSource('冻结章节上下文')],
      },
      settings,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
    expect(contract.expectedArtifactType).toBe('plan');
    expect(contract.taskType).toBe('chapter_scene_plan_v2_generate');
    const userMessage =
      contract.request.messages[contract.request.messages.length - 1]?.content ?? '';
    expect(userMessage).toContain('"scenes"');
    expect(userMessage).toContain('不得输出 beats');
    expect(contract.constraintSnapshot.payloadJson.constraints).toMatchObject({
      sceneOnly: true,
      candidateOnly: true,
      mayWriteBusinessData: false,
    });
  });

  test('compiles the Beat plan contract with a strict Beat count and SHA binding', async () => {
    const targetCharactersPerBeat = [600, 650, 700, 550];
    const contract = await compileProductionAiExecution({
      taskType: 'chapter_beat_plan_generate',
      scope,
      compilation: {
        taskInput: {
          chapterTitle: '第十二章 城门',
          sceneId: 'scene-1',
          sceneNo: 1,
          targetBeatCount: 4,
          minimumBeatCharacters: 500,
          maximumBeatCharacters: 900,
          targetCharactersPerBeat,
          sourceContextHash: hash,
          previousTextHash: 'c'.repeat(64),
          inputStateHash: 'd'.repeat(64),
        },
        sources: [contextSource('当前 Scene 与实际已写状态')],
      },
      settings,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
    expect(contract.expectedArtifactType).toBe('plan');
    const userMessage =
      contract.request.messages[contract.request.messages.length - 1]?.content ?? '';
    expect(userMessage).toContain('恰好包含 4 个有序 Beat');
    expect(userMessage).toContain(targetCharactersPerBeat.join('、'));
    expect(userMessage).toContain(hash);
  });

  test('compiles the actual Beat state extraction contract as candidate-only JSON', async () => {
    const contract = await compileProductionAiExecution({
      taskType: 'chapter_beat_state_extract',
      scope,
      compilation: {
        taskInput: {
          sourceTextHash: hash,
        },
        sources: [contextSource('当前 Beat 正文与进入前实际状态')],
      },
      settings,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
    expect(contract.expectedArtifactType).toBe('generic_json');
    expect(contract.constraintSnapshot.payloadJson.constraints).toMatchObject({
      jsonOnly: true,
      candidateOnly: true,
      mayWriteBusinessData: false,
      semanticValidation: 'not_checked',
      actualStateOnly: true,
    });
    expect(contract.request.messages[contract.request.messages.length - 1]?.content).toContain(
      'semanticValidation',
    );
  });

  test('rejects Beat planning input without the required SHA-256 baseline', async () => {
    await expect(
      compileProductionAiExecution({
        taskType: 'chapter_beat_plan_generate',
        scope,
        compilation: {
          taskInput: {
            sceneId: 'scene-1',
            sceneNo: 1,
            targetBeatCount: 2,
            minimumBeatCharacters: 500,
            maximumBeatCharacters: 900,
            targetCharactersPerBeat: [600, 600],
            sourceContextHash: 'weak-txt-hash',
            previousTextHash: 'c'.repeat(64),
            inputStateHash: 'd'.repeat(64),
          },
          sources: [contextSource('当前 Scene 与实际已写状态')],
        },
        settings,
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      }),
    ).rejects.toThrow(/SHA-256/u);
  });
});
