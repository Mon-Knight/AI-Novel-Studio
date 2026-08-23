import type { AiGenerateRequest } from '../../types/ai';
import { ROUTE_DECISION_TASK_INPUT_KEY } from '../../types/modelRuntime';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { estimateTokens } from './compilation/canonical';
import { localChapterModelQueue } from './localChapterModelQueue';
import type { ChapterGenerationExecutionInput } from './chapterGenerationExecutionService';

function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

/**
 * Runs one Beat through the writer contract with Novel Memory Layer integration.
 * Local endpoints stay on the single-concurrency queue; cloud writer fallback uses
 * the same compiled Beat envelope and does not switch to chapter_generate.
 */
export async function executeChapterSceneGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  const { sceneContext, ...taskInput } = input.taskInput;
  const content =
    typeof sceneContext === 'string' && sceneContext.trim()
      ? sceneContext.trim()
      : requestSource(input.request);

  // 1. 生成前：召回 Novel Memory Context
  let memoryContextText = '';
  let memorySnapshotVersion: number | undefined;
  let retrievedFragmentIds: string[] = [];
  const memorySources: Array<{
    sourceType: 'memory_context';
    sourceId: string;
    sourceVersion: string;
    origin: 'system';
    label: string;
    content: string;
    order: number;
    priority: number;
    required: boolean;
    maxTokens: number;
  }> = [];

  if (input.novelId) {
    try {
      const { novelMemoryManager } = await import('../memory/novelMemoryManager');
      const { formatSceneMemoryForCompilation } = await import(
        '../memory/retrieval/novelMemoryRetriever'
      );
      const sceneId =
        typeof taskInput.sceneId === 'string'
          ? taskInput.sceneId
          : taskInput.sceneNo
            ? `scene-${taskInput.sceneNo}`
            : 'scene-active';
      const povCharacterId =
        typeof taskInput.povCharacterId === 'string'
          ? taskInput.povCharacterId
          : typeof taskInput.povCharacter === 'string'
            ? taskInput.povCharacter
            : undefined;
      const activeCharacterIds = Array.isArray(taskInput.activeCharacterIds)
        ? (taskInput.activeCharacterIds as string[])
        : Array.isArray(taskInput.characters)
          ? (taskInput.characters as string[])
          : undefined;

      const retrieved = await novelMemoryManager.retrieveContext({
        novelId: input.novelId,
        sceneId,
        povCharacterId,
        activeCharacterIds,
        maxMemoryTokens: 2_000,
      });

      if (
        retrieved &&
        (retrieved.longTermMemories.length > 0 ||
          retrieved.midTermMemories.length > 0 ||
          retrieved.shortTermMemories.length > 0 ||
          retrieved.povCharacter ||
          retrieved.activeCharacters.length > 0)
      ) {
        memoryContextText = formatSceneMemoryForCompilation(retrieved);
        retrievedFragmentIds = [
          ...retrieved.longTermMemories,
          ...retrieved.midTermMemories,
          ...retrieved.shortTermMemories,
        ].map((m) => m.id);

        const versions = novelMemoryManager.listMemoryVersions(input.novelId);
        memorySnapshotVersion =
          versions.length > 0 ? versions[versions.length - 1].versionNumber : 1;

        memorySources.push({
          sourceType: 'memory_context',
          sourceId: `memory:${input.novelId}:${sceneId}`,
          sourceVersion: String(memorySnapshotVersion),
          origin: 'system',
          label: 'Novel Memory Layer context',
          content: memoryContextText,
          order: 1,
          priority: 80,
          required: false,
          maxTokens: 2_000,
        });
      }
    } catch {
      // 容错回退：无记忆数据或异常时平滑降级为空上下文
    }
  }

  // 2. 路由决策 (Route Decision)
  let routeDecision = input.routeDecision;
  if (!routeDecision) {
    if (input.settings.localChapterModel?.enabled) {
      const { syncLocalModelLifecycleSidecar } = await import('./runtime/modelLifecycleSidecar');
      await syncLocalModelLifecycleSidecar(input.settings.localChapterModel);
    }
    const { routeCreativeTask } = await import('./runtime/modelRouter');
    routeDecision = routeCreativeTask(input.settings, 'chapter_scene_generate', {
      compiledContextTokens: estimateTokens(content) + estimateTokens(memoryContextText),
    });
  }

  // 3. 构建编译任务并执行
  const run = () =>
    executeAiTask({
      operationId: input.operationId,
      traceId: input.traceId ?? input.operationId,
      taskType: 'chapter_scene_generate',
      scopeType: 'chapter',
      novelId: input.novelId,
      chapterId: input.chapterId,
      targetHintJson: input.targetHintJson,
      settings: input.settings,
      routeDecision,
      compilation: {
        taskInput: {
          ...taskInput,
          protocolVersion: 'scene-beat-prose-v1',
          [ROUTE_DECISION_TASK_INPUT_KEY]: routeDecision,
          ...(memoryContextText
            ? {
                memoryContext: memoryContextText,
                memoryVersion: memorySnapshotVersion,
                retrievedFragments: retrievedFragmentIds,
              }
            : {}),
        },
        sources: [
          {
            sourceType: 'request_context',
            sourceId: input.sourceId,
            sourceVersion: input.sourceVersion,
            origin: 'request',
            label: 'Frozen chapter Beat writer context',
            content,
            order: 0,
            priority: 100,
            required: true,
            maxTokens: 3_000,
          },
          ...memorySources,
        ],
      },
      signal: input.signal,
      stream: input.stream,
      onStreamEvent: input.onStreamEvent,
    });

  const result =
    routeDecision.selected.kind === 'local'
      ? await localChapterModelQueue.enqueue(input.operationId, run, input.signal)
      : await run();

  // 4. 生成后：自动应用 State Delta 并创建世界状态快照
  if (input.novelId && result?.text?.trim()) {
    try {
      const { novelMemoryManager } = await import('../memory/novelMemoryManager');
      const sceneId =
        typeof taskInput.sceneId === 'string'
          ? taskInput.sceneId
          : taskInput.sceneNo
            ? `scene-${taskInput.sceneNo}`
            : 'scene-active';
      const sceneTitle =
        typeof taskInput.sceneTitle === 'string'
          ? taskInput.sceneTitle
          : `Scene ${taskInput.sceneNo || ''}`.trim();

      await novelMemoryManager.applyStateDelta(
        input.novelId,
        [
          {
            entityId: sceneId,
            entityType: 'world',
            changes: {
              eventDescription: `完成分镜正文生成：${result.text.slice(0, 100)}...`,
              sceneId,
            },
            sourceScene: sceneTitle,
            confidence: 0.9,
            timestamp: new Date().toISOString(),
          },
        ],
        `Scene 生成完成: ${sceneTitle}`,
      );
    } catch {
      // 容错保护：状态更新失败不影响正文正常交付
    }
  }

  return result;
}
