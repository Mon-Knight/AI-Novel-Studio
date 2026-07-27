import { dbCall } from '../database/db';
import { runAutonomousProvider } from './autonomousProvider';

export type ContinuityCheckType = 'character' | 'setting' | 'timeline' | 'logic' | 'full';
export type ContinuityStatus = 'passed' | 'warning' | 'failed';
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ContinuityIssue {
  type: ContinuityCheckType;
  severity: IssueSeverity;
  description: string;
  affectedChapters: string[];
  evidence: string;
  suggestion: string;
}

export interface ContinuityCheckResult {
  success: boolean;
  checkId: string | null;
  score: number;
  status: ContinuityStatus;
  issues: ContinuityIssue[];
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ContinuityCheckParams {
  novelId: string;
  chapterId: string;
  /** Candidate draft checked before adoption. */
  draftId?: string;
  previousChapterIds: string[];
  checkType?: ContinuityCheckType;
  operationId?: string;
  signal?: AbortSignal;
}

type ChapterContent = { id: string; content: string; summary?: string };

export class ContinuitySentinelService {
  async checkContinuity(params: ContinuityCheckParams): Promise<ContinuityCheckResult> {
    const startTime = Date.now();
    const checkType = params.checkType ?? 'full';
    try {
      const currentChapter = await this._getChapterContent(params.chapterId, params.draftId);
      const previousChapters = await Promise.all(params.previousChapterIds.map((id) => this._getChapterContent(id)));
      const operationId = params.operationId ?? `continuity:${params.chapterId}:${Date.now()}`;
      const generated = await this._performContinuityCheck({
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.draftId,
        operationId,
        currentChapter,
        previousChapters,
        checkType,
        signal: params.signal,
      });
      const status = this._calculateStatus(generated.score, generated.issues);
      const checkId = await this._saveContinuityCheck({
        novelId: params.novelId,
        chapterId: params.chapterId,
        checkType,
        score: generated.score,
        status,
        issues: generated.issues,
        previousChapterIds: params.previousChapterIds,
        operationId,
      });
      return {
        success: true,
        checkId,
        score: generated.score,
        status,
        issues: generated.issues,
        tokensUsed: generated.tokensUsed,
        tokenInput: generated.tokenInput,
        tokenOutput: generated.tokenOutput,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        checkId: null,
        score: 0,
        status: 'failed',
        issues: [],
        tokensUsed: 0,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async _getChapterContent(chapterId: string, draftId?: string): Promise<ChapterContent> {
    if (draftId) {
      const chapter = await dbCall('get_chapter_by_id', { id: chapterId }) as {
        id: string;
        novelId: string;
      } | null;
      if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
      const draft = await dbCall('read_chapter_draft_content', {
        input: { novelId: chapter.novelId, chapterId, draftId },
      }) as { contentState?: { status?: string; content?: string } };
      if (draft.contentState?.status !== 'ready') {
        throw new Error(`Draft ${draftId} is unavailable for continuity review`);
      }
      return { id: chapterId, content: draft.contentState.content ?? '' };
    }
    const summary = await dbCall('get_chapter_summary', { chapterId }).catch(() => null) as Record<string, unknown> | null;
    if (summary) {
      return {
        id: chapterId,
        content: '',
        summary: String(summary.summary ?? summary.summaryText ?? ''),
      };
    }
    const chapter = await dbCall('get_chapter_by_id', { id: chapterId }) as {
      id: string;
      novelId: string;
      adoptedDraftId?: string | null;
    } | null;
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
    if (chapter.adoptedDraftId) {
      const draft = await dbCall('read_chapter_draft_content', {
        input: { novelId: chapter.novelId, chapterId, draftId: chapter.adoptedDraftId },
      }) as { contentState?: { status?: string; content?: string } };
      if (draft.contentState?.status === 'ready') {
        return { id: chapterId, content: draft.contentState.content ?? '' };
      }
    }
    return { id: chapterId, content: '' };
  }

  private async _performContinuityCheck(params: {
    novelId: string;
    chapterId: string;
    draftId?: string;
    operationId: string;
    currentChapter: ChapterContent;
    previousChapters: ChapterContent[];
    checkType: ContinuityCheckType;
    signal?: AbortSignal;
  }): Promise<{
    score: number;
    issues: ContinuityIssue[];
    tokensUsed: number;
    tokenInput: number;
    tokenOutput: number;
  }> {
    const generated = await runAutonomousProvider({
      taskType: 'continuity_check',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      operationId: params.operationId,
      inputSummary: `连续性检查（${params.checkType}）`,
      systemPrompt: '你是小说连续性审校编辑。请严格返回 JSON，不要添加 Markdown。',
      userPrompt: this._buildContinuityPrompt(params),
      maxTokens: 3000,
      signal: params.signal,
    });
    const payload = generated.structured as Record<string, unknown> | undefined;
    const score = Math.max(0, Math.min(100, Number(payload?.score ?? 100)));
    const issues = Array.isArray(payload?.issues)
      ? payload.issues.map((issue) => this._normalizeIssue(issue as Record<string, unknown>, params.currentChapter.id)).filter(Boolean) as ContinuityIssue[]
      : [];
    return {
      score: Number.isFinite(score) ? score : 0,
      issues,
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
    };
  }

  private _normalizeIssue(value: Record<string, unknown>, chapterId: string): ContinuityIssue | null {
    const severity = String(value.severity ?? 'medium') as IssueSeverity;
    if (!['critical', 'high', 'medium', 'low'].includes(severity)) return null;
    const type = String(value.type ?? 'logic') as ContinuityCheckType;
    return {
      type: ['character', 'setting', 'timeline', 'logic', 'full'].includes(type) ? type : 'logic',
      severity,
      description: String(value.description ?? ''),
      affectedChapters: Array.isArray(value.affectedChapters) ? value.affectedChapters.map(String) : [chapterId],
      evidence: String(value.evidence ?? ''),
      suggestion: String(value.suggestion ?? ''),
    };
  }

  private _buildContinuityPrompt(params: {
    currentChapter: ChapterContent;
    previousChapters: ChapterContent[];
    checkType: ContinuityCheckType;
  }): string {
    const previous = params.previousChapters
      .map((chapter, index) => `前文 ${index + 1}（${chapter.id}）：${chapter.summary ?? chapter.content.slice(0, 5000)}`)
      .join('\n\n');
    return [
      `检查类型：${params.checkType}`,
      previous,
      `当前章节（${params.currentChapter.id}）：${params.currentChapter.summary ?? params.currentChapter.content.slice(0, 10000)}`,
      '请检查人物、设定、时间线和因果逻辑，返回 JSON：{"score":0-100,"issues":[{"type":"character|setting|timeline|logic","severity":"critical|high|medium|low","description":string,"affectedChapters":string[],"evidence":string,"suggestion":string}]}',
    ].join('\n\n');
  }

  private _calculateStatus(score: number, issues: ContinuityIssue[]): ContinuityStatus {
    if (issues.some((issue) => issue.severity === 'critical') || score < 60) return 'failed';
    if (score < 80 || issues.some((issue) => issue.severity === 'high')) return 'warning';
    return 'passed';
  }

  private async _saveContinuityCheck(params: {
    novelId: string;
    chapterId: string;
    checkType: ContinuityCheckType;
    score: number;
    status: ContinuityStatus;
    issues: ContinuityIssue[];
    previousChapterIds: string[];
    operationId: string;
  }): Promise<string> {
    const checkId = `${params.operationId}:check`;
    await dbCall('create_continuity_check', {
      input: {
        id: checkId,
        novelId: params.novelId,
        chapterId: params.chapterId,
        checkType: params.checkType,
        score: params.score,
        status: params.status,
        issuesJson: JSON.stringify(params.issues),
        previousChapterIds: JSON.stringify(params.previousChapterIds),
        operationId: params.operationId,
        createdAt: new Date().toISOString(),
      },
    });
    return checkId;
  }
}

export const continuitySentinelService = new ContinuitySentinelService();
