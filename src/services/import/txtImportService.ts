/**
 * AI Novel Studio - TXT 导入服务
 */

export interface ImportedChapterDraft {
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
}

export interface TxtAnalyzeResult {
  totalChars: number;
  totalWords: number;
  detectedChapterCount: number;
  chapters: ImportedChapterDraft[];
  warnings: string[];
}

const CHAPTER_PATTERNS = [
  /(?:^|\n)\s*(第\s*[0-9零一二三四五六七八九十百千]+[章节回卷部集篇])\s*[^\n]*/g,
  /(?:^|\n)\s*(Chapter\s*\d+)/gi,
  /(?:^|\n)\s*(第\s*\d+\s*[章节回])/g,
];

function countWords(text: string): number {
  const cleaned = text.replace(/[\s\n\r]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const other = cleaned
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + other;
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

export function analyzeTxtForChapters(content: string): TxtAnalyzeResult {
  if (!content?.trim())
    return {
      totalChars: 0,
      totalWords: 0,
      detectedChapterCount: 0,
      chapters: [],
      warnings: ['文件内容为空'],
    };

  const totalChars = content.length;
  const totalWords = countWords(content);
  const warnings: string[] = [];

  // 找章节标题位置
  const matches: { index: number; title: string }[] = [];
  for (const pattern of CHAPTER_PATTERNS) {
    let m: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((m = regex.exec(content)) !== null) {
      const title = m[1]?.trim() || m[0]?.trim();
      if (title && !matches.some((x) => x.index === m!.index)) {
        matches.push({ index: m.index, title });
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) {
    warnings.push('未识别到章节标题，建议作为单章导入');
    return {
      totalChars,
      totalWords,
      detectedChapterCount: 0,
      chapters: [
        { title: '第1章：导入正文', content: content.trim(), orderIndex: 1, wordCount: totalWords },
      ],
      warnings,
    };
  }

  // 按标题切分
  const chapters: ImportedChapterDraft[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : content.length;
    const body = content.slice(start, end).trim();
    const titleLineEnd = body.indexOf('\n');
    const title =
      titleLineEnd > 0 ? body.slice(0, titleLineEnd).trim().slice(0, 60) : body.slice(0, 60);
    const bodyContent = titleLineEnd > 0 ? body.slice(titleLineEnd).trim() : body;
    chapters.push({
      title,
      content: bodyContent,
      orderIndex: i + 1,
      wordCount: countWords(bodyContent),
    });
  }

  if (chapters.length > 50) {
    warnings.push(`检测到 ${chapters.length} 个章节，数量较多，请确认切分是否正确`);
  }

  return { totalChars, totalWords, detectedChapterCount: chapters.length, chapters, warnings };
}
