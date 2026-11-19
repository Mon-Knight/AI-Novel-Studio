import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  desktop: true,
  create: vi.fn(),
  append: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  capture: vi.fn(),
  model: {
    providerId: 'mock',
    modelId: 'offline',
    runtimeMode: 'mock' as const,
    capabilities: [],
    options: {},
    capturedAt: 'frozen',
  },
}));
vi.mock('../database/db', () => ({ isTauri: () => fixture.desktop }));
vi.mock('../conversation/taskModelSnapshot', () => ({ captureTaskModelSnapshot: fixture.capture }));
vi.mock('../conversation/taskConversationService', () => ({
  taskConversationService: {
    createInitialized: fixture.create,
    appendTurn: fixture.append,
    get: fixture.get,
  },
}));
vi.mock('../dsh/taskSessionAdapter', () => ({
  taskSessionAdapter: { startTurn: fixture.start, cancel: fixture.cancel },
}));
import { submitProductionAiEntry } from './productionAiEntryService';
const request = {
  novelId: 'novel',
  chapterId: 'chapter',
  goal: '本任务章节准备，只读不调用模型',
  entry: { kind: 'chapter_readiness' as const, planId: 'plan' },
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.desktop = true;
  fixture.capture.mockReturnValue(fixture.model);
  fixture.create.mockResolvedValue({
    conversation: { conversationId: 'root', novelId: 'novel', defaultModel: fixture.model },
    turn: { turnId: 'turn' },
  });
  fixture.append.mockResolvedValue({ turnId: 'resume-turn' });
  fixture.start.mockResolvedValue({ runId: 'run', status: 'completed' });
  fixture.cancel.mockResolvedValue(true);
  fixture.get.mockResolvedValue({
    conversation: { conversationId: 'root', novelId: 'novel', defaultModel: fixture.model },
    artifacts: [
      { turnId: 'turn', artifactId: 'own' },
      { turnId: 'other-turn', artifactId: 'other' },
    ],
  });
});
describe('production domain submission', () => {
  it('creates persisted root/user goal then calls the same session runtime once with typed entry', async () => {
    const result = await submitProductionAiEntry(request);
    expect(fixture.create).toHaveBeenCalledWith('novel', request.goal, fixture.model);
    expect(fixture.start).toHaveBeenCalledTimes(1);
    expect(fixture.start).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'root',
        turnId: 'turn',
        chapterId: 'chapter',
        modelSnapshot: fixture.model,
        domainEntry: request.entry,
      }),
    );
    expect(result.artifactIds).toEqual(['own']);
  });
  it('explicit resume keeps root/model, appends a user turn and does not create another root', async () => {
    await submitProductionAiEntry({ ...request, conversationId: 'root' });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.capture).not.toHaveBeenCalled();
    expect(fixture.append).toHaveBeenCalledWith('root', 'user', request.goal);
    expect(fixture.start).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'root',
        turnId: 'resume-turn',
        modelSnapshot: fixture.model,
      }),
    );
  });
  it('rejects foreign task scope before appending or dispatching', async () => {
    fixture.get.mockResolvedValueOnce({ conversation: { novelId: 'foreign' } });
    await expect(submitProductionAiEntry({ ...request, conversationId: 'root' })).rejects.toThrow(
      'SCOPE_MISMATCH',
    );
    expect(fixture.append).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  });
  it('propagates cancellation to the native owner without claiming committed data was undone', async () => {
    const controller = new AbortController();
    let finish!: (run: { status: string }) => void;
    fixture.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = submitProductionAiEntry({ ...request, signal: controller.signal });
    await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledOnce());
    controller.abort();
    expect(fixture.cancel).toHaveBeenCalledWith('root');
    finish({ status: 'cancelled' });
    await expect(pending).rejects.toThrow('已提交的候选仍以权威事实为准');
  });
  it('does not dispatch an already-cancelled request or silently fall back after host failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      submitProductionAiEntry({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
    fixture.start.mockRejectedValueOnce(new Error('HOST_STAGE_CONFLICT'));
    await expect(submitProductionAiEntry(request)).rejects.toThrow('HOST_STAGE_CONFLICT');
    expect(fixture.start).toHaveBeenCalledTimes(1);
  });
  it('keeps browser compatibility visibly separate from desktop persistence', async () => {
    fixture.desktop = false;
    await expect(submitProductionAiEntry(request)).rejects.toThrow('浏览器不是桌面验收');
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  });
});
