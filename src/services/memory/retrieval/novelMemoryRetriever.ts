import type {
  CharacterDynamicState,
  MemoryFragment,
  MemoryRetrievalQuery,
  SceneMemoryContext,
  WorldStateSnapshot,
} from '../../../types/novelMemory';

export interface MemoryRetrievalDataStore {
  fragments: MemoryFragment[];
  characterStates: Map<string, CharacterDynamicState>;
  worldState?: WorldStateSnapshot;
  previousSceneSummary?: string;
  currentConflict?: string;
  constraints?: string[];
}

export function estimateMemoryTokens(text: string): number {
  if (!text) return 0;
  // 中文字符与标点约 1 字符 ≈ 1.2 tokens，英文词按 1 词 ≈ 1.3 tokens，保守向上取整
  return Math.ceil(text.trim().length * 1.25);
}

export class NovelMemoryRetriever {
  /**
   * 根据场景入参与数据仓库组装分层记忆上下文并进行 Token 预算优先级裁剪
   */
  retrieve(query: MemoryRetrievalQuery, store: MemoryRetrievalDataStore): SceneMemoryContext {
    const novelId = query.novelId.trim();
    const relevantEntityIds = new Set<string>();

    if (query.povCharacterId) relevantEntityIds.add(query.povCharacterId.trim());
    for (const cid of query.activeCharacterIds ?? []) {
      if (cid.trim()) relevantEntityIds.add(cid.trim());
    }
    if (query.sceneId) relevantEntityIds.add(query.sceneId.trim());

    // 1. 实体与重要度相关性评分与过滤
    const scoredFragments = store.fragments
      .map((fragment) => {
        let score = fragment.importance * 10;
        const matchesEntity = fragment.relatedEntities.some((id) =>
          relevantEntityIds.has(id.trim()),
        );
        if (matchesEntity) score += 30;
        // 如果是世界规则且重要度 >= 4，即使未显式声明实体也赋予高基础分
        if (fragment.type === 'world_rule' && fragment.importance >= 4) score += 20;
        return { fragment, score, matchesEntity };
      })
      // 过滤低分且无实体关联的碎片 (importance < 3 且不匹配当前实体)
      .filter((item) => item.matchesEntity || item.fragment.importance >= 3)
      .sort((a, b) => b.score - a.score);

    // 2. 分层提炼
    const rawLongTerm = scoredFragments
      .filter((item) => item.fragment.tier === 'long_term')
      .map((item) => item.fragment);

    const rawMidTerm = scoredFragments
      .filter((item) => item.fragment.tier === 'mid_term')
      .map((item) => item.fragment);

    const rawShortTerm = scoredFragments
      .filter((item) => item.fragment.tier === 'short_term')
      .map((item) => item.fragment);

    // 3. Token 预算分配与优先级裁剪 (核心设定/规则 > 当前冲突/POV > 近期事件/动态 > 辅助线索)
    const totalBudget = Math.max(200, query.maxMemoryTokens ?? 1500);
    const longTermBudget = Math.max(50, Math.round(totalBudget * 0.35));
    const midTermBudget = Math.max(50, Math.round(totalBudget * 0.4));
    const shortTermBudget = Math.max(50, totalBudget - longTermBudget - midTermBudget);

    const { selected: longTermMemories, used: longTermUsed } = this.selectFragmentsWithinBudget(
      rawLongTerm,
      longTermBudget,
    );

    const { selected: midTermMemories, used: midTermUsed } = this.selectFragmentsWithinBudget(
      rawMidTerm,
      midTermBudget,
    );

    const { selected: shortTermMemories, used: shortTermUsed } = this.selectFragmentsWithinBudget(
      rawShortTerm,
      shortTermBudget,
    );

    // 4. 构建出场人物及其动态状态
    const povCharacter = query.povCharacterId
      ? {
          id: query.povCharacterId,
          name:
            store.characterStates.get(query.povCharacterId)?.characterName ?? query.povCharacterId,
          dynamicState: store.characterStates.get(query.povCharacterId),
        }
      : undefined;

    const activeCharacters = (query.activeCharacterIds ?? []).map((id) => ({
      id,
      name: store.characterStates.get(id)?.characterName ?? id,
      dynamicState: store.characterStates.get(id),
    }));

    return {
      novelId,
      chapterId: query.chapterId,
      sceneId: query.sceneId,
      povCharacter,
      activeCharacters,
      longTermMemories,
      midTermMemories,
      shortTermMemories,
      previousSceneSummary: store.previousSceneSummary,
      currentConflict: query.scenePlotGoal || store.currentConflict,
      constraints: store.constraints ?? [],
      tokenBudget: {
        totalBudget,
        longTermUsed,
        midTermUsed,
        shortTermUsed,
      },
    };
  }

  private selectFragmentsWithinBudget(
    fragments: MemoryFragment[],
    budget: number,
  ): { selected: MemoryFragment[]; used: number } {
    const selected: MemoryFragment[] = [];
    let used = 0;

    for (const fragment of fragments) {
      const estimated = fragment.estimatedTokens ?? estimateMemoryTokens(fragment.content);
      if (used + estimated <= budget) {
        selected.push(fragment);
        used += estimated;
      } else if (fragment.importance >= 5 && used === 0) {
        // 重要度为 5 的核心约束至少保留一条
        selected.push(fragment);
        used += estimated;
        break;
      }
    }

    return { selected, used };
  }
}

export const novelMemoryRetriever = new NovelMemoryRetriever();

/**
 * 将 SceneMemoryContext 格式化为注入 Prompt 的紧凑结构化 Markdown 文本
 */
export function formatSceneMemoryForCompilation(context: SceneMemoryContext): string {
  const sections: string[] = [];

  // 1. 视点人物与出场人物动态状态
  if (context.povCharacter || context.activeCharacters.length > 0) {
    const lines: string[] = ['### 【出场人物与动态心境】'];
    if (context.povCharacter) {
      const pov = context.povCharacter;
      const state = pov.dynamicState;
      lines.push(
        `- **视点人物 (POV)**: ${pov.name}` +
          (state?.currentEmotion ? ` | 心境: ${state.currentEmotion}` : '') +
          (state?.currentGoal ? ` | 动机: ${state.currentGoal}` : '') +
          (state?.injuries && state.injuries.length > 0
            ? ` | 状态: ${state.injuries.join('、')}`
            : ''),
      );
    }
    for (const char of context.activeCharacters) {
      if (char.id === context.povCharacter?.id) continue;
      const state = char.dynamicState;
      lines.push(
        `- **活跃人物**: ${char.name}` +
          (state?.currentEmotion ? ` | 情绪: ${state.currentEmotion}` : '') +
          (state?.currentGoal ? ` | 目标: ${state.currentGoal}` : '') +
          (state?.faction ? ` | 阵营: ${state.faction}` : ''),
      );
    }
    sections.push(lines.join('\n'));
  }

  // 2. 当前场景戏剧冲突与前序衔接
  if (context.currentConflict || context.previousSceneSummary) {
    const lines: string[] = ['### 【场景剧情冲突与前序衔接】'];
    if (context.currentConflict) {
      lines.push(`- **当前冲突目标**: ${context.currentConflict}`);
    }
    if (context.previousSceneSummary) {
      lines.push(`- **前序动作残余**: ${context.previousSceneSummary}`);
    }
    sections.push(lines.join('\n'));
  }

  // 3. 长期记忆（世界规则 / 核心设定 / 主线伏笔）
  if (context.longTermMemories.length > 0) {
    const lines: string[] = ['### 【长期记忆与世界规则】'];
    for (const mem of context.longTermMemories) {
      lines.push(`- [${mem.type}] ${mem.content}`);
    }
    sections.push(lines.join('\n'));
  }

  // 4. 中期记忆（阶段剧情 / 阵营 / 关系演变）
  if (context.midTermMemories.length > 0) {
    const lines: string[] = ['### 【中期记忆与阶段态势】'];
    for (const mem of context.midTermMemories) {
      lines.push(`- [${mem.type}] ${mem.content}`);
    }
    sections.push(lines.join('\n'));
  }

  // 5. 短期工作记忆
  if (context.shortTermMemories.length > 0) {
    const lines: string[] = ['### 【短期工作记忆】'];
    for (const mem of context.shortTermMemories) {
      lines.push(`- ${mem.content}`);
    }
    sections.push(lines.join('\n'));
  }

  // 6. 硬约束与禁忌
  if (context.constraints.length > 0) {
    const lines: string[] = ['### 【场景写作硬约束】'];
    for (const c of context.constraints) {
      lines.push(`- ${c}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
