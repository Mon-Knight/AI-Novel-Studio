import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { qualityCheckService } from '../quality/qualityCheckService';
import { autoQualityService, type AutoQualityEvaluation } from './autoQualityService';
import { runAutonomousProvider } from './autonomousProvider';
import { hashTextContent } from '../../utils/contentHash';
import type { QualityThresholds } from '../../types/autonomous';
import type {
  QualityCheckReport,
  QualityCheckResult,
  QualityIssueSeverity,
  QualityIssueType,
} from '../../types/qualityCheck';

export interface AutoQualityCheckResult {
  reportId: string;
  totalScore: number;
  evaluation: AutoQualityEvaluation;
  tokensUsed: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
}

const QUALITY_SEVERITIES = new Set<QualityIssueSeverity>(['critical', 'high', 'medium', 'low']);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeAutonomousQualityPayload(payload: unknown): QualityCheckResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('质量检查 Artifact 缺少结构化 JSON 对象');
  }
  const record = payload as Record<string, unknown>;
  const scoreValue = Number(record.overallScore ?? record.overall_score ?? 0);
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
    .map((value, index) => {
      const severityValue = String(value.severity ?? 'medium') as QualityIssueSeverity;
      const severity = QUALITY_SEVERITIES.has(severityValue) ? severityValue : 'medium';
      const issueType = String(value.issueType ?? value.issue_type ?? value.category ?? 'language') as QualityIssueType;
      return {
        issueType,
        category: optionalString(value.category),
        severity,
        title: optionalString(value.title) ?? `质量问题 ${index + 1}`,
        description: optionalString(value.description) ?? '模型未提供问题说明',
        evidence: optionalString(value.evidence),
        suggestion: optionalString(value.suggestion),
        quote: optionalString(value.quote),
        startOffset: Number.isInteger(value.startOffset) ? Number(value.startOffset) : undefined,
        endOffset: Number.isInteger(value.endOffset) ? Number(value.endOffset) : undefined,
        paragraphIndex: Number.isInteger(value.paragraphIndex) ? Number(value.paragraphIndex) : undefined,
      };
    });
  return {
    overallScore: Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : 0,
    summary: optionalString(record.summary) ?? '质量检查完成。',
    items,
  };
}

export class AutoQualityCheckService {
  async runAutoQualityCheck(params: {
    novelId: string;
    chapterId: string;
    draftId: string;
    thresholds: QualityThresholds;
    signal?: AbortSignal;
  }): Promise<AutoQualityCheckResult> {
    const startTime = Date.now();
    const chapter = await chapterRepository.getById(params.chapterId);
    const draft = (await draftVersionService.getByChapterId(params.chapterId))
      .find((item) => item.id === params.draftId);
    if (!chapter || !draft) throw new Error(`Draft ${params.draftId} not found`);

    const report = await qualityCheckService.createReport({
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      scope: 'current_draft',
      contentLength: draft.content.length,
    });
    const contentHash = hashTextContent(draft.content);
    const generated = await runAutonomousProvider({
      taskType: 'quality_check',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      operationId: `auto_quality:${params.draftId}`,
      inputSummary: `自主质量检查草稿 ${params.draftId}`,
      systemPrompt: '你是小说质量审校编辑。请严格返回 JSON，不要添加 Markdown。',
      userPrompt: [
        `章节：${chapter.title}`,
        chapter.outline ? `章节大纲：${chapter.outline}` : '',
        chapter.goal ? `章节目标：${chapter.goal}` : '',
        `正文 hash：${contentHash}`,
        `正文长度：${draft.content.length}`,
        '按逻辑、设定、人物、连续性、语言和节奏检查，返回 overallScore、summary、items。',
      ].filter(Boolean).join('\n'),
      taskInput: {
        contentHash,
        draftVersion: draft.versionNo,
        wordCount: draft.wordCount,
      },
      maxTokens: 4000,
      signal: params.signal,
    });
    const result = normalizeAutonomousQualityPayload(generated.structured);
    const snapshot = await qualityCheckService.saveResult({
      reportId: report.id,
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.draftId,
      result,
      draftVersion: draft.versionNo,
      model: generated.modelId,
      contentHash,
      contentLength: draft.content.length,
      aiTaskId: generated.taskId,
      checkedAt: new Date().toISOString(),
    });
    const evaluation = autoQualityService.evaluate(snapshot.items, params.thresholds);
    return {
      reportId: snapshot.report?.id ?? report.id,
      totalScore: evaluation.totalScore,
      evaluation,
      tokensUsed: generated.tokenTotal,
      tokenInput: generated.tokenInput,
      tokenOutput: generated.tokenOutput,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateQuality(report: QualityCheckReport, thresholds: QualityThresholds): Promise<AutoQualityEvaluation> {
    const items = await qualityCheckService.getItemsByReportId(report.id);
    return autoQualityService.evaluate(items, thresholds);
  }
}

export const autoQualityCheckService = new AutoQualityCheckService();
