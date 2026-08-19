import { describe, expect, it } from 'vitest';
import type { ReferenceSection, ReferenceWork, StyleSampleLayer } from '../../types/reference';
import type { StyleAnalyzeResult } from '../../types/style';
import {
  analyzeLayeredReferenceStyle,
  mergeLayeredStyleProfiles,
  selectLayeredStyleSamples,
} from '../../services/references/layeredStyleAnalyzer';

function section(orderIndex: number, title: string, content: string): ReferenceSection {
  return {
    id: `section-${orderIndex}`,
    importId: 'import-1',
    workId: 'work-1',
    novelId: 'novel-1',
    orderIndex,
    title,
    content,
    contentHash: `section-hash-${orderIndex}`,
    charCount: Array.from(content).length,
    sourceStartUtf16: 0,
    sourceEndUtf16: content.length,
  };
}

const prose = (label: string, count = 180): string =>
  Array.from({ length: count }, (_, index) => `${label}${index}。群山沉静，雾气越过长街。`).join(
    '',
  );

function fixtureSections(): ReferenceSection[] {
  return [
    section(1, '开篇', prose('开')),
    section(2, '发展一', prose('承')),
    section(
      3,
      '对话',
      Array.from({ length: 180 }, (_, index) => `“第${index}句话。”\n“回应。”`).join('\n'),
    ),
    section(4, '描写', prose('景')),
    section(
      5,
      '高潮',
      Array.from({ length: 240 }, (_, index) => `骤然冲撞！爆裂声${index}！众人猛追！`).join(''),
    ),
    section(6, '收束', prose('终')),
  ];
}

function allLayers(
  samples: Awaited<ReturnType<typeof selectLayeredStyleSamples>>,
): Set<StyleSampleLayer> {
  return new Set(samples.flatMap((sample) => sample.layers));
}

describe('selectLayeredStyleSamples', () => {
  it('deterministically covers all six semantic layers with bounded replayable ranges', async () => {
    const sections = fixtureSections();
    const first = await selectLayeredStyleSamples(sections, { sampleChars: 900 });
    const second = await selectLayeredStyleSamples([...sections].reverse(), { sampleChars: 900 });

    expect(second).toEqual(first);
    expect(allLayers(first)).toEqual(
      new Set([
        'opening',
        'development',
        'dialogue_dense',
        'description_dense',
        'climax',
        'closing',
      ]),
    );
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(first.length).toBeLessThanOrEqual(6);
    expect(first.reduce((sum, sample) => sum + sample.content.length, 0)).toBeLessThanOrEqual(
      5_400,
    );
    for (const sample of first) {
      const source = sections.find((item) => item.id === sample.sectionId);
      expect(source).toBeDefined();
      expect(source!.content.slice(sample.startUtf16, sample.endUtf16)).toBe(sample.content);
      expect(sample.contentHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(sample.sampleId).toMatch(/^style-sample-[a-f0-9]{24}$/u);
    }
  });

  it('samples a 200k+ source without copying the full source into the result', async () => {
    const sections = Array.from({ length: 60 }, (_, index) =>
      section(index + 1, `章节 ${index + 1}`, prose(`段${index}`, 220)),
    );
    const totalLength = sections.reduce((sum, item) => sum + item.content.length, 0);
    expect(totalLength).toBeGreaterThan(200_000);

    const samples = await selectLayeredStyleSamples(sections);
    expect(samples.length).toBeLessThanOrEqual(6);
    expect(samples.reduce((sum, sample) => sum + sample.content.length, 0)).toBeLessThanOrEqual(
      24_000,
    );
    expect(samples.some((sample) => sample.layers.includes('opening'))).toBe(true);
    expect(samples.some((sample) => sample.layers.includes('closing'))).toBe(true);
  });

  it('fails closed for sources that cannot produce a representative sample', async () => {
    await expect(selectLayeredStyleSamples([])).rejects.toThrow('没有可分析');
    await expect(selectLayeredStyleSamples([section(1, '短文', '太短')])).rejects.toThrow(
      '正文过短',
    );
  });
});

describe('mergeLayeredStyleProfiles', () => {
  it('merges abstract fields and reports disagreement as confidence', () => {
    const profiles: StyleAnalyzeResult[] = [
      {
        narrativePerspective: '第三人称限知',
        tone: '冷静',
        dialogueRatio: 0.2,
        descriptionRatio: 0.5,
        forbiddenStyles: ['堆砌形容词'],
        styleSummary: '短句与克制叙述。',
      },
      {
        narrativePerspective: '第三人称限知',
        tone: '冷静',
        dialogueRatio: 0.3,
        descriptionRatio: 0.4,
        forbiddenStyles: ['堆砌形容词', '视角跳跃'],
        styleSummary: '场景描写强调空间层次。',
      },
      {
        narrativePerspective: '第一人称',
        tone: '热烈',
        dialogueRatio: 0.25,
        descriptionRatio: 0.45,
        styleSummary: '动作段落节奏紧凑。',
      },
    ];

    const merged = mergeLayeredStyleProfiles(profiles, '画像');
    expect(merged.profile.name).toBe('画像');
    expect(merged.profile.narrativePerspective).toBe('第三人称限知');
    expect(merged.profile.dialogueRatio).toBe(0.25);
    expect(merged.profile.forbiddenStyles).toEqual(['堆砌形容词', '视角跳跃']);
    expect(merged.profile.styleSummary).toContain('空间层次');
    expect(merged.confidence.byField.narrativePerspective).toBeCloseTo(2 / 3, 4);
    expect(merged.confidence.lowConfidenceFields).toContain('pace');
    expect(merged.confidence.overall).toBeGreaterThan(0);
    expect(merged.confidence.overall).toBeLessThan(1);
  });
});

describe('analyzeLayeredReferenceStyle', () => {
  it('keeps raw excerpts ephemeral and persists provenance plus abstract profiles', async () => {
    const work: ReferenceWork = {
      id: 'work-1',
      novelId: 'novel-1',
      title: '参考作品',
      purpose: 'style',
      activeImportId: 'import-1',
      activeSourceHash: 'source-hash',
      revision: 1,
      sourceStatus: 'available',
      sectionCount: 6,
      totalChars: 30_000,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    const analyzedContents: string[] = [];
    const result = await analyzeLayeredReferenceStyle(
      {
        work,
        importId: 'import-1',
        sourceHash: 'source-hash',
        sections: fixtureSections(),
      },
      {
        analyzeSample: async (content) => {
          analyzedContents.push(content);
          return {
            narrativePerspective: '第三人称限知',
            tone: '克制',
            dialogueRatio: 0.32,
            descriptionRatio: 0.44,
            styleSummary: '抽象画像摘要，不复述原文。',
          };
        },
      },
    );

    expect(analyzedContents).toHaveLength(result.samples.length);
    expect(result.sourceWorkId).toBe('work-1');
    expect(result.sourceImportId).toBe('import-1');
    expect(result.sourceHash).toBe('source-hash');
    expect(result.promptVersion).toBe('style_analyze_layered_v1');
    expect(result.layerResults).toHaveLength(result.samples.length);
    expect(result.samples.every((sample) => !('content' in sample))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('群山沉静');
    expect(result.mergedProfile.styleSummary).toBe('抽象画像摘要，不复述原文。');
  });

  it('honors cancellation before starting sample analysis', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      analyzeLayeredReferenceStyle(
        {
          work: {
            id: 'work-1',
            novelId: 'novel-1',
            title: '参考作品',
            purpose: 'style',
            activeImportId: 'import-1',
            activeSourceHash: 'source-hash',
            revision: 1,
            sourceStatus: 'available',
            sectionCount: 6,
            totalChars: 30_000,
            createdAt: '',
            updatedAt: '',
          },
          importId: 'import-1',
          sourceHash: 'source-hash',
          sections: fixtureSections(),
          options: { signal: controller.signal },
        },
        {
          analyzeSample: async () => {
            calls += 1;
            return { styleSummary: '不应执行' };
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'AI_REQUEST_CANCELLED' });
    expect(calls).toBe(0);
  });
});
