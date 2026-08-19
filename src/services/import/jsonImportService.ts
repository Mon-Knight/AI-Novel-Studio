/**
 * AI Novel Studio - JSON 导入服务
 */

export type JsonImportType =
  'ai_novel_studio_project' | 'style_profile' | 'output_profile' | 'unknown';

export interface JsonDetectResult {
  type: JsonImportType;
  name?: string;
  summary?: string;
  isProjectBackupCandidate?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNovelTitle(value: unknown): string {
  return readString(asRecord(value)?.title) || '导入作品';
}

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function parseJsonFile(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('JSON 解析失败，请确认文件格式');
  }
}

export function detectJsonImportType(data: unknown): JsonDetectResult {
  const obj = asRecord(data);
  if (!obj) return { type: 'unknown' };

  // A file that declares the versioned backup protocol must never fall back
  // to the legacy import path when its validation fails.
  if (obj.type === 'ai_novel_studio_project' && ('schemaVersion' in obj || 'tables' in obj)) {
    const tables = asRecord(obj.tables) ?? {};
    const volumes = readArrayLength(tables.volumes);
    const chapters = readArrayLength(tables.chapters);
    return {
      type: 'ai_novel_studio_project',
      name: readNovelTitle(obj.novel),
      summary: `项目备份：含 ${volumes} 卷、${chapters} 章`,
      isProjectBackupCandidate: true,
    };
  }

  if (obj.type === 'ai_novel_studio_project' && obj.novel) {
    return {
      type: 'ai_novel_studio_project',
      name: readNovelTitle(obj.novel),
      summary: `含 ${readArrayLength(obj.volumes)} 卷 ${readArrayLength(obj.chapters)} 章`,
    };
  }
  if (obj.novel && (obj.chapters || obj.volumes)) {
    return {
      type: 'ai_novel_studio_project',
      name: readNovelTitle(obj.novel),
      summary: `含 ${readArrayLength(obj.chapters)} 章`,
    };
  }

  // 风格方案
  if (obj.narrativePerspective || obj.tone || obj.pace || obj.dialogueRatio != null) {
    return {
      type: 'style_profile',
      name: readString(obj.name) || '导入风格',
      summary: `${obj.name || ''}`,
    };
  }

  // 输出控制
  if (obj.targetWordCount != null || obj.chapterWordRange || obj.endingHookRequired != null) {
    return {
      type: 'output_profile',
      name: readString(obj.name) || '导入输出方案',
      summary: `${obj.name || ''}`,
    };
  }

  return { type: 'unknown' };
}
