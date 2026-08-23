import { aiSettingsService } from '../ai/aiClient';
import { executeChapterGeneration } from '../ai/chapterGenerationExecutionService';
import { draftVersionService } from '../database/draftVersionService';
import {
  buildLocalSceneTaskInput,
  buildSnapshotGenerateRequest,
} from '../generation/chapterGenerationPipeline';
import { generationContextCompiler } from '../generation/generationContextCompiler';
import { validateCandidateText } from '../agent-tools/candidateValidation';
import { generateId } from '../database/db';

export interface WorkbenchChapterWriteInput {
  novelId: string;
  chapterId: string;
  goal: string;
  mode: 'generate' | 'polish';
  signal?: AbortSignal;
}

export interface WorkbenchChapterWriteResult {
  text: string;
  source: 'writer';
  taskId?: string;
  artifactId?: string;
  contextHash?: string;
}

export async function writeWorkbenchChapterCandidate(
  input: WorkbenchChapterWriteInput,
): Promise<WorkbenchChapterWriteResult> {
  const snapshot = await generationContextCompiler.compile({
    novelId: input.novelId,
    chapterId: input.chapterId,
    userInstruction: input.goal,
  });
  const request = buildSnapshotGenerateRequest(snapshot);
  if (input.mode === 'polish') {
    const adopted = await draftVersionService.getAdoptedByChapterId(input.chapterId);
    const source = adopted?.content?.trim();
    if (!source) {
      const error = new Error('当前章节没有可润色的已采用正文。请先生成并采用一版正文。') as Error & {
        code: string;
      };
      error.code = 'WORKBENCH_POLISH_SOURCE_MISSING';
      throw error;
    }
    const user = request.messages[1];
    if (user) {
      user.content = user.content + '\n\n待润色正文：\n' + source;
    }
  }
  const settings = aiSettingsService.getSettings();
  const operationId = 'workbench-write-' + generateId();
  const result = await executeChapterGeneration({
    novelId: input.novelId,
    chapterId: input.chapterId,
    operationId,
    settings,
    request,
    sourceId: input.chapterId + ':' + operationId,
    sourceVersion: snapshot.contextHash,
    taskInput: {
      ...buildLocalSceneTaskInput(snapshot),
      mode: input.mode === 'polish' ? 'rewrite' : 'new',
      userGoal: input.goal,
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
  };
}

export const workbenchChapterWriter = {
  generate: writeWorkbenchChapterCandidate,
};
