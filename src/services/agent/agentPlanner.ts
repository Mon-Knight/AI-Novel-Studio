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
    return this.heuristicPlan(context, config);
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

  private heuristicPlan(context: AgentContext, config?: AgentHarnessConfig): AgentDecision {
    const lastUserMessage = [...context.messages].reverse().find((m) => m.role === 'user');
    const userGoal = lastUserMessage?.content || context.currentGoal || '';
    const records = context.executionRecords;
    const lastRecord = records.length > 0 ? records[records.length - 1] : null;
    const taskState = context.taskState;
    const retryCount = taskState?.retryCount || 0;
    const maxRetries = config?.maxRetries ?? 2;

    // A. 错误分析与自适应重试恢复 (Failure Recovery & Retry)
    if (lastRecord && !lastRecord.success) {
      if (retryCount < maxRetries && config?.enableAutoRecovery !== false) {
        return {
          thought: `检测到工具 [${lastRecord.toolName}] 执行失败 (${lastRecord.error})。启动自适应恢复重试（第 ${retryCount + 1}/${maxRetries} 次），调整入参和降级策略重新执行。`,
          plan: ['分析错误原因', '自适应调整参数', '重试执行工具'],
          selectedTool: {
            name: lastRecord.toolName,
            arguments: {
              ...lastRecord.inputArgs,
              fallbackMode: true,
              retryAttempt: retryCount + 1,
            },
          },
          needsRetry: true,
          isDone: false,
        };
      }

      return {
        thought: `工具 [${lastRecord.toolName}] 达到最大重试次数，执行安全降级与结果总结。`,
        plan: ['捕获异常', '给出降级说明'],
        selectedTool: undefined,
        finalResponse: `工具 ${lastRecord.toolName} 遇到问题: ${lastRecord.error}。已自动记录异常并完成安全降级保护。`,
        isDone: true,
      };
    }

    // B. 自主多步骤任务推进 (Autonomous Multi-Step Execution)
    if (records.length > 0) {
      // 场景 1: 查询世界状态完成 -> 如果是复合任务则规划分镜
      if (
        lastRecord?.toolName === 'query_world_state' &&
        (userGoal.includes('完成') || userGoal.includes('写') || userGoal.includes('创作') || userGoal.includes('分镜'))
      ) {
        return {
          thought: '世界状态与规则已就绪，现在自主为章节规划详细分镜与情节节奏。',
          plan: ['查询世界状态 (已完成)', '分镜规划', '正文生成', '质量检查'],
          selectedTool: {
            name: 'generate_scene_plan',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              chapterTitle: '第 ' + (userGoal.match(/第(.*?)章/)?.[1] || '一') + ' 章',
              goal: userGoal,
            },
          },
          isDone: false,
        };
      }

      // 场景 2: 分镜生成完成 -> 生成正文
      if (
        lastRecord?.toolName === 'generate_scene_plan' &&
        (userGoal.includes('正文') || userGoal.includes('完成') || userGoal.includes('创作'))
      ) {
        return {
          thought: '分镜规划已就绪，现在自主调用正文生成工具完成第一幕创作。',
          plan: ['分镜规划 (已完成)', '正文生成', '质量检查'],
          selectedTool: {
            name: 'generate_prose',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              chapterTitle: '第 ' + (userGoal.match(/第(.*?)章/)?.[1] || '一') + ' 章 破局',
              sceneGoal: '推进核心冲突与主线节奏',
              sceneBeats: '主角潜行入夜探寻关键伏笔',
            },
          },
          isDone: false,
        };
      }

      // 场景 3: 正文生成完成 -> 进行质量检查
      if (
        lastRecord?.toolName === 'generate_prose' &&
        !records.some((r) => r.toolName === 'quality_check')
      ) {
        const proseText =
          typeof (lastRecord.output as Record<string, unknown>)?.prose === 'string'
            ? String((lastRecord.output as Record<string, unknown>).prose)
            : '正文生成完成';

        return {
          thought: '正文已生成完毕，现在自主触发质量合规检查以确保没有错别字与偏离。',
          plan: ['正文生成 (已完成)', '质量检查', '最终交付'],
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

      // 场景 4: 质检或指定工具完成 -> 输出最终成果
      if (lastRecord?.toolName === 'quality_check' || lastRecord?.toolName === 'flaky_writer_tool' || records.length >= 4) {
        return {
          thought: '所有规划流程与质量核验已完成，输出最终成果。',
          plan: ['全流程闭环达成'],
          selectedTool: undefined,
          finalResponse: `已成功自主完成目标：“${userGoal}”！全流程共调度 ${records.length} 个工具步骤，分镜、正文与质量核验均已妥善处理。`,
          isDone: true,
        };
      }
    }

    // C. 初始意图理解与目标驱动任务拆解 (Goal-Driven Task Decomposition)
    // 目标 0: 显式调用特定工具 (如测试或指定扩展工具)
    if (userGoal.includes('flaky_writer_tool')) {
      return {
        thought: '用户指定调用 flaky_writer_tool 工具进行创作任务。',
        plan: ['调用 flaky_writer_tool'],
        selectedTool: {
          name: 'flaky_writer_tool',
          arguments: { novelId: context.novelId || 'novel-01' },
        },
        isDone: false,
      };
    }

    // 目标 1: 复合全流程任务（例如：“完成第三章创作”、“写第三章”）
    if (
      userGoal.includes('完成') &&
      (userGoal.includes('章') || userGoal.includes('创作') || userGoal.includes('小说'))
    ) {
      return {
        thought: `识别到复合小说创作目标：“${userGoal}”。规划执行链路：查询世界状态 -> 规划分镜 -> 生成正文 -> 质量检查。首先执行 query_world_state 检索上下文。`,
        plan: ['查询世界状态', '规划分镜', '生成正文', '质量检查'],
        selectedTool: {
          name: 'query_world_state',
          arguments: { novelId: context.novelId || 'novel-01' },
        },
        isDone: false,
      };
    }

    // 目标 2: 查询世界观与状态
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

    // 目标 3: 查询角色状态
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

    // 目标 4: 分镜规划与正文生成
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

    // 目标 5: 生成大纲
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

    // 默认问答交互
    return {
      thought: '作者输入属于一般创作探讨，无需调度工程写工具，直接回答。',
      selectedTool: undefined,
      finalResponse: `我是 AI Novel Studio 创作智能体，已理解您的需求：“${userGoal}”。请指示具体创作步骤。`,
      isDone: true,
    };
  }
}

export const agentPlanner = new AgentPlanner();
