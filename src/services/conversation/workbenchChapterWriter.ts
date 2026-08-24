import { aiSettingsService } from '../ai/aiClient';
import { executeChapterGeneration } from '../ai/chapterGenerationExecutionService';
import { draftVersionService } from '../database/draftVersionService';
import { buildSnapshotGenerateRequest } from '../generation/chapterGenerationPipeline';
import { generationContextCompiler } from '../generation/generationContextCompiler';
import { validateCandidateText } from '../agent-tools/candidateValidation';
import { generateId } from '../database/db';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { AiProvider, AiSettings } from '../../types/ai';

export interface WorkbenchChapterWriteInput {
  novelId: string;
  chapterId: string;
  goal: string;
  mode: 'generate' | 'polish';
  previousCandidateText?: string;
  memoryContext?: unknown;
  modelSnapshot: TaskModelSnapshot;
  signal?: AbortSignal;
}

export interface WorkbenchChapterWriteResult {
  text: string;
  source: 'writer';
  taskId?: string;
  artifactId?: string;
  contextHash?: string;
  resolvedSettings?: AiSettings;
}

export interface WorkbenchChapterWriterDependencies {
  executeGeneration?: typeof executeChapterGeneration;
  compileContext?: typeof generationContextCompiler.compile;
  getSettings?: () => AiSettings;
}

function formatMemoryContext(memoryContext: unknown): string {
  if (!memoryContext || typeof memoryContext !== 'object') return '';
  const record = memoryContext as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(record.matches)
        ? record.matches
        : [];
  if (items.length === 0) return '';
  const lines = items
    .slice(0, 5)
    .map((item, idx) => {
      if (typeof item === 'string') return `${idx + 1}. ${item}`;
      if (item && typeof item === 'object') {
        const itemRecord = item as Record<string, unknown>;
        const content = itemRecord.content || itemRecord.text || itemRecord.summary || '';
        return `${idx + 1}. ${String(content)}`;
      }
      return '';
    })
    .filter(Boolean);
  return lines.length > 0 ? `【检索到的长期记忆事实】\n${lines.join('\n')}` : '';
}

export function createWorkbenchChapterWriter(deps: WorkbenchChapterWriterDependencies = {}) {
  const executeGen = deps.executeGeneration ?? executeChapterGeneration;
  const compileCtx = deps.compileContext ?? ((input) => generationContextCompiler.compile(input));
  const getAiSettings = deps.getSettings ?? (() => aiSettingsService.getSettings());

  async function generate(input: WorkbenchChapterWriteInput): Promise<WorkbenchChapterWriteResult> {
    if (!input.modelSnapshot) {
      throw new Error('写章调用缺少必要的 modelSnapshot 冻结快照参数。');
    }

    const snapshot = await compileCtx({
      novelId: input.novelId,
      chapterId: input.chapterId,
      userInstruction: input.goal,
    });
    const request = buildSnapshotGenerateRequest(snapshot);

    // 1. 如果有前序记忆事实检索，附加至 Prompt
    const memoryText = formatMemoryContext(input.memoryContext);
    if (memoryText) {
      const userMsg = request.messages[1];
      if (userMsg) {
        userMsg.content = `${userMsg.content}\n\n${memoryText}`;
      }
    }

    // 2. 如果是润色或重写，且有上一版候选正文或已采用正文，附加至 Prompt
    let sourceText = input.previousCandidateText?.trim();
    if (!sourceText && input.mode === 'polish') {
      const adopted = await draftVersionService.getAdoptedByChapterId(input.chapterId);
      sourceText = adopted?.content?.trim();
    }

    if (input.mode === 'polish' && !sourceText) {
      const error = new Error('当前章节没有可润色的正文。请先生成一版正文。') as Error & {
        code: string;
      };
      error.code = 'WORKBENCH_POLISH_SOURCE_MISSING';
      throw error;
    }

    if (sourceText) {
      const userMsg = request.messages[1];
      if (userMsg) {
        userMsg.content = `${userMsg.content}\n\n【待修改/润色原正文】\n${sourceText}`;
      }
    }

    // 3. 严格依据冻结快照派生配置，严禁从全局当前设置漂移
    const baseSettings = getAiSettings();
    const snapshotModel = input.modelSnapshot;

    let apiKey = '';
    if (snapshotModel.runtimeMode === 'api') {
      if (!snapshotModel.baseUrl?.trim()) {
        throw new Error('冻结模型快照缺少 API Base URL，拒绝使用后来修改的全局设置。');
      }
      if (baseSettings.provider === snapshotModel.providerId && baseSettings.apiKey) {
        apiKey = baseSettings.apiKey;
      } else {
        throw new Error(
          `无法获取冻结模型 Provider (${snapshotModel.providerId}) 对应的 API 安全凭据。`,
        );
      }
    }

    const settings: AiSettings = {
      ...baseSettings,
      provider: snapshotModel.providerId as AiProvider,
      modelName: snapshotModel.modelId,
      runtimeMode: snapshotModel.runtimeMode,
      baseUrl: snapshotModel.runtimeMode === 'mock' ? '' : snapshotModel.baseUrl!,
      apiKey,
      temperature:
        typeof snapshotModel.options?.temperature === 'number'
          ? snapshotModel.options.temperature
          : 0.7,
      maxTokens:
        typeof snapshotModel.options?.maxTokens === 'number'
          ? snapshotModel.options.maxTokens
          : 4000,
      timeoutSeconds:
        typeof snapshotModel.options?.timeoutSeconds === 'number'
          ? snapshotModel.options.timeoutSeconds
          : 120,
      inputPricePerMillionTokens: snapshotModel.pricing?.inputPricePerMillionTokens,
      outputPricePerMillionTokens: snapshotModel.pricing?.outputPricePerMillionTokens,
    };

    const operationId = 'workbench-write-' + generateId();

    const result = await executeGen({
      novelId: input.novelId,
      chapterId: input.chapterId,
      operationId,
      settings,
      request,
      sourceId: input.chapterId + ':' + operationId,
      sourceVersion: snapshot.contextHash ?? '',
      taskInput: {
        chapterTitle:
          snapshot.compiledContext?.baseContext?.chapterTitle ??
          snapshot.sources?.find((s) => s.type === 'chapter_outline')?.title ??
          '未命名章节',
        contextHash: snapshot.contextHash ?? '',
        targetWordCount: snapshot.compiledContext?.baseContext?.targetWordCount ?? 2000,
        mode: input.mode === 'polish' || Boolean(sourceText) ? 'rewrite' : 'new',
        userGoal: input.goal,
        novelId: input.novelId,
        chapterId: input.chapterId,
        purpose: 'workbench_chapter_candidate',
      },
      signal: input.signal,
    });

    const text = validateCandidateText('chapter_text', result.text);
    return {
      text,
      source: 'writer',
      taskId: result.taskId,
      artifactId: result.artifactBundle?.artifact.artifactId,
      contextHash: snapshot.contextHash,
      resolvedSettings: settings,
    };
  }

  return { generate };
}

export const workbenchChapterWriter = createWorkbenchChapterWriter();

export async function writeWorkbenchChapterCandidate(
  input: WorkbenchChapterWriteInput,
): Promise<WorkbenchChapterWriteResult> {
  return workbenchChapterWriter.generate(input);
}
