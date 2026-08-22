import { createHash } from 'node:crypto';

export const DEFAULT_BENCHMARK_THRESHOLD = 0.9;
export const DEFAULT_BENCHMARK_CASES = 10;
export const MAX_BENCHMARK_CASES = 100;

export const LOCAL_PROSE_BENCHMARK_FIXTURES = Object.freeze([
  {
    id: 'station-arrival',
    context: '夜雨中的旧车站，沈岚独自等待一列不该出现的列车。',
    goal: '让异常列车实际进站并改变现场状态。',
    beat: '沈岚听见汽笛，确认黑色列车已经进站。',
    requiredTerms: ['沈岚', '列车'],
  },
  {
    id: 'archive-discovery',
    context: '顾言在封存档案室检查一册被替换过页码的航海日志。',
    goal: '完成发现证据的动作。',
    beat: '顾言找到蓝色批注，确认第七码头记录被人改写。',
    requiredTerms: ['顾言', '蓝色批注', '第七码头'],
  },
  {
    id: 'clinic-warning',
    context: '凌晨诊所停电，苏遥正在给伤员重新固定监护设备。',
    goal: '让警告出现并被角色理解。',
    beat: '苏遥看见红色波形，意识到药物正在失效。',
    requiredTerms: ['苏遥', '红色波形'],
  },
  {
    id: 'tower-entry',
    context: '北境塔戒备森严，阿澄伪装成信使来到侧门。',
    goal: '完成进入动作，不提前写塔内后续调查。',
    beat: '阿澄交出铜牌，穿过侧门进入北境塔。',
    requiredTerms: ['阿澄', '铜牌', '北境塔'],
  },
  {
    id: 'harbor-signal',
    context: '雾港所有灯塔都已熄灭，陆衡守在防波堤。',
    goal: '完成信号出现和角色确认。',
    beat: '陆衡看见三次白光，确认外海船队已经抵达。',
    requiredTerms: ['陆衡', '三次白光', '船队'],
  },
  {
    id: 'court-refusal',
    context: '议事厅正在逼迫叶青签署一份没有日期的命令。',
    goal: '完成明确拒绝并改变对峙状态。',
    beat: '叶青推回银笔，公开拒绝签署命令。',
    requiredTerms: ['叶青', '银笔', '拒绝'],
  },
  {
    id: 'forest-trace',
    context: '雪后森林没有脚印，闻舟沿结冰河道寻找失踪队伍。',
    goal: '找到可验证的踪迹。',
    beat: '闻舟掀开冰层，发现刻有双环标记的绳扣。',
    requiredTerms: ['闻舟', '双环标记', '绳扣'],
  },
  {
    id: 'engine-shutdown',
    context: '地下机房温度持续上升，主冷却阀已经卡死。',
    goal: '完成停机动作并保留直接后果。',
    beat: '程雾切断黄色线路，迫使二号引擎停止运转。',
    requiredTerms: ['程雾', '黄色线路', '二号引擎'],
  },
  {
    id: 'message-decode',
    context: '旧电台每隔七秒发出一组相同杂音，简宁正在手工抄录。',
    goal: '完成解码和信息确认。',
    beat: '简宁拼出坐标，确认消息指向西侧水库。',
    requiredTerms: ['简宁', '坐标', '西侧水库'],
  },
  {
    id: 'bridge-choice',
    context: '吊桥只剩一根主索，追兵已经出现在峡谷入口。',
    goal: '完成角色选择，不提前写渡桥结果。',
    beat: '唐彻割断备用绳，决定让同伴先过桥。',
    requiredTerms: ['唐彻', '备用绳', '同伴'],
  },
]);

export function endpointId(providerId, modelId) {
  return 'local.' + providerId + '.' + modelId;
}

export function buildBenchmarkPrompt(fixture, sequence) {
  return [
    '只续写当前一个 Beat 的连续小说正文，不解释、不列提纲、不输出 JSON 或思考过程。',
    '不得提前写下一 Beat。必须实际完成 Beat 中的动作和状态变化。',
    '正文必须原样保留这些事实词：' + fixture.requiredTerms.join('、'),
    '样本序号：' + sequence,
    '',
    'Context：',
    fixture.context,
    '',
    'Goal：',
    fixture.goal,
    '',
    'Beat：',
    fixture.beat,
  ].join('\n');
}

export function narrativeCharacterCount(text) {
  return (text.match(/[A-Za-z0-9\u4e00-\u9fff]/g) ?? []).length;
}

function hasRepeatedParagraph(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, '').trim())
    .filter((paragraph) => narrativeCharacterCount(paragraph) >= 40);
  return new Set(paragraphs).size !== paragraphs.length;
}

export function evaluateBenchmarkOutput({ fixture, text, finishReason }) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  const issues = [];
  const characterCount = narrativeCharacterCount(normalized);
  if (characterCount < 120) issues.push('OUTPUT_TOO_SHORT');
  if (characterCount > 1_800) issues.push('OUTPUT_TOO_LONG');
  if (finishReason === 'length') issues.push('OUTPUT_TRUNCATED');
  if (/<think>|<\/think>|\x60{3}|^\s*[\[{]/i.test(normalized)) issues.push('NON_PROSE_LEAKAGE');
  if (hasRepeatedParagraph(normalized)) issues.push('PARAGRAPH_REPETITION');
  const missingTerms = fixture.requiredTerms.filter((term) => !normalized.includes(term));
  if (missingTerms.length > 0) issues.push('REQUIRED_FACT_MISSING');
  return {
    caseId: fixture.id,
    passed: issues.length === 0,
    score: Math.max(0, 100 - issues.length * 25),
    characterCount,
    missingTerms,
    issues,
    finishReason: typeof finishReason === 'string' ? finishReason : undefined,
  };
}

export function summarizeBenchmark(results, threshold = DEFAULT_BENCHMARK_THRESHOLD) {
  if (!Array.isArray(results) || results.length === 0)
    throw new Error('benchmark results required');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('benchmark threshold must be between 0 and 1');
  }
  const casesPassed = results.filter((result) => result.passed).length;
  const passRate = casesPassed / results.length;
  return {
    status: passRate >= threshold ? 'passed' : 'failed',
    casesTotal: results.length,
    casesPassed,
    passRate,
    threshold,
  };
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') +
    '}'
  );
}

export function benchmarkReportHash(report) {
  return createHash('sha256').update(stableJson(report), 'utf8').digest('hex');
}

export function buildTestingSidecar({ providerId, modelId, casesTotal, threshold, now }) {
  return {
    schemaVersion: 1,
    endpointId: endpointId(providerId, modelId),
    providerId,
    modelId,
    lifecycle: 'TESTING',
    updatedAt: now,
    benchmark: { status: 'pending', casesTotal, casesPassed: 0, passRate: 0, threshold },
  };
}

export function buildCompletedSidecar({ providerId, modelId, results, threshold, now }) {
  const summary = summarizeBenchmark(results, threshold);
  const report = {
    schemaVersion: 1,
    endpointId: endpointId(providerId, modelId),
    providerId,
    modelId,
    completedAt: now,
    summary,
    cases: results,
  };
  const reportHash = benchmarkReportHash(report);
  const passed = summary.status === 'passed';
  return {
    sidecar: {
      schemaVersion: 1,
      endpointId: report.endpointId,
      providerId,
      modelId,
      lifecycle: passed ? 'AVAILABLE' : 'FAILED',
      updatedAt: now,
      benchmark: { ...summary, completedAt: now, reportHash },
      ...(passed ? {} : { failureReason: 'LOCAL_MODEL_BENCHMARK_FAILED' }),
    },
    report,
    reportHash,
  };
}
