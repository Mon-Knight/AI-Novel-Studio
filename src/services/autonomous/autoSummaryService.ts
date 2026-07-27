import { dbCall } from '../database/db';
import { runAutonomousProvider } from './autonomousProvider';

export interface AutoSummaryResult {
  success: boolean;
  summaryId: string | null;
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ChapterSummary {
  id: string;
  novelId: string;
  chapterId: string;
  draftId: string;
  summaryText: string;
  summaryType: 'auto_generated' | 'manual';
  operationId: string | null;
  createdAt: string;
  updatedAt: string;
}

type SummaryPayload = {
  plotPoints: string[];
  characters: unknown[];
  foreshadowing: string[];
  endingState: string;
};

export class AutoSummaryService {
  async generateChapterSummary(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    signal?: AbortSignal;
  }): Promise<AutoSummaryResult> {
    const startTime = Date.now();
    try {
      const draft = await this._getDraftContent(params.novelId, params.chapterId, params.draftId);
      if (!draft) throw new Error(`Draft ${params.draftId} not found`);

      const operationId = `auto_summary:${params.chapterId}:${params.draftId}`;
      const generated = await this._generateSummaryText({
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.draftId,
        operationId,
        content: draft.content,
        signal: params.signal,
      });
      const summaryId = await this._saveSummary({
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.draftId,
        summaryText: generated.text,
        operationId,
        aiTaskId: generated.taskId,
      });
      return {
        success: true,
        summaryId,
        tokensUsed: generated.tokensUsed,
        tokenInput: generated.tokenInput,
        tokenOutput: generated.tokenOutput,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        summaryId: null,
        tokensUsed: 0,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getChapterSummary(chapterId: string): Promise<ChapterSummary | null> {
    try {
      const value = await dbCall('get_chapter_summary', { chapterId }) as Record<string, unknown> | null;
      return value ? this._normalizeSummary(value, { chapterId }) : null;
    } catch {
      return null;
    }
  }

  async getNovelSummaries(novelId: string): Promise<ChapterSummary[]> {
    try {
      const values = await dbCall('get_chapter_summaries_by_novel', { novelId }) as unknown[];
      return values.map((value) => this._normalizeSummary(value as Record<string, unknown>, { novelId }));
    } catch {
      return [];
    }
  }

  private async _getDraftContent(
    novelId: string,
    chapterId: string,
    draftId: string,
  ): Promise<{ content: string } | null> {
    try {
      const result = await dbCall('read_chapter_draft_content', {
        input: { novelId, chapterId, draftId },
      }) as { contentState?: { status?: string; content?: string } };
      const state = result?.contentState;
      return state?.status === 'ready' && typeof state.content === 'string'
        ? { content: state.content }
        : null;
    } catch {
      return null;
    }
  }

  private async _generateSummaryText(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    operationId: string;
    content: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; tokensUsed: number; tokenInput: number; tokenOutput: number; taskId: string }> {
    const generated = await runAutonomousProvider({
      taskType: 'chapter_summary',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      operationId: params.operationId,
      inputSummary: '自主生成章节结构化总结',
      systemPrompt: '你是小说编辑，负责生成结构化章节总结。请严格返回 JSON，不要添加 Markdown。',
      userPrompt: [
        '请总结下面的章节，提取 plot_points、characters、foreshadowing、ending_state。',
        '章节正文：',
        params.content.slice(0, 24000),
        'JSON schema: {"plot_points": string[], "characters": object[], "foreshadowing": string[], "ending_state": string}',
      ].join('\n'),
      maxTokens: 1800,
      signal: params.signal,
    });

    const payload = generated.structured as Record<string, unknown> | undefined;
    const plotPoints = this._stringArray(payload?.plot_points ?? payload?.plotPoints);
    const characters = Array.isArray(payload?.characters) ? payload.characters : [];
    const foreshadowing = this._stringArray(payload?.foreshadowing);
    const endingState = String(payload?.ending_state ?? payload?.endingState ?? '');
    if (plotPoints.length > 0 || characters.length > 0 || foreshadowing.length > 0 || endingState) {
      return {
        text: JSON.stringify({ plotPoints, characters, foreshadowing, endingState }, null, 2),
        tokensUsed: generated.tokenTotal,
        tokenInput: generated.tokenInput,
        tokenOutput: generated.tokenOutput,
        taskId: generated.taskId,
      };
    }

    const paragraphs = params.content.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const fallback: SummaryPayload = {
      plotPoints: paragraphs.slice(0, 5),
      characters: [],
      foreshadowing: [],
      endingState: paragraphs[paragraphs.length - 1] ?? '',
    };
    return {
      text: JSON.stringify(fallback, null, 2),
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
      taskId: generated.taskId,
    };
  }

  private _stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => typeof item === 'string' ? item.trim() : JSON.stringify(item)).filter(Boolean)
      : [];
  }

  private _normalizeSummary(value: Record<string, unknown>, fallback: { novelId?: string; chapterId?: string }): ChapterSummary {
    return {
      id: String(value.id ?? ''),
      novelId: String(value.novelId ?? value.novel_id ?? fallback.novelId ?? ''),
      chapterId: String(value.chapterId ?? value.chapter_id ?? fallback.chapterId ?? ''),
      draftId: String(value.draftId ?? value.draft_id ?? value.adoptedDraftId ?? value.adopted_draft_id ?? ''),
      summaryText: String(value.summaryText ?? value.summary ?? ''),
      summaryType: value.summaryType === 'manual' ? 'manual' : 'auto_generated',
      operationId: (value.operationId ?? value.aiTaskId ?? value.ai_task_id ?? null) as string | null,
      createdAt: String(value.createdAt ?? value.created_at ?? ''),
      updatedAt: String(value.updatedAt ?? value.updated_at ?? ''),
    };
  }

  private async _saveSummary(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    summaryText: string;
    operationId: string;
    aiTaskId: string;
  }): Promise<string> {
    const summaryId = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await dbCall('save_chapter_summary', {
      input: {
        id: summaryId,
        novelId: params.novelId,
        chapterId: params.chapterId,
        adoptedDraftId: params.draftId,
        summary: params.summaryText,
        aiTaskId: params.aiTaskId,
      },
    });
    return summaryId;
  }
}

export const autoSummaryService = new AutoSummaryService();
