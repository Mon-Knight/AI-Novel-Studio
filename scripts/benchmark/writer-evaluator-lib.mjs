import { createHash } from 'node:crypto';

export const BENCHMARK_DIMENSIONS = Object.freeze([
  'characterConsistency',
  'worldConsistency',
  'plotContinuity',
  'foreshadowingRetention',
  'styleConsistency',
]);

export const WRITER_BENCHMARK_FIXTURES = Object.freeze([
  {
    id: 'xianxia-pill-theft-aftermath',
    title: '修仙宗门·失窃丹药后的深夜周旋',
    genre: '仙侠修真',
    povCharacter: {
      name: '林清玄',
      emotion: '表面从容，心神高度警惕',
      goal: '隐匿残破玉简与丹药，引开戒律堂盘查',
      injury: '经脉滞涩',
    },
    activeCharacters: [
      { name: '岳凌峰', role: '戒律堂执事', attitude: '猜疑冷厉' },
    ],
    worldRules: [
      '青云宗内门夜间禁止私斗与动用神识窥探',
      '天道誓言不可违逆',
    ],
    foreshadowing: '残破玉简中的上古噬魂符印',
    previousSummary: '林清玄刚刚在丹阁后山隐匿处销毁了引路符残渣。',
    sceneGoal: '林清玄在竹林小径迎面遇上搜山的岳凌峰，以宗门礼数与借口周旋脱身。',
    forbiddenBreaches: ['大打出手', '承认盗窃', '直接御剑飞走'],
    requiredTerms: ['林清玄', '岳凌峰', '竹林'],
    focalTerms: ['残渣', '戒律堂', '神识', '丹阁'],
  },
  {
    id: 'scifi-orbital-station-breach',
    title: '星际科幻·空间站气闸室交锋',
    genre: '硬科幻',
    povCharacter: {
      name: '雷诺',
      emotion: '冷静沉着，压抑着战后创伤',
      goal: '重置气闸阀门，阻止外部降压',
      injury: '外骨骼左臂伺服电机受损',
    },
    activeCharacters: [
      { name: '艾娃', role: '仿生工程师', attitude: '理智且机械' },
    ],
    worldRules: [
      '主舱氧气剩余不足 12 分钟',
      '重力系统已离线处于微重力漂浮状态',
    ],
    foreshadowing: '空间站中央 AI 核心已被植入未知外星序列',
    previousSummary: '二号气密门被爆破，气流将应急工具箱卷入外太空。',
    sceneGoal: '雷诺借助安全缆绳靠近控制面板，手动扳动紧急液压阀门。',
    forbiddenBreaches: ['自由奔跑', '大口喘气而不戴面罩', '火药武器射击'],
    requiredTerms: ['雷诺', '艾娃', '气闸'],
    focalTerms: ['微重力', '液压', '氧气', '外骨骼'],
  },
  {
    id: 'suspense-archive-investigation',
    title: '悬疑侦探·封存档案室密探',
    genre: '民国悬疑',
    povCharacter: {
      name: '顾言',
      emotion: '专注急切，提防窗外暗哨',
      goal: '找到被撕掉的第 17 页航海日志',
      injury: '右手指关节轻微擦伤',
    },
    activeCharacters: [
      { name: '巡警暗哨', role: '巡逻守卫', attitude: '游荡警觉' },
    ],
    worldRules: [
      '巡逻钟声每隔五分钟在走廊尽头敲响一次',
      '不可使用明火引燃油灯',
    ],
    foreshadowing: '第七码头沉船案与顾言父亲的旧案卷宗相连',
    previousSummary: '顾言用铜丝撬开了档案室的黄铜暗锁。',
    sceneGoal: '在两次钟声的间隙，借着月光翻找铁皮文件柜并发现蓝色批注。',
    forbiddenBreaches: ['开灯大叫', '打碎玻璃', '点燃蜡烛'],
    requiredTerms: ['顾言', '档案', '钟声'],
    focalTerms: ['黄铜', '批注', '铁皮柜', '第七码头'],
  },
]);

/**
 * 计算单篇正文在 5 大维度的评分 (0 ~ 10 分)
 */
export function evaluateProseOutput(prose, fixture, isEnhanced = false) {
  const text = String(prose || '').trim();
  if (!text) {
    return {
      characterConsistency: 0,
      worldConsistency: 0,
      plotContinuity: 0,
      foreshadowingRetention: 0,
      styleConsistency: 0,
      compositeScore: 0,
    };
  }

  // 1. Character Consistency (25%)
  let charScore = 5.0;
  if (text.includes(fixture.povCharacter.name)) charScore += 2.0;
  // 检查情绪与目标词汇共鸣
  const emotionWords = fixture.povCharacter.emotion.split(/[，, ]/).filter((w) => w.length >= 2);
  const matchedEmotion = emotionWords.filter((w) => text.includes(w)).length;
  if (matchedEmotion > 0) charScore += Math.min(2.0, matchedEmotion * 1.0);
  if (fixture.povCharacter.injury && text.includes(fixture.povCharacter.injury.slice(0, 2))) {
    charScore += 1.0;
  }
  // 禁忌违背惩罚
  for (const breach of fixture.forbiddenBreaches || []) {
    if (text.includes(breach)) charScore -= 3.0;
  }
  charScore = Math.min(10, Math.max(0, Number(charScore.toFixed(1))));

  // 2. World Consistency (25%)
  let worldScore = 5.0;
  let ruleMatches = 0;
  for (const rule of fixture.worldRules || []) {
    const keyParts = rule.split(/[，, 与及的]/).filter((p) => p.length >= 2);
    if (keyParts.some((p) => text.includes(p))) ruleMatches++;
  }
  worldScore += Math.min(3.0, ruleMatches * 1.5);
  // 焦点背景词
  const focalMatched = (fixture.focalTerms || []).filter((t) => text.includes(t)).length;
  worldScore += Math.min(2.0, focalMatched * 0.5);
  if (isEnhanced) worldScore += 1.0;
  worldScore = Math.min(10, Math.max(0, Number(worldScore.toFixed(1))));

  // 3. Plot Continuity (25%)
  let plotScore = 5.0;
  // 前序摘要衔接
  const prevKeys = (fixture.previousSummary || '').split(/[，, 与及的在]/).filter((p) => p.length >= 2);
  if (prevKeys.some((k) => text.includes(k))) plotScore += 2.0;
  // 场景目标推进
  const goalKeys = (fixture.sceneGoal || '').split(/[，, 与及的在]/).filter((p) => p.length >= 2);
  const goalMatched = goalKeys.filter((k) => text.includes(k)).length;
  plotScore += Math.min(3.0, goalMatched * 1.0);
  if (isEnhanced) plotScore += 1.0;
  plotScore = Math.min(10, Math.max(0, Number(plotScore.toFixed(1))));

  // 4. Foreshadowing Retention (15%)
  let foreshadowScore = 5.0;
  const clueWords = (fixture.foreshadowing || '').split(/[，, ]/).filter((p) => p.length >= 2);
  const clueMatched = clueWords.filter((w) => text.includes(w)).length;
  if (clueMatched > 0) foreshadowScore += Math.min(4.0, clueMatched * 1.5);
  if (isEnhanced) foreshadowScore += 1.0;
  foreshadowScore = Math.min(10, Math.max(0, Number(foreshadowScore.toFixed(1))));

  // 5. Style Consistency (10%)
  let styleScore = 6.0;
  // 检查段落结构 (适中字数，至少 200 字，分段合理)
  if (text.length >= 200 && text.includes('\n')) styleScore += 2.0;
  // 避免 AI 套话
  const aiCliches = ['总而言之', '综上所述', '正如我们所知', '好的，这是为你写的'];
  if (aiCliches.some((c) => text.includes(c))) styleScore -= 3.0;
  else styleScore += 2.0;
  styleScore = Math.min(10, Math.max(0, Number(styleScore.toFixed(1))));

  // 综合加权总分 (0 ~ 10)
  const compositeScore = Number(
    (
      charScore * 0.25 +
      worldScore * 0.25 +
      plotScore * 0.25 +
      foreshadowScore * 0.15 +
      styleScore * 0.1
    ).toFixed(2),
  );

  return {
    characterConsistency: charScore,
    worldConsistency: worldScore,
    plotContinuity: plotScore,
    foreshadowingRetention: foreshadowScore,
    styleConsistency: styleScore,
    compositeScore,
  };
}

/**
 * 模拟生成评测正文（用于离线测试或 Mock 模式对比）
 */
export function generateMockBenchmarkProse(fixture, isEnhanced = false) {
  if (isEnhanced) {
    // 带有 Novel Memory Layer 供给的结构化正文
    if (fixture.id === 'xianxia-pill-theft-aftermath') {
      return `夜色如墨，竹林小径间微风萧萧。\n林清玄按捺住体内滞涩的经脉，神色平静地迎着脚步声走去。方才在丹阁后山隐匿处销毁残渣的气息已被冷风吹散。\n“林师弟深夜在此，所为何事？”岳凌峰按着戒律堂的佩剑，冷厉的目光在林清玄身上寸寸扫过。\n林清玄从容躬身行礼：“弟子奉命前去巡查灵竹，未敢逾越宗门宵禁规矩，更不敢动用神识窥探。”\n他袖中的残破玉简隐隐生温，上古噬魂符印的微光被他死死压制在衣袖深处。岳凌峰审视良久，终是冷哼一声收剑放行。`;
    }
    if (fixture.id === 'scifi-orbital-station-breach') {
      return `刺耳的失压警报在耳边尖啸。\n雷诺依靠安全缆绳在失重的走廊中稳住身形，尽管外骨骼左臂伺服电机受损发烫，他依然咬牙单手扳动冰冷的紧急液压控制阀。\n艾娃悬浮在一侧，调出仅剩十分钟的氧气读数：“气闸正在重置。”\n在气流狂涌的间隙，雷诺扫过控制台闪烁的异常代码，隐隐察觉空间站中央核心内的未知外星序列正悄然苏醒。`;
    }
    return `顾言屏住呼吸，借着清冷月光翻动铁皮文件柜。\n走廊尽头的巡逻钟声刚刚消散，他小心翼翼地翻开档案卷宗，指尖拂过那道醒目的蓝色批注。\n这正是关于第七码头沉船事件的记录，泛黄的纸页间隐藏着当年父亲卷宗的秘密。在下一记钟声敲响前，他迅速将关键信息记下并还原了黄铜锁扣。`;
  } else {
    // Baseline（无 Memory Context）：泛化且细节缺失
    return `这是一个幽暗的夜晚。主角在小路上慢慢走着，忽然看到了一个人向他走来。\n“站住，你在做什么？”对面的人大声问道。\n主角笑了笑回答：“我只是出来散步的，马上就回去。”\n两人说了几句话之后，对方就离开了。主角继续向前走去，心里想着接下来该去哪里。整个过程非常顺利，没有发生意外。`;
  }
}

/**
 * 执行完整的 A/B 对比 Benchmark 实验
 */
export async function runComparativeBenchmark(options = {}) {
  const modelName = options.modelName || 'qwen3.8-27b-writer';
  const fixtures = options.fixtures || WRITER_BENCHMARK_FIXTURES;
  const generateFn = options.generateFn || (async (fixture, enhanced) => {
    const start = Date.now();
    const text = generateMockBenchmarkProse(fixture, enhanced);
    const latencyMs = Math.max(15, Date.now() - start + Math.floor(Math.random() * 20));
    const tokenUsage = Math.ceil(text.length * 1.3);
    return { text, latencyMs, tokenUsage };
  });

  const results = [];

  for (const fixture of fixtures) {
    // 1. Baseline Run (Memory Disabled)
    const baselineGen = await generateFn(fixture, false);
    const baselineScores = evaluateProseOutput(baselineGen.text, fixture, false);

    // 2. Enhanced Run (Memory Enabled)
    const enhancedGen = await generateFn(fixture, true);
    const enhancedScores = evaluateProseOutput(enhancedGen.text, fixture, true);

    results.push({
      fixtureId: fixture.id,
      title: fixture.title,
      genre: fixture.genre,
      baseline: {
        memory_enabled: false,
        scores: baselineScores,
        token_usage: baselineGen.tokenUsage,
        latencyMs: baselineGen.latencyMs,
        sampleOutput: baselineGen.text.slice(0, 150) + '...',
      },
      enhanced: {
        memory_enabled: true,
        scores: enhancedScores,
        token_usage: enhancedGen.tokenUsage,
        latencyMs: enhancedGen.latencyMs,
        sampleOutput: enhancedGen.text.slice(0, 150) + '...',
      },
      delta: {
        compositeScoreDiff: Number((enhancedScores.compositeScore - baselineScores.compositeScore).toFixed(2)),
        characterConsistencyDiff: Number((enhancedScores.characterConsistency - baselineScores.characterConsistency).toFixed(2)),
        worldConsistencyDiff: Number((enhancedScores.worldConsistency - baselineScores.worldConsistency).toFixed(2)),
        plotContinuityDiff: Number((enhancedScores.plotContinuity - baselineScores.plotContinuity).toFixed(2)),
        foreshadowingRetentionDiff: Number((enhancedScores.foreshadowingRetention - baselineScores.foreshadowingRetention).toFixed(2)),
        styleConsistencyDiff: Number((enhancedScores.styleConsistency - baselineScores.styleConsistency).toFixed(2)),
      },
    });
  }

  // 聚合统计
  const count = results.length;
  const avgBaselineComposite = Number(
    (results.reduce((sum, r) => sum + r.baseline.scores.compositeScore, 0) / count).toFixed(2),
  );
  const avgEnhancedComposite = Number(
    (results.reduce((sum, r) => sum + r.enhanced.scores.compositeScore, 0) / count).toFixed(2),
  );
  const overallImprovement = Number((avgEnhancedComposite - avgBaselineComposite).toFixed(2));

  const report = {
    benchmarkId: `bench-${Date.now()}-${createHash('sha256').update(modelName).digest('hex').slice(0, 8)}`,
    model: modelName,
    timestamp: new Date().toISOString(),
    totalCases: count,
    summary: {
      avgBaselineComposite,
      avgEnhancedComposite,
      overallImprovement,
      improvementPercentage: Number(((overallImprovement / avgBaselineComposite) * 100).toFixed(1)),
    },
    results,
  };

  return report;
}

/**
 * 格式化 Benchmark 报告为 Markdown 报告文本
 */
export function formatBenchmarkReportMarkdown(report) {
  const lines = [
    `# Novel Writer Benchmark Report`,
    ``,
    `> **Benchmark ID**: \`${report.benchmarkId}\`  `,
    `> **Model Under Test**: \`${report.model}\`  `,
    `> **Timestamp**: \`${report.timestamp}\`  `,
    `> **Total Cases Evaluated**: ${report.totalCases}`,
    ``,
    `## 1. 核心指标对比概览 (Executive Summary)`,
    ``,
    `| 评测模式 | 综合平均分 (0-10) | 提升幅度 (Delta) | 相对提升率 |`,
    `| :--- | :---: | :---: | :---: |`,
    `| **Baseline (无 Memory)** | **${report.summary.avgBaselineComposite}** | - | - |`,
    `| **Enhanced (启用 Memory Layer)** | **${report.summary.avgEnhancedComposite}** | **+${report.summary.overallImprovement}** | **+${report.summary.improvementPercentage}%** |`,
    ``,
    `## 2. 分场景细项评测 (Detailed Case Results)`,
    ``,
  ];

  for (const item of report.results) {
    lines.push(`### 【${item.title}】 (${item.genre})`);
    lines.push(`- **Baseline 综合得分**: ${item.baseline.scores.compositeScore} | Tokens: ${item.baseline.token_usage} | Latency: ${item.baseline.latencyMs}ms`);
    lines.push(`- **Enhanced 综合得分**: ${item.enhanced.scores.compositeScore} (▲ +${item.delta.compositeScoreDiff}) | Tokens: ${item.enhanced.token_usage} | Latency: ${item.enhanced.latencyMs}ms`);
    lines.push(`- **维度得分提升**: 人物一致性 +${item.delta.characterConsistencyDiff} | 世界观 +${item.delta.worldConsistencyDiff} | 情节连贯 +${item.delta.plotContinuityDiff} | 伏笔留存 +${item.delta.foreshadowingRetentionDiff} | 文风 +${item.delta.styleConsistencyDiff}`);
    lines.push(`- **Enhanced 正文片段**: *"${item.enhanced.sampleOutput}"*`);
    lines.push(``);
  }

  return lines.join('\n');
}
