import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  analyzeReferenceFile,
  decodeReferenceText,
  splitReferenceSections,
} from '../../services/references/referenceTextParser';

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_CHARS = 20_000_000;
const MAX_REFERENCE_SECTIONS = 10_000;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function utf16Bytes(text: string, endianness: 'le' | 'be', includeBom = true): Uint8Array {
  const bom = includeBom
    ? endianness === 'le'
      ? Uint8Array.from([0xff, 0xfe])
      : Uint8Array.from([0xfe, 0xff])
    : new Uint8Array();
  const body = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    const offset = index * 2;
    if (endianness === 'le') {
      body[offset] = codeUnit & 0xff;
      body[offset + 1] = codeUnit >>> 8;
    } else {
      body[offset] = codeUnit >>> 8;
      body[offset + 1] = codeUnit & 0xff;
    }
  }
  return concatBytes(bom, body);
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

describe('reference text decoding', () => {
  it('detects valid UTF-8 and strips a UTF-8 BOM without losing emoji', () => {
    const text = '参考资料😀';
    const bytes = new TextEncoder().encode(text);

    expect(decodeReferenceText(bytes)).toEqual({
      text,
      encoding: 'utf-8',
      encodingSource: 'utf8_valid',
      warnings: [],
    });
    expect(decodeReferenceText(concatBytes(UTF8_BOM, bytes))).toEqual({
      text,
      encoding: 'utf-8',
      encodingSource: 'bom',
      warnings: [],
    });
  });

  it.each([
    ['le', 'utf-16le'],
    ['be', 'utf-16be'],
  ] as const)('decodes UTF-16%s BOM input including surrogate pairs', (endianness, encoding) => {
    const text = '第1章\n星海🌙';
    expect(decodeReferenceText(utf16Bytes(text, endianness))).toEqual({
      text,
      encoding,
      encodingSource: 'bom',
      warnings: [],
    });
  });

  it('falls back to GB18030 for non-UTF-8 Chinese bytes', () => {
    const gb18030Chinese = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]);
    let supported = true;
    try {
      new TextDecoder('gb18030', { fatal: true });
    } catch {
      supported = false;
    }

    if (!supported) {
      expect(() => decodeReferenceText(gb18030Chinese)).toThrow(/gb18030/i);
      return;
    }
    expect(decodeReferenceText(gb18030Chinese)).toEqual({
      text: '中文',
      encoding: 'gb18030',
      encodingSource: 'fallback',
      warnings: ['文件不是有效 UTF-8，已按 GB18030 解码；导入前请检查预览。'],
    });
  });

  it('honors an explicit encoding override before automatic detection', () => {
    const text = '无 BOM 的 UTF-16😀';
    const decoded = decodeReferenceText(utf16Bytes(text, 'le', false), 'utf-16le');
    expect(decoded).toEqual({
      text,
      encoding: 'utf-16le',
      encodingSource: 'user_override',
      warnings: [],
    });

    const gb18030Chinese = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeReferenceText(gb18030Chinese, 'gb18030')).toEqual({
      text: '中文',
      encoding: 'gb18030',
      encodingSource: 'user_override',
      warnings: [],
    });
  });
});

describe('reference section parsing and integrity facts', () => {
  it('splits a preface and mixed Chinese/English chapter headings with exact UTF-16 ranges', async () => {
    const text = ['前🙂言', '第 1 章 起点', '甲😀乙', 'Chapter 2 Return', '终🌙'].join('\n');
    const sections = await splitReferenceSections(text);

    expect(
      sections.map((section) => ({
        orderIndex: section.orderIndex,
        title: section.title,
        content: section.content,
        charCount: section.charCount,
      })),
    ).toEqual([
      { orderIndex: 1, title: '前言', content: '前🙂言', charCount: 3 },
      { orderIndex: 2, title: '第 1 章 起点', content: '甲😀乙', charCount: 3 },
      { orderIndex: 3, title: 'Chapter 2 Return', content: '终🌙', charCount: 2 },
    ]);
    for (const section of sections) {
      expect(text.slice(section.sourceStartUtf16, section.sourceEndUtf16)).toBe(section.content);
      expect(section.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sections[0]?.sourceEndUtf16).toBe(4);
  });

  it('keeps an untitled document as one trimmed full-text section', async () => {
    const source = '\n  无标题😀正文  \n';
    const sections = await splitReferenceSections(source);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual(
      expect.objectContaining({
        orderIndex: 1,
        title: '全文',
        content: '无标题😀正文',
        charCount: 6,
      }),
    );
    expect(source.slice(sections[0].sourceStartUtf16, sections[0].sourceEndUtf16)).toBe(
      '无标题😀正文',
    );
  });

  it('reports emoji as one character and produces stable SHA-256 facts', async () => {
    const bytes = new TextEncoder().encode('abc');
    const first = await analyzeReferenceFile({ fileName: ' stable.txt ', bytes });
    const second = await analyzeReferenceFile({ fileName: 'stable.txt', bytes: bytes.slice() });
    const knownSha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    expect(first.fileName).toBe('stable.txt');
    expect(first.sourceHash).toBe(knownSha256);
    expect(first.sections[0]?.contentHash).toBe(knownSha256);
    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.sections[0]?.contentHash).toBe(first.sections[0]?.contentHash);

    const emoji = await analyzeReferenceFile({
      fileName: 'emoji.txt',
      bytes: new TextEncoder().encode('A😀B'),
    });
    expect(emoji.totalChars).toBe(3);
    expect(emoji.sections[0]?.charCount).toBe(3);
  });

  it('warns only for truly untitled input, not a one-chapter document', async () => {
    const untitled = await analyzeReferenceFile({
      fileName: 'untitled.txt',
      bytes: new TextEncoder().encode('只有正文'),
    });
    const titled = await analyzeReferenceFile({
      fileName: 'titled.txt',
      bytes: new TextEncoder().encode('第一章 开始\n章节正文'),
    });

    expect(untitled.warnings).toContain('未识别到章节标题，已作为单一全文片段导入。');
    expect(titled.sections).toHaveLength(1);
    expect(titled.sections[0]?.title).toBe('第一章 开始');
    expect(titled.warnings).not.toContain('未识别到章节标题，已作为单一全文片段导入。');
  });

  it('hashes the original source bytes, so BOM changes source identity but not decoded content', async () => {
    const plainBytes = new TextEncoder().encode('相同正文');
    const bomBytes = concatBytes(UTF8_BOM, plainBytes);
    const plain = await analyzeReferenceFile({ fileName: 'plain.txt', bytes: plainBytes });
    const bom = await analyzeReferenceFile({ fileName: 'bom.txt', bytes: bomBytes });

    expect(bom.text).toBe(plain.text);
    expect(bom.sections[0]?.contentHash).toBe(plain.sections[0]?.contentHash);
    expect(bom.sourceHash).not.toBe(plain.sourceHash);
    expect(bom.sourceByteLength).toBe(plain.sourceByteLength + UTF8_BOM.byteLength);
  });
});

describe('reference parser guardrails', () => {
  it('rejects empty, undecodable, and explicitly mis-decoded byte streams', () => {
    expect(() => decodeReferenceText(new Uint8Array())).toThrow('参考资料文件为空。');
    expect(() => decodeReferenceText(Uint8Array.from([0xff]))).toThrow(/gb18030/i);
    expect(() => decodeReferenceText(Uint8Array.from([0xff]), 'utf-8')).toThrow(/utf-8/i);
  });

  it('rejects blank names and non-TXT assets before parsing', async () => {
    const bytes = new TextEncoder().encode('正文');
    await expect(analyzeReferenceFile({ fileName: '   ', bytes })).rejects.toThrow(
      '参考资料文件名为空。',
    );
    await expect(analyzeReferenceFile({ fileName: 'reference.md', bytes })).rejects.toThrow(
      '当前参考资料库仅接受 TXT 文件。',
    );
  });

  it('rejects a source larger than the 64 MiB byte limit', () => {
    const oversized = new Uint8Array(MAX_REFERENCE_BYTES + 1);
    expect(() => decodeReferenceText(oversized)).toThrow('参考资料超过 64 MiB 上限。');
  });

  it('rejects decoded text beyond the Unicode character limit without materializing a code-point array', async () => {
    const oversized = '字'.repeat(MAX_REFERENCE_CHARS + 1);
    await expect(splitReferenceSections(oversized)).rejects.toThrow(
      '参考资料超过 20,000,000 字符上限。',
    );
  });

  it('rejects more than 10,000 recognized chapter headings before hashing sections', async () => {
    const text = Array.from(
      { length: MAX_REFERENCE_SECTIONS + 1 },
      (_, index) => `第${index + 1}章\n正文`,
    ).join('\n');
    await expect(splitReferenceSections(text)).rejects.toThrow('识别到的章节数超过 10,000 上限。');
  });

  it('fails closed when reliable SHA-256 is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(splitReferenceSections('正文')).rejects.toThrow(
      '当前环境缺少可靠的 SHA-256，参考资料未导入。',
    );
  });
});
