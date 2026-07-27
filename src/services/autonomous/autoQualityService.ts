/**
 * Auto Quality Service
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 *
 * 质量自动评分引擎：将质量检查报告转换为自动决策
 */

import type { QualityThresholds } from '../../types/autonomous';
import type { QualityCheckItem } from '../../types/qualityCheck';

export type QualityDimension = 'logic' | 'setting' | 'character' | 'continuity' | 'language' | 'pacing';

export type AutoAdoptDecision = 'adopt' | 'fix_only' | 'regenerate' | 'pause';

export interface DimensionScores {
  logic: number;
  setting: number;
  character: number;
  continuity: number;
  language: number;
  pacing: number;
}

export interface AutoQualityEvaluation {
  totalScore: number;
  dimensionScores: DimensionScores;
  passed: boolean;

  // 各维度是否通过阈值
  dimensionPassed: Record<QualityDimension, boolean>;

  // 问题分类
  criticalIssues: QualityCheckItem[];
  autoFixableIssues: QualityCheckItem[];   // 可通过润色修复（仅语言问题）
  regenerationIssues: QualityCheckItem[];  // 需要重新生成

  // 决策
  decision: AutoAdoptDecision;
  decisionReason: string;
}

/**
 * 权重配置：各维度对总分的贡献
 * 逻辑、连续性权重最高（对长篇小说最重要）
 */
const DIMENSION_WEIGHTS: Record<QualityDimension, number> = {
  logic: 0.25,
  setting: 0.20,
  character: 0.15,
  continuity: 0.25,
  language: 0.10,
  pacing: 0.05,
};

/**
 * 分数扣除规则
 */
const DEDUCTION_RULES = {
  critical: 30,  // 严重问题：每个扣 30 分
  major: 10,     // 重要问题：每个扣 10 分
  minor: 3,      // 轻微问题：每个扣 3 分
};

/**
 * 映射 QualityCheckItem.category 到 QualityDimension
 * 注意：不同版本的质量检查可能使用不同的 category 字符串
 */
const CATEGORY_TO_DIMENSION: Record<string, QualityDimension> = {
  logic: 'logic',
  logic_check: 'logic',
  setting: 'setting',
  setting_check: 'setting',
  setting_violation: 'setting',
  world_setting: 'setting',
  character: 'character',
  character_check: 'character',
  character_behavior: 'character',
  continuity: 'continuity',
  continuity_check: 'continuity',
  language: 'language',
  language_check: 'language',
  style: 'language',
  pacing: 'pacing',
  pacing_check: 'pacing',
  rhythm: 'pacing',
};

export class AutoQualityService {
  /**
   * 评估质量报告，给出自动化决策
   */
  evaluate(
    items: QualityCheckItem[],
    thresholds: QualityThresholds
  ): AutoQualityEvaluation {
    // 1. 计算各维度分数
    const dimensionScores = this.calculateDimensionScores(items);

    // 2. 计算加权总分
    const totalScore = this.calculateWeightedTotal(dimensionScores);

    // 3. 判断各维度是否通过
    const dimensionPassed: Record<QualityDimension, boolean> = {
      logic: dimensionScores.logic >= thresholds.minLogicScore,
      setting: dimensionScores.setting >= thresholds.minSettingScore,
      character: dimensionScores.character >= thresholds.minCharacterScore,
      continuity: dimensionScores.continuity >= thresholds.minContinuityScore,
      language: dimensionScores.language >= thresholds.minLanguageScore,
      pacing: dimensionScores.pacing >= thresholds.minPacingScore,
    };

    // 4. 分类问题
    const criticalIssues = items.filter(
      (i) => i.severity === 'critical' || i.severity === 'high'
    );
    const autoFixableIssues = items.filter(
      (i) =>
        (i.severity === 'low' || i.severity === 'medium') &&
        this._getDimension(i.category ?? i.issueType ?? '') === 'language'
    );
    const regenerationIssues = items.filter(
      (i) =>
        (i.severity === 'critical' || i.severity === 'high') &&
        this._getDimension(i.category ?? i.issueType ?? '') !== 'language'
    );

    // 5. 决策
    const passed = totalScore >= thresholds.minTotalScore;
    const tooManyCritical = criticalIssues.length > thresholds.maxCriticalIssues;
    const failedCriticalDimension =
      !dimensionPassed.logic ||
      !dimensionPassed.continuity ||
      !dimensionPassed.setting ||
      !dimensionPassed.character;

    let decision: AutoAdoptDecision;
    let decisionReason: string;

    // A single low-severity wording issue is harmless, but a cluster of
    // fixable language issues should go through the polish pass even when the
    // weighted score remains above the adoption threshold.
    const requiresPolish = autoFixableIssues.length > 1;
    if (passed && !tooManyCritical && !failedCriticalDimension && !requiresPolish) {
      decision = 'adopt';
      decisionReason = `质量达标：总分 ${totalScore}/${thresholds.minTotalScore}，各维度通过`;
    } else if (!tooManyCritical && autoFixableIssues.length > 0 && regenerationIssues.length === 0) {
      decision = 'fix_only';
      decisionReason = `仅有语言问题（${autoFixableIssues.length} 个），可通过润色修复`;
    } else if (tooManyCritical || failedCriticalDimension || regenerationIssues.length > 0) {
      decision = 'regenerate';
      decisionReason = this._buildRegenerationReason(
        tooManyCritical,
        failedCriticalDimension,
        dimensionPassed,
        regenerationIssues.length
      );
    } else {
      decision = 'pause';
      decisionReason = `质量不达标（${totalScore} < ${thresholds.minTotalScore}），无法自动修复，需要人工干预`;
    }

    return {
      totalScore,
      dimensionScores,
      passed,
      dimensionPassed,
      criticalIssues,
      autoFixableIssues,
      regenerationIssues,
      decision,
      decisionReason,
    };
  }

  /**
   * 计算各维度得分（0-100）
   */
  calculateDimensionScores(items: QualityCheckItem[]): DimensionScores {
    const dimensions: QualityDimension[] = [
      'logic', 'setting', 'character', 'continuity', 'language', 'pacing',
    ];

    const scores: Partial<DimensionScores> = {};

    for (const dim of dimensions) {
      const dimItems = items.filter((i) => this._getDimension(i.category ?? i.issueType ?? '') === dim);

      if (dimItems.length === 0) {
        scores[dim] = 100; // 无问题 = 满分
      } else {
        const critical = dimItems.filter((i) => i.severity === 'critical').length;
        const high = dimItems.filter((i) => i.severity === 'high').length;
        const minor = dimItems.filter((i) => i.severity === 'medium' || i.severity === 'low').length;

        const deduction =
          critical * DEDUCTION_RULES.critical +
          high * DEDUCTION_RULES.major +
          minor * DEDUCTION_RULES.minor;

        scores[dim] = Math.max(0, Math.min(100, 100 - deduction));
      }
    }

    return scores as DimensionScores;
  }

  /**
   * 加权平均总分
   */
  calculateWeightedTotal(scores: DimensionScores): number {
    let total = 0;
    for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
      total += scores[dim as QualityDimension] * weight;
    }
    return Math.round(total);
  }

  // ==================== Private ====================

  private _getDimension(category: string): QualityDimension {
    const dim = CATEGORY_TO_DIMENSION[category?.toLowerCase() ?? ''];
    return dim ?? 'language'; // 未知类别归入 language
  }

  private _buildRegenerationReason(
    tooManyCritical: boolean,
    failedCriticalDimension: boolean,
    dimensionPassed: Record<QualityDimension, boolean>,
    regenerationIssueCount: number
  ): string {
    const reasons: string[] = [];

    if (tooManyCritical) {
      reasons.push('存在严重问题（Critical Issues）');
    }
    if (failedCriticalDimension) {
      const failed = ['logic', 'continuity', 'setting', 'character']
        .filter((d) => !dimensionPassed[d as QualityDimension])
        .join('、');
      reasons.push(`关键维度不达标：${failed}`);
    }
    if (regenerationIssueCount > 0) {
      reasons.push(`存在 ${regenerationIssueCount} 个需要重新生成的问题`);
    }

    return `需要重新生成：${reasons.join('；')}`;
  }
}

export const autoQualityService = new AutoQualityService();
