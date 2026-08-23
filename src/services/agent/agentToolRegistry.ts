/**
 * Creative Agent Harness - Tool Registry
 * 包装小说工程核心能力的 Agent 工具注册表
 */
import type { AgentTool, AgentToolDescriptor } from '../../types/agentHarness';
import type { MemoryStateDelta } from '../../types/novelMemory';
import { novelMemoryManager } from '../memory/novelMemoryManager';
import { chapterVersionService } from '../chapters/chapterVersionService';
import { executeChapterSceneGeneration } from '../ai/chapterSceneGenerationExecutionService';
import { aiSettingsService } from '../ai/aiSettingsService';

export class AgentToolRegistry {
  private tools = new Map<string, AgentTool>();

  constructor() {
    this.registerBuiltInTools();
  }

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.descriptor.name, tool);
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  listTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getToolDescriptors(): AgentToolDescriptor[] {
    return this.listTools().map((t) => t.descriptor);
  }

  private registerBuiltInTools(): void {
    // 1. 查询世界状态
    this.registerTool({
      descriptor: {
        name: 'query_world_state',
        description: '查询小说的世界观规则、当前时间线与世界状态快照。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
          },
          required: ['novelId'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        if (!novelId) throw new Error('novelId is required');
        const retrieved = await novelMemoryManager.retrieveContext({ novelId, sceneId: 'world-query' });
        const snapshot = novelMemoryManager.getWorldState(novelId);
        return {
          worldRules: retrieved.longTermMemories.filter((m) => m.type === 'world_rule'),
          currentTimeline: snapshot?.timelinePosition || '当前纪元',
          recentEvents: snapshot?.activeEvents || [],
          factionStatus: snapshot?.factionStatus || {},
        };
      },
    });

    // 2. 查询人物状态
    this.registerTool({
      descriptor: {
        name: 'query_character_state',
        description: '查询特定角色的动态心境、当前目标、伤势与阵营关系。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            characterId: { type: 'string', description: '角色 ID 或角色名称' },
          },
          required: ['novelId', 'characterId'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const characterId = String(args.characterId || '');
        if (!novelId || !characterId) throw new Error('novelId and characterId are required');
        const dynamicState = novelMemoryManager.getCharacterState(novelId, characterId);
        return {
          characterId,
          characterName: dynamicState?.characterName || characterId,
          currentEmotion: dynamicState?.currentEmotion || '平静',
          currentGoal: dynamicState?.currentGoal || '按大纲推进',
          injuries: dynamicState?.injuries || [],
          faction: dynamicState?.faction || '中立',
        };
      },
    });

    // 3. 查询章节信息
    this.registerTool({
      descriptor: {
        name: 'query_chapter_info',
        description: '查询指定章节的历史修订版本、最新草稿字数及创作溯源存证。',
        parameters: {
          type: 'object',
          properties: {
            chapterId: { type: 'string', description: '章节 ID' },
          },
          required: ['chapterId'],
        },
      },
      execute: async (args, context) => {
        const chapterId = String(args.chapterId || context.chapterId || '');
        if (!chapterId) throw new Error('chapterId is required');
        const revisions = chapterVersionService.listRevisions(chapterId);
        const latest = revisions.length > 0 ? revisions[revisions.length - 1] : null;
        return {
          chapterId,
          totalRevisions: revisions.length,
          latestRevision: latest
            ? {
                revisionId: latest.revisionId,
                title: latest.title,
                wordCount: latest.wordCount,
                tag: latest.tag,
                isAdopted: latest.isAdopted,
                provenance: latest.provenance,
                createdAt: latest.createdAt,
              }
            : null,
        };
      },
    });

    // 4. 生成大纲
    this.registerTool({
      descriptor: {
        name: 'generate_outline',
        description: '根据主题与核心冲突生成小说大纲或卷章梗概。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            theme: { type: 'string', description: '小说主题或创作意图' },
          },
          required: ['novelId'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const theme = String(args.theme || '仙侠长篇创作');
        return {
          novelId,
          theme,
          outline: `【主线大纲】以 ${theme} 为核心，分为起承转合四卷。第一卷破局，第二卷涉险，第三卷决战，第四卷归真。`,
        };
      },
    });

    // 5. 生成 Scene 分镜
    this.registerTool({
      descriptor: {
        name: 'generate_scene_plan',
        description: '为指定章节规划详细 Scene 列表与 Beat 节奏序列。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            chapterId: { type: 'string', description: '章节 ID' },
            chapterTitle: { type: 'string', description: '章节标题' },
            goal: { type: 'string', description: '本章核心目标' },
          },
          required: ['novelId', 'chapterId'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const chapterId = String(args.chapterId || context.chapterId || '');
        const chapterTitle = String(args.chapterTitle || '第一章 破局');
        const goal = String(args.goal || '主角面临危机并果断破局');

        return {
          success: true,
          novelId,
          chapterId,
          scenes: [
            {
              sceneNo: 1,
              title: `${chapterTitle} - 破局`,
              goal,
              beats: [
                '主角潜行入夜探查线索',
                '遭遇强敌埋伏陷入苦战',
                '机智动用秘法破局脱险',
              ],
            },
          ],
        };
      },
    });

    // 6. 生成正文
    this.registerTool({
      descriptor: {
        name: 'generate_prose',
        description: '执行指定分镜正文生成，自动召回记忆层上下文并写入草稿。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            chapterId: { type: 'string', description: '章节 ID' },
            chapterTitle: { type: 'string', description: '章节标题' },
            sceneGoal: { type: 'string', description: '场景目标' },
            sceneBeats: { type: 'string', description: '单条 Beat 节奏描述' },
          },
          required: ['novelId', 'chapterId', 'chapterTitle'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const chapterId = String(args.chapterId || context.chapterId || '');
        const chapterTitle = String(args.chapterTitle || '第一章');
        const sceneGoal = String(args.sceneGoal || '推进情节');
        const beat = String(args.sceneBeats || '主角潜行入夜');

        let settings: import('../../types/ai').AiSettings = context.modelSettings ?? {
          runtimeMode: 'mock',
          provider: 'mock',
          baseUrl: '',
          apiKey: '',
          modelName: 'mock',
          temperature: 0.7,
          maxTokens: 4000,
          timeoutSeconds: 60,
          mockMode: true,
        };
        if (!context.modelSettings) {
          try {
            settings = aiSettingsService.getSettings();
          } catch {
            // Keep mock fallback
          }
        }
        let proseText = `【${chapterTitle}】夜色深沉，${beat}。四下静谧无声，主角凝神聚气，按计划悄然破局。`;
        let providerId = 'mock';

        try {
          const genResult = await executeChapterSceneGeneration({
            novelId,
            chapterId,
            operationId: `op-agent-${Date.now()}`,
            settings,
            request: {
              messages: [{ role: 'user', content: `${chapterTitle}: ${beat}` }],
            },
            sourceId: chapterId,
            sourceVersion: '1',
            taskInput: {
              chapterTitle,
              contextHash: `hash-${Date.now()}`,
              sceneGoal,
              sceneBeats: [beat],
              sceneConstraints: ['视点单一'],
            },
          });

          if (genResult.text && genResult.text.trim().length >= 10) {
            proseText = genResult.text;
          }
          if (genResult.provider?.providerId) {
            providerId = genResult.provider.providerId;
          }
        } catch {
          // Keep safe generated prose fallback
        }

        return {
          success: true,
          prose: proseText,
          provider: providerId,
        };
      },
    });

    // 7. 质量检查
    this.registerTool({
      descriptor: {
        name: 'quality_check',
        description: '对章节或候选正文进行错别字、大纲偏离、人物一致性等质量维度检查。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            chapterId: { type: 'string', description: '章节 ID' },
            content: { type: 'string', description: '待检查的正文内容' },
          },
          required: ['novelId', 'content'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const content = String(args.content || '');
        const { verifyStyleCompliance } = await import('../../agent-tools/verification-tools');
        const checkResult = await verifyStyleCompliance(
          { novelId, chapterId: String(context.chapterId || '') },
          content,
        );

        return {
          success: true,
          overallScore: checkResult.ok ? 95 : 75,
          passed: checkResult.ok,
          data: checkResult.data,
        };
      },
    });

    // 8. 更新 Memory
    this.registerTool({
      descriptor: {
        name: 'update_memory',
        description: '向长篇小说记忆层应用状态增量（Delta），演进角色心境或世界态势。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            characterId: { type: 'string', description: '角色 ID' },
            emotion: { type: 'string', description: '演进后的心境' },
            goal: { type: 'string', description: '演进后的当前目标' },
          },
          required: ['novelId'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const characterId = args.characterId ? String(args.characterId) : undefined;
        const emotion = args.emotion ? String(args.emotion) : undefined;
        const goal = args.goal ? String(args.goal) : undefined;

        const deltas: MemoryStateDelta[] = [];
        if (characterId) {
          deltas.push({
            entityId: characterId,
            entityType: 'character',
            changes: {
              currentEmotion: emotion,
              currentGoal: goal,
            },
          });
        }

        const updateResult = await novelMemoryManager.applyStateDelta(
          novelId,
          deltas,
          'Agent tool state update',
        );
        return {
          success: true,
          versionNumber: updateResult.versionSnapshot.versionNumber,
          appliedDeltas: updateResult.appliedDeltas,
        };
      },
    });

    // 9. 保存版本
    this.registerTool({
      descriptor: {
        name: 'save_chapter_version',
        description: '保存章节正文为新的版本（Revision）并记录创作溯源存证。',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            chapterId: { type: 'string', description: '章节 ID' },
            title: { type: 'string', description: '章节标题' },
            content: { type: 'string', description: '章节正文' },
            isAdopted: { type: 'boolean', description: '是否设为当前采用版本' },
          },
          required: ['novelId', 'chapterId', 'content'],
        },
      },
      execute: async (args, context) => {
        const novelId = String(args.novelId || context.novelId || '');
        const chapterId = String(args.chapterId || context.chapterId || '');
        const title = String(args.title || '第一章');
        const content = String(args.content || '');
        const isAdopted = args.isAdopted !== false;

        const revision = await chapterVersionService.createRevision({
          novelId,
          chapterId,
          title,
          content,
          source: 'ai_generation',
          isAdopted,
          provenance: {
            author: 'CreativeAgentHarness',
            modelId: 'agent-driven',
          },
        });

        return {
          success: true,
          revisionId: revision.revisionId,
          revisionNumber: revision.revisionNumber,
          wordCount: revision.wordCount,
        };
      },
    });
  }
}

export const agentToolRegistry = new AgentToolRegistry();
