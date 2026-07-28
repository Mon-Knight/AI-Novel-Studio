import type {
  ReferenceEncoding,
  ReferenceFileAnalysis,
  ReferenceSectionDraft,
} from '../../types/reference';

const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_CHARS = 20_000_000;
const MAX_REFERENCE_SECTIONS = 10_000;

export const REFERENCE_TEXT_PARSER_VERSION = 'reference_txt_parser_v1';

const HEADING_PATTERN =
  /^(?:\s*)((?:第\s*[0-9零一二三四五六七八九十百千万两〇]+\s*[章节回卷部集篇]|Chapter\s*\d+)[^\r\n]*)\s*$/gim;

interface DecodedReferenceText {
  text: string;
  encoding: ReferenceEncoding;
  encodingSource: ReferenceFileAnalysis['encodingSource'];
  warnings: string[];
}

function unicodeLength(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function decode(bytes: Uint8Array, encoding: ReferenceEncoding, fatal: boolean): string {
  try {
    return stripBom(new TextDecoder(encoding, { fatal }).decode(bytes));
  } catch {
    throw new Error(`参考资料无法按 ${encoding} 解码，请手动选择正确编码。`);
  }
}

function detectBom(bytes: Uint8Array): ReferenceEncoding | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
}

export function decodeReferenceText(
  bytes: Uint8Array,
  encodingOverride?: ReferenceEncoding,
): DecodedReferenceText {
  if (bytes.byteLength === 0) throw new Error('参考资料文件为空。');
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error(`参考资料超过 ${MAX_REFERENCE_BYTES / 1024 / 1024} MiB 上限。`);
  }

  if (encodingOverride) {
    return {
      text: decode(bytes, encodingOverride, true),
      encoding: encodingOverride,
      encodingSource: 'user_override',
      warnings: [],
    };
  }

  const bomEncoding = detectBom(bytes);
  if (bomEncoding) {
    return {
      text: decode(bytes, bomEncoding, true),
      encoding: bomEncoding,
      encodingSource: 'bom',
      warnings: [],
    };
  }

  try {
    return {
      text: decode(bytes, 'utf-8', true),
      encoding: 'utf-8',
      encodingSource: 'utf8_valid',
      warnings: [],
    };
  } catch {
    return {
      text: decode(bytes, 'gb18030', true),
      encoding: 'gb18030',
      encodingSource: 'fallback',
      warnings: ['文件不是有效 UTF-8，已按 GB18030 解码；导入前请检查预览。'],
    };
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境缺少可靠的 SHA-256，参考资料未导入。');
  }
  const copied = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copied.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

interface HeadingMatch {
  index: number;
  end: number;
  title: string;
}

function findHeadings(text: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  const regex = new RegExp(HEADING_PATTERN.source, HEADING_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1]?.trim().slice(0, 160);
    if (title) headings.push({ index: match.index, end: regex.lastIndex, title });
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
  }
  return headings;
}

async function createSection(
  orderIndex: number,
  title: string,
  text: string,
  sourceStartUtf16: number,
  sourceEndUtf16: number,
): Promise<ReferenceSectionDraft | undefined> {
  const leadingWhitespace = text.length - text.trimStart().length;
  const trailingWhitespace = text.length - text.trimEnd().length;
  const content = text.trim();
  if (!content) return undefined;
  const start = sourceStartUtf16 + leadingWhitespace;
  const end = Math.max(start, sourceEndUtf16 - trailingWhitespace);
  return {
    orderIndex,
    title: title.trim().slice(0, 160) || `片段 ${orderIndex}`,
    content,
    contentHash: await sha256Text(content),
    charCount: unicodeLength(content),
    sourceStartUtf16: start,
    sourceEndUtf16: end,
  };
}

export async function splitReferenceSections(text: string): Promise<ReferenceSectionDraft[]> {
  const normalized = stripBom(text);
  if (!normalized.trim()) throw new Error('参考资料正文为空。');
  if (unicodeLength(normalized) > MAX_REFERENCE_CHARS) {
    throw new Error(`参考资料超过 ${MAX_REFERENCE_CHARS.toLocaleString()} 字符上限。`);
  }
  const headings = findHeadings(normalized);
  if (headings.length > MAX_REFERENCE_SECTIONS) {
    throw new Error(`识别到的章节数超过 ${MAX_REFERENCE_SECTIONS.toLocaleString()} 上限。`);
  }

  const sections: ReferenceSectionDraft[] = [];
  const append = async (title: string, body: string, start: number, end: number) => {
    const section = await createSection(sections.length + 1, title, body, start, end);
    if (section) sections.push(section);
  };

  if (headings.length === 0) {
    await append('全文', normalized, 0, normalized.length);
    return sections;
  }

  if (normalized.slice(0, headings[0].index).trim()) {
    await append('前言', normalized.slice(0, headings[0].index), 0, headings[0].index);
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.index ?? normalized.length;
    await append(heading.title, normalized.slice(heading.end, end), heading.end, end);
  }
  if (sections.length === 0) {
    await append('全文', normalized, 0, normalized.length);
  }
  return sections;
}

export async function analyzeReferenceFile(input: {
  fileName: string;
  bytes: Uint8Array;
  encodingOverride?: ReferenceEncoding;
}): Promise<ReferenceFileAnalysis> {
  const fileName = input.fileName.trim().slice(0, 255);
  if (!fileName) throw new Error('参考资料文件名为空。');
  if (!/\.txt$/i.test(fileName)) throw new Error('当前参考资料库仅接受 TXT 文件。');
  const decoded = decodeReferenceText(input.bytes, input.encodingOverride);
  const sections = await splitReferenceSections(decoded.text);
  const encodedText = new TextEncoder().encode(decoded.text);
  const sectionPlanHash = await sha256Text(
    JSON.stringify(
      sections.map((section) => ({
        orderIndex: section.orderIndex,
        title: section.title,
        contentHash: section.contentHash,
        charCount: section.charCount,
        sourceStartUtf16: section.sourceStartUtf16,
        sourceEndUtf16: section.sourceEndUtf16,
      })),
    ),
  );
  const warnings = [...decoded.warnings];
  if (findHeadings(decoded.text).length === 0) {
    warnings.push('未识别到章节标题，已作为单一全文片段导入。');
  }
  return {
    fileName,
    encoding: decoded.encoding,
    encodingSource: decoded.encodingSource,
    sourceHash: await sha256Bytes(input.bytes),
    decodedTextHash: await sha256Bytes(encodedText),
    sourceByteLength: input.bytes.byteLength,
    decodedUtf8ByteLength: encodedText.byteLength,
    totalChars: unicodeLength(decoded.text),
    parserVersion: REFERENCE_TEXT_PARSER_VERSION,
    sectionPlanHash,
    sections,
    warnings,
    text: decoded.text,
  };
}
