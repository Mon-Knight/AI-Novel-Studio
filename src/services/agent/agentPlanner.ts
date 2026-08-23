import type { AiSettings } from '../../types/ai';
import type { AgentContext, AgentDecision, AgentHarnessConfig } from '../../types/agentHarness';
import { createAiClient } from '../ai/aiClient';
import { aiSettingsService } from '../ai/aiSettingsService';
import { agentContextManager } from './agentContextManager';
import { toolUsageMemory } from './toolUsageMemory';

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

    const lastUserMessage = [...context.messages].reverse().find((m) => m.role === 'user');
    const userGoal = lastUserMessage?.content || context.currentGoal || '';
    const similarExperiences = toolUsageMemory.findSimilarExperiences(userGoal, 80);
    const expText =
      similarExperiences.length > 0
        ? `\n### 历史高分工具执行经验参考 (Tool Usage Memory):\n${similarExperiences
            .slice(0, 2)
            .map(
              (e) =>
                `- 相似目标: "${e.userGoal}" -> 推荐工具链: [${e.toolSequence.join(' -> ')}] (成功质量分: ${e.qualityScore})`,
            )
            .join('\n')}\n`
        : '';

    const prompt = `${systemPrompt}${expText}\n\n### 对话与工具执行历史:\n${historyText}\n\n请输出你的下一步 JSON 决策 (包含 thought, plan, action, actionInput, reasoningSummary, selectedToolReason, expectedOutcome, confidenceScore):`;

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
        reasoningSummary: parsed.reasoningSummary || parsed.thought,
        selectedToolReason: parsed.selectedToolReason || parsed.reason,
        expectedOutcome: parsed.expectedOutcome || parsed.expected,
        confidenceScore:
          typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.9,
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
          reasoningSummary: `工具 ${lastRecord.toolName} 遇到异常，启用自适应降级重试策略`,
          selectedToolReason: '前序调用报错，通过调整参数与降级策略恢复执行',
          expectedOutcome: '自愈恢复并获得正确输出',
          confidenceScore: 0.85,
          needsRetry: true,
          isDone: false,
        };
      }

      return {
        thought: `工具 [${lastRecord.toolName}] 达到最大重试次数，执行安全降级与结果总结。`,
        plan: ['捕获异常', '给出降级说明'],
        selectedTool: undefined,
        reasoningSummary: '达到最大重试上限，执行安全终态收敛',
        selectedToolReason: '触发安全保护，避免无限重试循环',
        expectedOutcome: '保存现场错误并提示作者',
        confidenceScore: 1.0,
        finalResponse: `工具 ${lastRecord.toolName} 遇到问题: ${lastRecord.error}。已自动记录异常并完成安全降级保护。`,
        isDone: true,
      };
    }

    // B. 自主多步骤任务推进 (Autonomous Multi-Step Execution)
    if (records.length > 0) {
      // 场景 0: 人物性格调整专项链路 (Character Modification Trajectory: query_character_state -> generate_scene_plan -> update_memory)
      if (
        (userGoal.includes('性格') || userGoal.includes('修改人物') || userGoal.includes('调整角色')) &&
        !userGoal.includes('完成') &&
        !userGoal.includes('全篇')
      ) {
        if (lastRecord?.toolName === 'query_character_state' && !records.some((r) => r.toolName === 'generate_scene_plan')) {
          return {
            thought: '参考历史成功案例[修改人物性格]，角色状态已就绪，现在规划展示性格转变的分镜节拍。',
            plan: ['查询人物状态 (已完成)', '分镜规划', '更新记忆'],
            selectedTool: {
              name: 'generate_scene_plan',
              arguments: {
                novelId: context.novelId || 'novel-01',
                chapterId: context.chapterId || 'chap-01',
                chapterTitle: '角色性格转变篇',
                goal: userGoal,
              },
            },
            reasoningSummary: '参考历史成功经验，为性格调整编排分镜节拍',
            selectedToolReason: '已有角色状态，需要通过场景分镜呈现性格转变的戏剧冲突',
            expectedOutcome: '获得体现新性格的分镜节拍',
            confidenceScore: 0.94,
            isDone: false,
          };
        }

        if (lastRecord?.toolName === 'generate_scene_plan' && !records.some((r) => r.toolName === 'update_memory')) {
          return {
            thought: '参考历史成功案例，性格调整分镜已就绪，将新性格特征沉淀至 Novel Memory Layer。',
            plan: ['分镜规划 (已完成)', '更新记忆', '任务交付'],
            selectedTool: {
              name: 'update_memory',
              arguments: {
                novelId: context.novelId || 'novel-01',
                characterId: 'char-protagonist',
                emotion: '果决坚毅',
                goal: '贯彻新信念并破局前行',
              },
            },
            reasoningSummary: '参考历史成功经验，持久化角色最新性格与动态心境',
            selectedToolReason: '性格调整分镜已就绪，需将新性格与心境更新至记忆层',
            expectedOutcome: '记忆层角色性格更新并生成新版本快照',
            confidenceScore: 0.96,
            isDone: false,
          };
        }

        if (lastRecord?.toolName === 'update_memory') {
          return {
            thought: '人物性格调整与记忆层更新已闭环达成，输出成果报告。',
            plan: ['全流程闭环达成'],
            selectedTool: undefined,
            reasoningSummary: '人物性格优化全流程完成',
            selectedToolReason: '目标已达成',
            expectedOutcome: '交付角色性格调整结果',
            confidenceScore: 1.0,
            finalResponse: `已根据需求“${userGoal}”成功完成主角性格与心境的动态调整，分镜节拍与记忆层快照均已妥善沉淀。`,
            isDone: true,
          };
        }
      }

      // 场景 1: 查询世界状态完成 -> 如果需要人物心境且未查询过，调用 query_character_state
      if (
        lastRecord?.toolName === 'query_world_state' &&
        (userGoal.includes('完成') || userGoal.includes('节') || userGoal.includes('章')) &&
        !records.some((r) => r.toolName === 'query_character_state')
      ) {
        return {
          thought: '世界状态与规则已就绪，接下来检索视点人物的动态心境与伤势状态。',
          plan: ['查询世界状态 (已完成)', '查询人物状态', '分镜规划', '正文生成', '质量检查', '更新记忆', '保存版本'],
          selectedTool: {
            name: 'query_character_state',
            arguments: {
              novelId: context.novelId || 'novel-01',
              characterId: 'char-protagonist',
            },
          },
          reasoningSummary: '已掌握世界观设定，进入角色心理维度感知',
          selectedToolReason: '正文生成需要确认主角当前心理状态、动机与伤势',
          expectedOutcome: '获得角色目标、情绪与当前所在地',
          confidenceScore: 0.92,
          isDone: false,
        };
      }

      // 场景 2: 查询人物状态或世界状态完成 -> 规划分镜
      if (
        (lastRecord?.toolName === 'query_character_state' ||
          (lastRecord?.toolName === 'query_world_state' && !records.some((r) => r.toolName === 'generate_scene_plan'))) &&
        (userGoal.includes('完成') || userGoal.includes('写') || userGoal.includes('创作') || userGoal.includes('分镜')) &&
        !records.some((r) => r.toolName === 'generate_scene_plan')
      ) {
        return {
          thought: '上下文已充分就绪，现在自主为章节规划详细分镜与情节节奏。',
          plan: ['感知阶段 (已完成)', '分镜规划', '正文生成', '质量检查', '更新记忆', '保存版本'],
          selectedTool: {
            name: 'generate_scene_plan',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              chapterTitle: '第五章 第一节 遗迹探秘',
              goal: userGoal,
            },
          },
          reasoningSummary: '背景与人物上下文完备，开始构建章节情节节奏与冲突节点',
          selectedToolReason: '已有角色和世界信息，需要生成冲突结构与分镜节拍',
          expectedOutcome: '获得分镜列表与各 Beat 节奏安排',
          confidenceScore: 0.90,
          isDone: false,
        };
      }

      // 场景 3: 分镜生成完成 -> 生成正文
      if (
        lastRecord?.toolName === 'generate_scene_plan' &&
        (userGoal.includes('正文') || userGoal.includes('完成') || userGoal.includes('创作') || userGoal.includes('节')) &&
        !records.some((r) => r.toolName === 'generate_prose')
      ) {
        return {
          thought: '分镜规划已就绪，现在自主调用正文生成工具完成本节创作。',
          plan: ['分镜规划 (已完成)', '正文生成', '质量检查', '更新记忆', '保存版本'],
          selectedTool: {
            name: 'generate_prose',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-01',
              chapterTitle: '第五章 第一节 遗迹探秘',
              sceneGoal: '主角进入遗迹探寻线索，隐忍克制不揭开最终谜底',
              sceneBeats: '主角潜行进入遗迹内部，发现古代机关符文与隐秘线索，保持警惕',
            },
          },
          reasoningSummary: '分镜节拍已明确，驱动正文生成引擎执行文学渲染',
          selectedToolReason: '分镜结构已确定，调用正文模型生成高质量小说正文',
          expectedOutcome: '产出符合字数与视角约束的章节草稿',
          confidenceScore: 0.93,
          isDone: false,
        };
      }

      // 场景 4: 正文生成完成 -> 检查质量裁判结果；如未达标自主重写，如达标则推进质检或记忆演进
      if (lastRecord?.toolName === 'generate_prose') {
        const latestReview =
          context.qualityReviews && context.qualityReviews.length > 0
            ? context.qualityReviews[context.qualityReviews.length - 1]
            : null;

        if (latestReview && !latestReview.passed) {
          return {
            thought: `正文初稿质量审查未通过（总分 ${latestReview.overallScore}/100，未达阈值），审查建议：${latestReview.suggestions.join('; ')}。现在自主启动正文重写（rewrite_prose）以扩充文学细节与戏剧冲突。`,
            plan: ['正文初稿 (质检未通过)', '正文重写与自愈', '质量检查', '更新记忆', '保存版本'],
            selectedTool: {
              name: 'generate_prose',
              arguments: {
                novelId: context.novelId || 'novel-01',
                chapterId: context.chapterId || 'chap-01',
                chapterTitle: '第五章 第一节 遗迹探秘 (重写修订版)',
                sceneGoal: '主角进入遗迹探寻线索，隐忍克制不揭开最终谜底（重写扩充细节）',
                sceneBeats: '主角深入古代遗迹殿堂，仔细勘查断裂石柱与古老铭文，感知四周隐蔽的机关波动，神情戒备谨慎推进。',
                rewriteMode: true,
                improvementSuggestions: latestReview.suggestions,
              },
            },
            reasoningSummary: `初稿质量得分 ${latestReview.overallScore} 偏低，依据评判建议触发重写优化`,
            selectedToolReason: '初稿质量未达标，调用重写工具增强文学细节与情节张力',
            expectedOutcome: '产出质量达标的高质量重写正文',
            confidenceScore: 0.95,
            isDone: false,
          };
        }

        if (!records.some((r) => r.toolName === 'quality_check')) {
          const proseText =
            typeof (lastRecord.output as Record<string, unknown>)?.prose === 'string'
              ? String((lastRecord.output as Record<string, unknown>).prose)
              : '正文生成完成';

          return {
            thought: '正文已生成完毕并通过质量裁判初审，现在自主触发质量合规检查以确保没有错别字、大纲偏离或约束违规。',
            plan: ['正文生成 (已通过质量裁判)', '质量检查', '更新记忆', '保存版本'],
            selectedTool: {
              name: 'quality_check',
              arguments: {
                novelId: context.novelId || 'novel-01',
                chapterId: context.chapterId || 'chap-01',
                content: proseText,
              },
            },
            reasoningSummary: '正文初稿达标，执行前置文学质量与设定合规性审查',
            selectedToolReason: '正文已生成，需要检验行文质量、设定一致性与违规问题',
            expectedOutcome: '获得质量评分与合规检测报告',
            confidenceScore: 0.96,
            isDone: false,
          };
        }
      }

      // 场景 5: 质检完成 -> 如果是全流程章节生产，更新记忆状态
      if (
        lastRecord?.toolName === 'quality_check' &&
        (userGoal.includes('完成') || userGoal.includes('节')) &&
        !records.some((r) => r.toolName === 'update_memory')
      ) {
        return {
          thought: '正文质检通过，现在将主角进入遗迹后的动态心境与新目标沉淀更新至 Novel Memory Layer。',
          plan: ['质量检查 (已完成)', '更新记忆', '保存版本', '生成交付报告'],
          selectedTool: {
            name: 'update_memory',
            arguments: {
              novelId: context.novelId || 'novel-01',
              characterId: 'char-protagonist',
              emotion: '机敏凝重',
              goal: '探索遗迹深处并破译古籍残卷',
            },
          },
          reasoningSummary: '本节剧情达标闭环，将情节产生的新心境与态势沉淀为长期记忆',
          selectedToolReason: '正文已通过质量检查，需将角色心境与状态演进沉淀至记忆层',
          expectedOutcome: '记忆层状态更新并生成新版本快照',
          confidenceScore: 0.94,
          isDone: false,
        };
      }

      // 场景 6: 记忆更新完成 -> 保存版本并存证
      if (
        lastRecord?.toolName === 'update_memory' &&
        !records.some((r) => r.toolName === 'save_chapter_version')
      ) {
        const proseRecord = records.find((r) => r.toolName === 'generate_prose');
        const proseText =
          typeof (proseRecord?.output as Record<string, unknown>)?.prose === 'string'
            ? String((proseRecord?.output as Record<string, unknown>).prose)
            : '第五章第一节正文草稿';

        return {
          thought: '记忆状态已演化并创建快照，现在为本章节保存不可变修订版本（Revision）与创作存证。',
          plan: ['更新记忆 (已完成)', '保存版本', '生成交付报告'],
          selectedTool: {
            name: 'save_chapter_version',
            arguments: {
              novelId: context.novelId || 'novel-01',
              chapterId: context.chapterId || 'chap-05',
              title: '第五章 第一节 遗迹探秘',
              content: proseText,
              isAdopted: true,
            },
          },
          reasoningSummary: '全要素演进完成，保存持久化版本并记录 Provenance',
          selectedToolReason: '创作全流程达标，需要持久化章节 Revision 与 Provenance 溯源信息',
          expectedOutcome: '产生新的不可变章节版本并归档',
          confidenceScore: 0.98,
          isDone: false,
        };
      }

      // 场景 7: 保存版本或指定测试工具完成 -> 输出最终成果报告
      if (
        lastRecord?.toolName === 'save_chapter_version' ||
        lastRecord?.toolName === 'flaky_writer_tool' ||
        records.length >= 7
      ) {
        const proseRecord = records.find((r) => r.toolName === 'generate_prose');
        const proseSnippet =
          typeof (proseRecord?.output as Record<string, unknown>)?.prose === 'string'
            ? String((proseRecord?.output as Record<string, unknown>).prose).slice(0, 100) + '...'
            : '正文已就绪';

        return {
          thought: '全流程 7 个阶段（感知、分镜、正文、质检、记忆演进、版本存证）均已圆满达成，生成最终交付报告。',
          plan: ['全流程闭环达成'],
          selectedTool: undefined,
          reasoningSummary: '全流程各环节验证通过，生成结构化交付报告',
          selectedToolReason: '创作目标圆满达成，无需进一步工具调度',
          expectedOutcome: '交付完整的小说产物与决策审计链路',
          confidenceScore: 1.0,
          finalResponse: `### 创作任务完成报告
- **目标**: ${userGoal}
- **工具调度序列**: ${records.map((r) => r.toolName).join(' -> ')}
- **模型与提供方**: mock-agent-planner (RouteDecision: chapter_scene_generate)
- **记忆层状态演变**: Memory State Delta 已应用并生成新快照版本
- **版本归档**: 已保存为当前采用版本 (Revision)
- **正文摘要**: ${proseSnippet}`,
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
        reasoningSummary: '命中显式工具调用指令',
        selectedToolReason: '用户指令明确指定调用 flaky_writer_tool',
        expectedOutcome: '执行指定工具完成特定任务',
        confidenceScore: 0.95,
        isDone: false,
      };
    }

    // 目标 0.1: 人物性格修改（匹配 ToolUsageMemory 推荐轨迹）
    if (
      (userGoal.includes('性格') || userGoal.includes('修改人物') || userGoal.includes('调整角色')) &&
      !userGoal.includes('完成') &&
      !userGoal.includes('全篇')
    ) {
      return {
        thought: '参考历史成功案例[修改人物性格与心理动态]，推荐执行链：query_character_state -> generate_scene_plan -> update_memory。首先查询当前人物心境。',
        plan: ['查询人物状态', '分镜规划', '更新记忆'],
        selectedTool: {
          name: 'query_character_state',
          arguments: { novelId: context.novelId || 'novel-01', characterId: 'char-protagonist' },
        },
        reasoningSummary: '参考历史成功经验，首先检索主角当前性格与心境基线',
        selectedToolReason: '修改人物性格需要先获取当前角色的基础设定与心理状态',
        expectedOutcome: '获取角色当前动态心境与目标',
        confidenceScore: 0.95,
        isDone: false,
      };
    }

    // 目标 1: 复合全流程任务（例如：“完成第五章第一节”、“完成第三章创作”、“写第三章”）
    if (
      userGoal.includes('完成') &&
      (userGoal.includes('章') || userGoal.includes('节') || userGoal.includes('创作') || userGoal.includes('小说'))
    ) {
      return {
        thought: `识别到端到端章节创作目标：“${userGoal}”。规划自主执行链路：检索世界设定 -> 检索人物状态 -> 规划分镜节奏 -> 生成正文 -> 质量核验 -> 演进记忆状态 -> 保存版本存证。首先执行 query_world_state。`,
        plan: ['查询世界状态', '查询人物状态', '规划分镜', '生成正文', '质量检查', '更新记忆', '保存版本'],
        selectedTool: {
          name: 'query_world_state',
          arguments: { novelId: context.novelId || 'novel-01' },
        },
        reasoningSummary: `识别到小说创作目标：“${userGoal}”，首先建立世界观与环境约束感知`,
        selectedToolReason: '小说创作需要了解当前世界规则、力量体系与势力背景',
        expectedOutcome: '获取世界观规则与当前时间线设定',
        confidenceScore: 0.95,
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
        reasoningSummary: '作者请求查询作品世界规则与世界状态',
        selectedToolReason: '检索世界观规则库以提供精准设定信息',
        expectedOutcome: '输出世界观规则与当前状态',
        confidenceScore: 0.95,
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
        reasoningSummary: '作者请求检索指定角色的心境与状态',
        selectedToolReason: '正文生成需要确认主角当前心理状态',
        expectedOutcome: '获得角色目标和情绪',
        confidenceScore: 0.92,
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
        reasoningSummary: '作者请求章节分镜与冲突规划',
        selectedToolReason: '已有角色和世界信息，需要生成冲突结构与分镜节拍',
        expectedOutcome: '获得分镜列表与各 Beat 节奏安排',
        confidenceScore: 0.90,
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
        reasoningSummary: '作者请求构思长篇小说大纲架构',
        selectedToolReason: '调用大纲生成工具构建长篇情节脉络',
        expectedOutcome: '获得主线与分卷大纲结构',
        confidenceScore: 0.90,
        isDone: false,
      };
    }

    // 默认问答交互
    return {
      thought: '作者输入属于一般创作探讨，无需调度工程写工具，直接回答。',
      selectedTool: undefined,
      reasoningSummary: '常规创作问答探讨',
      selectedToolReason: '无需调度工程工具',
      expectedOutcome: '向作者提供自然语言创作建议',
      confidenceScore: 1.0,
      finalResponse: `我是 AI Novel Studio 创作智能体，已理解您的需求：“${userGoal}”。请指示具体创作步骤。`,
      isDone: true,
    };
  }
}

export const agentPlanner = new AgentPlanner();
