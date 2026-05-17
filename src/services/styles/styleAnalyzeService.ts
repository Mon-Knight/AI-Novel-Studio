/**
 * AI Novel Studio - 风格分析服务
 */
import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { aiTaskService } from '../ai/aiTaskService';
import type { StyleAnalyzeResult } from '../../types/style';
import { extractJsonObject } from '../ai/jsonUtils';

const MAX_TEXT_LENGTH = 20000;

export async function analyzeStyle(text: string): Promise<StyleAnalyzeResult> {
  if (!text.trim()) throw new Error('参考文本为空，请提供文本内容。');
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`文本过长（${text.length} 字），请截取代表性片段（不超过 ${MAX_TEXT_LENGTH} 字）。`);

  const settings = aiSettingsService.getSettings();
  const task = await aiTaskService.create('style_analyze', {
    runtimeMode: settings.runtimeMode,
    provider: settings.provider,
    modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
    inputSummary: `风格分析，参考文本 ${text.length} 字`,
  }).catch(() => null);

  const truncated = text.slice(0, MAX_TEXT_LENGTH);

  // 尝试加载模板
  let template = '';
  try {
    const resp = await fetch('/prompts/style_analyze.md');
    if (resp.ok) template = await resp.text();
  } catch { /* use inline */ }

  if (!template) {
    template = `你是文学风格分析师。分析以下文本的抽象风格，输出 JSON。\n参考文本：\n{{reference_text}}`;
  }

  const prompt = template.replace('{{reference_text}}', truncated);

  try {
    const client = createAiClient(settings);
    const response = await client.generate({
      taskType: 'style_analyze',
      messages: [
        { role: 'system', content: '你是一位专业的文学风格分析师。请严格按 JSON 格式输出分析结果。' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 4000,
    });

    const jsonText = extractJsonObject(response.text);
    if (!jsonText) throw new Error('AI 未返回有效的 JSON，请重试。\n\n原始返回：' + response.text.slice(0, 300));

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
    const message = e instanceof Error ? e.message : '风格分析失败';
    if (task) await aiTaskService.markFailed(task.id, message);
    throw e;
  }
}
