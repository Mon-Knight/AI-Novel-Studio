import { draftVersionService } from '../database/draftVersionService';
import { runAutonomousProvider } from './autonomousProvider';
import type { QualityCheckItem } from '../../types/qualityCheck';

export interface AutoPolishResult {
  success: boolean;
  newDraftId: string | null;
  fixedIssueCount: number;
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  errorMessage?: string;
}

export class AutoPolishService {
  async autoPolish(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    issues: QualityCheckItem[];
    signal?: AbortSignal;
  }): Promise<AutoPolishResult> {
    const startTime = Date.now();
    try {
      const fixableIssues = this._filterFixableIssues(params.issues);
      if (fixableIssues.length === 0) {
        return {
          success: true,
          newDraftId: null,
          fixedIssueCount: 0,
          tokensUsed: 0,
          tokenInput: 0,
          tokenOutput: 0,
          durationMs: Date.now() - startTime,
        };
      }
      const result = await this._executePolish({
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.draftId,
        instructions: this._buildPolishInstructions(fixableIssues),
        signal: params.signal,
      });
      return {
        success: true,
        newDraftId: result.newDraftId,
        fixedIssueCount: fixableIssues.length,
        tokensUsed: result.tokensUsed,
        tokenInput: result.tokenInput,
        tokenOutput: result.tokenOutput,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        newDraftId: null,
        fixedIssueCount: 0,
        tokensUsed: 0,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private _filterFixableIssues(issues: QualityCheckItem[]): QualityCheckItem[] {
    return issues.filter((issue) => {
      const languageIssue = issue.issueType === 'language'
        || issue.issueType === 'style'
        || issue.issueType === 'pacing';
      const fixableSeverity = issue.severity === 'low' || issue.severity === 'medium';
      return languageIssue && fixableSeverity;
    });
  }

  private _buildPolishInstructions(issues: QualityCheckItem[]): string {
    const lines = [
      '请只修复以下语言表达问题，不改变情节、人物关系、事实或世界观设定。',
      ...issues.flatMap((issue, index) => [
        `${index + 1}. ${issue.title}`,
        `问题：${issue.description}`,
        issue.suggestion ? `建议：${issue.suggestion}` : '',
        issue.quote ? `原文片段：${issue.quote}` : '',
      ]),
      '保留原文段落结构；只返回完整润色后的正文。',
    ];
    return lines.filter(Boolean).join('\n');
  }

  private async _executePolish(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    instructions: string;
    signal?: AbortSignal;
  }): Promise<{ newDraftId: string; tokensUsed: number; tokenInput: number; tokenOutput: number }> {
    const currentDraft = (await draftVersionService.getByChapterId(params.chapterId))
      .find((draft) => draft.id === params.draftId);
    if (!currentDraft) throw new Error(`Draft ${params.draftId} not found`);

    const operationId = `auto_polish:${params.draftId}`;
    const generated = await runAutonomousProvider({
      taskType: 'chapter_polish',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      operationId,
      inputSummary: `自主润色草稿 ${params.draftId}`,
      systemPrompt: '你是小说文字编辑。只修复语言、风格和节奏问题，不改变情节、事实或角色设定。请只返回润色后的正文。',
      userPrompt: `${params.instructions}\n\n原文：\n${currentDraft.content.slice(0, 30000)}`,
      maxTokens: 12000,
      signal: params.signal,
    });
    const polishedContent = generated.text
      .replace(/^【润色版[：:][^】]*】\s*/gm, '')
      .replace(/\/\/\s*润色完成[^\n]*/g, '')
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim() || currentDraft.content;
    const newDraft = await draftVersionService.create({
      novelId: params.novelId,
      chapterId: params.chapterId,
      content: polishedContent,
      source: 'ai_polished',
      operationId,
      aiTaskId: generated.taskId,
      note: 'Autonomous auto-polish',
    });
    return {
      newDraftId: newDraft.id,
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
    };
  }
}

export const autoPolishService = new AutoPolishService();
