/**
 * AI Novel Studio - 卷上下文服务
 * v1.7.14: 卷完成判断 + 卷总结生成
 */
import type { Volume } from '../../types/volume';
import type { Chapter } from '../../types/chapter';
import type { VolumeCompletionCheck, VolumeSummarizeResult, SummarizeVolumeInput } from '../../types/chapterSummary';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { createAiClient, aiSettingsService } from './aiClient';
import { aiTaskService } from './aiTaskService';
import { safeJsonParse } from './jsonUtils';
import { aiWorkflowService, type WorkflowCreated } from '../ai-tasks/aiWorkflowService';

function buildVolumeSummaryMessages(input: SummarizeVolumeInput): Array<{ role: string; content: string }> {
  const chaptersSummary = input.chapterContexts.map((ctx, i) => [
    `第${i + 1}章：${ctx.chapterTitle}`,
    `摘要：${ctx.summary}`,
    ctx.keyEvents.length > 0 ? `关键事件：${ctx.keyEvents.join('；')}` : '',
    ctx.protagonistStateChange ? `主角变化：${ctx.protagonistStateChange}` : '',
    ctx.settingChanges?.length ? `设定变化：${ctx.settingChanges.join('；')}` : '',
    ctx.unresolvedQuestions?.length ? `未解决问题：${ctx.unresolvedQuestions.join('；')}` : '',
    ctx.factsMustRemember?.length ? `必须记住的事实：${ctx.factsMustRemember.join('；')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');
  const system = [
    '你是一位专业的小说编辑，擅长对长篇小说的分卷进行总结和梳理。',
    `卷名：${input.volumeTitle}`,
    '只能基于以下章节上下文生成结构化卷总结，不得编造。',
    chaptersSummary.slice(0, 8000),
    '请严格返回 JSON，字段为 summaryTitle、volumeMainArc、majorEvents、protagonistGrowth、characterChanges、relationshipChanges、factionChanges、settingChanges、foreshadowingCollected、unresolvedQuestions、factsMustRemember、nextVolumeHook。',
  ].join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `请汇总卷「${input.volumeTitle}」的章节上下文，生成结构化卷总结。` },
  ];
}

/** 检查卷是否满足生成卷上下文的条件 */
export async function checkVolumeCompletion(
  volume: Volume,
  chapters: Chapter[],
): Promise<VolumeCompletionCheck> {
  const reasons: string[] = [];
  const volChapters = chapters.filter((c) => c.volumeId === volume.id);
  const totalChapters = volChapters.length;

  if (volume.status !== 'completed') {
    reasons.push(`卷状态为「${volume.status}」，需要设置为「已完成」`);
  }

  if (totalChapters === 0) {
    reasons.push('该卷下没有章节');
    return { completed: false, reasons, totalChapters: 0, chaptersWithContext: 0, expiredContexts: 0, disabledContexts: 0 };
  }

  let chaptersWithContext = 0;
  let expiredContexts = 0;
  let disabledContexts = 0;

  for (const ch of volChapters) {
    const summary = await chapterSummaryService.getByChapterId(ch.id);
    if (!summary) {
      reasons.push(`第 ${ch.chapterNumber} 章缺少章节上下文`);
      continue;
    }
    chaptersWithContext++;
    if (summary.isExpired) {
      expiredContexts++;
      reasons.push(`第 ${ch.chapterNumber} 章章节上下文已过期`);
    }
    if (!summary.enabled) {
      disabledContexts++;
      reasons.push(`第 ${ch.chapterNumber} 章章节上下文已停用`);
    }
  }

  const isCompleted = reasons.length === 0 && volume.status === 'completed';

  return {
    completed: isCompleted,
    reasons: isCompleted ? [] : reasons,
    totalChapters,
    chaptersWithContext,
    expiredContexts,
    disabledContexts,
  };
}

/** 收集卷下所有有效章节上下文 */
export async function collectVolumeChapterContexts(
  volumeId: string,
  chapters: Chapter[],
): Promise<SummarizeVolumeInput['chapterContexts']> {
  const volChapters = chapters.filter((c) => c.volumeId === volumeId);
  const contexts: SummarizeVolumeInput['chapterContexts'] = [];

  for (const ch of volChapters) {
    const summary = await chapterSummaryService.getByChapterId(ch.id);
    if (summary && summary.enabled && !summary.isExpired) {
      contexts.push({
        chapterId: ch.id,
        chapterTitle: ch.title,
        summary: summary.summary,
        keyEvents: summary.keyEvents || [],
        coreEvents: summary.coreEvents,
        protagonistStateChange: summary.protagonistStateChange,
        importantCharacterChanges: summary.importantCharacterChanges,
        settingChanges: summary.settingChanges,
        newForeshadows: summary.newForeshadows,
        resolvedForeshadows: summary.resolvedForeshadows,
        unresolvedQuestions: summary.unresolvedQuestions,
        factsMustRemember: summary.factsMustRemember,
      });
    }
  }

  return contexts;
}

/** AI 生成卷总结 */
export const volumeSummaryAiService = {
  async submitBackground(input: SummarizeVolumeInput): Promise<WorkflowCreated> {
    return aiWorkflowService.createBackground({
      workflowName: `${input.volumeTitle} · 卷摘要`,
      taskType: 'volume_summary',
      novelId: input.novelId,
      scopeType: 'volume',
      targetHintJson: { volumeId: input.volumeId },
      inputPayloadJson: { volumeId: input.volumeId, chapterIds: input.chapterContexts.map((item) => item.chapterId) },
      inputBody: JSON.stringify(input.chapterContexts),
      sourceManifestJson: input.chapterContexts.map((item) => ({ type: 'chapter_summary', id: item.chapterId })),
      steps: [{
        stepKey: 'volume_summary', taskType: 'volume_summary', agentRole: '卷摘要',
        artifactType: 'volume_summary', messages: buildVolumeSummaryMessages(input), reviewOutput: true,
      }],
    });
  },

  async summarize(input: SummarizeVolumeInput): Promise<VolumeSummarizeResult> {
    const settings = aiSettingsService.getSettings();

    // 构建章节上下文摘要
    const chaptersSummary = input.chapterContexts.map((ctx, i) => {
      const parts = [
        `第${i + 1}章：${ctx.chapterTitle}`,
        `摘要：${ctx.summary}`,
        ctx.keyEvents.length > 0 ? `关键事件：${ctx.keyEvents.join('；')}` : '',
        ctx.protagonistStateChange ? `主角变化：${ctx.protagonistStateChange}` : '',
        ctx.settingChanges?.length ? `设定变化：${ctx.settingChanges.join('；')}` : '',
        ctx.unresolvedQuestions?.length ? `未解决问题：${ctx.unresolvedQuestions.join('；')}` : '',
        ctx.factsMustRemember?.length ? `必须记住的事实：${ctx.factsMustRemember.join('；')}` : '',
      ];
      return parts.filter(Boolean).join('\n');
    }).join('\n\n---\n\n');

    const system = [
      '你是一位专业的小说编辑，擅长对长篇小说的分卷进行总结和梳理。',
      '',
      `卷名：${input.volumeTitle}`,
      '',
      '以下是该卷所有章节的上下文摘要。请基于这些摘要，生成一个结构化的卷总结。',
      '注意：你只能基于提供的章节上下文来总结，不得编造任何没有出现在章节上下文中的信息。',
      '',
      '--- 章节上下文 ---',
      chaptersSummary.slice(0, 8000),
      '--- 结束 ---',
      '',
      '请严格按以下 JSON 格式返回，不要输出其他内容：',
      '```json',
      '{',
      '  "summaryTitle": "卷总结标题",',
      '  "volumeMainArc": "本卷主线概括（一段话）",',
      '  "majorEvents": ["事件1", "事件2"],',
      '  "protagonistGrowth": "主角在本卷中的成长变化",',
      '  "characterChanges": [{"name": "角色名", "change": "变化描述"}],',
      '  "relationshipChanges": [{"from": "角色A", "to": "角色B", "change": "关系变化"}],',
      '  "factionChanges": ["阵营变化1"],',
      '  "settingChanges": ["设定变化1"],',
      '  "foreshadowingCollected": ["已埋下的伏笔"],',
      '  "unresolvedQuestions": ["尚未解决的问题"],',
      '  "factsMustRemember": ["跨章节必须记住的关键事实"],',
      '  "nextVolumeHook": "下一卷衔接建议"',
      '}',
      '```',
    ].join('\n');

    const task = await aiTaskService.create('context_summarize', {
      novelId: input.novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `汇总卷「${input.volumeTitle}」上下文`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate({
        taskType: 'context_summarize',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `请汇总卷「${input.volumeTitle}」的章节上下文，生成结构化卷总结。` },
        ],
        maxTokens: 4000,
      });

      const parsed = safeJsonParse<VolumeSummarizeResult>(response.text, {
        summaryTitle: input.volumeTitle + ' 总结',
        volumeMainArc: response.text.slice(0, 500) || '无法解析卷总结',
        majorEvents: [], protagonistGrowth: '', characterChanges: [],
        relationshipChanges: [], factionChanges: [], settingChanges: [],
        foreshadowingCollected: [], unresolvedQuestions: [],
        factsMustRemember: [], nextVolumeHook: '',
      });

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: parsed.summaryTitle,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return parsed;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '卷总结失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },
};

