import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const mocks = vi.hoisted(() => ({
  getChapter: vi.fn(),
  getChapters: vi.fn(),
  getDrafts: vi.fn(),
  getNovel: vi.fn(),
  getVolume: vi.fn(),
  getContextRecords: vi.fn(),
  getRules: vi.fn(),
  getEvents: vi.fn(),
  getEngineeringBundle: vi.fn(),
  getSummary: vi.fn(),
  getIssues: vi.fn(),
  buildContext: vi.fn(),
  buildRequest: vi.fn(),
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.getChapter, getByNovelId: mocks.getChapters },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { getByChapterId: mocks.getDrafts },
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.getNovel },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getById: mocks.getVolume },
}));
vi.mock('../../services/context/contextRecordService', () => ({
  contextRecordService: { getByNovelId: mocks.getContextRecords },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: { getRuleSystems: mocks.getRules },
}));
vi.mock('../../services/characters/chapterEventService', () => ({
  chapterEventService: { getByChapterId: mocks.getEvents },
}));
vi.mock('../../services/engineering/chapterEngineeringService', () => ({
  chapterEngineeringService: { getBundle: mocks.getEngineeringBundle },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: { getByChapterId: mocks.getSummary },
}));
vi.mock('../../services/quality/qualityCheckService', () => ({
  qualityCheckService: { getChapterIssues: mocks.getIssues },
}));
vi.mock('../../services/prompt/contextBuilder', () => ({
  buildFreshChapterGenerationContext: mocks.buildContext,
}));
vi.mock('../../services/prompt/promptOrchestrator', () => ({
  getChapterGeneratePromptTemplate: () => ({
    id: 'chapter_generate', version: '1', body: 'template', source: 'chapter_generate.md',
  }),
  buildGenerateRequest: mocks.buildRequest,
}));

import { compileChapterGeneration } from '../../services/prompt/chapterGenerationCompiler';

const chapterA = {
  id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: 'A 章', orderIndex: 2, status: 'editing',
};
const previousChapterA = {
  id: 'chapter-a-previous', novelId: 'novel-a', volumeId: 'volume-a', title: 'A 前章', orderIndex: 1, status: 'completed',
};

function baseContext() {
  return {
    novelTitle: '作品 A', chapterTitle: 'A 章', targetWordCount: 1200,
    chapterGoal: '完成 A 章目标', chapterOutline: 'A 章关键事件', outlineChecklistText: '1. A 章关键事件',
    outlineKeyPoints: [{ id: 'a-point', text: 'A 章关键事件', type: 'event', required: true }],
    volumeTitle: 'A 卷', volumeOutline: 'A 卷主线', masterOutline: 'A 作品总纲',
    chapterCharacterList: [
      { id: 'a-character', novelId: 'novel-a', chapterId: 'chapter-a', characterId: 'character-a', name: 'A 角色', mustAppear: true },
      { id: 'b-character', novelId: 'novel-b', chapterId: 'chapter-b', characterId: 'character-b', name: 'B 角色', mustAppear: true },
    ],
    requiredCharacters: [
      { id: 'a-character', novelId: 'novel-a', chapterId: 'chapter-a', characterId: 'character-a', name: 'A 角色', mustAppear: true },
      { id: 'b-character', novelId: 'novel-b', chapterId: 'chapter-b', characterId: 'character-b', name: 'B 角色', mustAppear: true },
    ],
    worldBackground: 'A 世界观', ruleSystems: 'A 规则', userInstruction: '只写 A 章',
  };
}

describe('chapter generation compiler source isolation', () => {
  beforeEach(async () => {
    const sourceContent = 'A 章来源正文';
    const sourceHash = await computeContentSha256(sourceContent);
    mocks.getChapter.mockResolvedValue(chapterA);
    mocks.getChapters.mockResolvedValue([previousChapterA, chapterA, {
      id: 'chapter-b', novelId: 'novel-b', volumeId: 'volume-b', title: 'B 章', orderIndex: 1, status: 'editing',
    }]);
    mocks.getNovel.mockResolvedValue({ id: 'novel-a', title: '作品 A' });
    mocks.getVolume.mockResolvedValue({ id: 'volume-a', novelId: 'novel-a', title: 'A 卷' });
    mocks.getContextRecords.mockResolvedValue([
      {
        id: 'context-a', novelId: 'novel-a', contextType: 'foreshadow', title: 'A 线索', content: 'A 未解线索',
        importance: 5, isActive: true, isExpired: false,
      },
      {
        id: 'context-b', novelId: 'novel-b', contextType: 'foreshadow', title: 'B 线索', content: 'B 作品私有线索',
        importance: 5, isActive: true, isExpired: false,
      },
    ]);
    mocks.getRules.mockResolvedValue([
      { id: 'rule-a', novelId: 'novel-a', isActive: true, forbiddenRules: '不得忽略 A 规则' },
      { id: 'rule-b', novelId: 'novel-b', isActive: true, forbiddenRules: 'B 作品私有规则' },
    ]);
    mocks.getEvents.mockResolvedValue([
      { id: 'event-a', novelId: 'novel-a', chapterId: 'chapter-a', status: 'required', title: 'A 事件', description: '完成 A 事件' },
      { id: 'event-b', novelId: 'novel-b', chapterId: 'chapter-b', status: 'required', title: 'B 事件', description: '完成 B 事件' },
    ]);
    mocks.getEngineeringBundle.mockResolvedValue({ activeState: undefined, states: [], hasUnappliedDraft: false });
    mocks.getSummary.mockResolvedValue({
      id: 'summary-a', novelId: 'novel-a', chapterId: 'chapter-a-previous', enabled: true, isExpired: false,
      summary: 'A 前章摘要', unresolvedQuestions: [], foreshadowing: [], factsMustRemember: [],
    });
    mocks.getIssues.mockResolvedValue({
      report: { novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a' },
      items: [
        { id: 'issue-a', novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a', status: 'pending', issueType: 'continuity', severity: 'high', title: 'A 问题', description: '避免 A 问题' },
        { id: 'issue-b', novelId: 'novel-b', chapterId: 'chapter-b', draftId: 'draft-b', status: 'pending', issueType: 'continuity', severity: 'high', title: 'B 问题', description: '避免 B 问题' },
      ],
      statistics: {},
    });
    mocks.buildContext.mockResolvedValue(baseContext());
    mocks.buildRequest.mockImplementation(async (context: Record<string, unknown>, options?: { compiledConstraints?: string }) => ({
      taskType: 'chapter_generate',
      messages: [{ role: 'user', content: `${String(context.chapterTitle)}\n${options?.compiledConstraints ?? ''}` }],
      promptTemplateSource: 'chapter_generate.md',
    }));
    mocks.getDrafts.mockResolvedValue([{
      id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 7,
      content: sourceContent, isAdopted: false, contentState: { status: 'ready', contentHash: sourceHash },
    }]);
  });

  it('loads only the selected novel and chapter into compiled snapshots', async () => {
    const baseContentHash = await computeContentSha256('A 章来源正文');
    const compiled = await compileChapterGeneration({
      novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
      sourceDraftId: 'draft-a', sourceDraftVersion: 7, baseContentHash,
    });

    expect(compiled.contextContract.sourceManifest).toEqual(expect.objectContaining({
      novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a',
      sourceDraft: { id: 'draft-a', versionNo: 7, contentHash: baseContentHash },
    }));
    expect(compiled.contextContract.text).toContain('A 未解线索');
    expect(compiled.contextContract.text).not.toContain('B 作品私有线索');
    expect(compiled.contextContract.text).not.toContain('B 角色');
    expect(compiled.constraints.text).toContain('A 事件');
    expect(compiled.constraints.text).not.toContain('B 事件');
    expect(compiled.constraints.text).not.toContain('B 作品私有规则');
    expect(compiled.constraints.text).not.toContain('B 问题');
    expect(mocks.buildRequest).toHaveBeenCalledWith(
      expect.objectContaining({ chapterTitle: 'A 章' }),
      expect.objectContaining({ compiledConstraints: compiled.constraints.text }),
    );
  });

  it('rejects a chapter that is requested under a different novel before compiling a request', async () => {
    const baseContentHash = await computeContentSha256('A 章来源正文');
    await expect(compileChapterGeneration({
      novelId: 'novel-b', volumeId: 'volume-b', chapterId: 'chapter-a',
      sourceDraftId: 'draft-a', sourceDraftVersion: 7, baseContentHash,
    })).rejects.toThrow('章节不属于当前作品');
    expect(mocks.buildRequest).not.toHaveBeenCalled();
  });
});
