import {
  checkChapterReadiness,
  verifyOutlineCompliance,
  verifyStyleCompliance,
} from '../../agent-tools/verification-tools';
import type { AgentToolContext } from '../../agent-tools/tool-types';
import type {
  ToolDescriptorV1,
  ToolInvocationContext,
  ToolJsonSchema,
} from '../../types/toolRegistry';
import { ToolRegistry, type ToolDefinition } from './toolRegistry';
import { validateCandidateText } from './candidateValidation';
import { memoryService } from '../memory/memoryService';
import { isTauri } from '../database/db';

const idSchema: ToolJsonSchema = { type: 'string', minLength: 1, maxLength: 160 };
const draftSchema: ToolJsonSchema = { type: 'string', minLength: 1, maxLength: 400_000 };
const candidateTextSchema: ToolJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 400_000,
};
const resultSchema: ToolJsonSchema = {
  type: 'object',
  required: ['ok'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    data: {},
    error: { type: 'string', maxLength: 2000 },
    source: { type: 'string', maxLength: 160 },
    warnings: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', maxLength: 1000 },
    },
  },
};

const readinessResultSchema: ToolJsonSchema = {
  type: 'object',
  required: ['ok', 'data'],
  additionalProperties: false,
  properties: {
    ok: { enum: [true] },
    data: {
      type: 'object',
      required: ['ready', 'score', 'missing', 'warnings', 'summary'],
      additionalProperties: false,
      properties: {
        ready: { type: 'boolean' },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        missing: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            required: ['code', 'label', 'blocking'],
            additionalProperties: false,
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 80 },
              label: { type: 'string', minLength: 1, maxLength: 200 },
              blocking: { type: 'boolean' },
            },
          },
        },
        warnings: {
          type: 'array',
          maxItems: 100,
          items: { type: 'string', maxLength: 1000 },
        },
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    },
    source: { type: 'string', maxLength: 160 },
  },
};

const chapterCandidateResultSchema: ToolJsonSchema = {
  type: 'object',
  required: ['ok', 'toolVersion', 'artifactType', 'candidateOnly', 'data'],
  additionalProperties: false,
  properties: {
    ok: { enum: [true] },
    toolVersion: { enum: ['v1'] },
    artifactType: { enum: ['chapter_text'] },
    candidateOnly: { enum: [true] },
    data: {
      type: 'object',
      required: ['novelId', 'chapterId', 'text'],
      additionalProperties: false,
      properties: {
        novelId: idSchema,
        chapterId: idSchema,
        text: candidateTextSchema,
      },
    },
  },
};

function objectSchema(
  properties: Record<string, ToolJsonSchema>,
  required: string[],
): ToolJsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function contextFrom(
  argumentsJson: Record<string, unknown>,
  context: ToolInvocationContext,
): AgentToolContext {
  return {
    novelId: String(argumentsJson.novelId ?? context.novelId ?? ''),
    chapterId:
      typeof argumentsJson.chapterId === 'string' ? argumentsJson.chapterId : context.chapterId,
    styleProfileId:
      typeof argumentsJson.styleProfileId === 'string' ? argumentsJson.styleProfileId : undefined,
    dryRun: context.dryRun ?? true,
  };
}

function descriptor(
  input: Omit<ToolDescriptorV1, 'version' | 'outputSchema' | 'sideEffect' | 'confirmationPolicy'>,
): ToolDescriptorV1 {
  return {
    ...input,
    version: '1',
    outputSchema: resultSchema,
    sideEffect: 'none',
    confirmationPolicy: 'never',
  };
}

const definitions: ToolDefinition[] = [
  {
    descriptor: descriptor({
      name: 'search_memory',
      description: '在当前小说的长期记忆中检索与任务相关的已采用事实。',
      inputSchema: objectSchema(
        { novelId: idSchema, query: { type: 'string', minLength: 1, maxLength: 1000 } },
        ['novelId', 'query'],
      ),
      permissions: ['novel.read'],
      scope: 'novel',
      timeoutMs: 20_000,
    }),
    handler: async (args) => {
      try {
        const result = await memoryService.retrieve({
          requestId: `conversation-memory-${Date.now()}`,
          novelId: String(args.novelId),
          query: String(args.query),
          topK: 8,
          candidateLimit: 50,
          tokenBudget: 4000,
          filters: {},
        });
        return { ok: true, data: result, source: 'memory' };
      } catch (error) {
        if (!isTauri()) {
          const { retrieveLocalMemory } = await import('../memory/adoptedDraftMemory');
          return {
            ok: true,
            data: retrieveLocalMemory(String(args.novelId), String(args.query ?? '')),
            source: 'localstorage',
          };
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Memory 检索失败',
          source: 'memory',
        };
      }
    },
  },
  {
    descriptor: {
      ...descriptor({
        name: 'generate_chapter',
        description: '接收并验证模型已生成的章节候选，只返回 candidate-only 结构，不写入正式正文。',
        inputSchema: objectSchema(
          {
            novelId: idSchema,
            chapterId: idSchema,
            candidateText: candidateTextSchema,
          },
          ['novelId', 'chapterId', 'candidateText'],
        ),
        permissions: ['novel.read', 'chapter.read'],
        scope: 'chapter',
        timeoutMs: 30_000,
      }),
      outputSchema: chapterCandidateResultSchema,
    },
    handler: async (args) => {
      const text = validateCandidateText('chapter_text', String(args.candidateText));
      return {
        ok: true,
        toolVersion: 'v1',
        artifactType: 'chapter_text',
        candidateOnly: true,
        data: {
          novelId: String(args.novelId),
          chapterId: String(args.chapterId),
          text,
        },
      };
    },
  },
  ...(
    [
      ['generate_outline', 'outline', '接收并验证大纲候选 JSON，不写入正式大纲。'],
      ['generate_characters', 'character_candidates', '接收并验证角色候选，不写入角色库。'],
      ['suggest_events', 'event_candidates', '接收并验证事件候选，不写入章节事件。'],
      ['expand_settings', 'setting_candidates', '接收并验证设定候选，不写入正式设定。'],
      ['polish_chapter', 'chapter_text', '接收并验证润色后的章节候选，不覆盖正式正文。'],
      ['check_quality', 'quality_report', '接收并验证质量检查报告，报告不能直接应用。'],
      ['summarize_chapter', 'chapter_summary', '接收并验证章节总结候选，不写入正式上下文。'],
    ] as const
  ).map(([name, artifactType, description]) => ({
    descriptor: {
      ...descriptor({
        name,
        description,
        inputSchema: objectSchema(
          {
            novelId: idSchema,
            chapterId: idSchema,
            candidateText: candidateTextSchema,
          },
          ['novelId', 'candidateText'],
        ),
        permissions: ['novel.read', 'chapter.read'],
        scope: 'chapter' as const,
        timeoutMs: 30_000,
      }),
      outputSchema: {
        ...chapterCandidateResultSchema,
        properties: {
          ...chapterCandidateResultSchema.properties,
          artifactType: { enum: [artifactType] },
        },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const text = validateCandidateText(artifactType, String(args.candidateText));
      return {
        ok: true,
        toolVersion: 'v1',
        artifactType,
        candidateOnly: true,
        data: {
          novelId: String(args.novelId),
          chapterId: String(args.chapterId ?? ''),
          text,
        },
      };
    },
  })),
  {
    descriptor: {
      ...descriptor({
        name: 'verification.check_readiness',
        description: '确定性检查章节生成所需上下文是否准备完成，不调用外部 AI。',
        inputSchema: objectSchema({ novelId: idSchema, chapterId: idSchema }, [
          'novelId',
          'chapterId',
        ]),
        permissions: ['novel.read', 'chapter.read', 'style.read', 'verification.execute'],
        scope: 'chapter',
        timeoutMs: 30_000,
      }),
      outputSchema: readinessResultSchema,
    },
    handler: (args, context) => checkChapterReadiness(contextFrom(args, context)),
  },
  {
    descriptor: descriptor({
      name: 'novel.read_context',
      description: '读取一个作品的基础信息、设定、主角和卷章结构。',
      inputSchema: objectSchema({ novelId: idSchema }, ['novelId']),
      permissions: ['novel.read'],
      scope: 'novel',
      timeoutMs: 20_000,
    }),
    handler: async (args, context) => {
      const { readProjectContext } = await import('../../agent-tools/project-tools');
      return readProjectContext(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'novel.read_settings',
      description: '读取一个作品的世界设定与主角设置摘要。',
      inputSchema: objectSchema({ novelId: idSchema }, ['novelId']),
      permissions: ['novel.read'],
      scope: 'novel',
      timeoutMs: 15_000,
    }),
    handler: async (args, context) => {
      const { readProjectSettings } = await import('../../agent-tools/project-tools');
      return readProjectSettings(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'chapter.read_outline',
      description: '读取指定章节、所属分卷和草稿版本概要。',
      inputSchema: objectSchema({ novelId: idSchema, chapterId: idSchema }, [
        'novelId',
        'chapterId',
      ]),
      permissions: ['novel.read', 'chapter.read'],
      scope: 'chapter',
      timeoutMs: 15_000,
    }),
    handler: async (args, context) => {
      const { readChapterOutline } = await import('../../agent-tools/chapter-tools');
      return readChapterOutline(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'chapter.read_context',
      description: '读取指定章节及本章角色和事件上下文。',
      inputSchema: objectSchema({ novelId: idSchema, chapterId: idSchema }, [
        'novelId',
        'chapterId',
      ]),
      permissions: ['novel.read', 'chapter.read'],
      scope: 'chapter',
      timeoutMs: 15_000,
    }),
    handler: async (args, context) => {
      const { readChapterContext } = await import('../../agent-tools/chapter-tools');
      return readChapterContext(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'style.read_profile',
      description: '读取作品当前风格方案和禁用写法摘要。',
      inputSchema: objectSchema({ novelId: idSchema }, ['novelId']),
      permissions: ['novel.read', 'style.read'],
      scope: 'novel',
      timeoutMs: 15_000,
    }),
    handler: async (args, context) => {
      const { readStyleProfile } = await import('../../agent-tools/style-tools');
      return readStyleProfile(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'style.read_output_control',
      description: '读取作品输出字数、视角、节奏和结尾控制方案。',
      inputSchema: objectSchema({ novelId: idSchema }, ['novelId']),
      permissions: ['novel.read', 'style.read'],
      scope: 'novel',
      timeoutMs: 15_000,
    }),
    handler: async (args, context) => {
      const { readOutputControl } = await import('../../agent-tools/style-tools');
      return readOutputControl(contextFrom(args, context));
    },
  },
  {
    descriptor: descriptor({
      name: 'verification.check_outline',
      description: '对指定章节候选正文执行本地大纲和基础完整性检查。',
      inputSchema: objectSchema({ novelId: idSchema, chapterId: idSchema, draft: draftSchema }, [
        'novelId',
        'chapterId',
        'draft',
      ]),
      permissions: ['novel.read', 'chapter.read', 'verification.execute'],
      scope: 'chapter',
      timeoutMs: 20_000,
    }),
    handler: (args, context) =>
      verifyOutlineCompliance(contextFrom(args, context), String(args.draft)),
  },
  {
    descriptor: descriptor({
      name: 'verification.check_style',
      description: '对候选正文执行本地风格方案和禁用写法检查。',
      inputSchema: objectSchema({ novelId: idSchema, draft: draftSchema }, ['novelId', 'draft']),
      permissions: ['novel.read', 'style.read', 'verification.execute'],
      scope: 'novel',
      timeoutMs: 20_000,
    }),
    handler: (args, context) =>
      verifyStyleCompliance(contextFrom(args, context), String(args.draft)),
  },
];

export const productionToolRegistry = new ToolRegistry(definitions);
