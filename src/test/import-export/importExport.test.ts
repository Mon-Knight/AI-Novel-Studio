import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  novelGetById: vi.fn(),
  volumeGetByNovelId: vi.fn(), volumeGetById: vi.fn(), volumeCreate: vi.fn(), volumeUpdate: vi.fn(),
  chapterGetByNovelId: vi.fn(), chapterCreate: vi.fn(), chapterUpdate: vi.fn(),
  draftGetAdopted: vi.fn(), draftCreate: vi.fn(), draftAdopt: vi.fn(),
  worldSettings: vi.fn(), ruleSystems: vi.fn(), protagonist: vi.fn(), characters: vi.fn(),
  styleGetAll: vi.fn(), styleCreate: vi.fn(), outputGetAll: vi.fn(), outputCreate: vi.fn(),
  summaries: vi.fn(), contexts: vi.fn(),
  novelCreate: vi.fn(), novelUpdate: vi.fn(), novelDeleteCascade: vi.fn(),
}));

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.novelGetById },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: {
    getByNovelId: mocks.volumeGetByNovelId,
    getById: mocks.volumeGetById,
    create: mocks.volumeCreate,
    update: mocks.volumeUpdate,
  },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: {
    getByNovelId: mocks.chapterGetByNovelId,
    create: mocks.chapterCreate,
    update: mocks.chapterUpdate,
  },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getAdoptedByChapterId: mocks.draftGetAdopted,
    create: mocks.draftCreate,
    adopt: mocks.draftAdopt,
  },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: { getWorldSettings: mocks.worldSettings, getRuleSystems: mocks.ruleSystems },
}));
vi.mock('../../services/database/protagonistRepository', () => ({
  protagonistRepository: { getByNovelId: mocks.protagonist },
}));
vi.mock('../../services/characters/characterService', () => ({
  characterService: { getByNovelId: mocks.characters },
}));
vi.mock('../../services/styles/styleProfileService', () => ({
  styleProfileService: { getAll: mocks.styleGetAll, create: mocks.styleCreate },
}));
vi.mock('../../services/styles/outputProfileService', () => ({
  outputProfileService: { getAll: mocks.outputGetAll, create: mocks.outputCreate },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: { getByNovelId: mocks.summaries },
}));
vi.mock('../../services/context/contextRecordService', () => ({
  contextRecordService: { getByNovelId: mocks.contexts },
}));
vi.mock('../../services/novels/novelService', () => ({
  novelService: {
    createNovel: mocks.novelCreate,
    updateNovel: mocks.novelUpdate,
    deleteNovelCascade: mocks.novelDeleteCascade,
  },
}));

import { buildNovelBackup, exportNovelToTxt } from '../../services/export/exportService';
import { importProjectBackup, importTxtNovel } from '../../services/import/projectImportService';

const novel = {
  id: 'novel-a', title: '测试作品', subtitle: '', description: '简介', outline: '', genre: '幻想',
  protagonistMode: 'single', protagonists: [], dualProtagonistRelation: {}, status: 'writing',
  totalWordCount: 4, totalWords: 4, targetWords: 0, volumes: [], createdAt: 'now', updatedAt: 'now',
};
const chapter = {
  id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '第一章', outline: '', goal: '',
  chapterNumber: 1, orderIndex: 0, sortOrder: 0, status: 'not_started', wordCount: 0,
  currentWords: 0, targetWords: 0, drafts: [], createdAt: 'now', updatedAt: 'now',
};
const adoptedDraft = {
  id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', content: '这是已采用正文。',
  source: 'imported', versionNo: 1, wordCount: 8, isAdopted: true, createdAt: 'now', updatedAt: 'now',
};

describe('project import and export', () => {
  beforeEach(() => {
    mocks.novelGetById.mockResolvedValue(novel);
    mocks.volumeGetByNovelId.mockResolvedValue([{ id: 'volume-a', novelId: 'novel-a', title: '第一卷', orderIndex: 0 }]);
    mocks.volumeGetById.mockResolvedValue({ id: 'volume-a', title: '第一卷' });
    mocks.chapterGetByNovelId.mockResolvedValue([chapter]);
    mocks.draftGetAdopted.mockResolvedValue(adoptedDraft);
    mocks.worldSettings.mockResolvedValue([]);
    mocks.ruleSystems.mockResolvedValue([]);
    mocks.protagonist.mockResolvedValue(null);
    mocks.characters.mockResolvedValue([]);
    mocks.styleGetAll.mockResolvedValue([{ id: 'style-a', novelId: 'novel-a', name: '作品风格' }]);
    mocks.outputGetAll.mockResolvedValue([{ id: 'output-a', novelId: 'novel-a', name: '作品输出' }]);
    mocks.summaries.mockResolvedValue([]);
    mocks.contexts.mockResolvedValue([]);
    mocks.novelCreate.mockResolvedValue({ ...novel, id: 'novel-new' });
    mocks.novelUpdate.mockResolvedValue({ ...novel, id: 'novel-new' });
    mocks.novelDeleteCascade.mockResolvedValue(undefined);
    mocks.volumeCreate.mockResolvedValue({ id: 'volume-new', novelId: 'novel-new', title: '第一卷', orderIndex: 0 });
    mocks.volumeUpdate.mockResolvedValue(undefined);
    mocks.chapterCreate.mockImplementation(async (input: { title: string }) => ({ id: `chapter-${input.title}`, title: input.title }));
    mocks.chapterUpdate.mockResolvedValue(undefined);
    mocks.draftCreate.mockImplementation(async (input: { chapterId: string; content: string }) => ({ id: `draft-${input.chapterId}`, ...input }));
    mocks.draftAdopt.mockResolvedValue(undefined);
    mocks.styleCreate.mockResolvedValue(undefined);
    mocks.outputCreate.mockResolvedValue(undefined);
  });

  it('stores the adopted full chapter text in schema v2 backups', async () => {
    const backup = await buildNovelBackup('novel-a');
    expect(backup.schemaVersion).toBe(2);
    const chapters = backup.chapters as Array<{ adoptedDraft: { content: string } }>;
    expect(chapters[0].adoptedDraft.content).toBe('这是已采用正文。');
  });

  it('exports chapters according to the adopted draft instead of stale chapter status', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await expect(exportNovelToTxt('novel-a')).resolves.toMatch(/测试作品_全文_/);
    expect(mocks.draftGetAdopted).toHaveBeenCalledWith('chapter-a');
  });

  it('imports TXT chapters as adopted正文 so they are immediately exportable', async () => {
    const result = await importTxtNovel({
      title: '导入作品',
      analysis: {
        totalChars: 8,
        totalWords: 8,
        detectedChapterCount: 2,
        warnings: [],
        chapters: [
          { title: '第一章', content: '正文一', orderIndex: 0, wordCount: 3 },
          { title: '第二章', content: '正文二', orderIndex: 1, wordCount: 3 },
        ],
      },
    });
    expect(result.adoptedChapterCount).toBe(2);
    expect(mocks.draftAdopt).toHaveBeenCalledTimes(2);
    expect(mocks.chapterUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.chapterCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ orderIndex: 0 }));
    expect(mocks.chapterUpdate).toHaveBeenCalledWith('chapter-第一章', { status: 'adopted' });
  });

  it('round-trips project volumes, chapters, adopted text and project profiles with new ids', async () => {
    const result = await importProjectBackup({
      type: 'ai_novel_studio_project',
      schemaVersion: 2,
      novel,
      volumes: [{ id: 'volume-old', title: '第一卷', orderIndex: 0, status: 'writing' }],
      chapters: [{
        id: 'chapter-old', volumeId: 'volume-old', title: '第一章', orderIndex: 0,
        status: 'adopted', adoptedDraft: { content: '恢复后的小说正文。' },
      }],
      styleProfiles: [{ name: '冷峻风格', tone: '冷峻' }],
      outputProfiles: [{ name: '短章', targetWordCount: 2500 }],
    });

    expect(result).toMatchObject({
      novelId: 'novel-new', volumeCount: 1, chapterCount: 1, adoptedChapterCount: 1,
      missingContentCount: 0, styleProfileCount: 1, outputProfileCount: 1,
    });
    expect(mocks.chapterCreate).toHaveBeenCalledWith(expect.objectContaining({ volumeId: 'volume-new' }));
    expect(mocks.draftCreate).toHaveBeenCalledWith(expect.objectContaining({ content: '恢复后的小说正文。' }));
    expect(mocks.draftAdopt).toHaveBeenCalledTimes(1);
    expect(mocks.styleCreate).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'novel-new' }));
    expect(mocks.outputCreate).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'novel-new' }));
  });

  it('reports legacy metadata-only backups without inventing adopted正文', async () => {
    const result = await importProjectBackup({
      novel,
      volumes: [],
      chapters: [{ title: '空章节', orderIndex: 0, status: 'adopted' }],
    });
    expect(result.missingContentCount).toBe(1);
    expect(result.adoptedChapterCount).toBe(0);
    expect(mocks.draftCreate).not.toHaveBeenCalled();
  });
});
