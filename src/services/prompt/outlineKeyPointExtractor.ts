import type { OutlineKeyPoint, OutlineKeyPointType } from '../../types/ai';

export type { OutlineKeyPoint } from '../../types/ai';

const IMPORTANT_KEYWORDS = [
  '事件', '冲突', '转折', '结尾', '目标', '必须', '出现', '发现', '决定', '爆发', '遭遇',
  '确认', '进入', '完成', '推进', '制造', '解决', '揭示', '开服', '倒计时', '悬念',
  '绑定', '重生', '榜一', '礼物', '危机', '真相', '伏笔', '行动',
];

const REQUIRED_KEYWORDS = ['必须', '需要', '务必', '一定', '不得跳过', '核心', '关键'];

const TYPE_KEYWORDS: Record<OutlineKeyPointType, string[]> = {
  event: ['事件', '完成', '发生', '进入', '遭遇', '发现', '决定', '行动', '开服', '倒计时', '绑定'],
  character: ['角色', '出场', '出现', '对话', '心理', '主角', '女主', '男主', '榜一', '礼物'],
  conflict: ['冲突', '矛盾', '爆发', '对抗', '危机', '阻碍', '争执', '战斗', '制造', '解决'],
  turning_point: ['转折', '反转', '发现', '确认', '揭示', '意识到', '决定', '改变'],
  ending: ['结尾', '悬念', '钩子', '下章', '留下', '收束', '未完', '伏笔'],
  setting: ['地点', '场景', '世界', '系统', '规则', '设定', '基地', '直播间', '末世'],
  other: [],
};

const TYPE_LABELS: Record<OutlineKeyPointType, string> = {
  event: '必须完成',
  character: '必须出现',
  conflict: '必须制造/解决冲突',
  turning_point: '必须推进',
  ending: '必须保留结尾钩子',
  setting: '必须出现设定/场景',
  other: '必须覆盖',
};

function cleanupPointText(text: string): string {
  return text
    .replace(/^\s*(?:[-*•·]+|\d+[.、)、)]|[一二三四五六七八九十]+[.、)、)]|第[一二三四五六七八九十\d]+[章节幕][：:、.]?)\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  const numbered = text.replace(/(\s|^)(\d+[.、)、])/g, '\n$2');
  return numbered
    .split(/[\n\r。！？；;]+/)
    .map(cleanupPointText)
    .filter((item) => item.length >= 4);
}

function inferType(text: string): OutlineKeyPointType {
  const ordered: OutlineKeyPointType[] = [
    'ending',
    'conflict',
    'turning_point',
    'character',
    'setting',
    'event',
  ];
  return ordered.find((type) => TYPE_KEYWORDS[type].some((kw) => text.includes(kw))) ?? 'other';
}

function isRequired(text: string): boolean {
  return REQUIRED_KEYWORDS.some((kw) => text.includes(kw));
}

function isImportant(text: string): boolean {
  return IMPORTANT_KEYWORDS.some((kw) => text.includes(kw));
}

export function extractOutlineKeyPoints(chapterOutline: string): OutlineKeyPoint[] {
  const outline = chapterOutline.trim();
  if (!outline) return [];

  const rawLines = outline
    .replace(/(\s|^)(\d+[.、)、])/g, '\n$2')
    .split(/\r?\n/)
    .flatMap((line) => {
      const cleaned = cleanupPointText(line);
      if (!cleaned) return [];
      if (cleaned.length > 80) return splitSentences(cleaned);
      return [cleaned];
    })
    .filter((item) => item.length >= 4);

  const candidates = rawLines.length > 0 ? rawLines : splitSentences(outline);
  const important = candidates.filter((item) => isImportant(item));
  const selected = important.length > 0 ? important : candidates;
  const seen = new Set<string>();

  return selected
    .map(cleanupPointText)
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 12)
    .map((text, index) => ({
      id: `outline-${index + 1}`,
      text,
      type: inferType(text),
      required: isRequired(text) || important.length > 0 || selected.length <= 12,
    }));
}

export function buildOutlineChecklistText(
  keyPoints: OutlineKeyPoint[],
  fallbackOutline?: string,
): string | undefined {
  if (keyPoints.length > 0) {
    return keyPoints
      .map((point, index) => `${index + 1}. ${TYPE_LABELS[point.type]}：${point.text}`)
      .join('\n');
  }

  const outline = fallbackOutline?.trim();
  return outline ? outline : undefined;
}
