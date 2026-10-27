import { beforeEach, describe, expect, it } from 'vitest';
import { novelRepository } from './novelRepository';

const chaptersKey = 'ai_novel_studio_chapters';
const recoveryKey = (novelId: string, chapterId: string) =>
  `ai_novel_studio_workspace_recovery_${encodeURIComponent(novelId)}_${encodeURIComponent(chapterId)}`;

describe('novelRepository.deleteCascade browser cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('purges scoped collections, dynamic caches, references, recovery and AI tasks', async () => {
    const doomed = await novelRepository.create({ title: '待删除作品' });
    const retained = await novelRepository.create({ title: '保留作品' });
    const doomedChapter = 'chapter-doomed';
    const retainedChapter = 'chapter-retained';
    localStorage.setItem(
      chaptersKey,
      JSON.stringify([
        { id: doomedChapter, novelId: doomed.id },
        { id: retainedChapter, novelId: retained.id },
      ]),
    );
    localStorage.setItem(
      'ai_novel_studio_ai_tasks',
      JSON.stringify([
        { id: 'task-doomed', taskType: 'chapter_generation', novelId: doomed.id },
        { id: 'task-retained', taskType: 'chapter_generation', novelId: retained.id },
      ]),
    );
    localStorage.setItem(
      'ai_novel_studio_drafts_list_chapter-doomed',
      JSON.stringify([{ id: 'draft-doomed', novelId: doomed.id, chapterId: doomedChapter }]),
    );
    localStorage.setItem(
      recoveryKey(doomed.id, doomedChapter),
      JSON.stringify({ novelId: doomed.id, chapterId: doomedChapter, recoveryContent: 'secret' }),
    );
    localStorage.setItem(
      'ai_novel_studio_reference_library_v1',
      JSON.stringify({
        schemaVersion: 1,
        works: [
          { id: 'work-doomed', novelId: doomed.id },
          { id: 'work-retained', novelId: retained.id },
        ],
        imports: [
          { id: 'import-doomed', novelId: doomed.id, workId: 'work-doomed' },
          { id: 'import-retained', novelId: retained.id, workId: 'work-retained' },
        ],
        sections: [
          {
            id: 'section-doomed',
            novelId: doomed.id,
            workId: 'work-doomed',
            importId: 'import-doomed',
          },
          {
            id: 'section-retained',
            novelId: retained.id,
            workId: 'work-retained',
            importId: 'import-retained',
          },
        ],
        operations: {
          doomed: { novelId: doomed.id, workId: 'work-doomed' },
          retained: { novelId: retained.id, workId: 'work-retained' },
        },
      }),
    );

    await novelRepository.deleteCascade(doomed.id);

    expect(await novelRepository.getById(doomed.id)).toBeNull();
    expect(await novelRepository.getById(retained.id)).not.toBeNull();
    expect(localStorage.getItem('ai_novel_studio_drafts_list_chapter-doomed')).toBeNull();
    expect(localStorage.getItem(recoveryKey(doomed.id, doomedChapter))).toBeNull();

    const tasks = JSON.parse(localStorage.getItem('ai_novel_studio_ai_tasks') ?? '[]') as Array<{
      novelId?: string;
    }>;
    expect(tasks).toEqual([
      { id: 'task-retained', taskType: 'chapter_generation', novelId: retained.id },
    ]);

    const references = JSON.parse(
      localStorage.getItem('ai_novel_studio_reference_library_v1') ?? '{}',
    ) as {
      works?: Array<{ id: string }>;
      imports?: Array<{ id: string }>;
      sections?: Array<{ id: string }>;
      operations?: Record<string, unknown>;
    };
    expect(references.works?.map((item) => item.id)).toEqual(['work-retained']);
    expect(references.imports?.map((item) => item.id)).toEqual(['import-retained']);
    expect(references.sections?.map((item) => item.id)).toEqual(['section-retained']);
    expect(Object.keys(references.operations ?? {})).toEqual(['retained']);
  });
});
