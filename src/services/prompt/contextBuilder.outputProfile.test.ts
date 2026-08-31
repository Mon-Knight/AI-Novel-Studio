import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGenerationContextSnapshot } from '../generation/generationContextCompiler';
import { buildOutputProfileContextForWriter } from './contextBuilder';
import type { OutputProfile } from '../../types/output';

const outputProfile: OutputProfile = {
  id: 'output-profile-001',
  novelId: 'novel-001',
  name: '高压冲突章节',
  description: '控制冲突章节的篇幅、叙事方式和段落密度。',
  chapterWordRange: { min: 2_400, max: 3_800, default: 3_000 },
  targetWordCount: 3_200,
  minWordCount: 2_500,
  maxWordCount: 3_600,
  paragraphLength: 'long',
  povType: 'first_person',
  tenseType: 'present',
  paceLevel: 'fast',
  dialogueRatio: 0.375,
  descriptionRatio: 0.42,
  battleIntensity: 'high',
  emotionTendency: '持续压迫后短暂释放',
  endingHookRequired: true,
  extraRequirements: '冲突必须改变人物关系。',
  forbiddenItems: ['跳跃视角', '无代价胜利'],
  isDefault: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

test('Writer projects every formal OutputProfile control into GenerationContext', () => {
  const context = buildOutputProfileContextForWriter(outputProfile);

  assert.equal(context.targetWordCount, 3_200);
  assert.ok(context.outputProfile);
  assert.match(context.outputProfile, /方案名称：高压冲突章节/);
  assert.match(context.outputProfile, /方案说明：控制冲突章节的篇幅、叙事方式和段落密度/);
  assert.match(context.outputProfile, /本章生效目标字数：3200 字/);
  assert.match(context.outputProfile, /最少字数：2500 字/);
  assert.match(context.outputProfile, /最多字数：3600 字/);
  assert.match(context.outputProfile, /段落长度：长段落/);
  assert.match(context.outputProfile, /叙事视角：第一人称/);
  assert.match(context.outputProfile, /叙事时态：现在时/);
  assert.match(context.outputProfile, /节奏等级：快/);
  assert.match(context.outputProfile, /对话比例：37\.5%/);
  assert.match(context.outputProfile, /描写比例：42%/);
  assert.match(context.outputProfile, /战斗强度：高/);
  assert.match(context.outputProfile, /情绪倾向：持续压迫后短暂释放/);
  assert.match(context.outputProfile, /结尾必须有钩子/);
  assert.match(context.outputProfile, /额外要求：冲突必须改变人物关系/);
  assert.match(context.outputProfile, /禁止项：跳跃视角、无代价胜利/);
});

test('chapter target remains highest priority without leaving a contradictory profile target', () => {
  const context = buildOutputProfileContextForWriter(outputProfile, 4_100);

  assert.equal(context.targetWordCount, 4_100);
  assert.match(context.outputProfile ?? '', /本章生效目标字数：4100 字/);
  assert.match(context.outputProfile ?? '', /章节单独设置优先/);
  assert.match(context.outputProfile ?? '', /最少字数：2500 字（输出方案参考值/);
  assert.match(context.outputProfile ?? '', /最多字数：3600 字（输出方案参考值/);
  assert.doesNotMatch(context.outputProfile ?? '', /本章生效目标字数：3200 字/);
  assert.equal(context.outputProfile?.match(/本章生效目标字数/g)?.length, 1);

  assert.deepEqual(buildOutputProfileContextForWriter(null, 4_500), {
    targetWordCount: 4_500,
    outputProfile: undefined,
  });
  assert.deepEqual(buildOutputProfileContextForWriter(null), {
    targetWordCount: 4_000,
    outputProfile: undefined,
  });
});

test('compiled Writer snapshot freezes the complete OutputProfile projection', async () => {
  const projectedOutput = buildOutputProfileContextForWriter(outputProfile, 4_100);
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      outputProfileId: outputProfile.id,
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '潮汐档案',
        chapterTitle: '第三章',
        chapterOutline: '主角在退潮前进入档案馆。',
        ...projectedOutput,
      }),
      getEngineeringBundle: async () => ({ states: [], hasUnappliedDraft: false }),
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );

  assert.equal(snapshot.outputProfileId, outputProfile.id);
  assert.equal(snapshot.compiledContext.baseContext.outputProfile, projectedOutput.outputProfile);
  assert.equal(snapshot.compiledContext.baseContext.targetWordCount, 4_100);
  assert.match(snapshot.compiledPromptText, /本章生效目标字数：4100 字/);
  assert.match(snapshot.compiledPromptText, /对话比例：37\.5%/);
  assert.match(snapshot.compiledPromptText, /描写比例：42%/);
  assert.match(snapshot.compiledPromptText, /段落长度：长段落/);
  assert.match(snapshot.compiledPromptText, /叙事视角：第一人称/);
  assert.match(snapshot.compiledPromptText, /叙事时态：现在时/);
  assert.doesNotMatch(snapshot.compiledPromptText, /本章生效目标字数：3200 字/);
  assert.equal(snapshot.sources.find((source) => source.type === 'output_profile')?.status, 'used');
});
