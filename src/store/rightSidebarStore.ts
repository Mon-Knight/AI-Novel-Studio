/**
 * AI Novel Studio - 右侧栏统一状态模型
 * v1.0.45: 为每个面板保留 output/error/loading/relatedDraftVersion
 *
 * 设计原则：
 * 1. collapsed 只控制显示宽度，不销毁 toolStates
 * 2. activeTool 切换不清空其他功能输出
 * 3. AI 输出必须知道自己对应哪个正文版本
 * 4. 正文改变后，旧 AI 输出要提示"正文已变化，建议重新生成"
 * 5. 清空输出必须由用户主动触发
 */

import type { PanelType } from '../pages/WritingWorkspace/WritingWorkspacePage';

// ==================== 类型定义 ====================

/** 单个面板的运行时状态 */
export interface PanelToolState {
  /** AI 输出或计算结果文本 */
  output: string;
  /** 错误信息 */
  error: string;
  /** 是否正在加载/生成中 */
  loading: boolean;
  /** AI 输出对应的正文 contentHash */
  relatedContentHash?: string;
  /** AI 输出对应的草稿版本号 */
  relatedDraftVersion?: number;
  /** 最后一次运行的 ISO 时间戳 */
  lastRunAt?: string;
  /** 附加元数据（JSON 字符串，各面板自定义） */
  metadata?: string;
}

/** 右侧栏总状态 */
export interface RightSidebarState {
  /** 当前激活的面板类型 */
  activeTool: PanelType;
  /** 面板是否收起（false=展开, true=收起） */
  collapsed: boolean;
  /** 上一次激活的面板类型（收起时保留） */
  lastActiveTool: PanelType;
  /** 各面板的状态字典，key=toolKey */
  toolStates: Record<string, PanelToolState>;
}

// ==================== 工具键名 ====================

/** 面板键名映射（与 PanelType 一致） */
export const TOOL_KEYS: Record<string, string> = {
  'ai-generate': 'ai-generate',
  'engineering': 'engineering',
  'outline': 'outline',
  'characters': 'characters',
  'events': 'events',
  'setting': 'setting',
  'style': 'style',
  'check': 'check',
  'polish': 'polish',
  'chapter-summary': 'chapter-summary',
  'context-view': 'context-view',
};

// ==================== 工厂函数 ====================

export function createInitialSidebarState(): RightSidebarState {
  return {
    activeTool: null,
    collapsed: true,
    lastActiveTool: null,
    toolStates: {},
  };
}

export function createEmptyToolState(): PanelToolState {
  return {
    output: '',
    error: '',
    loading: false,
  };
}

export function getOrCreateToolState(
  state: RightSidebarState,
  toolKey: string,
): PanelToolState {
  return state.toolStates[toolKey] ?? createEmptyToolState();
}

/** 更新指定工具的运行时状态 */
export function updateToolState(
  state: RightSidebarState,
  toolKey: string,
  patch: Partial<PanelToolState>,
): RightSidebarState {
  const current = getOrCreateToolState(state, toolKey);
  return {
    ...state,
    toolStates: {
      ...state.toolStates,
      [toolKey]: { ...current, ...patch },
    },
  };
}

/** 清空指定工具的 AI 输出 */
export function clearToolOutput(
  state: RightSidebarState,
  toolKey: string,
): RightSidebarState {
  return updateToolState(state, toolKey, {
    output: '',
    error: '',
    relatedContentHash: undefined,
    relatedDraftVersion: undefined,
    lastRunAt: undefined,
  });
}

/** 判断指定工具的 AI 输出是否基于旧正文 */
export function isToolOutputStale(
  state: RightSidebarState,
  toolKey: string,
  currentContentHash?: string,
): boolean {
  if (!currentContentHash) return false;
  const tool = state.toolStates[toolKey];
  if (!tool?.relatedContentHash) return false;
  return tool.relatedContentHash !== currentContentHash;
}

/** 面板收起/展开切换 */
export function toggleCollapse(state: RightSidebarState): RightSidebarState {
  if (state.collapsed) {
    // 展开：恢复上次激活工具
    return {
      ...state,
      collapsed: false,
      activeTool: state.lastActiveTool,
    };
  }
  // 收起：保存当前工具为 lastActiveTool
  return {
    ...state,
    collapsed: true,
    lastActiveTool: state.activeTool,
    activeTool: null,
  };
}

/** 切换到指定工具面板 */
export function switchTool(
  state: RightSidebarState,
  toolKey: PanelType,
): RightSidebarState {
  if (state.activeTool === toolKey) {
    // 点击同一面板 → 收起
    return toggleCollapse(state);
  }
  // 切换到不同面板
  return {
    ...state,
    collapsed: false,
    lastActiveTool: state.activeTool,
    activeTool: toolKey,
  };
}

/** 关闭面板（同收起） */
export function closePanel(state: RightSidebarState): RightSidebarState {
  if (state.collapsed) return state;
  return {
    ...state,
    collapsed: true,
    lastActiveTool: state.activeTool,
    activeTool: null,
  };
}
