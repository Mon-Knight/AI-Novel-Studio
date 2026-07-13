import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoCreationWorkspaceSnapshot } from '../../types/coCreation';

const harness = vi.hoisted(() => ({
  novel: {} as Record<string, unknown>,
  worlds: [] as Array<Record<string, unknown>>,
  rules: [] as Array<Record<string, unknown>>,
  protagonist: null as Record<string, unknown> | null,
  volumes: [] as Array<Record<string, unknown>>,
  chapters: [] as Array<Record<string, unknown>>,
  master: null as Record<string, unknown> | null,
  volumeOutline: null as Record<string, unknown> | null,
  style: null as Record<string, unknown> | null,
  context: {} as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
}));

const mocks = vi.hoisted(() => ({
  getNovel: vi.fn(),
  getWorlds: vi.fn(),
  getRules: vi.fn(),
  getProtagonist: vi.fn(),
  getVolumes: vi.fn(),
  getVolume: vi.fn(),
  getChapters: vi.fn(),
  getChapter: vi.fn(),
  getMaster: vi.fn(),
  getMasterVersions: vi.fn(),
  getVolumeOutline: vi.fn(),
  getVolumeOutlineVersions: vi.fn(),
  getStyle: vi.fn(),
  buildContext: vi.fn(),
  createBackground: vi.fn(),
  getSettings: vi.fn(),
  open: vi.fn(),
}));

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: { getWorldSettings: mocks.getWorlds, getRuleSystems: mocks.getRules },
}));
vi.mock('../../services/database/protagonistRepository', () => ({
  protagonistRepository: { getByNovelId: mocks.getProtagonist },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: mocks.getVolumes, getById: mocks.getVolume },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: mocks.getChapters, getById: mocks.getChapter },
}));
vi.mock('../../services/outlines/outlineService', () => ({
  masterOutlineService: { getActive: mocks.getMaster, getVersions: mocks.getMasterVersions },
  volumeOutlineService: {
    getActive: mocks.getVolumeOutline,
    getVersions: mocks.getVolumeOutlineVersions,
  },
}));
vi.mock('../../services/styles/styleProfileService', () => ({
  styleProfileService: { getActive: mocks.getStyle },
}));
vi.mock('../../features/co-creation/contextBuilder', () => ({
  buildCoCreationContext: mocks.buildContext,
}));
vi.mock('../../services/ai-tasks/aiWorkflowService', () => ({
  aiWorkflowService: { createBackground: mocks.createBackground },
}));
vi.mock('../../services/ai/aiClient', () => ({
  createAiClient: vi.fn(),
  aiSettingsService: { getSettings: mocks.getSettings },
}));
vi.mock('../../services/co-creation/coCreationSessionService', () => ({
  coCreationSessionService: { open: mocks.open },
}));

import { outlineGenerateService } from '../../services/ai/outlineGenerateService';
import { coCreationGenerationService } from '../../services/co-creation/coCreationGenerationService';
import { normalizeNovel } from '../../features/novels/novelNormalizer';

function workspace(overrides: Partial<CoCreationWorkspaceSnapshot['session']> = {}): CoCreationWorkspaceSnapshot {
  return {
    session: {
      sessionId: 'session-a', novelId: 'novel-a', title: 'AI 共创', status: 'active',
      currentStage: 'outline', stageProgress: [], objectContext: { novelId: 'novel-a' },
      summary: '保持悬疑感', summaryHash: 'summary-hash', dataRevision: 5,
      dataHash: 'session-state-hash', createdAt: 'now', updatedAt: 'now', ...overrides,
    },
    messages: [{
      messageId: 'message-a', sessionId: 'session-a', sequenceNo: 1, role: 'user',
      status: 'completed', content: '从失窃记忆开场', contentHash: 'message-hash',
      contentLength: 8, operationId: 'message-operation', requestHash: 'message-request',
      createdAt: 'now',
    }],
    draftRevisions: [],
  };
}

async function compile(
  kind: 'master_outline' | 'chapter_outlines' = 'master_outline',
  sourceWorkspace = workspace(),
) {
  return coCreationGenerationService.compileBaseContext(sourceWorkspace, {
    kind,
    novelId: 'novel-a',
    sessionId: 'session-a',
    ...(kind === 'chapter_outlines'
      ? { volumeId: 'volume-a', chapterId: 'chapter-a', chapterCount: 2 }
      : {}),
  });
}

describe('co-creation outline frozen compilation', () => {
  beforeEach(() => {
    harness.novel = {
      id: 'novel-a', title: '记忆之城', genre: '悬疑', description: '记忆可交易',
      outline: '', protagonists: [], updatedAt: 'novel-v1',
    };
    harness.worlds = [{
      id: 'world-a', novelId: 'novel-a', title: '城邦', content: '雾城',
      isActive: true, updatedAt: 'world-v1',
    }];
    harness.rules = [{
      id: 'rule-a', novelId: 'novel-a', title: '记忆法则', content: '交易有代价',
      isActive: true, updatedAt: 'rule-v1',
    }];
    harness.protagonist = {
      id: 'legacy-a', novelId: 'novel-a', name: '林默', identity: '记忆侦探',
      goal: '找回过去', updatedAt: 'protagonist-v1',
    };
    harness.volumes = [{
      id: 'volume-a', novelId: 'novel-a', title: '雾城卷', summary: '追查失窃案',
      goal: '找到黑市', updatedAt: 'volume-v1',
    }];
    harness.chapters = [{
      id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '失窃',
      outline: '记忆被盗', goal: '进入黑市', updatedAt: 'chapter-v1',
    }];
    harness.master = {
      id: 'master-a', projectId: 'novel-a', title: '总纲', content: '追查记忆黑市',
      version: 1, isActive: true, updatedAt: 'master-v1',
    };
    harness.volumeOutline = {
      id: 'volume-outline-a', projectId: 'novel-a', volumeId: 'volume-a',
      title: '卷纲', content: '卷内追查', version: 1, isActive: true,
      updatedAt: 'volume-outline-v1',
    };
    harness.style = {
      id: 'style-a', novelId: 'novel-a', isActive: true, tone: '克制', pace: '快',
      dialogueRatio: 0.3, descriptionRatio: 0.4, prohibitedStyles: [], updatedAt: 'style-v1',
    };
    harness.context = {
      canonicalDataHash: 'canonical-hash',
      sourceManifest: [{ sourceType: 'novel', sourceId: 'novel-a', version: 'novel-v1' }],
      priorityOrder: ['formal_project_data', 'pending_draft', 'session_summary', 'recent_messages'],
      knownFields: { 'storySeed.premise': { value: '记忆可以买卖', state: 'user_confirmed' } },
      sessionSummary: '保持悬疑感',
      recentMessages: [{
        messageId: 'message-a', role: 'user', content: '从失窃记忆开场', contentHash: 'message-hash',
      }],
      objectContext: { novelId: 'novel-a' },
    };
    harness.settings = {
      provider: 'openai', runtimeMode: 'mock', modelName: 'model-a',
      temperature: 0.5, maxTokens: 4_000, timeoutSeconds: 90,
    };
    mocks.getNovel.mockImplementation(async () => harness.novel);
    mocks.getWorlds.mockImplementation(async () => harness.worlds);
    mocks.getRules.mockImplementation(async () => harness.rules);
    mocks.getProtagonist.mockImplementation(async () => harness.protagonist);
    mocks.getVolumes.mockImplementation(async () => harness.volumes);
    mocks.getVolume.mockImplementation(async (id: string) => harness.volumes.find((item) => item.id === id));
    mocks.getChapters.mockImplementation(async () => harness.chapters);
    mocks.getChapter.mockImplementation(async (id: string) => harness.chapters.find((item) => item.id === id));
    mocks.getMaster.mockImplementation(async () => harness.master);
    mocks.getMasterVersions.mockImplementation(async () => harness.master ? [harness.master] : []);
    mocks.getVolumeOutline.mockImplementation(async () => harness.volumeOutline);
    mocks.getVolumeOutlineVersions.mockImplementation(async () => (
      harness.volumeOutline ? [harness.volumeOutline] : []
    ));
    mocks.getStyle.mockImplementation(async () => harness.style);
    mocks.buildContext.mockImplementation(async () => harness.context);
    mocks.getSettings.mockImplementation(() => harness.settings);
    mocks.createBackground.mockResolvedValue({
      workflowId: 'workflow-a', rootTaskId: 'root-a', childTaskIds: ['child-a'],
    });
  });

  it('changes compiledInputHash for every prompt-bearing source and session context', async () => {
    const masterBase = (await compile()).compiledInputHash;
    expect((await compile('master_outline', workspace({
      dataRevision: 6, dataHash: 'post-prepared-session-state',
    }))).compiledInputHash).toBe(masterBase);

    harness.master = { ...harness.master!, content: '另一版总纲', updatedAt: 'master-v2' };
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.master = { ...harness.master!, content: '追查记忆黑市', updatedAt: 'master-v1' };

    harness.style = { ...harness.style!, tone: '冷峻', updatedAt: 'style-v2' };
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.style = { ...harness.style!, tone: '克制', updatedAt: 'style-v1' };

    harness.volumes = [...harness.volumes, {
      id: 'volume-b', novelId: 'novel-a', title: '真相卷', summary: '揭露真相', updatedAt: 'volume-v1',
    }];
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.volumes = harness.volumes.filter((item) => item.id !== 'volume-b');

    harness.chapters = [...harness.chapters, {
      id: 'chapter-b', novelId: 'novel-a', volumeId: 'volume-a', title: '追踪',
      outline: '追踪线索', updatedAt: 'chapter-v1',
    }];
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.chapters = harness.chapters.filter((item) => item.id !== 'chapter-b');

    harness.context = { ...harness.context, sessionSummary: '改为黑色幽默' };
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.context = {
      ...harness.context,
      sessionSummary: '保持悬疑感',
      recentMessages: [{
        messageId: 'message-b', role: 'user', content: '从追逐开场', contentHash: 'message-b-hash',
      }],
    };
    expect((await compile()).compiledInputHash).not.toBe(masterBase);
    harness.context = {
      ...harness.context,
      recentMessages: [{
        messageId: 'message-a', role: 'user', content: '从失窃记忆开场', contentHash: 'message-hash',
      }],
      objectContext: { novelId: 'novel-a', chapterId: 'chapter-a' },
    };
    expect((await compile()).compiledInputHash).not.toBe(masterBase);

    const chapterBase = (await compile('chapter_outlines')).compiledInputHash;
    harness.volumeOutline = {
      ...harness.volumeOutline!, content: '另一版卷纲', updatedAt: 'volume-outline-v2',
    };
    expect((await compile('chapter_outlines')).compiledInputHash).not.toBe(chapterBase);

    const providerBase = (await compile()).compiledInputHash;
    harness.settings = { ...harness.settings, modelName: 'model-b', runtimeMode: 'live' };
    expect((await compile()).compiledInputHash).not.toBe(providerBase);
  });

  it('submits a prepared workflow without any second business-data read', async () => {
    const compiled = await compile();
    expect(compiled.prepared).toBeDefined();
    const frozenProvider = compiled.prepared!.providerOptionsJson;
    vi.clearAllMocks();
    for (const read of [
      mocks.getNovel, mocks.getWorlds, mocks.getRules, mocks.getProtagonist,
      mocks.getVolumes, mocks.getVolume, mocks.getChapters, mocks.getChapter,
      mocks.getMaster, mocks.getMasterVersions, mocks.getVolumeOutline,
      mocks.getVolumeOutlineVersions, mocks.getStyle, mocks.buildContext,
    ]) read.mockRejectedValue(new Error('must not be read after compilation'));
    mocks.createBackground.mockResolvedValue({
      workflowId: 'workflow-a', rootTaskId: 'root-a', childTaskIds: ['child-a'],
    });

    await expect(outlineGenerateService.submitPrepared(compiled.prepared!, {
      operationId: 'operation-a',
    })).resolves.toEqual(expect.objectContaining({ workflowId: 'workflow-a' }));
    expect(mocks.createBackground).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'operation-a', providerOptionsJson: frozenProvider,
    }));
    for (const read of [
      mocks.getNovel, mocks.getWorlds, mocks.getRules, mocks.getProtagonist,
      mocks.getVolumes, mocks.getVolume, mocks.getChapters, mocks.getChapter,
      mocks.getMaster, mocks.getMasterVersions, mocks.getVolumeOutline,
      mocks.getVolumeOutlineVersions, mocks.getStyle, mocks.buildContext,
    ]) expect(read).not.toHaveBeenCalled();
  });

  it('fails strict reads before createBackground and rejects conflicting manifest duplicates', async () => {
    mocks.getWorlds.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(outlineGenerateService.submitNovelOutline('novel-a', {
      generationSource: 'ai_co_creation',
    })).rejects.toThrow('上下文读取失败');
    expect(mocks.createBackground).not.toHaveBeenCalled();

    await expect(outlineGenerateService.compileNovelOutline('novel-a', {
      generationSource: 'ai_co_creation',
      sourceManifestJson: [{ type: 'novel', id: 'novel-a', version: 'tampered' }],
    })).rejects.toThrow('重复且内容冲突');
  });

  it('produces a unique sorted manifest and stable fallback protagonist identity', async () => {
    const compiled = await compile();
    const manifest = compiled.prepared!.sourceManifestJson;
    const identities = manifest.map((source) => `${source.type}:${source.id}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(identities).toEqual([...identities].sort((a, b) => a.localeCompare(b)));
    expect(manifest.every((source) => (
      typeof source.type === 'string' && typeof source.id === 'string'
      && ['used', 'missing'].includes(String(source.status))
    ))).toBe(true);

    const raw = {
      id: 'novel-fallback', title: '空主角作品', description: '', outline: '',
      protagonists_json: '[]', protagonist_mode: 'single', created_at: 'now', updated_at: 'now',
    };
    const first = normalizeNovel(raw);
    const second = normalizeNovel(raw);
    expect(first?.protagonists[0].id).toBe('novel-protagonist:novel-fallback:primary');
    expect(second?.protagonists[0].id).toBe(first?.protagonists[0].id);
  });

  it('preserves authoritative sub-millisecond timestamps for source guards', () => {
    const timestamp = '2026-07-13T10:21:47.955820100+00:00';
    const normalized = normalizeNovel({
      id: 'novel-precision', title: '精度测试', description: '', outline: '',
      protagonists_json: '[]', protagonist_mode: 'single',
      created_at: timestamp, updated_at: timestamp,
    });

    expect(normalized?.createdAt).toBe(timestamp);
    expect(normalized?.updatedAt).toBe(timestamp);
  });
});
