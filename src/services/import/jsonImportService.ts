/**
 * AI Novel Studio - JSON 导入服务
 */

export type JsonImportType = 'ai_novel_studio_project' | 'style_profile' | 'output_profile' | 'unknown';

export interface JsonDetectResult {
  type: JsonImportType; name?: string; summary?: string;
}

export function parseJsonFile(content: string): unknown {
  try { return JSON.parse(content); }
  catch { throw new Error('JSON 解析失败，请确认文件格式'); }
}

export function detectJsonImportType(data: unknown): JsonDetectResult {
  if (!data || typeof data !== 'object') return { type: 'unknown' };
  const obj = data as Record<string, unknown>;

  // AI Novel Studio 完整作品
  if (obj.type === 'ai_novel_studio_project' && obj.novel) {
    return { type: 'ai_novel_studio_project', name: (obj.novel as any)?.title || '导入作品', summary: `含 ${(obj as any).volumes?.length || 0} 卷 ${(obj as any).chapters?.length || 0} 章` };
  }
  if (obj.novel && (obj.chapters || obj.volumes)) {
    return { type: 'ai_novel_studio_project', name: (obj.novel as any)?.title || '导入作品', summary: `含 ${(obj as any).chapters?.length || 0} 章` };
  }

  // 风格方案
  if (obj.narrativePerspective || obj.tone || obj.pace || obj.dialogueRatio != null) {
    return { type: 'style_profile', name: (obj.name as string) || '导入风格', summary: `${obj.name || ''}` };
  }

  // 输出控制
  if (obj.targetWordCount != null || obj.chapterWordRange || obj.endingHookRequired != null) {
    return { type: 'output_profile', name: (obj.name as string) || '导入输出方案', summary: `${obj.name || ''}` };
  }

  return { type: 'unknown' };
}
