import type {
  ChapterDraft,
  ChapterGenerationContext,
  OutlineComplianceResult,
} from '../../../types/ai';
import { checkOutlineCompliance } from '../../../services/ai/outlineComplianceChecker';

export function namesText(names: string[]): string {
  return names.length > 0 ? names.join('、') : '无';
}
export function getChapterCharacterNames(
  ctx: ChapterGenerationContext | null | undefined,
): string[] {
  return ctx?.chapterCharacterList?.map((item) => item.name).filter(Boolean) ?? [];
}

export function getRequiredCharacterNames(
  ctx: ChapterGenerationContext | null | undefined,
): string[] {
  return ctx?.requiredCharacters?.map((item) => item.name).filter(Boolean) ?? [];
}

type ValidationStatus = '通过' | '警告' | '未通过';

export interface GenerationValidationState {
  draftId: string;
  outlineCompliance: OutlineComplianceResult;
  requiredNames: string[];
  missingRequiredNames: string[];
  note: string;
}

export function getOutlineValidationStatus(score: number): ValidationStatus {
  if (score < 60) return '未通过';
  if (score < 80) return '警告';
  return '通过';
}

export function buildValidationNote(input: {
  outlineCompliance: OutlineComplianceResult;
  requiredNames: string[];
  missingRequiredNames: string[];
}): string {
  const outlineStatus = getOutlineValidationStatus(input.outlineCompliance.score);
  const roleStatus = input.missingRequiredNames.length > 0 ? '缺失' : '通过';
  const missingPoints =
    input.outlineCompliance.missingPoints.map((point) => point.text).join('；') || '无';
  return [
    `大纲遵循检查：${outlineStatus}`,
    `大纲遵循度：${input.outlineCompliance.score}分`,
    `已覆盖：${input.outlineCompliance.coveredPoints.length}项`,
    `缺失：${input.outlineCompliance.missingPoints.length}项`,
    `缺失大纲关键点：${missingPoints}`,
    `角色出场检查：${roleStatus}`,
    `缺失必须出场角色：${input.missingRequiredNames.join('、') || '无'}`,
  ].join('\n');
}

export function buildValidationSnapshot(ctx: ChapterGenerationContext, generatedText: string) {
  const outlineCompliance = checkOutlineCompliance(generatedText, ctx.outlineKeyPoints || []);
  const requiredNames = [...new Set(getRequiredCharacterNames(ctx))];
  const missingRequiredNames = requiredNames.filter((name) => !generatedText.includes(name));
  const note = buildValidationNote({ outlineCompliance, requiredNames, missingRequiredNames });
  return {
    outlineCompliance,
    requiredNames,
    missingRequiredNames,
    note,
  };
}

export function buildValidationWarningText(
  validation: Omit<GenerationValidationState, 'draftId'>,
): string | undefined {
  const messages: string[] = [];
  const outlineStatus = getOutlineValidationStatus(validation.outlineCompliance.score);
  if (outlineStatus === '未通过') {
    messages.push(
      `生成正文未充分遵循章节大纲（${validation.outlineCompliance.score} 分）。建议重新生成或按大纲修正后再确认采用。`,
    );
  } else if (outlineStatus === '警告') {
    messages.push(
      `生成正文只部分遵循章节大纲（${validation.outlineCompliance.score} 分）。建议检查缺失关键点。`,
    );
  }
  if (validation.missingRequiredNames.length > 0) {
    messages.push(`生成正文缺少必须出场角色：${validation.missingRequiredNames.join('、')}。`);
  }
  return messages.join('\n') || undefined;
}

export function draftHasAdoptionRisk(
  draft: ChapterDraft,
  validationState: GenerationValidationState | null,
): boolean {
  if (validationState?.draftId === draft.id) {
    return (
      validationState.outlineCompliance.score < 80 ||
      validationState.missingRequiredNames.length > 0
    );
  }
  const note = draft.note || '';
  return (
    note.includes('大纲遵循检查：未通过') ||
    note.includes('大纲遵循检查：警告') ||
    note.includes('角色出场检查：缺失')
  );
}
