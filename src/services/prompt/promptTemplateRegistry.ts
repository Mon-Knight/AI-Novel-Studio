import { createHash } from 'node:crypto';
import type {
  CompiledPromptPayload,
  ModelFamily,
  PromptTemplate,
  PromptTemplateCategory,
  RenderPromptOptions,
} from '../../types/promptRegistry';

/**
 * 自动识别模型家族分类
 */
export function detectModelFamily(modelName = ''): ModelFamily {
  const normalized = String(modelName || '').toLowerCase().trim();
  if (normalized.includes('qwen')) {
    return 'qwen';
  }
  if (normalized.includes('deepseek')) {
    return 'deepseek';
  }
  if (normalized.includes('claude')) {
    return 'claude';
  }
  if (
    normalized.includes('gpt') ||
    normalized.includes('openai') ||
    normalized.includes('gateway')
  ) {
    return 'openai_compatible';
  }
  return 'generic';
}

/**
 * 模板字符串替换与条件块渲染引擎
 */
export function renderTemplateString(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;

  // 1. 处理反向条件块 {{^var}}...{{/var}} (当变量为空时保留)
  result = result.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      const val = variables[key];
      return !val || val.trim() === '' ? content : '';
    },
  );

  // 2. 处理正向条件块 {{#var}}...{{/var}} (当变量非空时保留)
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      const val = variables[key];
      return val && val.trim() !== '' ? content : '';
    },
  );

  // 3. 处理变量插值 {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] !== undefined ? variables[key] : '';
  });

  return result.trim();
}

export class PromptTemplateRegistry {
  private templates = new Map<string, PromptTemplate>();

  constructor() {
    this.registerOfficialTemplates();
  }

  /**
   * 注册或更新提示词模板
   */
  registerTemplate(template: PromptTemplate): void {
    if (!template.templateId) {
      throw new Error('注册提示词模板失败：缺少 templateId。');
    }
    this.templates.set(template.templateId, { ...template });
  }

  /**
   * 获取指定模板
   */
  getTemplate(templateId: string): PromptTemplate | undefined {
    return this.templates.get(templateId.trim());
  }

  /**
   * 列出所有模板（可按场景分类过滤）
   */
  listTemplates(category?: PromptTemplateCategory): PromptTemplate[] {
    const list = Array.from(this.templates.values());
    if (category) {
      return list.filter((t) => t.category === category);
    }
    return list;
  }

  /**
   * 渲染并编译提示词载荷
   */
  renderPrompt(
    templateId: string,
    variables: Record<string, unknown> = {},
    options: RenderPromptOptions = {},
  ): CompiledPromptPayload {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`提示词模板 [${templateId}] 未找到。`);
    }

    const isStrict = options.strict !== false;
    const modelFamily: ModelFamily =
      options.modelFamily ||
      (options.modelName ? detectModelFamily(options.modelName) : 'generic');

    // 检查并准备变量
    const renderedVariables: Record<string, string> = {};
    for (const v of template.variables) {
      const rawVal = variables[v.name];
      if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
        renderedVariables[v.name] = String(rawVal).trim();
      } else if (v.defaultValue !== undefined) {
        renderedVariables[v.name] = v.defaultValue;
      } else if (v.required && isStrict) {
        throw new Error(
          `渲染模板 [${templateId}] 失败：必填变量 [${v.name}] 缺失且无默认值。`,
        );
      } else {
        renderedVariables[v.name] = '';
      }
    }

    // 补充未显式声明但在 variables 中传入的附加变量
    for (const [key, val] of Object.entries(variables)) {
      if (!(key in renderedVariables) && val !== undefined && val !== null) {
        renderedVariables[key] = String(val).trim();
      }
    }

    // 渲染用户提示词主体
    const baseUserPrompt = renderTemplateString(template.templateText, renderedVariables);

    // 获取模型适配规则
    const adaptation =
      template.adaptations?.[modelFamily] || template.adaptations?.generic;

    const systemParts: string[] = [];
    if (adaptation?.systemInstructionPrefix) {
      systemParts.push(adaptation.systemInstructionPrefix);
    }
    if (adaptation?.outputConstraints) {
      systemParts.push(adaptation.outputConstraints);
    }
    const systemPrompt = systemParts.join('\n\n').trim();

    const userParts: string[] = [baseUserPrompt];
    if (adaptation?.formatSuffix) {
      userParts.push(adaptation.formatSuffix);
    }
    const userPrompt = userParts.join('\n\n').trim();

    const hash = createHash('sha256')
      .update(`${template.templateId}:${template.version}:${modelFamily}:${systemPrompt}:::${userPrompt}`)
      .digest('hex');

    return {
      templateId: template.templateId,
      version: template.version,
      modelFamily,
      systemPrompt,
      userPrompt,
      renderedVariables,
      hash,
    };
  }

  /**
   * 注册官方基准提示词模板
   */
  private registerOfficialTemplates(): void {
    // 1. 场景分镜创作 (Scene Generation)
    this.registerTemplate({
      templateId: 'scene_generation_v1',
      name: '场景分镜小说正文创作',
      category: 'scene_generation',
      version: '1.0.0',
      description: '负责长篇小说单幕分镜正文写作，深度结合记忆层与角色心境。',
      isOfficial: true,
      variables: [
        { name: 'novelTitle', required: true, description: '小说书名' },
        { name: 'genre', required: false, defaultValue: '通俗长篇小说', description: '题材流派' },
        { name: 'povName', required: true, description: '视点角色姓名' },
        { name: 'povEmotion', required: false, defaultValue: '警惕专注', description: '视点角色心境' },
        { name: 'sceneGoal', required: true, description: '本场核心目标' },
        { name: 'memoryContext', required: false, description: '长中期记忆与世界状态包络' },
        { name: 'beatList', required: true, description: '分镜 Beat 规划清单' },
      ],
      templateText: `你正在创作长篇小说《{{novelTitle}}》（流派：{{genre}}）。

【视点角色 (POV)】
姓名：{{povName}}
当前心境：{{povEmotion}}

【本场分镜核心目标】
{{sceneGoal}}

{{#memoryContext}}
【记忆层沉淀与世界状态】
{{memoryContext}}
{{/memoryContext}}

【本场 Beat 规划步骤】
{{beatList}}

请严格按照分镜 Beat 的推进节奏展开小说正文创作。`,
      adaptations: {
        qwen: {
          modelFamily: 'qwen',
          systemInstructionPrefix:
            '你是一位严谨沉浸的华语长篇小说作家。请直接输出文学正文，严禁输出任何解释、寒暄或总结性套话。',
          outputConstraints:
            '【Qwen 写作规范】保持动作与对话的紧凑张力，严格遵从 POV 视角与伤势状态，杜绝视角跳跃。',
        },
        deepseek: {
          modelFamily: 'deepseek',
          systemInstructionPrefix:
            '你是一位拥有深度逻辑推理与结构把控力的小说创作者。在构思正文前，请确保情节与前序伏笔高度呼应。',
          outputConstraints:
            '【DeepSeek 写作规范】正文叙事流畅，保持环境与人物心理描写的平衡，直接输出纯正文。',
        },
        claude: {
          modelFamily: 'claude',
          systemInstructionPrefix:
            '你是一位注重文学质感、心理细微变化与宏大世界观一致性的作家。',
          outputConstraints:
            '【Claude 写作规范】运用丰富感官细节与克制笔触，保持高文学水准。',
        },
        generic: {
          modelFamily: 'generic',
          systemInstructionPrefix: '你是一位专业的小说创作者，请根据提供的信息创作小说正文。',
        },
      },
    });

    // 2. Beat 逐段推进生成 (Beat Generation)
    this.registerTemplate({
      templateId: 'beat_generation_v1',
      name: '分镜 Beat 逐段正文创作',
      category: 'beat_generation',
      version: '1.0.0',
      description: '针对单条 Beat 进行原子化正文推进创作。',
      isOfficial: true,
      variables: [
        { name: 'currentBeat', required: true, description: '当前要执行的 Beat 动作' },
        { name: 'previousSummary', required: false, description: '上一段落动作残余' },
        { name: 'constraints', required: false, description: '本段硬性约束' },
      ],
      templateText: `【当前 Beat 动作】
{{currentBeat}}

{{#previousSummary}}
【前序承接】
{{previousSummary}}
{{/previousSummary}}

{{#constraints}}
【硬性约束】
{{constraints}}
{{/constraints}}

请输出紧承前序、精准落实本 Beat 目标的段落正文。`,
      adaptations: {
        qwen: {
          modelFamily: 'qwen',
          systemInstructionPrefix: '直接输出段落正文，不增加任何多余标记。',
        },
      },
    });

    // 3. 多智能体专家评审 (Multi-Agent Review)
    this.registerTemplate({
      templateId: 'multi_agent_review_v1',
      name: '多智能体专家评审',
      category: 'multi_agent_review',
      version: '1.0.0',
      description: '供逻辑、人设、世界观等各领域专家对章节正文进行结构化评审。',
      isOfficial: true,
      variables: [
        { name: 'expertRole', required: true, description: '评审专家角色身份' },
        { name: 'criteria', required: true, description: '评审考量维度与标准' },
        { name: 'targetDraft', required: true, description: '待审阅章节草稿正文' },
      ],
      templateText: `你当前的专家角色：【{{expertRole}}】

【评审标准与考量维度】
{{criteria}}

【待审阅章节正文】
{{targetDraft}}

请以严格专业标准审阅上述内容，给出具体的修改建议与评分。`,
      adaptations: {
        qwen: {
          modelFamily: 'qwen',
          formatSuffix:
            '请务必在回复末尾以严格 JSON 代码块输出结构化评审结果：\n```json\n{\n  "score": 85,\n  "verdict": "accept" | "revise" | "regenerate",\n  "issues": ["问题清单"]\n}\n```',
        },
        deepseek: {
          modelFamily: 'deepseek',
          formatSuffix:
            '请在给出分析后输出严格 JSON 评审结果：\n```json\n{\n  "score": 85,\n  "verdict": "accept" | "revise" | "regenerate",\n  "issues": []\n}\n```',
        },
      },
    });

    // 4. 记忆状态演化抽取 (Memory State Extraction)
    this.registerTemplate({
      templateId: 'memory_state_extraction_v1',
      name: '记忆状态演化分析与抽取',
      category: 'memory_extraction',
      version: '1.0.0',
      description: '从生成正文中分析出角色心境变化与世界大势更新的 State Delta。',
      isOfficial: true,
      variables: [
        { name: 'sourceScene', required: true, description: '触发状态变更的分镜场景' },
        { name: 'generationProse', required: true, description: '生成的正文' },
      ],
      templateText: `【分镜场景】
{{sourceScene}}

【生成小说正文】
{{generationProse}}

请分析本段剧情对人物心境、伤势、阵营关系以及世界事件造成的实质演化。`,
    });

    // 5. 章节质量深度诊断 (Quality Inspection)
    this.registerTemplate({
      templateId: 'quality_inspection_v1',
      name: '章节质量深度诊断',
      category: 'quality_check',
      version: '1.0.0',
      description: '对章节进行错别字、设定违背、AI套话与节奏崩坏的全面诊断。',
      isOfficial: true,
      variables: [
        { name: 'chapterTitle', required: true, description: '章节名' },
        { name: 'chapterProse', required: true, description: '章节正文' },
      ],
      templateText: `【章节名称】《{{chapterTitle}}》

【正文内容】
{{chapterProse}}

请针对语病、人设偏离、战力崩坏与节奏拖沓等问题进行深度排查。`,
    });
  }

  reset(): void {
    this.templates.clear();
    this.registerOfficialTemplates();
  }
}

export const promptTemplateRegistry = new PromptTemplateRegistry();
