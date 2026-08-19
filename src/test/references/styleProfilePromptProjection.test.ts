import { describe, expect, it } from 'vitest';

import { buildChapterGeneratePrompt } from '../../services/ai/promptBuilder';
import {
  buildStylePromptProjection,
  getStyleProfileTrace,
} from '../../services/styles/styleProfilePromptProjection';
import type { StyleProfile } from '../../types/style';

const SOURCE_TEXT = 'REFERENCE_SECTION_SOURCE_TEXT_MUST_NOT_REACH_PROMPT';
const SOURCE_HASH = 'a'.repeat(64);
const SAMPLE_HASH = 'b'.repeat(64);
const timestamp = '2026-07-28T00:00:00.000Z';

function layeredProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    id: 'style-layered-1',
    novelId: 'novel-1',
    name: '分层画像',
    sourceType: 'ai_analyzed',
    sourceReferenceWorkId: 'reference-work-1',
    sourceReferenceImportId: 'reference-import-3',
    sourceContentHash: SOURCE_HASH,
    sourceState: 'available',
    analysisMetadataJson: JSON.stringify({
      analyzerVersion: 'layered_style_analyzer_v1',
      promptVersion: 'style_analyze_layered_v1',
      model: { runtimeMode: 'api', provider: 'provider-a', modelName: 'model-a' },
      sourceWorkId: 'reference-work-1',
      sourceImportId: 'reference-import-3',
      sourceHash: SOURCE_HASH,
      samples: [
        {
          sectionId: 'reference-section-7',
          sectionOrderIndex: 7,
          startUtf16: 120,
          endUtf16: 480,
          contentHash: SAMPLE_HASH,
          layers: ['opening', 'dialogue_dense'],
          content: SOURCE_TEXT,
        },
      ],
      confidence: { overall: 0.875, byField: { tone: 0.9 } },
      layerResults: [{ profile: { styleSummary: SOURCE_TEXT } }],
      sourceText: SOURCE_TEXT,
    }),
    rawConfigJson: JSON.stringify({ referenceBody: SOURCE_TEXT }),
    targetWordsPerChapter: 4000,
    rhythmPreference: 'fast',
    narrativePerspective: '第三人称有限视角',
    tone: '冷静克制',
    pace: '快',
    sentenceStyle: '短句为主',
    dialogueRatio: 0.42,
    descriptionRatio: 0.36,
    psychologicalRatio: 0.22,
    battleStyle: '动作因果清晰',
    battleIntensity: 'medium',
    emotionTendency: '克制后爆发',
    chapterEnding: '悬念收束',
    prohibitedStyles: ['流水账'],
    forbiddenStyles: ['流水账'],
    styleSummary: '使用短段落推进冲突，减少解释性旁白。',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('layered style profile chapter prompt projection', () => {
  it('injects abstract profile fields and replay metadata without reference source text', () => {
    const profile = layeredProfile();
    const styleProjection = buildStylePromptProjection(profile);
    const request = buildChapterGeneratePrompt({
      novelTitle: '测试作品',
      chapterTitle: '第一章',
      chapterOutline: '主角进入城市。',
      targetWordCount: 4000,
      styleProfile: styleProjection,
    });
    const prompt = request.messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('叙事人称：第三人称有限视角');
    expect(prompt).toContain('文风语气：冷静克制');
    expect(prompt).toContain('对话比例：42%，描写比例：36%');
    expect(prompt).toContain('reference-work-1');
    expect(prompt).toContain('reference-import-3');
    expect(prompt).toContain(SOURCE_HASH);
    expect(prompt).toContain('layered_style_analyzer_v1');
    expect(prompt).toContain('style_analyze_layered_v1');
    expect(prompt).toContain('reference-section-7');
    expect(prompt).toContain('"startUtf16":120');
    expect(prompt).toContain('"confidenceOverall":0.875');
    expect(prompt).not.toContain(SOURCE_TEXT);
    expect(prompt).not.toContain('layerResults');
    expect(prompt).not.toContain('sourceText');
    expect(prompt).not.toContain('rawConfigJson');
  });

  it('discards analysis metadata when its source identity does not match the saved binding', () => {
    const mismatched = layeredProfile({
      analysisMetadataJson: JSON.stringify({
        analyzerVersion: 'untrusted-analyzer',
        sourceWorkId: 'reference-work-other',
        sourceImportId: 'reference-import-3',
        sourceHash: SOURCE_HASH,
        samples: [{ content: SOURCE_TEXT }],
      }),
    });

    const trace = getStyleProfileTrace(mismatched);
    const projection = buildStylePromptProjection(mismatched);

    expect(trace.sourceReferenceWorkId).toBe('reference-work-1');
    expect(trace.analyzerVersion).toBeUndefined();
    expect(trace.samples).toEqual([]);
    expect(projection).not.toContain('untrusted-analyzer');
    expect(projection).not.toContain(SOURCE_TEXT);
  });

  it('retains historical provenance metadata after a deleted source becomes missing', () => {
    const missing = layeredProfile({
      sourceState: 'missing',
      sourceReferenceWorkId: undefined,
      sourceReferenceImportId: undefined,
    });

    const trace = getStyleProfileTrace(missing);

    expect(trace.sourceState).toBe('missing');
    expect(trace.sourceReferenceWorkId).toBe('reference-work-1');
    expect(trace.sourceReferenceImportId).toBe('reference-import-3');
    expect(trace.sourceContentHash).toBe(SOURCE_HASH);
    expect(trace.analyzerVersion).toBe('layered_style_analyzer_v1');
    expect(JSON.stringify(trace)).not.toContain(SOURCE_TEXT);
  });
});
