/**
 * AI Novel Studio - 用户自定义模板服务 (v1.0.27)
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';

const USER_TEMPLATES_KEY = 'ai_novel_studio_user_templates';

export type TemplateType =
  | 'novel_setting'
  | 'novel_outline'
  | 'volume_outline'
  | 'chapter_outline'
  | 'chapter_content'
  | 'character'
  | 'event'
  | 'world_background'
  | 'style_profile'
  | 'output_control'
  | 'polish'
  | 'quality_check'
  | 'custom';

export const TemplateTypeLabels: Record<TemplateType, string> = {
  novel_setting: '作品设定',
  novel_outline: '作品总大纲',
  volume_outline: '分卷大纲',
  chapter_outline: '章节大纲',
  chapter_content: '章节正文',
  character: '角色设定',
  event: '事件设计',
  world_background: '世界背景',
  style_profile: '风格方案',
  output_control: '输出控制',
  polish: '润色模板',
  quality_check: '质量检查',
  custom: '自定义',
};

export interface UserTemplate {
  id: string;
  name: string;
  type: TemplateType;
  description: string;
  content: string;
  tags: string[];
  variables: string[];
  source: 'system' | 'user_imported' | 'user_created';
  fileName?: string;
  createdAt: string;
  updatedAt: string;
}

function getAll(): UserTemplate[] {
  return lsGet<UserTemplate[]>(USER_TEMPLATES_KEY) ?? [];
}

function saveAll(items: UserTemplate[]): void {
  lsSet(USER_TEMPLATES_KEY, items);
}

export const templateService = {
  /** 获取所有用户模板 */
  getAll(): UserTemplate[] {
    return getAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  /** 按类型筛选 */
  getByType(type: TemplateType): UserTemplate[] {
    return this.getAll().filter((t) => t.type === type);
  },

  /** 获取单个 */
  getById(id: string): UserTemplate | null {
    return getAll().find((t) => t.id === id) ?? null;
  },

  /** 创建模板 */
  create(input: {
    name: string;
    type: TemplateType;
    description?: string;
    content: string;
    tags?: string[];
    variables?: string[];
    source: 'user_imported' | 'user_created';
    fileName?: string;
  }): UserTemplate {
    const list = getAll();
    const now = nowISO();
    const template: UserTemplate = {
      id: generateId(),
      name: input.name,
      type: input.type,
      description: input.description || '',
      content: input.content,
      tags: input.tags || [],
      variables: input.variables || [],
      source: input.source,
      fileName: input.fileName,
      createdAt: now,
      updatedAt: now,
    };
    list.push(template);
    saveAll(list);
    return template;
  },

  /** 更新模板 */
  update(id: string, input: Partial<Pick<UserTemplate, 'name' | 'type' | 'description' | 'content' | 'tags' | 'variables'>>): UserTemplate | null {
    const list = getAll();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    saveAll(list);
    return list[idx];
  },

  /** 删除模板 */
  remove(id: string): void {
    saveAll(getAll().filter((t) => t.id !== id));
  },

  /** 清空所有用户模板 */
  clearAll(): void {
    saveAll([]);
  },
};
