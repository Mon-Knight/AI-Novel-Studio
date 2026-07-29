/**
 * AI Novel Studio - 风格分析服务
 */
import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { aiTaskService } from '../ai/aiTaskService';
import type { StyleAnalyzeResult } from '../../types/style';
import { extractJsonObject } from '../ai/jsonUtils';
import type { AiGenerateOptions } from '../../types/ai';
import { throwIfAiRequestCancelled } from '../ai/aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from '../ai/aiTaskCancellation';
import styleAnalyzeTemplate from '../../../prompts/style_analyze.md?raw';

const MAX_TEXT_LENGTH = 20000;
const REFERENCE_TEXT_TOKEN = '{{reference_text}}';

export function renderStyleAnalyzePrompt(referenceText: string): string {
  if (!styleAnalyzeTemplate.includes(REFERENCE_TEXT_TOKEN)) {
    throw new Error('风格分析提示词缺少 reference_text 模板变量。');
  }
  const rendered = styleAnalyzeTemplate.replace(REFERENCE_TEXT_TOKEN, referenceText);
  if (rendered.includes(REFERENCE_TEXT_TOKEN)) {
    throw new Error('风格分析提示词包含未替换的 reference_text 模板变量。');
  }
  return rendered;
}

export async function analyzeStyle(
  text: string,
  options: AiGenerateOptions = {},
): Promise<StyleAnalyzeResult> {
  if (!text.trim()) throw new Error('参考文本为空，请提供文本内容。');
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error(
      `文本过长（${text.length} 字），请截取代表性片段（不超过 ${MAX_TEXT_LENGTH} 字）。`,
    );

  const settings = aiSettingsService.getSettings();
  const task = await aiTaskService
    .create('style_analyze', {
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `风格分析，参考文本 ${text.length} 字`,
    })
    .catch(() => null);
  const releaseCancellation = bindAiTaskCancellation(task?.id, options);

  const truncated = text.slice(0, MAX_TEXT_LENGTH);

  const prompt = renderStyleAnalyzePrompt(truncated);

  try {
    const client = createAiClient(settings);
    const response = await client.generate(
      {
        taskType: 'style_analyze',
        messages: [
          {
            role: 'system',
            content: '你是一位专业的文学风格分析师。请严格按 JSON 格式输出分析结果。',
          },
          { role: 'user', content: prompt },
        ],
        maxTokens: 4000,
      },
      options,
    );
    throwIfAiRequestCancelled(options.signal);

    const jsonText = extractJsonObject(response.text);
    if (!jsonText) throw new Error('AI 未返回有效的 JSON，请重试。');

    const result: StyleAnalyzeResult = JSON.parse(jsonText);
    if (!result.styleSummary) throw new Error('分析结果缺少 styleSummary 字段。');

    await aiTaskService.markSucceeded(task?.id || '', {
      resultText: result.styleSummary,
      tokenInput: response.tokenInput,
      tokenOutput: response.tokenOutput,
      tokenTotal: response.tokenTotal,
    });

    return result;
  } catch (e: unknown) {
    await settleAiTaskError({
      taskId: task?.id,
      error: e,
      signal: options.signal,
      fallbackMessage: '风格分析失败',
    });
    throw e;
  } finally {
    releaseCancellation();
  }
}
