/**
 * Creative Agent - Quality Feedback Memory
 * 记录高质量成功正文范式与生成参数，用于未来创作强化
 */
import type { AgentQualityReview, QualityFeedbackRecord } from '../../types/agentHarness';
import { createUniqueId } from '../../utils/uniqueId';

export class QualityFeedbackMemory {
  private records = new Map<string, QualityFeedbackRecord>();

  recordSuccessfulGeneration(params: {
    userGoal: string;
    inputConditions: {
      sceneGoal?: string;
      sceneBeats?: string;
      povCharacter?: string;
    };
    generationParams: {
      modelName: string;
      temperature: number;
    };
    qualityReview: AgentQualityReview;
    proseSnippet: string;
  }): QualityFeedbackRecord {
    const record: QualityFeedbackRecord = {
      id: `qf-${createUniqueId()}`,
      userGoal: params.userGoal,
      inputConditions: { ...params.inputConditions },
      generationParams: { ...params.generationParams },
      qualityReview: { ...params.qualityReview },
      proseSnippet: params.proseSnippet.slice(0, 300),
      timestamp: new Date().toISOString(),
    };

    this.records.set(record.id, record);
    return record;
  }

  findBestGenerationExamples(goal: string, minScore = 85): QualityFeedbackRecord[] {
    const list = Array.from(this.records.values()).filter(
      (r) => r.qualityReview.overallScore >= minScore,
    );
    const keywords = goal.toLowerCase().split(/\s+/).filter(Boolean);

    list.sort((a, b) => {
      const aOverlap = keywords.filter((k) => a.userGoal.toLowerCase().includes(k)).length;
      const bOverlap = keywords.filter((k) => b.userGoal.toLowerCase().includes(k)).length;
      return (
        bOverlap * 10 +
        b.qualityReview.overallScore -
        (aOverlap * 10 + a.qualityReview.overallScore)
      );
    });

    return list;
  }

  listRecords(): QualityFeedbackRecord[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }
}

export const qualityFeedbackMemory = new QualityFeedbackMemory();
