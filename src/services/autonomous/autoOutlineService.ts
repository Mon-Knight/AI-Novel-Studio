import { dbCall } from '../database/db';
import { runAutonomousProvider } from './autonomousProvider';

export interface OutlineGenerationParams {
  novelId: string;
  idea: string;
  targetChapterCount?: number;
}

export interface OutlineGenerationResult {
  success: boolean;
  chapterCount: number;
  tokensUsed: number;
  durationMs: number;
  errorMessage?: string;
}

export interface GeneratedChapter {
  order: number;
  title: string;
  summary: string;
  plotPoints: string[];
}

export interface OutlineStructure {
  chapters: GeneratedChapter[];
  overallTheme: string;
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
}

export class AutoOutlineService {
  async generateOutlineFromIdea(params: OutlineGenerationParams): Promise<OutlineGenerationResult> {
    const startTime = Date.now();
    const targetCount = Math.min(100, Math.max(1, params.targetChapterCount ?? 12));
    try {
      const outline = await this.previewOutlineFromIdea(params);
      await this.applyOutline(params.novelId, outline);
      return {
        success: true,
        chapterCount: outline.chapters.length,
        tokensUsed: outline.tokensUsed,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        chapterCount: 0,
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async previewOutlineFromIdea(params: OutlineGenerationParams): Promise<OutlineStructure> {
    const idea = params.idea.trim();
    if (!idea) throw new Error('请输入小说创意后再生成大纲');
    const targetCount = Math.min(100, Math.max(1, params.targetChapterCount ?? 12));
    return this._generateOutline(
      params.novelId,
      this._buildOutlinePrompt(idea, targetCount),
      targetCount,
    );
  }

  async applyOutline(novelId: string, outline: OutlineStructure): Promise<string[]> {
    const createdIds: string[] = [];
    for (const chapter of [...outline.chapters].sort((left, right) => left.order - right.order)) {
      const id = await this._createChapter({
        novelId,
        title: chapter.title,
        summary: [chapter.summary, ...chapter.plotPoints.map((point) => `- ${point}`)].join('\n'),
        order: chapter.order,
      });
      if (!id) throw new Error(`章节「${chapter.title}」创建后未返回 ID`);
      createdIds.push(id);
    }
    return createdIds;
  }

  private _buildOutlinePrompt(idea: string, targetChapterCount: number): string {
    return [
      `请根据下面的创意生成 ${targetChapterCount} 章小说大纲。`,
      `创意：${idea}`,
      '每章必须包含 order、title、summary、plotPoints（3-5 项）。',
      '返回 JSON：{"overallTheme": string, "chapters": [{"order": number, "title": string, "summary": string, "plotPoints": string[]}]}',
    ].join('\n');
  }

  private async _generateOutline(
    novelId: string,
    prompt: string,
    targetCount: number,
  ): Promise<OutlineStructure> {
    const operationId = `auto_outline:${Date.now()}`;
    const generated = await runAutonomousProvider({
      taskType: 'outline_generate',
      novelId,
      operationId,
      inputSummary: `生成 ${targetCount} 章自主大纲预览`,
      systemPrompt: '你是小说大纲编辑。请严格返回 JSON，不要添加 Markdown 或解释。',
      userPrompt: prompt,
      maxTokens: Math.min(16000, Math.max(3000, targetCount * 700)),
    });
    const payload = generated.structured as Record<string, unknown> | undefined;
    const rawChapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
    const chapters = rawChapters
      .map((value, index) => {
        const item = value as Record<string, unknown>;
        const order = Number(item.order ?? index + 1);
        const title = String(item.title ?? `第${order}章`);
        const summary = String(item.summary ?? '');
        const rawPlotPoints = item.plotPoints ?? item.plot_points;
        const plotPoints = Array.isArray(rawPlotPoints)
          ? rawPlotPoints.map(String).filter(Boolean)
          : [];
        return { order, title, summary, plotPoints };
      })
      .filter((chapter) => chapter.title.trim() && chapter.summary.trim())
      .slice(0, targetCount);
    if (chapters.length === 0) {
      throw new Error('AI 大纲返回中没有可用章节，请重试或检查模型配置');
    }
    return {
      chapters,
      overallTheme: String(payload?.overallTheme ?? '围绕核心创意展开的成长与冲突'),
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
    };
  }

  private async _createChapter(params: {
    novelId: string;
    title: string;
    summary: string;
    order: number;
  }): Promise<string> {
    const created = await dbCall('create_chapter', {
      input: {
        novelId: params.novelId,
        title: params.title,
        outline: params.summary,
        orderIndex: params.order,
      },
    }) as { id?: string } | null;
    return created?.id ?? '';
  }
}

export const autoOutlineService = new AutoOutlineService();
