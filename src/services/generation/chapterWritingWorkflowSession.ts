import { CHAPTER_WRITING_WORKFLOW_SCHEMA } from '../../types/chapterWritingWorkflow';
import type { ChapterWritingWorkflowCheckpoint } from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../ai/compilation/canonical';
import { validateWorkflowCheckpoint, workflowFailure } from './chapterWritingWorkflowValidation';
import type {
  ChapterWritingWorkflowPorts,
  ChapterWritingWorkflowSession,
  RunChapterWritingWorkflowInput,
} from './chapterWritingWorkflowPorts';

export async function openChapterWritingWorkflow(
  input: RunChapterWritingWorkflowInput,
  ports: ChapterWritingWorkflowPorts,
): Promise<ChapterWritingWorkflowSession> {
  const { identity, budget } = input;
  if (
    identity.schemaVersion !== CHAPTER_WRITING_WORKFLOW_SCHEMA ||
    !identity.workflowId ||
    !identity.novelId ||
    !identity.chapterId ||
    !input.attemptId ||
    !/^[0-9a-f]{64}$/.test(identity.contextHash) ||
    !/^[0-9a-f]{64}$/.test(identity.modelSnapshotHash) ||
    !input.sourceContext.trim() ||
    (await sha256(input.sourceContext)) !== identity.contextHash ||
    !Number.isSafeInteger(input.targetCharacters) ||
    input.targetCharacters < 1 ||
    !Array.isArray(input.chapterConstraints) ||
    input.chapterConstraints.some((item) => typeof item !== 'string') ||
    ![budget.maxCalls, budget.maxWallClockMs, budget.maxBeatAttempts, budget.maxBeats].every(
      Number.isSafeInteger,
    ) ||
    budget.maxCalls < 1 ||
    budget.maxCalls > 128 ||
    budget.maxWallClockMs < 1 ||
    budget.maxWallClockMs > 480_000 ||
    budget.maxBeatAttempts < 1 ||
    budget.maxBeatAttempts > 2 ||
    budget.maxBeats < 1 ||
    budget.maxBeats > 72
  )
    workflowFailure('CHAPTER_WORKFLOW_INPUT_INVALID', '缺少冻结身份、强哈希、有效目标或受限预算。');
  const now = ports.now ?? Date.now;
  await ports.assertBaseline();
  const loaded = await ports.load();
  const requestHash = await canonicalHash({
    identity,
    budget,
    targetCharacters: input.targetCharacters,
    chapterConstraints: input.chapterConstraints,
  });
  let checkpoint: ChapterWritingWorkflowCheckpoint;
  if (loaded) {
    await validateWorkflowCheckpoint(loaded, input, ports);
    checkpoint = structuredClone(loaded);
    if (checkpoint.status !== 'completed') {
      if (!input.authorizeResume || input.attemptId === checkpoint.attemptId) {
        workflowFailure(
          'CHAPTER_WORKFLOW_RESUME_REQUIRED',
          '中断或失败的写作阶段必须由作者明确继续，并创建新尝试。',
        );
      }
      checkpoint.attemptHistory.push({
        attemptId: checkpoint.attemptId,
        startedAt: checkpoint.startedAt,
        callsUsed: checkpoint.callsUsed,
        status: checkpoint.status === 'running' ? 'interrupted' : checkpoint.status,
      });
      checkpoint.attemptId = input.attemptId;
      checkpoint.startedAt = now();
      checkpoint.callsUsed = 0;
      checkpoint.status = 'running';
      checkpoint.stages = checkpoint.stages.map((stage) =>
        stage.status === 'running'
          ? { ...stage, status: 'failed', errorCode: 'CHAPTER_STAGE_INTERRUPTED' }
          : stage,
      );
      checkpoint.revision += 1;
      await ports.save(structuredClone(checkpoint), loaded.revision);
    }
  } else {
    checkpoint = {
      identity: structuredClone(identity),
      requestHash,
      revision: 0,
      status: 'running',
      attemptId: input.attemptId,
      startedAt: now(),
      callsUsed: 0,
      budget: structuredClone(budget),
      attemptHistory: [],
      beatPlans: [],
      prose: [],
      scenes: [],
      stages: [],
    };
    await ports.save(structuredClone(checkpoint), null);
  }
  const session: ChapterWritingWorkflowSession = {
    input,
    ports,
    checkpoint,
    now,
    commit: async (change) => {
      const before = session.checkpoint;
      const next = structuredClone(before);
      change(next);
      next.revision = before.revision + 1;
      await ports.save(structuredClone(next), before.revision);
      session.checkpoint = next;
    },
    assertActive: async () => {
      const check = () => {
        if (input.signal?.aborted)
          workflowFailure('AI_REQUEST_CANCELLED', '本次写作已取消，迟到结果不能写入阶段。');
        if (now() < session.checkpoint.startedAt) {
          workflowFailure(
            'CHAPTER_WORKFLOW_CLOCK_CHANGED',
            '系统时间早于尝试开始时间，必须显式重新开始尝试。',
          );
        }
        if (now() - session.checkpoint.startedAt >= budget.maxWallClockMs) {
          workflowFailure('CHAPTER_WORKFLOW_DEADLINE_EXCEEDED', '本次写作尝试的时间预算已耗尽。');
        }
      };
      check();
      await ports.assertBaseline();
      check();
    },
  };
  return session;
}
