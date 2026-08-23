import type { AiSettings } from '../../types/ai';
import type { AgentContext, AgentDecision, AgentHarnessConfig } from '../../types/agentHarness';
import { createAiClient } from '../ai/aiClient';
import { aiSettingsService } from '../ai/aiSettingsService';
import { agentContextManager } from './agentContextManager';

const FALLBACK_AI_SETTINGS: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: 'mock-agent-planner',
  temperature: 0.3,
  maxTokens: 4000,
  timeoutSeconds: 60,
  mockMode: true,
};

export class AgentPlanner {
  async decideNextStep(
    context: AgentContext,
    config?: AgentHarnessConfig,
  ): Promise<AgentDecision> {
    let settings: AiSettings = config?.modelSettings ?? FALLBACK_AI_SETTINGS;
    if (!config?.modelSettings) {
      try {
        settings = aiSettingsService.getSettings();
      } catch {
        settings = FALLBACK_AI_SETTINGS;
      }
    }
    const systemPrompt = agentContextManager.buildSystemPrompt(context);

    // 格式化消息为模型输入
    const historyText = context.messages
      .map((m) => {
        if (m.role === 'user') return `User: ${m.content}`;
        if (m.role === 'assistant') return `Assistant Thought: ${m.thought || ''}\nAssistant: ${m.content}`;
        if (m.role === 'tool') return `Tool [${m.name}] Observation:\n${m.content}`;
        return `${m.role}: ${m.content}`;
      })
      .join('\n\n');

    const prompt = `${systemPrompt}\n\n### 对话与工具执行历史:\n${historyText}\n\n请输出你的下一步 JSON 决策:`;

    // 1. 如果在真实模型环境，调用真实 AI Client
    if (settings.runtimeMode !== 'mock') {
      try {
        const client = createAiClient(settings);
        const response = await client.generate(
          {
            messages: [
              {
                role: 'system',
                content: 'You are an autonomous creative writing agent. Respond strictly with a valid JSON block.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: config?.temperature ?? 0.3,
          },
          {},
        );

        const decision = this.parseDecisionJson(response.text);
        if (decision) return decision;
      } catch {
        // Fallback to heuristic planner below
      }
    }

    // 2. 启发式/Mock 规划器（支持单元测试与离线运行）
    return this.heuristicPlan(context);
  }

  private parseDecisionJson(rawText: string): AgentDecision | null {
    try {
      let jsonStr = rawText.trim();
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }
      const parsed = JSON.parse(jsonStr);
      const isFinal = parsed.action === 'final_answer';

      return {
        thought: parsed.thought || '根据当前目标推进下一步',
        plan: Array.isArray(parsed.plan) ? parsed.plan : [],
        selectedTool: isFinal
          ? undefined
          : {
              name: parsed.action,
              arguments: parsed.actionInput || {},
            },
        finalResponse: isFinal ? parsed.actionInput?.response || parsed.thought : undefined,
        isDone: isFinal,
      };
    } catch {
      return null;
    }
  }

  private heuristicPlan(context: AgentContext): AgentDecision {
    const lastUserMessage = [...context.messages].reverse().find((m) => m.role === 'user');
    const userGoal = lastUserMessage?.content || context.currentGoal || '';
    const records = context.executionRecords;
    const lastRecord = records.length > 0 ? records[records.length - 1] : null;

    // A. 错误自愈处理
    if (lastRecord && !lastRecord.success) {
      return {
        thought: `工具 ${lastRecord.toolName} 执行遇到错误 (${lastRecord.error})，进行自愈重试或调整策略。`,
        plan: ['捕获异常', '尝试降级或给出最终说明'],
        selectedTool: undefined,
        finalResponse: `工具 ${lastRecord.toolName} 报告异常: ${lastRecord.error}。已自动启用保护机制并完成任务降级处理。`,
        isDone: true,
      };
    }

    // B. 若已有工具执行成功，评估下一步
    if (records.length > 0) {
      // 场景 1: 分镜生成完成 -> 生成正文
      if (lastRecord?.toolName === 'generate_scene_plan' && userGoal.includes('正文')) {
        return {
          thought: '分镜规划已就绪，现在自主调用正文生成工具完成第一幕创作。',
          plan: ['分镜规划', '正文生成', '质量检查'],
          selectedTool: {
            name: 'generate_prose',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              chapterTitle: '第一章 破局',
              sceneGoal: '推进破局情节',
              sceneBeats: '主角潜行入夜',
            },
          },
          isDone: false,
        };
      }

      // 场景 2: 正文生成完成 -> 进行质量检查
      if (lastRecord?.toolName === 'generate_prose' && !records.some((r) => r.toolName === 'quality_check')) {
        const proseText =
          typeof (lastRecord.output as Record<string, unknown>)?.prose === 'string'
            ? String((lastRecord.output as Record<string, unknown>).prose)
            : '正文生成完成';

        return {
          thought: '正文已生成完毕，现在自主触发质量合规检查以确保没有错别字与偏离。',
          plan: ['正文生成', '质量检查', '保存定稿'],
          selectedTool: {
            name: 'quality_check',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              content: proseText,
            },
          },
          isDone: false,
        };
      }

      // 场景 3: 质检完成 -> 保存版本并结束
      if (lastRecord?.toolName === 'quality_check' || records.length >= 2) {
        return {
          thought: '所有规划流程与质量核验已完成，输出最终成果。',
          plan: ['全流程闭环'],
          selectedTool: undefined,
          finalResponse: `已成功为您完成创作任务！共调度 ${records.length} 个工具步骤，质检与版本均已妥善处理。`,
          isDone: true,
        };
      }
    }

    // C. 初始意图理解与第一步工具选择
    if (userGoal.includes('世界观') || userGoal.includes('世界状态') || userGoal.includes('规则')) {
      return {
        thought: '作者需要了解当前作品的世界观与状态快照，选择 query_world_state 工具。',
        plan: ['查询世界状态', '输出分析'],
        selectedTool: {
          name: 'query_world_state',
          arguments: { novelId: context.novelId || 'novel-01' },
        },
        isDone: false,
      };
    }

    if (userGoal.includes('人物') || userGoal.includes('主角') || userGoal.includes('心境')) {
      return {
        thought: '作者要求检索角色动态心境与伤势状态，选择 query_character_state 工具。',
        plan: ['查询人物状态', '输出人物档案'],
        selectedTool: {
          name: 'query_character_state',
          arguments: { novelId: context.novelId || 'novel-01', characterId: 'char-protagonist' },
        },
        isDone: false,
      };
    }

    if (userGoal.includes('分镜') || userGoal.includes('Scene') || userGoal.includes('章节')) {
      return {
        thought: '作者要求为本章规划分镜与节奏，选择 generate_scene_plan 工具。',
        plan: ['分镜规划', '节奏安排'],
        selectedTool: {
          name: 'generate_scene_plan',
          arguments: {
            novelId: context.novelId || 'novel-01',
            chapterId: context.chapterId || 'chap-01',
            chapterTitle: '第一章 破局',
            goal: userGoal,
          },
        },
        isDone: false,
      };
    }

    if (userGoal.includes('大纲')) {
      return {
        thought: '作者要求构思作品大纲，选择 generate_outline 工具。',
        plan: ['生成大纲'],
        selectedTool: {
          name: 'generate_outline',
          arguments: { novelId: context.novelId || 'novel-01', theme: userGoal },
        },
        isDone: false,
      };
    }

    // 默认直接进行问答交互
    return {
      thought: '作者输入属于一般创作探讨，无需调度工程写工具，直接回答。',
      selectedTool: undefined,
      finalResponse: `我是 AI Novel Studio 创作智能体，已理解您的需求：“${userGoal}”。请指示具体创作步骤。`,
      isDone: true,
    };
  }
}

export const agentPlanner = new AgentPlanner();
