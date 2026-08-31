import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDshTurnContract,
  classifyTaskIntent,
  findTaskTargetConflict,
  isConversationalGoal,
  selectCandidateTool,
} from './taskGoalRouting';

test('DSH turn contracts freeze the candidate sink and required grounding reads', () => {
  assert.deepEqual(
    buildDshTurnContract('生成全书规划候选\n创意依据：档案修复师发现城市在删除记忆。'),
    {
      taskKind: 'story_plan_generate',
      expectedTool: 'generate_outline',
      expectedArtifactType: 'outline',
      requiredReadTools: ['novel.read_context'],
    },
  );
  assert.deepEqual(buildDshTurnContract('生成世界设定候选', 'ch-1'), {
    taskKind: 'setting_expand',
    expectedTool: 'expand_settings',
    expectedArtifactType: 'setting_candidates',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline'],
  });
  assert.deepEqual(buildDshTurnContract('为本作品生成角色候选'), {
    taskKind: 'character_generate',
    expectedTool: 'generate_characters',
    expectedArtifactType: 'character_candidates',
    requiredReadTools: ['novel.read_context'],
  });
  assert.deepEqual(buildDshTurnContract('审计人物一致性', 'ch-1'), {
    taskKind: 'quality_check',
    expectedTool: 'check_quality',
    expectedArtifactType: 'quality_report',
    requiredReadTools: [
      'novel.read_context',
      'chapter.read_outline',
      'get_character_states',
      'search_memory',
    ],
  });
  assert.deepEqual(buildDshTurnContract('总结本章', 'ch-1'), {
    taskKind: 'chapter_summary',
    expectedTool: 'summarize_chapter',
    expectedArtifactType: 'chapter_summary',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline'],
  });
  assert.deepEqual(buildDshTurnContract('读取当前世界设定', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context'],
  });
  assert.deepEqual(buildDshTurnContract('风格分析当前章节', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline'],
  });
});

test('project asset reads are grounded without broadening generic creative advice', () => {
  const groundedGoals = [
    '分析当前世界设定有什么矛盾',
    '评估本作品现有大纲结构',
    '查询全书大纲',
    '怎么看这本书的世界观',
  ];
  for (const goal of groundedGoals) {
    assert.deepEqual(buildDshTurnContract(goal, 'ch-1'), {
      taskKind: 'read',
      requiredReadTools: ['novel.read_context'],
    });
  }

  const generalGoals = [
    '分析六万字悬疑小说是否可行',
    '分析废土上的送信人适合怎样的剧情',
    '悬疑小说的大纲结构怎么安排',
  ];
  for (const goal of generalGoals) {
    assert.deepEqual(buildDshTurnContract(goal, 'ch-1'), {
      taskKind: 'read',
      requiredReadTools: [],
    });
  }

  assert.deepEqual(buildDshTurnContract('你好', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: [],
  });
  assert.deepEqual(buildDshTurnContract('风格分析当前章节', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline'],
  });
  assert.deepEqual(buildDshTurnContract('分析第二章的人物动机', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline', 'get_character_states'],
  });
  assert.deepEqual(buildDshTurnContract('查看主角设定', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context', 'get_character_states'],
  });
  assert.deepEqual(buildDshTurnContract('分析本章伏笔是否回收', 'ch-1'), {
    taskKind: 'read',
    requiredReadTools: ['novel.read_context', 'chapter.read_outline', 'search_memory'],
  });
});

test('candidate tool routing covers domain, style and foreshadowing goals', () => {
  assert.equal(selectCandidateTool('生成下一章', 'ch-1')?.name, 'generate_chapter');
  assert.equal(selectCandidateTool('扩展本章大纲', 'ch-1')?.name, 'generate_outline');
  assert.equal(selectCandidateTool('为本作品生成角色候选', 'ch-1')?.name, 'generate_characters');
  assert.equal(selectCandidateTool('生成世界设定候选', 'ch-1')?.name, 'expand_settings');
  assert.equal(selectCandidateTool('生成世界与规则设定候选', 'ch-1')?.name, 'expand_settings');
  assert.equal(selectCandidateTool('建议本章事件', 'ch-1')?.name, 'suggest_events');
  assert.equal(selectCandidateTool('润色本章正文', 'ch-1')?.name, 'polish_chapter');
  assert.equal(selectCandidateTool('按风格润色本章', 'ch-1')?.name, 'polish_chapter');
  assert.equal(selectCandidateTool('风格分析当前章节', 'ch-1'), undefined);
  assert.equal(selectCandidateTool('审计人物一致性', 'ch-1')?.name, 'check_quality');
  assert.equal(selectCandidateTool('检查伏笔回收', 'ch-1')?.name, 'check_quality');
  assert.equal(selectCandidateTool('生成伏笔候选', 'ch-1')?.name, 'suggest_events');
  assert.equal(selectCandidateTool('总结本章', 'ch-1')?.name, 'summarize_chapter');
  assert.equal(selectCandidateTool('为本作品生成角色候选')?.name, 'generate_characters');
  assert.equal(selectCandidateTool('为本作品生成世界设定候选')?.name, 'expand_settings');
  assert.equal(selectCandidateTool('建议本章事件'), undefined);
  assert.equal(selectCandidateTool('你好', 'ch-1'), undefined);
  assert.equal(selectCandidateTool('你能做什么', 'ch-1'), undefined);
  assert.equal(selectCandidateTool('hello', 'ch-1'), undefined);
  assert.equal(isConversationalGoal('你好'), true);
  assert.equal(isConversationalGoal('你能做什么？'), true);
  assert.equal(isConversationalGoal('生成下一章'), false);
  assert.equal(classifyTaskIntent('风格分析当前章节'), 'read');
  assert.equal(classifyTaskIntent('你好'), 'read');
});

test('minimal chapter commands route to chapter writing', () => {
  const goals = [
    '继续',
    '继续写',
    '接着写',
    '往下写',
    '再写一章',
    '下一章',
    '写第二章',
    '生成第2章',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1')?.name, 'generate_chapter', goal);
    assert.equal(classifyTaskIntent(goal), 'chapter_write', goal);
  }
});

test('chapter analysis requests do not route to generation', () => {
  const goals = [
    '分析第二章的人物动机',
    '请分析第2章的节奏问题',
    '讨论第三章的伏笔安排',
    '评价第一章正文写作手法',
    '第二章写得怎么样',
    '分析第二章是否需要重写',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1'), undefined, goal);
    assert.equal(classifyTaskIntent(goal), 'read', goal);
  }
});

test('short creative briefs route to chapter writing without requiring a detailed prompt', () => {
  const goals = [
    '六万字悬疑',
    '6万字科幻',
    '悬疑故事，六万字',
    '科幻小说',
    '废土上的送信人',
    '赛博朋克，失忆侦探',
    '想写悬疑',
    '六万字小说',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1')?.name, 'generate_chapter', goal);
    assert.equal(classifyTaskIntent(goal), 'chapter_write', goal);
  }
});

test('bare narrative premises can enter empty-project asset preparation', () => {
  const goals = [
    '一个人醒来发现全城只有自己有影子',
    '六万字，海边旅馆每晚少一个房间',
    '雨停以后所有人都会忘记名字',
    '陌生小镇，退休侦探发现每位客人都在说同一个谎',
    '失忆钟表匠追查被偷走的时间',
  ];

  for (const goal of goals) {
    assert.equal(classifyTaskIntent(goal), 'chapter_write', goal);
    assert.equal(selectCandidateTool(goal), undefined, goal);
    assert.equal(selectCandidateTool(goal, 'ch-1')?.name, 'generate_chapter', goal);
  }
});

test('questions and explicit reads that resemble narrative premises stay read-only', () => {
  const goals = [
    '六万字大概多少页？',
    '一个人醒来发现全城只有自己有影子，这个设定怎么样？',
    '如何写一个失忆侦探追查时间的故事',
    '读取一个侦探发现秘密的世界设定',
    '六万字，机器人发现系统故障，需要多少章',
    '机器人发现系统故障该怎么办？',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1'), undefined, goal);
    assert.equal(classifyTaskIntent(goal), 'read', goal);
  }
});

test('questions about short genre briefs remain read-only', () => {
  const goals = [
    '分析六万字悬疑小说是否可行',
    '这个悬疑故事怎么样',
    '悬疑故事有哪些常见套路',
    '分析废土上的送信人适合怎样的剧情',
    '赛博朋克失忆侦探有哪些常见写法',
    '六万字小说是否可行',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1'), undefined, goal);
    assert.equal(classifyTaskIntent(goal), 'read', goal);
  }
});

test('workbench template goals route to the capabilities named by their copy', () => {
  const cases = [
    ['生成下一章', 'generate_chapter', 'chapter_text'],
    ['审计本章已采用正文的质量、人物与设定一致性', 'check_quality', 'quality_report'],
    ['完善当前章节大纲', 'generate_outline', 'outline'],
    ['审计本章已采用正文的人物一致性', 'check_quality', 'quality_report'],
    ['生成本章剧情事件候选', 'suggest_events', 'event_candidates'],
    ['生成本章新增设定候选', 'expand_settings', 'setting_candidates'],
    ['润色本章候选正文，增强文风表现力', 'polish_chapter', 'chapter_text'],
  ] as const;

  for (const [goal, name, artifactType] of cases) {
    assert.deepEqual(selectCandidateTool(goal, 'ch-1'), { name, artifactType }, goal);
  }
});

test('natural book creation goals route to chapter generation before entity keywords', () => {
  const goals = [
    '做个悬疑故事',
    '一个失忆钟表匠的故事',
    '我想写个六万字悬疑小说，世界背景是永夜城，主角是失忆钟表匠',
    '写一部小说，世界设定是记忆会被删除',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal, 'ch-1')?.name, 'generate_chapter', goal);
    assert.equal(classifyTaskIntent(goal), 'chapter_write', goal);
  }
});

test('explicit asset generation directives retain their dedicated candidate tools', () => {
  const cases = [
    { goal: '生成世界设定候选', chapterId: 'ch-1', tool: 'expand_settings' },
    { goal: '生成主角候选', chapterId: 'ch-1', tool: 'generate_characters' },
    { goal: '生成全书规划候选', chapterId: undefined, tool: 'generate_outline' },
    { goal: '生成本章大纲候选', chapterId: 'ch-1', tool: 'generate_outline' },
  ] as const;

  for (const { goal, chapterId, tool } of cases) {
    assert.equal(selectCandidateTool(goal, chapterId)?.name, tool, goal);
    assert.equal(classifyTaskIntent(goal), 'structured_write', goal);
  }
});

test('natural rule-setting goals stay on the setting candidate route', () => {
  const goals = ['生成规则候选', '扩展规则体系', '整理世界规则'];

  for (const goal of goals) {
    const expected = { name: 'expand_settings', artifactType: 'setting_candidates' };
    assert.deepEqual(selectCandidateTool(goal), expected, goal);
    assert.deepEqual(selectCandidateTool(goal, 'ch-1'), expected, goal);
    assert.deepEqual(buildDshTurnContract(goal), {
      taskKind: 'setting_expand',
      expectedTool: 'expand_settings',
      expectedArtifactType: 'setting_candidates',
      requiredReadTools: ['novel.read_context'],
    });
    assert.equal(classifyTaskIntent(goal), 'structured_write', goal);
  }
});

test('natural whole-book planning goals use story planning without a chapter target', () => {
  const goals = ['规划全书', '生成整本故事规划', '完善全书大纲'];

  for (const goal of goals) {
    assert.deepEqual(selectCandidateTool(goal), {
      name: 'generate_outline',
      artifactType: 'outline',
    });
    assert.deepEqual(buildDshTurnContract(goal), {
      taskKind: 'story_plan_generate',
      expectedTool: 'generate_outline',
      expectedArtifactType: 'outline',
      requiredReadTools: ['novel.read_context'],
    });
    assert.equal(classifyTaskIntent(goal), 'structured_write', goal);
  }
});

test('chapter outline goals require a chapter target and are not promoted to whole-book planning', () => {
  const goals = [
    '完善当前章节大纲',
    '生成本章大纲候选',
    '生成第十二章大纲',
    '请为第十二章生成大纲',
    '规划全书后，完善本章大纲',
    '生成章节大纲',
  ];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal), undefined, goal);
    assert.deepEqual(buildDshTurnContract(goal), {
      taskKind: 'read',
      requiredReadTools: [],
    });
    assert.deepEqual(selectCandidateTool(goal, 'ch-1'), {
      name: 'generate_outline',
      artifactType: 'outline',
    });
    assert.deepEqual(buildDshTurnContract(goal, 'ch-1'), {
      taskKind: 'outline_generate',
      expectedTool: 'generate_outline',
      expectedArtifactType: 'outline',
      requiredReadTools: ['novel.read_context', 'chapter.read_outline'],
    });
  }
});

test('volume outline goals fail closed because the DSH contract has no volume target', () => {
  const goals = ['生成分卷大纲', '完善卷纲', '请为第一卷生成大纲', '扩展当前卷规划'];

  for (const goal of goals) {
    assert.equal(selectCandidateTool(goal), undefined, goal);
    assert.equal(selectCandidateTool(goal, 'ch-1'), undefined, goal);
    assert.deepEqual(buildDshTurnContract(goal), {
      taskKind: 'read',
      requiredReadTools: [],
    });
    assert.deepEqual(buildDshTurnContract(goal, 'ch-1'), {
      taskKind: 'read',
      requiredReadTools: [],
    });
  }
});

test('project-level master outline goals retain their existing candidate route', () => {
  const goals = ['生成项目大纲', '完善小说大纲'];

  for (const goal of goals) {
    assert.deepEqual(selectCandidateTool(goal), {
      name: 'generate_outline',
      artifactType: 'outline',
    });
    assert.deepEqual(buildDshTurnContract(goal), {
      taskKind: 'outline_generate',
      expectedTool: 'generate_outline',
      expectedArtifactType: 'outline',
      requiredReadTools: ['novel.read_context'],
    });
  }
});

test('read and audit goals do not drift into book creation', () => {
  const readGoals = ['读取当前世界设定', '查看主角设定', '查询全书大纲'];
  for (const goal of readGoals) {
    assert.equal(selectCandidateTool(goal, 'ch-1'), undefined, goal);
    assert.equal(classifyTaskIntent(goal), 'read', goal);
  }

  const auditGoals = ['审计人物一致性', '检查伏笔回收'];
  for (const goal of auditGoals) {
    assert.equal(selectCandidateTool(goal, 'ch-1')?.name, 'check_quality', goal);
    assert.equal(classifyTaskIntent(goal), 'audit', goal);
  }
});

test('chapter story facts cannot override an explicit generation directive', () => {
  const goal = [
    '请创作《雾港回声》第 2 章完整正文。',
    '本章必须完成：找到机械钟，确认官方时间线被改写。',
    '只输出连续小说正文，不要输出总结。',
  ].join('\n\n');

  assert.equal(selectCandidateTool(goal, 'ch-2')?.name, 'generate_chapter');
  assert.equal(selectCandidateTool('请改写本章完整正文，修复节奏', 'ch-2')?.name, 'polish_chapter');
  assert.equal(selectCandidateTool('请生成本章正文，再润色语句', 'ch-2')?.name, 'generate_chapter');
});

test('write tasks on the same novel warn without blocking concurrency', () => {
  assert.equal(classifyTaskIntent('生成下一章'), 'chapter_write');
  assert.equal(classifyTaskIntent('审计人物一致性'), 'audit');
  const overlap = findTaskTargetConflict({
    novelId: 'novel-001',
    chapterId: 'ch-003',
    conversationId: 'task-a',
    goal: '生成下一章',
    peers: [
      {
        conversationId: 'task-b',
        novelId: 'novel-001',
        title: '另一章生成',
        chapterId: 'ch-003',
      },
    ],
  });
  assert.equal(overlap?.code, 'TASK_TARGET_OVERLAP');
  assert.match(overlap?.message ?? '', /另一章生成/);
  const audit = findTaskTargetConflict({
    novelId: 'novel-001',
    chapterId: 'ch-003',
    conversationId: 'task-a',
    goal: '审计人物一致性',
    peers: [
      {
        conversationId: 'task-b',
        novelId: 'novel-001',
        title: '另一章生成',
        chapterId: 'ch-003',
      },
    ],
  });
  assert.equal(audit, undefined);
  const otherNovel = findTaskTargetConflict({
    novelId: 'novel-001',
    conversationId: 'task-a',
    goal: '生成下一章',
    peers: [{ conversationId: 'task-b', novelId: 'novel-002', title: '别的作品' }],
  });
  assert.equal(otherNovel, undefined);
});
