import { describe, expect, it } from 'vitest';
import type { ChapterGenerationCompilationSource } from '../../types/chapterGenerationCompilation';
import {
  CHAPTER_GENERATION_CONTEXT_BUDGET_CHARS,
  compileChapterGenerationContracts,
} from '../../services/prompt/chapterGenerationCompiler';

function makeSource(overrides: Partial<ChapterGenerationCompilationSource> = {}): ChapterGenerationCompilationSource {
  return {
    novelId: 'novel-a',
    volumeId: 'volume-a',
    chapterId: 'chapter-a',
    baseContext: {
      novelTitle: '作品 A',
      novelGenre: '奇幻',
      novelDescription: '作品 A 的基础设定。',
      masterOutline: '总纲：主角必须先解决城门危机。',
      novelOutline: '总纲：主角必须先解决城门危机。',
      volumeTitle: '第一卷',
      volumeOutline: '本卷主线是追查城门失窃案。',
      volumeGoal: '找回钥匙',
      volumeConflict: '守卫不信任主角',
      chapterTitle: '城门前',
      chapterGoal: '让主角取得守卫信任。',
      chapterOutline: '主角发现钥匙线索；与守卫合作；在夜幕前进入城门。',
      outlineChecklistText: '1. 主角发现钥匙线索\n2. 与守卫合作\n3. 在夜幕前进入城门',
      outlineKeyPoints: [
        { id: 'point-1', text: '主角发现钥匙线索', type: 'event', required: true },
        { id: 'point-2', text: '与守卫合作', type: 'character', required: true },
        { id: 'point-3', text: '在夜幕前进入城门', type: 'ending', required: true },
      ],
      targetWordCount: 1800,
      protagonistsSummary: '主角林舟冷静、谨慎，正在寻找失窃钥匙。',
      protagonist: '林舟',
      protagonistNames: '林舟',
      protagonistAppearance: '林舟已经到达城门。',
      chapterCharacterList: [
        {
          id: 'character-link-a', novelId: 'novel-a', chapterId: 'chapter-a', characterId: 'character-a',
          name: '林舟', identity: '学徒', goal: '找回钥匙', personality: '谨慎',
          behaviorLimits: '不能无故伤害守卫', forbiddenBehaviors: '不得泄露师门秘密', mustAppear: true,
        },
        {
          id: 'character-link-other', novelId: 'novel-b', chapterId: 'chapter-b', characterId: 'character-b',
          name: '跨作品角色', mustAppear: true,
        },
      ],
      requiredCharacters: [
        {
          id: 'character-link-a', novelId: 'novel-a', chapterId: 'chapter-a', characterId: 'character-a',
          name: '林舟', mustAppear: true,
        },
        {
          id: 'character-link-other', novelId: 'novel-b', chapterId: 'chapter-b', characterId: 'character-b',
          name: '跨作品角色', mustAppear: true,
        },
      ],
      worldBackground: '王国的城门在夜幕前关闭。',
      ruleSystems: '夜间没有钥匙不得入城。',
      chapterSettings: '守卫轮班时刻已临近。',
      styleProfile: '克制的第三人称叙事。',
      outputProfile: '直接输出小说正文。',
      userInstruction: '强调城门前的紧迫感。',
    },
    sourceDraft: {
      id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 4,
      content: '当前草稿正文。', contentHash: 'source-hash', isAdopted: false,
    },
    adoptedDraft: {
      id: 'draft-adopted-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 3,
      content: '此前采用正文。', contentHash: 'adopted-hash', isAdopted: true,
    },
    previousSummaries: [
      {
        id: 'summary-a', chapterId: 'chapter-previous', chapterTitle: '前一章', orderIndex: 1,
        summary: '林舟发现钥匙失窃。', unresolvedQuestions: ['是谁偷走钥匙'],
        foreshadowing: ['守卫信任危机'], factsMustRemember: ['城门夜幕关闭'],
      },
    ],
    recentStates: [
      { id: 'chapter-previous', title: '前一章', orderIndex: 1, status: 'completed', adoptedDraftId: 'draft-previous' },
      { id: 'chapter-a', title: '城门前', orderIndex: 2, status: 'editing' },
    ],
    unresolvedThreads: [
      { id: 'thread-a', type: 'foreshadow', title: '失窃钥匙', content: '尚未确认盗窃者。', importance: 5 },
    ],
    qualityIssues: [
      {
        id: 'issue-a', issueType: 'continuity', severity: 'high', title: '守卫态度',
        description: '守卫尚未信任林舟。', suggestion: '先通过证据建立有限合作。',
      },
    ],
    events: [
      { id: 'event-required', status: 'required', title: '拿到线索', description: '林舟从地面找到钥匙痕迹。' },
      { id: 'event-forbidden', status: 'forbidden', title: '直接入城', description: '尚未取得钥匙前不得进城。' },
    ],
    engineeringState: undefined,
    worldRuleForbids: ['不得在夜幕前后颠倒城门规则'],
    warnings: [],
    ...overrides,
  } as ChapterGenerationCompilationSource;
}

describe('chapter generation Context and Constraint compiler', () => {
  it('produces stable Context and Constraint hashes for identical input', async () => {
    const source = makeSource();
    const first = await compileChapterGenerationContracts(source);
    const second = await compileChapterGenerationContracts(source);

    expect(first.contextContract.hash).toBe(second.contextContract.hash);
    expect(first.constraints.hash).toBe(second.constraints.hash);
    expect(first.contextContract.sourceManifest.contextHash).toBe(first.contextContract.hash);
  });

  it('keeps the current chapter outline at critical priority and filters foreign chapter characters', async () => {
    const { contextContract, constraints } = await compileChapterGenerationContracts(makeSource());
    const outlineSection = contextContract.sections.find((section) => section.key === 'chapter-outline');
    const characterSection = contextContract.sections.find((section) => section.key === 'chapter-characters');

    expect(outlineSection).toEqual(expect.objectContaining({ priority: 'critical' }));
    expect(contextContract.sections.indexOf(outlineSection!))
      .toBeLessThan(contextContract.sections.indexOf(characterSection!));
    expect(contextContract.text).not.toContain('跨作品角色');
    expect(constraints.must.map((item) => item.text).join('\n')).not.toContain('跨作品角色');
  });

  it('renders must, should, and forbid constraints in a stable category order', async () => {
    const { constraints } = await compileChapterGenerationContracts(makeSource());

    expect(constraints.must.every((item, index) => item.id === `must-${String(index + 1).padStart(2, '0')}`)).toBe(true);
    expect(constraints.should.every((item, index) => item.id === `should-${String(index + 1).padStart(2, '0')}`)).toBe(true);
    expect(constraints.forbid.every((item, index) => item.id === `forbid-${String(index + 1).padStart(2, '0')}`)).toBe(true);
    expect(constraints.text.indexOf('【必须满足】')).toBeLessThan(constraints.text.indexOf('【应尽量满足】'));
    expect(constraints.text.indexOf('【应尽量满足】')).toBeLessThan(constraints.text.indexOf('【禁止违反】'));
  });

  it('trims low-priority context after preserving outline and hard context', async () => {
    const { contextContract } = await compileChapterGenerationContracts(makeSource({
      baseContext: {
        ...makeSource().baseContext,
        worldBackground: '世界观背景'.repeat(20_000),
        ruleSystems: '硬规则'.repeat(10_000),
        chapterSettings: '背景设定'.repeat(10_000),
      },
    }));

    expect(contextContract.budget.usedChars).toBeLessThanOrEqual(CHAPTER_GENERATION_CONTEXT_BUDGET_CHARS);
    expect(contextContract.sections.find((section) => section.key === 'chapter-outline')?.content)
      .toContain('主角发现钥匙线索');
    expect([
      ...contextContract.budget.trimmedSections,
      ...contextContract.budget.omittedSections,
    ]).toContain('world-rules');
  });

  it('degrades safely when optional character and world data are absent', async () => {
    const { contextContract, constraints } = await compileChapterGenerationContracts(makeSource({
      baseContext: {
        ...makeSource().baseContext,
        chapterCharacterList: [],
        requiredCharacters: [],
        worldBackground: undefined,
        ruleSystems: undefined,
        chapterSettings: undefined,
      },
      worldRuleForbids: [],
    }));

    expect(contextContract.context.requiredCharacters).toEqual([]);
    expect(constraints.must.some((item) => item.text.includes('角色“'))).toBe(false);
    expect(contextContract.warnings).toEqual([]);
  });

  it('blocks Authorization, API Key, and Provider token text before producing a Snapshot contract', async () => {
    for (const userInstruction of [
      'Authorization: Bearer abcdefghijklmnop',
      'apiKey: abcdefghijklmnop',
      '请使用 sk-abcdefghijklmnop',
    ]) {
      await expect(compileChapterGenerationContracts(makeSource({
        baseContext: {
          ...makeSource().baseContext,
          userInstruction,
        },
      }))).rejects.toThrow('疑似 Provider 凭据');
    }
  });
});
