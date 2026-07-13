import type { OutputProfile } from '../../types/output';
import { outputProfileService } from '../styles/outputProfileService';
import { styleProfileService } from '../styles/styleProfileService';
import type { JsonImportType } from './jsonImportService';
import type { JsonImportPreview } from './importPreviewService';
import { importProjectBackup } from './projectImportService';

type JsonRecord = Record<string, unknown>;

export interface JsonImportExecutionResult {
  message: string;
  destination: string;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined;
}

export function jsonImportTypeLabel(type: JsonImportType): string {
  if (type === 'ai_novel_studio_project') return '完整作品';
  if (type === 'style_profile') return '风格方案';
  if (type === 'output_profile') return '输出控制方案';
  return '未知格式';
}

export async function executeJsonImport(
  preview: JsonImportPreview,
  onProgress?: (message: string) => void,
): Promise<JsonImportExecutionResult> {
  const obj = record(preview.data);
  if (preview.detection.type === 'style_profile') {
    onProgress?.('正在导入风格方案……');
    await styleProfileService.create({
      name: text(obj.name, '导入风格'),
      sourceType: 'json_import',
      narrativePerspective: text(obj.narrativePerspective) || undefined,
      tone: text(obj.tone) || undefined,
      pace: text(obj.pace) || undefined,
      sentenceStyle: text(obj.sentenceStyle) || undefined,
      dialogueRatio: number(obj.dialogueRatio, 0.35),
      descriptionRatio: number(obj.descriptionRatio, 0.4),
      psychologicalRatio: typeof obj.psychologicalRatio === 'number' ? obj.psychologicalRatio : undefined,
      styleSummary: text(obj.styleSummary),
    });
    return { message: '风格方案导入成功。', destination: '/styles' };
  }

  if (preview.detection.type === 'output_profile') {
    onProgress?.('正在导入输出控制方案……');
    await outputProfileService.create({
      name: text(obj.name, '导入输出方案'),
      targetWordCount: number(obj.targetWordCount, 4000),
      paceLevel: oneOf(obj.paceLevel, ['slow', 'medium', 'fast'] as const),
      dialogueRatio: number(obj.dialogueRatio, 0.35),
      descriptionRatio: number(obj.descriptionRatio, 0.4),
      battleIntensity: oneOf(obj.battleIntensity, ['low', 'medium', 'high'] as const) as OutputProfile['battleIntensity'],
      endingHookRequired: obj.endingHookRequired === true,
    });
    return { message: '输出控制方案导入成功。', destination: '/styles' };
  }

  if (preview.detection.type === 'ai_novel_studio_project') {
    const result = await importProjectBackup(preview.data, ({ stage, current, total }) => {
      onProgress?.(`${stage}（${current}/${Math.max(total, 1)}）`);
    });
    const missing = result.missingContentCount > 0
      ? `；旧备份中有 ${result.missingContentCount} 章不含正文`
      : '';
    return {
      message: `作品《${result.novelTitle}》导入成功：${result.volumeCount} 卷、${result.chapterCount} 章，恢复正文 ${result.adoptedChapterCount} 章${missing}。`,
      destination: `/novels/${result.novelId}`,
    };
  }

  throw new Error('无法导入未知 JSON 格式');
}
