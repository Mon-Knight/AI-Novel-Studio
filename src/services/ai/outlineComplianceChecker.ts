import type { OutlineComplianceResult, OutlineKeyPoint } from '../../types/ai';

export type { OutlineComplianceResult } from '../../types/ai';

const STOP_WORDS = new Set([
  '本章', '章节', '大纲', '剧情', '事件', '需要', '必须', '进行', '开始', '之后', '然后',
  '一个', '一些', '这个', '那个', '当前', '通过', '展现', '体现', '推进', '安排',
]);

const DOMAIN_TERMS = [
  '系统', '倒计时', '开服', '末世', '重生', '直播', '直播间', '代练', '榜一', '礼物',
  '悬念', '钩子', '绑定', '危机', '真相', '伏笔', '冲突', '任务', '副本', '基地',
  '组织', '能力', '规则', '目标', '结尾', '女主', '男主', '主角',
];

const ACTION_TERMS = [
  '完成', '确认', '进入', '出现', '发现', '决定', '爆发', '遭遇', '解决', '制造',
  '推动', '留下', '绑定', '重生', '开服', '刷成', '刷礼物', '成为', '展现',
];

function normalizeText(text: string): string {
  return text
    .replace(/[#*`>~\-—\s，。！？；：、,.!?;:《》「」『』“”"']/g, '')
    .trim();
}

function addKeyword(keywords: string[], value: string | undefined): void {
  const text = value?.trim();
  if (!text) return;
  if (text.length < 2 || text.length > 12) return;
  if (STOP_WORDS.has(text)) return;
  if (!keywords.includes(text)) keywords.push(text);
}

function extractPointKeywords(pointText: string): string[] {
  const keywords: string[] = [];

  for (const match of pointText.matchAll(/[《「『“"]([^》」』”"]{2,12})[》」』”"]/g)) {
    addKeyword(keywords, match[1]);
  }

  for (const term of DOMAIN_TERMS) {
    if (pointText.includes(term)) addKeyword(keywords, term);
  }

  for (const term of ACTION_TERMS) {
    if (pointText.includes(term)) addKeyword(keywords, term);
  }

  for (const match of pointText.matchAll(/([\u4e00-\u9fff]{2,4})(?=完成|确认|进入|刷|成为|重生|发现|决定|遭遇|出现|留下|开始|绑定|获得|失去|打开|前往|抵达|参与|推动|解决|制造|爆发)/g)) {
    addKeyword(keywords, match[1]);
  }

  for (const match of pointText.matchAll(/[\u4e00-\u9fffA-Za-z0-9]{2,10}(?:系统|直播间|倒计时|榜一|末世|开服|悬念|代练|直播|礼物|冲突|线索|真相|计划|目标|结尾|钩子|危机|战斗|任务|副本|道具|身份|能力|地点|基地|组织|阵营)/g)) {
    addKeyword(keywords, match[0]);
  }

  for (const match of pointText.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,20}/g)) {
    addKeyword(keywords, match[0]);
  }

  if (keywords.length < 2) {
    const chunks = pointText
      .replace(/[0-9]+[.、)、]/g, ' ')
      .split(/[，。！？；：、,.!?;:\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      if (/^[\u4e00-\u9fff]{2,12}$/.test(chunk)) {
        addKeyword(keywords, chunk.length > 6 ? chunk.slice(0, 4) : chunk);
        addKeyword(keywords, chunk.length > 6 ? chunk.slice(-4) : undefined);
      } else {
        addKeyword(keywords, chunk);
      }
    }
  }

  return keywords.slice(0, 5);
}

function isPointCovered(generatedText: string, point: OutlineKeyPoint): boolean {
  const normalizedGenerated = normalizeText(generatedText);
  const normalizedPoint = normalizeText(point.text);
  if (normalizedPoint.length >= 6 && normalizedGenerated.includes(normalizedPoint)) {
    return true;
  }

  const keywords = extractPointKeywords(point.text);
  if (keywords.length === 0) return false;

  const hitCount = keywords.filter((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return generatedText.includes(keyword) || normalizedGenerated.includes(normalizedKeyword);
  }).length;

  const requiredHits = keywords.length === 1
    ? 1
    : Math.min(3, Math.max(2, Math.ceil(keywords.length * 0.5)));
  return hitCount >= requiredHits;
}

export function checkOutlineCompliance(
  generatedText: string,
  outlineKeyPoints: OutlineKeyPoint[],
): OutlineComplianceResult {
  if (outlineKeyPoints.length === 0) {
    return {
      score: 100,
      coveredPoints: [],
      missingPoints: [],
      warnings: ['没有可检查的大纲关键点，已跳过大纲遵循度评分。'],
    };
  }

  const coveredPoints = outlineKeyPoints.filter((point) => isPointCovered(generatedText, point));
  const missingPoints = outlineKeyPoints.filter((point) => !coveredPoints.some((covered) => covered.id === point.id));
  const score = Math.round((coveredPoints.length / outlineKeyPoints.length) * 100);
  const warnings: string[] = [];

  if (score < 60) {
    warnings.push('生成正文未充分遵循章节大纲。');
  } else if (score < 80) {
    warnings.push('生成正文只部分遵循章节大纲，建议修正缺失关键点。');
  } else if (missingPoints.length > 0) {
    warnings.push('生成正文基本遵循章节大纲，但仍有少量关键点未覆盖。');
  }

  return {
    score,
    coveredPoints,
    missingPoints,
    warnings,
  };
}

