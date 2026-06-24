/**
 * AI Novel Studio - AI 质量修稿服务
 * v1.7.16: AI 根据质量检查问题自动修稿 + 复检闭环
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { aiTaskService } from './aiTaskService';
import { safeJsonParse } from './jsonUtils';
import type { QualityCheckItem } from '../../types/qualityCheck';
import type { ChapterDraft } from '../../types/ai';

/** 修稿模式 */
export type FixMode = 'conservative';

/** 修稿运行记录 */
export interface QualityFixRun {
  id: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  targetDraftId?: string;
  targetDraftVersion?: number;
  sourceContentHash: string;
  targetContentHash?: string;
  beforeReportId: string;
  afterReportId?: string;
  beforeScore: number;
  afterScore?: number;
  beforePendingCount: number;
  afterPendingCount?: number;
  beforeSeriousCount: number;
  afterSeriousCount?: number;
  fixedIssueIds: string[];
  newIssueIds: string[];
  mode: FixMode;
  status: 'pending' | 'running' | 'success' | 'failed' | 'adopted' | 'reverted';
  model?: string;
  revisionSummary?: string;
  changedRangesJson?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** AI 修稿返回结果 */
export interface FixResult {
  mode: FixMode;
  fixedIssueKeys: string[];
  revisionSummary: string;
  changedRanges: Array<{
    reason: string;
    before: string;
    after: string;
  }>;
  revisedContent: string;
}

/** 修复前后对比 */
export interface FixComparison {
  beforeScore: number;
  afterScore: number;
  beforeTotalIssues: number;
  afterTotalIssues: number;
  beforePendingCount: number;
  afterPendingCount: number;
  beforeSeriousCount: number;
  afterSeriousCount: number;
  beforeHighCount: number;
  afterHighCount: number;
  newIssueCount: number;
  fixedIssueCount: number;
  isBetter: boolean;
  isWorse: boolean;
  summary: string;
}

/** 生成简单哈希 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 5000); i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return 'fx_' + (hash >>> 0).toString(16).padStart(8, '0');
}

/** 构建 AI 修稿 Prompt */
function buildFixPrompt(params: {
  chapterTitle: string;
  chapterOutline?: string;
  draftContent: string;
  pendingIssues: QualityCheckItem[];
  ignoredIssues: QualityCheckItem[];
  chapterContext?: string;
  volumeContext?: string;
  styleSummary?: string;
}): { messages: Array<{ role: string; content: string }>; maxTokens: number } {
  const pendingText = params.pendingIssues.map((item, i) =>
    `${i + 1}. [${item.severity}] ${item.title}\n   类别：${item.category || item.issueType}\n   描述：${item.description}\n   ${item.quote ? `原文："${item.quote}"` : ''}\n   ${item.suggestion ? `建议：${item.suggestion}` : ''}`
  ).join('\n\n');

  const ignoredText = params.ignoredIssues.length > 0
    ? params.ignoredIssues.map((item) => `- ${item.title}（忽略，不要修复）`).join('\n')
    : '无';

  const system = [
    '你是小说章节自动修稿 AI。你只能根据质量检查指出的 pending 问题修复当前章节。',
    '你必须尽量保留原章节结构、剧情顺序、人物关系、叙事风格。',
    '你不能新增重大设定。你不能提前暴露未公开秘密。',
    '你不能修复 ignored 问题。你必须输出完整修订后章节正文。',
    '',
    `章节：${params.chapterTitle}`,
    params.chapterOutline ? `大纲：${params.chapterOutline}` : '',
    '',
    params.chapterContext ? params.chapterContext : '',
    params.volumeContext ? params.volumeContext : '',
    params.styleSummary ? `风格要求：${params.styleSummary}` : '',
    '',
    '【禁止改动】',
    '- 不允许改变章节核心目标',
    '- 不允许改变已确认世界设定',
    '- 不允许改变人物身份和核心关系',
    '- 不允许新增重大世界规则',
    '- 不允许提前暴露未公开秘密',
    '- 不允许为了修问题删除关键剧情',
    '- 不允许把章节改成完全不同内容',
    '- 不允许修复 ignored 问题',
    '- 不允许新增与质量问题无关的大段剧情',
    '',
    '【忽略问题，不要处理】',
    ignoredText,
    '',
    '【待修复问题】',
    pendingText,
    '',
    '请严格按以下 JSON 格式返回，不要输出其他内容：',
    '```json',
    '{',
    '  "mode": "conservative",',
    '  "fixed_issue_keys": ["issue_key_1", "issue_key_2"],',
    '  "revision_summary": "本次修复说明",',
    '  "changed_ranges": [',
    '    {"reason": "修复原因", "before": "原文片段", "after": "修改后片段"}',
    '  ],',
    '  "revised_content": "完整修订后章节正文"',
    '}',
    '```',
    '',
    '以下是当前章节正文：',
    '',
    params.draftContent.slice(0, 10000),
  ].filter(Boolean).join('\n');

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `请根据以上 ${params.pendingIssues.length} 个待修复问题，生成修订版章节正文。` },
    ],
    maxTokens: 10000,
  };
}

export const qualityFixService = {
  async runFix(params: {
    novelId: string;
    chapterId: string;
    chapterTitle: string;
    chapterOutline?: string;
    currentDraft: ChapterDraft;
    pendingIssues: QualityCheckItem[];
    ignoredIssues: QualityCheckItem[];
    beforeReportId: string;
    beforeScore: number;
    beforePendingCount: number;
    beforeSeriousCount: number;
    chapterContext?: string;
    volumeContext?: string;
    styleSummary?: string;
  }): Promise<{ fixResult: FixResult; fixRun: QualityFixRun }> {
    const settings = aiSettingsService.getSettings();
    const sourceHash = hashContent(params.currentDraft.content);

    // 创建 fix run 记录
    const fixRun: QualityFixRun = {
      id: 'fxr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      novelId: params.novelId,
      chapterId: params.chapterId,
      sourceDraftId: params.currentDraft.id,
      sourceDraftVersion: params.currentDraft.versionNo,
      sourceContentHash: sourceHash,
      beforeReportId: params.beforeReportId,
      beforeScore: params.beforeScore,
      beforePendingCount: params.beforePendingCount,
      beforeSeriousCount: params.beforeSeriousCount,
      fixedIssueIds: [],
      newIssueIds: [],
      mode: 'conservative',
      status: 'running',
      model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 创建 AI 任务
    const task = await aiTaskService.create('quality_fix', {
      novelId: params.novelId,
      chapterId: params.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `修复章节「${params.chapterTitle}」${params.pendingIssues.length} 个问题`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const request = buildFixPrompt({
        chapterTitle: params.chapterTitle,
        chapterOutline: params.chapterOutline,
        draftContent: params.currentDraft.content,
        pendingIssues: params.pendingIssues,
        ignoredIssues: params.ignoredIssues,
        chapterContext: params.chapterContext,
        volumeContext: params.volumeContext,
        styleSummary: params.styleSummary,
      });

      const response = await client.generate({
        taskType: 'quality_fix' as any,
        messages: request.messages as any,
        maxTokens: request.maxTokens,
      });

      const fixResult = safeJsonParse<FixResult>(response.text, {
        mode: 'conservative',
        fixedIssueKeys: [],
        revisionSummary: 'AI 返回格式不规范，无法解析修稿结果。',
        changedRanges: [],
        revisedContent: params.currentDraft.content,
      });

      fixRun.revisionSummary = fixResult.revisionSummary;
      fixRun.changedRangesJson = JSON.stringify(fixResult.changedRanges);
      fixRun.status = 'success';
      fixRun.fixedIssueIds = params.pendingIssues
        .filter((i) => fixResult.fixedIssueKeys.includes(i.issueKey))
        .map((i) => i.id);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: fixResult.revisionSummary,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return { fixResult, fixRun };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'AI 修稿失败';
      fixRun.status = 'failed';
      fixRun.failureReason = message;
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  /** 对比修复前后效果 */
  compareResults(
    beforeScore: number,
    afterScore: number,
    beforePending: number,
    afterPending: number,
    beforeSerious: number,
    afterSerious: number,
    beforeTotal: number,
    afterTotal: number,
    beforeHigh: number,
    afterHigh: number,
    fixedCount: number,
  ): FixComparison {
    const newIssueCount = Math.max(0, afterPending - (beforePending - fixedCount));
    const isBetter = afterScore > beforeScore
      && afterSerious <= beforeSerious
      && afterPending < beforePending;
    const isWorse = afterScore < beforeScore
      || afterSerious > beforeSerious;

    return {
      beforeScore, afterScore,
      beforeTotalIssues: beforeTotal, afterTotalIssues: afterTotal,
      beforePendingCount: beforePending, afterPendingCount: afterPending,
      beforeSeriousCount: beforeSerious, afterSeriousCount: afterSerious,
      beforeHighCount: beforeHigh, afterHighCount: afterHigh,
      newIssueCount, fixedIssueCount: fixedCount,
      isBetter, isWorse,
      summary: isBetter
        ? `修复成功：分数从 ${beforeScore} 提升至 ${afterScore}，修复 ${fixedCount} 个问题。`
        : isWorse
          ? `修复效果不佳：分数从 ${beforeScore} 降至 ${afterScore}。`
          : `修复效果一般：分数 ${beforeScore} → ${afterScore}。`,
    };
  },
};
