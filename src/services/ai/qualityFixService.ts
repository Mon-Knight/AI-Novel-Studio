/**
 * AI Novel Studio - AI 质量修稿服务
 * v1.7.16: AI 根据质量检查问题自动修稿 + 复检闭环
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { extractJsonObject, safeJsonParse } from './jsonUtils';
import { fixRunStore } from './fixRunStore';
import { unifiedAiPipeline } from '../ai-tasks/unifiedAiPipeline';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiWorkflowService, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';
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
  status: 'pending' | 'running' | 'success' | 'candidate_ready' | 'validated' | 'failed' | 'adopted' | 'reverted';
  model?: string;
  revisionSummary?: string;
  changedRangesJson?: string;
  /** v1.7.17 上下文追踪 */
  usedContextIds?: string;
  skippedContextIds?: string;
  warnings?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** AI 修稿返回结果 */
export interface FixResult {
  mode: 'targeted_fix' | 'conservative';
  revisionPlan?: Array<{ issue_key: string; target_quote?: string; fix_strategy: string; change_scope: string }>;
  fixedIssueKeys: string[];
  revisionSummary: string;
  changedRanges: Array<{ issue_key?: string; reason: string; before: string; after: string }>;
  revisedContent: string;
  unchangedPolicy?: string;
}

/** 修稿范围校验结果 */
export interface FixScopeValidation {
  passed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  changedParagraphCount: number;
  totalParagraphCount: number;
  unrelatedChangedCount: number;
  warnings: string[];
  rejectReason?: string;
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

type RawFixResult = Partial<FixResult> & {
  revision_plan?: unknown;
  fixed_issue_keys?: unknown;
  revision_summary?: unknown;
  changed_ranges?: unknown;
  revised_content?: unknown;
  unchanged_policy?: unknown;
};

/** 生成简单哈希 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 5000); i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return 'fx_' + (hash >>> 0).toString(16).padStart(8, '0');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return fallback;
}

function readArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractPlainRevisedContent(rawText: string, sourceContent: string): string {
  const cleaned = stripOuterFence(rawText);
  if (!cleaned || extractJsonObject(cleaned)) return '';

  const markerMatch = cleaned.match(/(?:revised_content|修订后正文|修订版正文|完整修订后章节正文)\s*[:：]\s*([\s\S]+)$/i);
  const candidate = (markerMatch?.[1] || cleaned).trim();
  const minLength = Math.min(120, Math.max(20, Math.round(sourceContent.trim().length * 0.3)));
  return candidate.length >= minLength ? candidate : '';
}

function normalizeRevisionPlan(value: unknown): FixResult['revisionPlan'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      issue_key: readString(record, ['issue_key', 'issueKey']),
      target_quote: readString(record, ['target_quote', 'targetQuote']) || undefined,
      fix_strategy: readString(record, ['fix_strategy', 'fixStrategy']),
      change_scope: readString(record, ['change_scope', 'changeScope']),
    };
  });
}

function normalizeChangedRanges(value: unknown): FixResult['changedRanges'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      issue_key: readString(record, ['issue_key', 'issueKey']) || undefined,
      reason: readString(record, ['reason']),
      before: readString(record, ['before']),
      after: readString(record, ['after']),
    };
  });
}

function normalizeFixResult(raw: RawFixResult, rawText: string, sourceContent: string): FixResult {
  const record = asRecord(raw);
  const fixedIssueKeys = readArray(record, ['fixedIssueKeys', 'fixed_issue_keys'])
    .filter((item): item is string => typeof item === 'string');
  const revisedContent =
    readString(record, ['revisedContent', 'revised_content'])
    || extractPlainRevisedContent(rawText, sourceContent)
    || sourceContent;

  return {
    mode: readString(record, ['mode']) === 'targeted_fix' ? 'targeted_fix' : 'conservative',
    revisionPlan: normalizeRevisionPlan(record.revisionPlan ?? record.revision_plan),
    fixedIssueKeys,
    revisionSummary: readString(record, ['revisionSummary', 'revision_summary'], '无修复摘要'),
    changedRanges: normalizeChangedRanges(record.changedRanges ?? record.changed_ranges),
    revisedContent,
    unchangedPolicy: readString(record, ['unchangedPolicy', 'unchanged_policy']),
  };
}

/** 构建 AI 修稿 Prompt (v1.7.19 精准局部修稿) */
export function buildFixPrompt(params: {
  chapterTitle: string;
  chapterOutline?: string;
  draftContent: string;
  pendingIssues: QualityCheckItem[];
  ignoredIssues: QualityCheckItem[];
  chapterContext?: string;
  volumeContext?: string;
  styleSummary?: string;
}): { messages: Array<{ role: string; content: string }>; maxTokens: number } {
  const pendingText = params.pendingIssues.map((item, i) => {
    const parts = [
      `### 问题 ${i + 1}`,
      `- issue_key: ${item.issueKey}`,
      `- severity: ${item.severity}`,
      `- category: ${item.category || item.issueType}`,
      `- title: ${item.title}`,
      `- description: ${item.description}`,
    ];
    if (item.quote) parts.push(`- quote: "${item.quote}"`);
    if (item.suggestion) parts.push(`- suggestion: ${item.suggestion}`);
    if (item.paragraphIndex !== undefined) parts.push(`- paragraph_index: ${item.paragraphIndex}`);
    return parts.join('\n');
  }).join('\n\n');

  const ignoredText = params.ignoredIssues.length > 0
    ? params.ignoredIssues.map((item) => `- ${item.issueKey}: ${item.title}（忽略，不要修复）`).join('\n')
    : '无';

  const system = [
    '你是一位精准小说章节修稿专家。你不是在重新创作本章。',
    '你是在对当前章节进行最小必要修改，只修复【待修复问题】中列出的问题。',
    '未被质量检查指出的内容，尽量保持原文不变。只修改问题涉及的段落。',
    '',
    `章节：${params.chapterTitle}`,
    params.chapterOutline ? `大纲：${params.chapterOutline}` : '',
    '',
    params.chapterContext || '',
    params.volumeContext || '',
    params.styleSummary ? `风格：${params.styleSummary}` : '',
    '',
    '【核心约束 - 必须遵守】',
    '- 修稿不是重写，修改范围尽量小。',
    '- 只修复【待修复问题】，不修复 ignored 问题。',
    '- 未涉及质量问题的段落保持原文不变。',
    '- 不改变章节核心目标、设定和人物关系。',
    '- 不新增设定、不提前暴露秘密。',
    '- 输出必须是完整章节正文。',
    '',
    '【已忽略问题，不要修复】',
    ignoredText,
    '',
    '【待修复问题】',
    pendingText,
    '',
    '请严格按以下 JSON 格式返回：',
    '{',
    '  "mode": "targeted_fix",',
    '  "revision_plan": [{ "issue_key":"...", "target_quote":"...", "fix_strategy":"...", "change_scope":"只修改该段" }],',
    '  "changed_ranges": [{ "issue_key":"...", "before":"原文", "after":"修改后", "reason":"修复原因" }],',
    '  "fixed_issue_keys": ["qc_xxx"],',
    '  "revision_summary": "本次修复说明",',
    '  "unchanged_policy": "未涉及质量问题的段落保持原文结构和表达。",',
    '  "revised_content": "完整修订后章节正文"',
    '}',
    '',
    '以下是当前章节全文：',
    params.draftContent.slice(0, 10000),
  ].filter(Boolean).join('\n');

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `请根据以上 ${params.pendingIssues.length} 个待修复问题，进行精准局部修稿。只修改问题相关部分，其他内容尽量不变。` },
    ],
    maxTokens: 10000,
  };
}

/** 修稿范围校验 (v1.7.19) */
function validateFixScope(
  sourceContent: string,
  revisedContent: string,
  changedRanges: FixResult['changedRanges'],
  fixedIssueKeys: string[],
  pendingIssueKeys: string[],
): FixScopeValidation {
  const warnings: string[] = [];
  if (!revisedContent || revisedContent.trim().length === 0) {
    return { passed: false, riskLevel: 'high', changedParagraphCount: 0, totalParagraphCount: 0, unrelatedChangedCount: 0, warnings, rejectReason: '修订版正文为空' };
  }

  const sourceLen = sourceContent.length;
  const revisedLen = revisedContent.length;
  const ratio = revisedLen / Math.max(1, sourceLen);

  if (ratio < 0.8) {
    return { passed: false, riskLevel: 'high', changedParagraphCount: 0, totalParagraphCount: 0, unrelatedChangedCount: 0, warnings, rejectReason: `修订版字数异常减少（${Math.round(ratio * 100)}%），可能丢失关键内容` };
  }
  if (ratio > 1.3) warnings.push(`修订版字数增加 ${Math.round((ratio - 1) * 100)}%，可能新增了无关内容`);

  // 段落级变化检测
  const srcParas = sourceContent.split(/\n\n+/);
  const revParas = revisedContent.split(/\n\n+/);
  let changedCount = 0;
  const totalComparable = Math.min(srcParas.length, revParas.length);

  for (let i = 0; i < totalComparable; i++) {
    const s = srcParas[i].trim();
    const r = revParas[i] ? revParas[i].trim() : '';
    if (s !== r) changedCount++;
  }
  // 新增/删除的段落也算变化
  changedCount += Math.abs(srcParas.length - revParas.length);

  const totalParagraphCount = Math.max(srcParas.length, revParas.length);
  const changeRatio = changedCount / Math.max(1, totalParagraphCount);

  // 检查是否只修改了 pending issue 相关区域
  const pendingQuoteTexts = pendingIssueKeys.join(' ').toLowerCase();
  let unrelatedChangedCount = 0;

  for (let i = 0; i < Math.min(srcParas.length, revParas.length); i++) {
    const s = srcParas[i].trim();
    const r = revParas[i] ? revParas[i].trim() : '';
    if (s !== r) {
      // 简单判断：是否包含 pending issue key 的引用
      const paraText = (s + ' ' + r).toLowerCase();
      if (!pendingQuoteTexts.includes(paraText.slice(0, 50))) {
        // 粗略判断为无关修改
      }
      unrelatedChangedCount++;
    }
  }

  if (changeRatio > 0.4 && changedCount > 3) {
    return { passed: false, riskLevel: 'high', changedParagraphCount: changedCount, totalParagraphCount, unrelatedChangedCount, warnings, rejectReason: `修改了 ${Math.round(changeRatio * 100)}% 段落（${changedCount}/${totalParagraphCount}），超出精准修稿范围` };
  }

  // 检查 changed_ranges 是否绑定 issue_key
  const unboundedRanges = changedRanges.filter((r) => !r.issue_key || !fixedIssueKeys.includes(r.issue_key));
  if (unboundedRanges.length > 0) {
    warnings.push(`${unboundedRanges.length} 个 changed_ranges 未绑定有效的 issue_key`);
  }

  const riskLevel = changeRatio > 0.25 ? 'medium' : 'low';
  return { passed: true, riskLevel, changedParagraphCount: changedCount, totalParagraphCount, unrelatedChangedCount, warnings };
}

export const qualityFixService = {
  async submitBackground(params: {
    novelId: string;
    chapterId: string;
    chapterTitle: string;
    chapterOutline?: string;
    currentDraft: ChapterDraft;
    pendingIssues: QualityCheckItem[];
    ignoredIssues: QualityCheckItem[];
    beforeReportId: string;
    chapterContext?: string;
    volumeContext?: string;
    styleSummary?: string;
  }): Promise<WorkflowCreated> {
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
    const baseContentHash = params.currentDraft.contentState?.status === 'ready'
      ? params.currentDraft.contentState.contentHash
      : await computeContentSha256(params.currentDraft.content);
    return aiWorkflowService.createBackground({
      workflowName: `${params.chapterTitle} · 质量修复与复检`,
      taskType: 'quality_fix',
      novelId: params.novelId,
      chapterId: params.chapterId,
      draftId: params.currentDraft.id,
      scopeType: 'draft',
      targetHintJson: {
        chapterId: params.chapterId,
        draftId: params.currentDraft.id,
        beforeReportId: params.beforeReportId,
        staleAgainstLatest: true,
      },
      inputPayloadJson: {
        beforeReportId: params.beforeReportId,
        pendingIssueIds: params.pendingIssues.map((item) => item.id),
        ignoredIssueIds: params.ignoredIssues.map((item) => item.id),
      },
      inputBody: params.currentDraft.content,
      sourceManifestJson: [{
        type: 'chapter_draft', id: params.currentDraft.id,
        version: params.currentDraft.versionNo, hash: baseContentHash,
      }],
      sourceDraftVersion: params.currentDraft.versionNo,
      baseContentHash,
      steps: [
        {
          stepKey: 'quality_fix', taskType: 'quality_fix', agentRole: '修复',
          artifactType: 'chapter_text', messages: request.messages,
        },
        {
          stepKey: 'quality_recheck', taskType: 'quality_recheck', agentRole: '复检',
          artifactType: 'quality_report', dependencies: ['quality_fix'], reviewOutput: true,
          messages: [{
            role: 'system',
            content: [
              '你是小说章节质量检查员。请只检查随请求附带的上游修复后正文 Artifact。',
              '输出严格 JSON：{"overallScore":0,"summary":"","items":[]}。',
              'items 中可包含 issueType、severity、title、description、suggestion、quote。',
              '不得修改正文，不得声称已经采用结果。',
            ].join('\n'),
          }, { role: 'user', content: '请复检上游修复后的完整章节正文。' }],
        },
      ],
    });
  },

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
  }): Promise<{ fixResult: FixResult; fixRun: QualityFixRun; scopeValidation: FixScopeValidation; taskId: string; artifactId: string }> {
    const settings = aiSettingsService.getSettings();
    const sourceHash = hashContent(params.currentDraft.content);

    // 创建 fix run 记录并持久化
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
    await fixRunStore.save(fixRun);

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

      const sourceContentHash = await computeContentSha256(params.currentDraft.content);
      const pipeline = await unifiedAiPipeline.run({
        taskType: 'quality_fix',
        novelId: params.novelId,
        chapterId: params.chapterId,
        draftId: params.currentDraft.id,
        scopeType: 'draft',
        targetHintJson: { chapterId: params.chapterId, draftId: params.currentDraft.id },
        inputSnapshot: {
          schemaVersion: 1,
          inputType: 'quality_fix_input',
          payloadJson: {
            chapterTitle: params.chapterTitle,
            beforeReportId: params.beforeReportId,
            pendingIssueIds: params.pendingIssues.map((item) => item.id),
          },
          body: params.currentDraft.content,
          sourceDraftId: params.currentDraft.id,
          sourceDraftVersion: params.currentDraft.versionNo,
          baseContentHash: sourceContentHash,
        },
        contextSnapshot: {
          schemaVersion: 1,
          sourceManifestJson: { novelId: params.novelId, chapterId: params.chapterId },
          compiledContext: request.messages.map((message) => `${message.role}:\n${message.content}`).join('\n\n'),
          budgetJson: { maxTokens: request.maxTokens },
          compilerVersion: 'quality-fix-context-v1',
        },
        constraintSnapshot: {
          schemaVersion: 1,
          payloadJson: { artifactType: 'chapter_text', mode: 'quality_fix', readOnlyUntilApply: true },
          promptTemplateId: 'quality_fix',
          promptTemplateVersion: '1',
          promptTemplateHash: await computeContentSha256(request.messages.map((message) => message.content).join('\n')),
          providerOptionsJson: {
            provider: settings.provider,
            model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
            maxTokens: request.maxTokens,
            timeoutSeconds: settings.timeoutSeconds,
          },
        },
        artifactType: 'chapter_text',
        providerId: settings.provider,
        timeoutMs: (settings.timeoutSeconds ?? 120) * 1000,
        client,
        request: {
        taskType: 'quality_fix' as any,
        messages: request.messages as any,
        maxTokens: request.maxTokens,
        },
        parseStructuredPayload: (text) => {
          const parsed = safeJsonParse<RawFixResult>(text, {
            mode: 'conservative', fixedIssueKeys: [], revisionSummary: '', changedRanges: [],
            revisedContent: params.currentDraft.content,
          });
          const normalized = normalizeFixResult(parsed, text, params.currentDraft.content);
          return { ...parsed, chapterText: normalized.revisedContent, revisedContent: normalized.revisedContent };
        },
      });
      const response = pipeline.response;

      const fixResult = safeJsonParse<RawFixResult>(response.text, {
        mode: 'conservative',
        fixedIssueKeys: [],
        revisionSummary: 'AI 返回格式不规范，无法解析修稿结果。',
        changedRanges: [],
        revisedContent: params.currentDraft.content,
      });

      // v1.7.20: 兼容 Prompt 要求的 snake_case、前端历史 camelCase，以及少数模型的纯正文输出。
      const safeFixResult = normalizeFixResult(fixResult, response.text, params.currentDraft.content);

      // 校验 revisedContent 非空
      if (!safeFixResult.revisedContent.trim()) {
        throw new Error('AI 返回的修订版正文为空');
      }

      fixRun.revisionSummary = safeFixResult.revisionSummary;
      fixRun.changedRangesJson = JSON.stringify(safeFixResult.changedRanges);
      fixRun.status = 'success';
      fixRun.fixedIssueIds = params.pendingIssues
        .filter((i) => safeFixResult.fixedIssueKeys.includes(i.issueKey))
        .map((i) => i.id);
      await fixRunStore.save(fixRun);

      // v1.7.19 修稿范围校验
      const scopeValidation = validateFixScope(
        params.currentDraft.content,
        safeFixResult.revisedContent,
        safeFixResult.changedRanges,
        safeFixResult.fixedIssueKeys,
        params.pendingIssues.map((i) => i.issueKey),
      );

      return { fixResult: safeFixResult, fixRun, scopeValidation,
        taskId: pipeline.task.taskId, artifactId: pipeline.artifact.artifactId };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'AI 修稿失败';
      fixRun.status = 'failed';
      fixRun.failureReason = message;
      await fixRunStore.save(fixRun);
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

  /** 标记修稿已被采用 */
  async adoptFixRun(id: string): Promise<void> {
    await fixRunStore.updateStatus(id, 'adopted');
  },

  /** 回退修稿 */
  async revertFixRun(id: string): Promise<void> {
    await fixRunStore.updateStatus(id, 'reverted');
  },

  /** 获取最近的修稿记录 */
  async getFixRuns(chapterId: string): Promise<QualityFixRun[]> {
    return fixRunStore.getByChapterId(chapterId);
  },
};
