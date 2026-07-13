import { analyzeTxtForChapters, type TxtAnalyzeResult } from './txtImportService';
import { detectJsonImportType, parseJsonFile, type JsonDetectResult } from './jsonImportService';

export interface TxtImportPreview {
  analysis: TxtAnalyzeResult;
  suggestedTitle: string;
}

export interface JsonImportPreview {
  data: unknown;
  detection: JsonDetectResult;
}

export function parseTxtImportPreview(content: string, fileName: string): TxtImportPreview {
  if (!content.trim()) throw new Error('TXT 文件内容为空');
  const analysis = analyzeTxtForChapters(content);
  if (analysis.chapters.length === 0) throw new Error('TXT 文件没有可导入的正文');
  return {
    analysis,
    suggestedTitle: fileName.replace(/\.txt$/i, '').trim().slice(0, 40) || '导入作品',
  };
}

export function parseJsonImportPreview(content: string): JsonImportPreview {
  const data = parseJsonFile(content);
  const detection = detectJsonImportType(data);
  if (detection.type === 'unknown') {
    throw new Error('无法识别该 JSON 格式。仅支持项目备份、风格方案和输出控制方案。');
  }
  return { data, detection };
}
