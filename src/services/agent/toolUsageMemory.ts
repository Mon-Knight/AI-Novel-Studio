/**
 * Creative Agent - Tool Usage Memory
 * 记录与检索历史成功创作工具链轨迹，为 Agent 规划提供经验推荐
 */
import type { ToolUsageExperience } from '../../types/agentHarness';
import { createUniqueId } from '../../utils/uniqueId';

export class ToolUsageMemory {
  private experiences = new Map<string, ToolUsageExperience>();

  constructor() {
    this.seedDefaultExperiences();
  }

  /**
   * 记录一次成功的工具链执行经验
   */
  recordExperience(
    userGoal: string,
    toolSequence: string[],
    qualityScore: number,
  ): ToolUsageExperience {
    const taskIntent = this.categorizeIntent(userGoal);
    const existing = this.findExactExperience(taskIntent, toolSequence);

    if (existing) {
      existing.successCount += 1;
      existing.qualityScore = Math.max(existing.qualityScore, qualityScore);
      existing.lastUsedAt = new Date().toISOString();
      return existing;
    }

    const experience: ToolUsageExperience = {
      id: `exp-${createUniqueId()}`,
      userGoal,
      taskIntent,
      toolSequence: [...toolSequence],
      qualityScore,
      successCount: 1,
      lastUsedAt: new Date().toISOString(),
    };

    this.experiences.set(experience.id, experience);
    return experience;
  }

  /**
   * 检索与用户目标相似的高分工具执行轨迹
   */
  findSimilarExperiences(goal: string, minScore = 70): ToolUsageExperience[] {
    const goalTokens = this.tokenize(goal);
    const results: Array<{ exp: ToolUsageExperience; relevance: number }> = [];

    for (const exp of this.experiences.values()) {
      if (exp.qualityScore < minScore) continue;

      const expTokens = this.tokenize(`${exp.userGoal} ${exp.taskIntent}`);
      const overlap = goalTokens.filter((t) => expTokens.includes(t)).length;

      if (overlap > 0 || exp.taskIntent === this.categorizeIntent(goal)) {
        const relevance = overlap * 10 + exp.qualityScore * 0.5 + exp.successCount * 2;
        results.push({ exp, relevance });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.map((r) => r.exp);
  }

  /**
   * 获取针对当前目标的推荐工具调用链
   */
  getRecommendedToolTrajectory(goal: string): string[] | undefined {
    const matched = this.findSimilarExperiences(goal, 80);
    return matched[0]?.toolSequence;
  }

  /**
   * 获取所有存储的经验列表
   */
  listExperiences(): ToolUsageExperience[] {
    return Array.from(this.experiences.values());
  }

  /**
   * 清理经验库（主要用于测试重置）
   */
  clear(): void {
    this.experiences.clear();
    this.seedDefaultExperiences();
  }

  private seedDefaultExperiences(): void {
    const defaultSeeds: Array<{ goal: string; tools: string[]; score: number }> = [
      {
        goal: '修改人物性格与心理动态',
        tools: ['query_character_state', 'generate_scene_plan', 'update_memory'],
        score: 95,
      },
      {
        goal: '检索世界规则与势力设定',
        tools: ['query_world_state'],
        score: 98,
      },
      {
        goal: '完成章节创作与全流程闭环',
        tools: [
          'query_world_state',
          'query_character_state',
          'generate_scene_plan',
          'generate_prose',
          'quality_check',
          'update_memory',
          'save_chapter_version',
        ],
        score: 96,
      },
      {
        goal: '构思全书大纲与分卷脉络',
        tools: ['generate_outline'],
        score: 92,
      },
    ];

    for (const seed of defaultSeeds) {
      const exp: ToolUsageExperience = {
        id: `seed-${createUniqueId()}`,
        userGoal: seed.goal,
        taskIntent: this.categorizeIntent(seed.goal),
        toolSequence: seed.tools,
        qualityScore: seed.score,
        successCount: 5,
        lastUsedAt: new Date().toISOString(),
      };
      this.experiences.set(exp.id, exp);
    }
  }

  private categorizeIntent(goal: string): string {
    const text = goal.toLowerCase();
    if (
      (text.includes('完成') || text.includes('写') || text.includes('创作')) &&
      (text.includes('章') || text.includes('节') || text.includes('遗迹'))
    ) {
      return 'full_chapter';
    }
    if (text.includes('人物') || text.includes('性格') || text.includes('角色') || text.includes('心境')) {
      return 'character';
    }
    if (text.includes('世界观') || text.includes('世界规则') || text.includes('设定')) {
      return 'world';
    }
    if (text.includes('大纲') || text.includes('脉络')) {
      return 'outline';
    }
    if (text.includes('分镜') || text.includes('节奏')) {
      return 'scene';
    }
    return 'general';
  }

  private findExactExperience(taskIntent: string, toolSequence: string[]): ToolUsageExperience | undefined {
    const seqKey = toolSequence.join('->');
    for (const exp of this.experiences.values()) {
      if (exp.taskIntent === taskIntent && exp.toolSequence.join('->') === seqKey) {
        return exp;
      }
    }
    return undefined;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }
}

export const toolUsageMemory = new ToolUsageMemory();
