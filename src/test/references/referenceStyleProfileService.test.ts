import { describe, expect, it } from 'vitest';
import type { LayeredStyleResult, ReferenceWorkBundle } from '../../types/reference';
import type { CreateStyleProfileInput, StyleProfile } from '../../types/style';
import { createReferenceStyleProfile } from '../../services/references/referenceStyleProfileService';

const SOURCE_CONTENT = '这是一段仅用于验证不会进入画像元数据的参考原文。'.repeat(40);

function bundle(): ReferenceWorkBundle {
  const content = SOURCE_CONTENT;
  return {
    work: {
      id: 'work-1',
      novelId: 'novel-1',
      title: '参考作品',
      purpose: 'style',
      activeImportId: 'import-1',
      activeSourceHash: 'a'.repeat(64),
      revision: 1,
      sourceStatus: 'available',
      sectionCount: 1,
      totalChars: Array.from(content).length,
      createdAt: '2026-07-28T00:00:00Z',
      updatedAt: '2026-07-28T00:00:00Z',
    },
    imports: [
      {
        id: 'import-1',
        workId: 'work-1',
        novelId: 'novel-1',
        version: 1,
        isCurrent: true,
        operationId: 'operation-1',
        fileName: 'reference.txt',
        fileType: 'txt',
        encoding: 'utf-8',
        encodingSource: 'utf8_valid',
        sourceHash: 'a'.repeat(64),
        decodedTextHash: 'b'.repeat(64),
        sourceByteLength: content.length,
        decodedUtf8ByteLength: new TextEncoder().encode(content).length,
        totalChars: Array.from(content).length,
        sectionCount: 1,
        parserVersion: 'reference_txt_parser_v1',
        sectionPlanHash: 'c'.repeat(64),
        warnings: [],
        importedAt: '2026-07-28T00:00:00Z',
      },
    ],
    sections: [
      {
        id: 'section-1',
        importId: 'import-1',
        workId: 'work-1',
        novelId: 'novel-1',
        orderIndex: 1,
        title: '全文',
        contentHash: 'd'.repeat(64),
        charCount: Array.from(content).length,
        sourceStartUtf16: 0,
        sourceEndUtf16: content.length,
      },
    ],
    sectionTotal: 1,
    sectionOffset: 0,
    sectionLimit: 100,
  };
}

function loaders(source: ReferenceWorkBundle) {
  return {
    listSections: async () => ({
      items: source.sections,
      total: source.sectionTotal,
      offset: 0,
      limit: 200,
    }),
    getSectionContent: async () => ({ ...source.sections[0], content: SOURCE_CONTENT }),
  };
}

function analysis(styleSummary = '抽象风格：第三人称限知、节奏克制。'): LayeredStyleResult {
  return {
    analyzerVersion: 'layered_style_analyzer_v1',
    promptVersion: 'style_analyze_layered_v1',
    model: { runtimeMode: 'mock', provider: 'mock', modelName: 'Mock' },
    sourceWorkId: 'work-1',
    sourceImportId: 'import-1',
    sourceHash: 'a'.repeat(64),
    samples: [
      {
        sectionId: 'section-1',
        sectionOrderIndex: 1,
        sectionTitle: '全文',
        startUtf16: 0,
        endUtf16: 400,
        contentHash: 'e'.repeat(64),
        layers: ['opening', 'closing'],
      },
    ],
    layerResults: [
      {
        sampleId: `style-sample-${'e'.repeat(24)}`,
        layers: ['opening', 'closing'],
        profile: { styleSummary },
      },
    ],
    mergedProfile: {
      name: '参考作品 · 分层风格画像',
      narrativePerspective: '第三人称限知',
      tone: '克制',
      dialogueRatio: 0.3,
      descriptionRatio: 0.45,
      forbiddenStyles: ['视角跳跃'],
      styleSummary,
    },
    confidence: {
      overall: 0.82,
      byField: { tone: 0.82 },
      lowConfidenceFields: [],
    },
  };
}

function savedProfile(input: CreateStyleProfileInput & { novelId: string }): StyleProfile {
  return {
    ...input,
    id: 'style-1',
    novelId: input.novelId,
    targetWordsPerChapter: 4000,
    rhythmPreference: 'moderate',
    dialogueRatio: input.dialogueRatio ?? 0.35,
    descriptionRatio: input.descriptionRatio ?? 0.4,
    prohibitedStyles: input.forbiddenStyles ?? [],
    isActive: true,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
}

describe('createReferenceStyleProfile', () => {
  it('persists only abstract analysis with replayable source provenance', async () => {
    const source = bundle();
    let savedInput: (CreateStyleProfileInput & { novelId: string }) | undefined;
    const result = await createReferenceStyleProfile(
      source,
      {},
      {
        ...loaders(source),
        analyze: async () => analysis(),
        saveProfile: async (input) => {
          savedInput = input;
          return savedProfile(input);
        },
      },
    );

    expect(savedInput).toMatchObject({
      novelId: 'novel-1',
      sourceType: 'ai_analyzed',
      sourceReferenceWorkId: 'work-1',
      sourceReferenceImportId: 'import-1',
      sourceContentHash: 'a'.repeat(64),
      sourceState: 'available',
      narrativePerspective: '第三人称限知',
      styleSummary: '抽象风格：第三人称限知、节奏克制。',
    });
    expect(savedInput?.analysisMetadataJson).not.toContain(SOURCE_CONTENT);
    expect(JSON.parse(savedInput!.analysisMetadataJson!)).toMatchObject({
      sourceWorkId: 'work-1',
      sourceImportId: 'import-1',
      promptVersion: 'style_analyze_layered_v1',
    });
    expect(result.profile.id).toBe('style-1');
  });

  it('rejects stale bundles and analyzers that echo the complete source', async () => {
    const stale = bundle();
    stale.imports[0].isCurrent = false;
    await expect(
      createReferenceStyleProfile(
        stale,
        {},
        {
          ...loaders(stale),
          analyze: async () => analysis(),
          saveProfile: async (input) => savedProfile(input),
        },
      ),
    ).rejects.toThrow('当前导入版本不完整');

    const leaked = bundle();
    await expect(
      createReferenceStyleProfile(
        leaked,
        {},
        {
          ...loaders(leaked),
          analyze: async () => analysis(SOURCE_CONTENT),
          saveProfile: async (input) => savedProfile(input),
        },
      ),
    ).rejects.toThrow('意外包含参考原文');
  });

  it('pages the metadata catalog and reads no more than six selected section bodies', async () => {
    const source = bundle();
    const catalog = Array.from({ length: 1_000 }, (_value, index) => ({
      ...source.sections[0],
      id: `section-${index + 1}`,
      orderIndex: index + 1,
      title: `Chapter ${index + 1}`,
      contentHash: index.toString(16).padStart(64, '0'),
      charCount: 1_000,
      sourceStartUtf16: index * 1_000,
      sourceEndUtf16: (index + 1) * 1_000,
    }));
    source.sections = catalog.slice(0, 100);
    source.sectionTotal = catalog.length;
    source.work.sectionCount = catalog.length;
    source.imports[0].sectionCount = catalog.length;
    const listOffsets: number[] = [];
    const readIds: string[] = [];
    let analyzedSectionIds: string[] = [];

    await createReferenceStyleProfile(
      source,
      {},
      {
        listSections: async (_novelId, _workId, _importId, offset = 0, limit = 100) => {
          listOffsets.push(offset);
          return {
            items: catalog.slice(offset, offset + limit),
            total: catalog.length,
            offset,
            limit,
          };
        },
        getSectionContent: async (_novelId, _workId, _importId, sectionId) => {
          readIds.push(sectionId);
          const metadata = catalog.find((section) => section.id === sectionId)!;
          return {
            ...metadata,
            content: 'x'.repeat(metadata.sourceEndUtf16 - metadata.sourceStartUtf16),
          };
        },
        analyze: async (input) => {
          analyzedSectionIds = input.sections.map((section) => section.id);
          return analysis();
        },
        saveProfile: async (input) => savedProfile(input),
      },
    );

    expect(listOffsets).toEqual([0, 200, 400, 600, 800]);
    expect(readIds.length).toBeLessThanOrEqual(6);
    expect(readIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(readIds).size).toBe(readIds.length);
    expect(analyzedSectionIds).toEqual(readIds);
    expect(readIds).toContain('section-1');
    expect(readIds).toContain('section-1000');
  });
});
