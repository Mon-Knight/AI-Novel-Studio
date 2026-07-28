import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportReferenceWorkInput } from '../../types/reference';
import {
  __referenceLibraryTestUtils,
  referenceLibraryService,
} from '../../services/references/referenceLibraryService';
import { analyzeReferenceFile } from '../../services/references/referenceTextParser';

const encoder = new TextEncoder();

async function createInput(
  operationId: string,
  text = '前言内容。\n第一章 开始\n这里是正文🙂。',
): Promise<ImportReferenceWorkInput> {
  return {
    operationId,
    novelId: 'novel-1',
    duplicateAction: 'createWork',
    title: '参考作品',
    purpose: 'style',
    description: '风格分析参考',
    analysis: await analyzeReferenceFile({
      fileName: 'reference.txt',
      bytes: encoder.encode(text),
    }),
  };
}

describe('referenceLibraryService LocalStorage adapter', () => {
  beforeEach(() => {
    localStorage.removeItem(__referenceLibraryTestUtils.storageKey);
  });

  it('imports a work, discovers duplicates, and replays an operation idempotently', async () => {
    const input = await createInput('operation-create-1');
    const created = await referenceLibraryService.import(input);

    expect(created.created).toBe(true);
    expect(created.action).toBe('createWork');
    expect(created.bundle.work.revision).toBe(1);
    expect(created.bundle.work.sourceStatus).toBe('available');
    expect(created.bundle.imports).toHaveLength(1);
    expect(created.bundle.sections.map((section) => section.title)).toEqual([
      '前言',
      '第一章 开始',
    ]);
    expect(created.bundle.sectionTotal).toBe(2);
    expect('content' in created.bundle.sections[1]).toBe(false);
    const content = await referenceLibraryService.getSectionContent(
      'novel-1',
      created.bundle.work.id,
      created.bundle.work.activeImportId,
      created.bundle.sections[1].id,
    );
    expect(content.content).toBe('这里是正文🙂。');

    const replay = await referenceLibraryService.import(input);
    expect(replay.bundle.work.id).toBe(created.bundle.work.id);
    expect(replay.bundle.imports).toHaveLength(1);

    const duplicates = await referenceLibraryService.inspectDuplicates(
      input.novelId,
      input.analysis.sourceHash,
    );
    expect(duplicates.matches).toEqual([
      expect.objectContaining({
        workId: created.bundle.work.id,
        importId: created.bundle.work.activeImportId,
        isCurrent: true,
      }),
    ]);
    expect(await referenceLibraryService.listWorks('novel-1')).toHaveLength(1);
    expect(await referenceLibraryService.listWorks('novel-2')).toEqual([]);
  });

  it('requires an explicit duplicate decision and supports version activation with CAS', async () => {
    const firstInput = await createInput('operation-version-1', '第一版正文🙂。');
    const first = await referenceLibraryService.import(firstInput);

    const skipped = await referenceLibraryService.import({
      ...firstInput,
      operationId: 'operation-skip-1',
      duplicateAction: 'skip',
      duplicateImportId: first.bundle.work.activeImportId,
    });
    expect(skipped.created).toBe(false);
    expect(skipped.bundle.imports).toHaveLength(1);

    const nextAnalysis = await analyzeReferenceFile({
      fileName: 'reference-v2.txt',
      bytes: encoder.encode('第二版正文🙂。'),
    });
    const second = await referenceLibraryService.import({
      operationId: 'operation-version-2',
      novelId: 'novel-1',
      duplicateAction: 'createVersion',
      workId: first.bundle.work.id,
      analysis: nextAnalysis,
    });
    expect(second.bundle.work.revision).toBe(2);
    expect(second.bundle.imports).toHaveLength(2);
    expect(second.bundle.imports.filter((item) => item.isCurrent)).toHaveLength(1);
    expect(second.bundle.work.activeSourceHash).toBe(nextAnalysis.sourceHash);

    const activated = await referenceLibraryService.activateImport(
      'novel-1',
      first.bundle.work.id,
      first.bundle.work.activeImportId,
      2,
    );
    expect(activated.work.revision).toBe(3);
    expect(activated.work.activeImportId).toBe(first.bundle.work.activeImportId);
    const activatedContent = await referenceLibraryService.getSectionContent(
      'novel-1',
      activated.work.id,
      activated.work.activeImportId,
      activated.sections[0].id,
    );
    expect(activatedContent.content).toBe('第一版正文🙂。');

    await expect(
      referenceLibraryService.activateImport(
        'novel-1',
        first.bundle.work.id,
        second.bundle.work.activeImportId,
        2,
      ),
    ).rejects.toThrow('其他操作更新');
  });

  it('rejects operation payload collisions and cross-novel target injection', async () => {
    const input = await createInput('operation-conflict-1');
    const created = await referenceLibraryService.import(input);
    await expect(
      referenceLibraryService.import({
        ...input,
        description: '不同的持久化说明',
      }),
    ).rejects.toThrow('不同请求');

    const otherAnalysis = await analyzeReferenceFile({
      fileName: 'other.txt',
      bytes: encoder.encode('另一正文。'),
    });
    await expect(
      referenceLibraryService.import({
        operationId: 'operation-scope-1',
        novelId: 'novel-2',
        duplicateAction: 'createVersion',
        workId: created.bundle.work.id,
        analysis: otherAnalysis,
      }),
    ).rejects.toThrow('不属于当前小说');
  });

  it('deletes the full work graph while leaving unrelated novels intact', async () => {
    const firstInput = await createInput('operation-delete-1');
    const first = await referenceLibraryService.import(firstInput);
    const secondInput = await createInput('operation-delete-2', '另一作品正文。');
    secondInput.novelId = 'novel-2';
    secondInput.title = '另一参考';
    const second = await referenceLibraryService.import(secondInput);

    await referenceLibraryService.deleteWork(
      'novel-1',
      first.bundle.work.id,
      first.bundle.work.revision,
    );
    expect(await referenceLibraryService.listWorks('novel-1')).toEqual([]);
    expect(await referenceLibraryService.listWorks('novel-2')).toEqual([second.bundle.work]);
    await expect(
      referenceLibraryService.getBundle('novel-1', first.bundle.work.id),
    ).rejects.toThrow('不存在');

    const recreated = await referenceLibraryService.import(firstInput);
    expect(recreated.bundle.work.id).not.toBe(first.bundle.work.id);
  });

  it('fails closed for incomplete hashes and duplicate actions without identities', async () => {
    const input = await createInput('operation-invalid-1');
    await expect(
      referenceLibraryService.import({
        ...input,
        analysis: { ...input.analysis, decodedTextHash: 'bad' },
      }),
    ).rejects.toThrow('正文哈希无效');
    await expect(
      referenceLibraryService.import({
        ...input,
        operationId: 'operation-invalid-2',
        duplicateAction: 'skip',
      }),
    ).rejects.toThrow('已有版本');
    await expect(
      referenceLibraryService.import({
        ...input,
        operationId: 'operation-invalid-3',
        title: '题'.repeat(201),
      }),
    ).rejects.toThrow('标题过长');
  });

  it('pages metadata by default and reads one verified section body on demand', async () => {
    const text = Array.from(
      { length: 205 },
      (_value, index) => `Chapter ${index + 1}\nsection-body-${index + 1}`,
    ).join('\n');
    const created = await referenceLibraryService.import(
      await createInput('operation-pages-1', text),
    );

    expect(created.bundle.sectionTotal).toBe(205);
    expect(created.bundle.sections).toHaveLength(100);
    expect(created.bundle.sections.every((section) => !('content' in section))).toBe(true);

    const secondPage = await referenceLibraryService.listSections(
      'novel-1',
      created.bundle.work.id,
      created.bundle.work.activeImportId,
      100,
      100,
    );
    expect(secondPage.total).toBe(205);
    expect(secondPage.items).toHaveLength(100);
    expect(secondPage.items[0].orderIndex).toBe(101);
    expect(secondPage.items.every((section) => !('content' in section))).toBe(true);

    const target = secondPage.items[37];
    const section = await referenceLibraryService.getSectionContent(
      'novel-1',
      created.bundle.work.id,
      created.bundle.work.activeImportId,
      target.id,
    );
    expect(section.orderIndex).toBe(138);
    expect(section.content).toBe('section-body-138');
    await expect(
      referenceLibraryService.getSectionContent(
        'novel-other',
        created.bundle.work.id,
        created.bundle.work.activeImportId,
        target.id,
      ),
    ).rejects.toThrow('不属于当前小说');
  });
});
