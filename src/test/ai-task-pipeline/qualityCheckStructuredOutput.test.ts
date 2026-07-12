import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unifiedAiPipeline } from '../../services/ai-tasks/unifiedAiPipeline';
import {
  parseQualityCheckResult,
  withQualityCheckStructuredRetry,
} from '../../services/ai/qualityCheckOutput';

const validReport = {
  overallScore: 76,
  summary: '存在一处衔接问题。',
  items: [{
    issueType: 'continuity',
    severity: 'medium',
    title: '场景衔接突兀',
    description: '人物位置变化缺少过渡。',
    suggestion: '补充离开房间的动作。',
  }],
};

describe('quality-check structured output compatibility', () => {
  beforeEach(() => localStorage.clear());

  it('accepts fenced snake_case JSON and normalizes the quality contract', () => {
    const parsed = parseQualityCheckResult(`前置说明\n\`\`\`json
      {
        "overall_score": "81",
        "overall_summary": "整体可读，但存在语言问题。",
        "issues": [{
          "issue_type": "语言表达",
          "severity": "中",
          "title": "句子重复",
          "description": "相邻两句表达相同。",
          "start_offset": 3,
          "end_offset": 9,
          "paragraph_index": 1
        }]
      }
    \`\`\``);

    expect(parsed).toEqual({
      overallScore: 81,
      summary: '整体可读，但存在语言问题。',
      items: [expect.objectContaining({
        issueType: 'language',
        severity: 'medium',
        title: '句子重复',
        description: '相邻两句表达相同。',
        startOffset: 3,
        endOffset: 9,
        paragraphIndex: 1,
      })],
    });
  });

  it('requests strict JSON up front and retries prose exactly once while preserving provider parameters', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        text: '夜色更深，人物继续向前走去。',
        raw: { id: 'initial' },
        tokenInput: 10,
        tokenOutput: 20,
        tokenTotal: 30,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(validReport),
        raw: { id: 'corrected' },
        tokenInput: 11,
        tokenOutput: 21,
        tokenTotal: 32,
      });
    const client = withQualityCheckStructuredRetry({ generate });
    const request = {
      taskType: 'quality_check' as const,
      messages: [
        { role: 'system' as const, content: '质量检查上下文' },
        { role: 'user' as const, content: '检查正文' },
      ],
      modelName: 'configured-model',
      temperature: 0.7,
      maxTokens: 6000,
    };

    const response = await client.generate(request);

    expect(generate).toHaveBeenCalledTimes(2);
    for (const [retryRequest] of generate.mock.calls) {
      expect(retryRequest).toEqual(expect.objectContaining({
        taskType: request.taskType,
        modelName: request.modelName,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      }));
      expect(retryRequest.messages).toHaveLength(request.messages.length);
      expect(retryRequest.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user']);
      expect(retryRequest.messages.at(-1)?.content).toContain('检查正文');
      expect(retryRequest.messages.at(-1)?.content).toContain('质量检查，不是续写');
    }
    expect(request.messages[request.messages.length - 1]?.content).toBe('检查正文');
    expect(parseQualityCheckResult(response.text)).toEqual(validReport);
    expect(response).toEqual(expect.objectContaining({
      tokenInput: 21,
      tokenOutput: 41,
      tokenTotal: 62,
      raw: {
        kind: 'quality_structured_retry_v1',
        initial: { id: 'initial' },
        corrected: { id: 'corrected' },
      },
    }));
  });

  it('does not retry an already valid structured response', async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(validReport) });
    const client = withQualityCheckStructuredRetry({ generate });

    const response = await client.generate({
      taskType: 'quality_check',
      messages: [{ role: 'user', content: '检查正文' }],
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(response.text).toBe(JSON.stringify(validReport));
  });

  it('still fails closed after one unsuccessful correction retry', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '继续续写正文，但不返回 JSON。' });
    const client = withQualityCheckStructuredRetry({ generate });

    await expect(unifiedAiPipeline.run({
      taskType: 'quality_check',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      draftId: 'draft-a',
      scopeType: 'draft',
      inputSnapshot: {
        schemaVersion: 1,
        inputType: 'quality_check_input',
        payloadJson: {},
        sourceDraftId: 'draft-a',
        sourceDraftVersion: 2,
        baseContentHash: 'base-hash',
      },
      contextSnapshot: {
        schemaVersion: 1,
        sourceManifestJson: {},
        budgetJson: {},
        compilerVersion: 'test',
      },
      constraintSnapshot: {
        schemaVersion: 1,
        payloadJson: {},
        promptTemplateId: 'quality-check-test',
        promptTemplateVersion: '1',
        promptTemplateHash: 'template-hash',
        providerOptionsJson: {},
      },
      artifactType: 'quality_report',
      timeoutMs: 1000,
      client,
      request: { messages: [{ role: 'user', content: '检查正文' }] },
      parseStructuredPayload: (text) => parseQualityCheckResult(text) ?? undefined,
    })).rejects.toEqual(expect.objectContaining({ code: 'ARTIFACT_VALIDATION_FAILED' }));

    expect(generate).toHaveBeenCalledTimes(2);
  });
});
