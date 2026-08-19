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

const idSchema: ToolJsonSchema = { type: 'string', minLength: 1, maxLength: 160 };
const draftSchema: ToolJsonSchema = { type: 'string', minLength: 1, maxLength: 400_000 };
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
