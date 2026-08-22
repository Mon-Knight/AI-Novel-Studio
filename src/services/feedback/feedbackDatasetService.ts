import type {
  CaptureFeedbackInput,
  DatasetStatistics,
  ExportDatasetOptions,
  FeedbackSample,
  FeedbackSampleType,
} from '../../types/feedbackDataset';

/**
 * 计算文本修改差异与修改幅度 (0.0 ~ 1.0)
 */
export function calculateEditMetrics(
  initialText: string,
  finalText: string,
): { charDifference: number; editRatio: number } {
  const a = String(initialText || '').trim();
  const b = String(finalText || '').trim();

  if (a === b) {
    return { charDifference: 0, editRatio: 0 };
  }

  const charDiff = Math.abs(b.length - a.length);
  const maxLen = Math.max(a.length, b.length, 1);

  // 简易编辑距离近似（基于字符差异与长度差）
  let diffCount = charDiff;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
    }
  }

  const editRatio = Number(Math.min(1.0, diffCount / maxLen).toFixed(3));
  return { charDifference: charDiff, editRatio };
}

export class FeedbackDatasetService {
  private samples: FeedbackSample[] = [];

  /**
   * 捕获并沉淀人类作家修改/采用样本
   */
  async captureFeedbackSample(
    input: CaptureFeedbackInput,
  ): Promise<{ sftSample: FeedbackSample; dpoSample: FeedbackSample } | null> {
    const prompt = input.prompt?.trim();
    const initial = input.initialAiOutput?.trim();
    const final = input.finalHumanOutput?.trim();

    if (!prompt || !initial || !final) {
      return null;
    }

    if (initial === final) {
      // 没有任何实际修改，跳过沉淀
      return null;
    }

    const { charDifference, editRatio } = calculateEditMetrics(initial, final);

    // 过滤极微小改动 (如纯1个标点变更)
    if (editRatio < 0.005) {
      return null;
    }

    const now = new Date().toISOString();
    const baseId = `fb-${input.chapterId}-${Date.now().toString(36)}`;

    // 1. SFT 示范样本
    const sftSample: FeedbackSample = {
      sampleId: `${baseId}-sft`,
      novelId: input.novelId.trim(),
      chapterId: input.chapterId.trim(),
      sceneId: input.sceneId?.trim(),
      source: input.source,
      type: 'sft_demonstration',
      prompt,
      systemPrompt: input.systemPrompt?.trim(),
      initialAiOutput: initial,
      finalHumanOutput: final,
      charDifference,
      editRatio,
      qualityScore: input.qualityScore,
      tags: input.tags ?? [],
      createdAt: now,
    };

    // 2. DPO 偏好对样本
    const dpoSample: FeedbackSample = {
      sampleId: `${baseId}-dpo`,
      novelId: input.novelId.trim(),
      chapterId: input.chapterId.trim(),
      sceneId: input.sceneId?.trim(),
      source: input.source,
      type: 'dpo_preference',
      prompt,
      systemPrompt: input.systemPrompt?.trim(),
      initialAiOutput: initial,
      finalHumanOutput: final,
      charDifference,
      editRatio,
      qualityScore: input.qualityScore,
      tags: input.tags ?? [],
      createdAt: now,
    };

    this.samples.push(sftSample, dpoSample);
    return { sftSample, dpoSample };
  }

  /**
   * 列出反馈样本
   */
  listSamples(
    novelId?: string,
    filter?: { type?: FeedbackSampleType; source?: string },
  ): FeedbackSample[] {
    return this.samples.filter((s) => {
      if (novelId && s.novelId !== novelId.trim()) return false;
      if (filter?.type && s.type !== filter.type) return false;
      if (filter?.source && s.source !== filter.source) return false;
      return true;
    });
  }

  /**
   * 导出为指定格式的微调数据集字符串
   */
  exportDataset(options: ExportDatasetOptions): string {
    const minRatio = options.minEditRatio ?? 0.01;
    const maxRatio = options.maxEditRatio ?? 0.99;

    const filtered = this.samples.filter((s) => {
      if (options.novelId && s.novelId !== options.novelId.trim()) return false;
      if (options.sampleType && s.type !== options.sampleType) return false;
      if (s.editRatio < minRatio || s.editRatio > maxRatio) return false;
      return true;
    });

    if (options.format === 'sharegpt') {
      const shareGptItems = filtered.map((s) => {
        const convos = [];
        if (s.systemPrompt) {
          convos.push({ from: 'system', value: s.systemPrompt });
        }
        convos.push({ from: 'human', value: s.prompt });
        convos.push({ from: 'gpt', value: s.finalHumanOutput });
        return {
          id: s.sampleId,
          conversations: convos,
        };
      });
      return JSON.stringify(shareGptItems, null, 2);
    }

    if (options.format === 'openai_chat') {
      const lines = filtered.map((s) => {
        const messages = [];
        if (s.systemPrompt) {
          messages.push({ role: 'system', content: s.systemPrompt });
        }
        messages.push({ role: 'user', content: s.prompt });
        messages.push({ role: 'assistant', content: s.finalHumanOutput });
        return JSON.stringify({ messages });
      });
      return lines.join('\n');
    }

    // 默认标准 jsonl 格式
    const lines = filtered.map((s) => {
      if (s.type === 'dpo_preference') {
        return JSON.stringify({
          prompt: s.prompt,
          system: s.systemPrompt || '',
          chosen: s.finalHumanOutput,
          rejected: s.initialAiOutput,
          metadata: {
            novelId: s.novelId,
            chapterId: s.chapterId,
            editRatio: s.editRatio,
          },
        });
      }
      return JSON.stringify({
        messages: [
          ...(s.systemPrompt ? [{ role: 'system', content: s.systemPrompt }] : []),
          { role: 'user', content: s.prompt },
          { role: 'assistant', content: s.finalHumanOutput },
        ],
        metadata: {
          novelId: s.novelId,
          chapterId: s.chapterId,
        },
      });
    });

    return lines.join('\n');
  }

  /**
   * 计算数据集统计指标
   */
  getStatistics(novelId?: string): DatasetStatistics {
    const list = this.listSamples(novelId);
    const totalSamples = list.length;

    let sftCount = 0;
    let dpoCount = 0;
    let totalWords = 0;
    let sumRatio = 0;

    for (const s of list) {
      if (s.type === 'sft_demonstration') sftCount++;
      if (s.type === 'dpo_preference') dpoCount++;
      totalWords += s.finalHumanOutput.length;
      sumRatio += s.editRatio;
    }

    const avgEditRatio =
      totalSamples > 0 ? Number((sumRatio / totalSamples).toFixed(3)) : 0;

    return {
      totalSamples,
      sftSamplesCount: sftCount,
      dpoSamplesCount: dpoCount,
      totalWords,
      avgEditRatio,
    };
  }

  reset(novelId?: string): void {
    if (novelId) {
      this.samples = this.samples.filter((s) => s.novelId !== novelId.trim());
    } else {
      this.samples = [];
    }
  }
}

export const feedbackDatasetService = new FeedbackDatasetService();
