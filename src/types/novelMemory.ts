/**
 * Novel Memory Layer - Domain Models & Contract Definitions
 * 面向百万字长篇小说创作的三层结构化记忆体系
 */

/** 记忆分层 */
export type MemoryTier = 'long_term' | 'mid_term' | 'short_term';

/** 记忆片段类型 */
export type MemoryFragmentType =
  | 'world_rule' // 长期：世界规则/力量体系/地理设定
  | 'character_profile' // 长期：角色基础设定/性格特征/身世背景
  | 'character_state' // 中期：角色当前动态状态（心境/伤势/目标/好感）
  | 'plot_arc' // 中期：当前卷/支线剧情进展与阶段目标
  | 'foreshadow' // 长期/中期：已埋伏笔与待解谜团
  | 'scene_working' // 短期：当前分镜/对白/临时环境工作记忆
  | 'custom'; // 自定义扩展记忆片段

/** 结构化记忆片段 */
export interface MemoryFragment {
  id: string;
  tier: MemoryTier;
  type: MemoryFragmentType;
  /** 重要度评级 (1 ~ 5, 5 为不可省略核心约束) */
  importance: number;
  /** 记忆来源标识（如 character:char-001 / volume:vol-2 / scene:scene-12） */
  source: string;
  /** 记忆正文描述 */
  content: string;
  /** 关联实体 ID 列表（如关联的角色 ID、地点 ID、派系 ID） */
  relatedEntities: string[];
  /** 预估 Token 占用 */
  estimatedTokens?: number;
  /** 创建与更新时间戳 (ISO 8601) */
  createdAt: string;
  updatedAt?: string;
}

/** 角色动态状态（中期记忆核心） */
export interface CharacterDynamicState {
  characterId: string;
  characterName: string;
  /** 当前情绪与心境（如 "暗自提防，表面虚与委蛇"） */
  currentEmotion?: string;
  /** 当前即时目标/动机（如 "寻机夺取筑基丹"） */
  currentGoal?: string;
  /** 即时人际关系/好感度简要（如 { "char-002": "信任度下降，怀疑其为卧底" }） */
  currentRelationship?: Record<string, string>;
  /** 当前伤势与负面状态（如 ["左肩贯穿剑伤", "灵力亏空 30%"]） */
  injuries?: string[];
  /** 所属阵营/派系当前身份 */
  faction?: string;
  /** 当前/最后已知所在地点 */
  lastKnownLocation?: string;
  /** 状态演变版本号 */
  stateVersion: number;
  /** 更新时间戳 */
  updatedAt: string;
}

/** 世界状态快照（长期与中期记忆交汇） */
export interface WorldStateSnapshot {
  novelId: string;
  /** 时间线位置/剧情纪年（如 "天元历 328 年·秋·宗门大比前夕"） */
  timelinePosition?: string;
  /** 当前生效的核心世界规则/禁忌（如 ["本秘境内禁止御剑飞行", "天道誓言违者遭雷劫"]） */
  worldRules?: string[];
  /** 正在发生的大事件/环境态势（如 ["魔教围攻落霞峰", "北域寒潮提前降临"]） */
  activeEvents?: string[];
  /** 各主要阵营/势力当前博弈状态（如 { "天剑宗": "封山自保", "万毒门": "暗中渗透" }） */
  factionStatus?: Record<string, string>;
  /** 待解谜团与核心未回收伏笔列表 */
  unresolvedMysteries?: string[];
  /** 快照版本号 */
  snapshotVersion: number;
  /** 快照创建时间戳 */
  updatedAt: string;
}

/** 场景记忆上下文（提供给 Writer 模型的组装产物） */
export interface SceneMemoryContext {
  novelId: string;
  chapterId?: string;
  sceneId: string;
  /** 视点人物（POV 角色） */
  povCharacter?: {
    id: string;
    name: string;
    dynamicState?: CharacterDynamicState;
  };
  /** 本场景出场/活跃角色列表及其当前动态状态 */
  activeCharacters: Array<{
    id: string;
    name: string;
    dynamicState?: CharacterDynamicState;
  }>;
  /** 长期记忆片段（世界观、核心设定） */
  longTermMemories: MemoryFragment[];
  /** 中期记忆片段（当前卷主线、人物状态变化、伏笔） */
  midTermMemories: MemoryFragment[];
  /** 短期工作记忆（前序场景摘要、即时对白线索） */
  shortTermMemories: MemoryFragment[];
  /** 前序场景摘要（保证场景间连续性） */
  previousSceneSummary?: string;
  /** 当前场景核心戏剧冲突与目标 */
  currentConflict?: string;
  /** 写作硬约束与禁忌（如 "本场景主角不得动用金手指"） */
  constraints: string[];
  /** 整体记忆预算分配 (Tokens) */
  tokenBudget?: {
    totalBudget: number;
    longTermUsed: number;
    midTermUsed: number;
    shortTermUsed: number;
  };
}

/** 记忆检索请求入参 */
export interface MemoryRetrievalQuery {
  novelId: string;
  chapterId?: string;
  sceneId: string;
  povCharacterId?: string;
  activeCharacterIds?: string[];
  scenePlotGoal?: string;
  /** 允许的最大记忆 Token 上限（默认按模型预算分配，如 1500 tokens） */
  maxMemoryTokens?: number;
}

/** 小说记忆管理器接口契约 */
export interface INovelMemoryManager {
  /**
   * 根据当前创作上下文检索并组装分层场景记忆
   */
  retrieveContext(query: MemoryRetrievalQuery): Promise<SceneMemoryContext>;

  /**
   * 更新特定角色的动态状态
   */
  updateCharacterState(
    novelId: string,
    characterId: string,
    patch: Partial<CharacterDynamicState>,
  ): Promise<CharacterDynamicState>;

  /**
   * 记录/更新世界状态快照
   */
  updateWorldState(
    novelId: string,
    patch: Partial<WorldStateSnapshot>,
  ): Promise<WorldStateSnapshot>;

  /**
   * 追加结构化记忆片段
   */
  addMemoryFragment(
    novelId: string,
    fragment: Omit<MemoryFragment, 'id' | 'createdAt'>,
  ): Promise<MemoryFragment>;

  /**
   * 生成当前小说的完整世界与人物状态快照
   */
  createSnapshot(novelId: string): Promise<WorldStateSnapshot>;

  /**
   * 批量应用状态增量 Delta 并创建版本快照
   */
  applyStateDelta(
    novelId: string,
    deltas: MemoryStateDelta[],
    description?: string,
  ): Promise<MemoryUpdateResult>;

  /**
   * 回滚至特定历史记忆版本快照
   */
  rollbackMemoryVersion(novelId: string, versionId: string): Promise<boolean>;

  /**
   * 获取小说历史版本快照列表
   */
  listMemoryVersions(novelId: string): MemoryVersionSnapshot[];
}

/** 状态增量变更实体类型 */
export type MemoryStateDeltaEntityType = 'character' | 'world' | 'faction' | 'rule' | 'mystery';

/** 状态增量变更对象（用于剧情演进后的结构化状态提交） */
export interface MemoryStateDelta {
  entityId: string;
  entityType: MemoryStateDeltaEntityType;
  /** 具体的属性变更键值对 */
  changes: Record<string, unknown>;
  /** 触发该变更的来源分镜/章节（如 "chap-05/scene-02"） */
  sourceScene?: string;
  /** 变更置信度 (0.0 ~ 1.0) */
  confidence?: number;
  /** 变更发生的时间戳 */
  timestamp?: string;
}

/** 不可变记忆版本快照（用于状态追溯与版本安全回滚） */
export interface MemoryVersionSnapshot {
  versionId: string;
  novelId: string;
  versionNumber: number;
  description: string;
  /** 快照时刻各角色动态状态副本 */
  characterStates: Record<string, CharacterDynamicState>;
  /** 快照时刻世界状态副本 */
  worldState: WorldStateSnapshot;
  /** 快照创建时间戳 */
  createdAt: string;
}

/** 状态增量批量应用结果 */
export interface MemoryUpdateResult {
  appliedDeltas: number;
  updatedCharacters: string[];
  worldUpdated: boolean;
  versionSnapshot: MemoryVersionSnapshot;
}
