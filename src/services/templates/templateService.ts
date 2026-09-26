/**
 * AI Novel Studio - 用户自定义模板服务
 *
 * 桌面端以 SQLite `user_templates`（migration 037）为事实源；浏览器开发模式继续使用 LocalStorage。
 * 首次在桌面端读取时，把历史 LocalStorage 模板幂等 upsert 到 SQLite，再写入迁移标记。
 */
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from '../database/db';

const USER_TEMPLATES_KEY = 'ai_novel_studio_user_templates';
export const USER_TEMPLATES_SQLITE_MIGRATION_KEY = 'ai_novel_studio_user_templates_sqlite_v1';

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

export interface CreateUserTemplateInput {
  name: string;
  type: TemplateType;
  description?: string;
  content: string;
  tags?: string[];
  variables?: string[];
  source: 'user_imported' | 'user_created';
  fileName?: string;
}

export type UpdateUserTemplateInput = Partial<
  Pick<UserTemplate, 'name' | 'type' | 'description' | 'content' | 'tags' | 'variables'>
>;

function localGetAll(): UserTemplate[] {
  return lsGet<UserTemplate[]>(USER_TEMPLATES_KEY) ?? [];
}

function localSaveAll(items: UserTemplate[]): void {
  lsSet(USER_TEMPLATES_KEY, items);
}

function sortByUpdated(items: UserTemplate[]): UserTemplate[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function fromDto(dto: Record<string, unknown>): UserTemplate {
  return {
    id: String(dto.id),
    name: String(dto.name),
    type: dto.type as TemplateType,
    description: typeof dto.description === 'string' ? dto.description : '',
    content: String(dto.content),
    tags: Array.isArray(dto.tags) ? (dto.tags as string[]) : [],
    variables: Array.isArray(dto.variables) ? (dto.variables as string[]) : [],
    source: dto.source as UserTemplate['source'],
    fileName: (dto.fileName as string | null) ?? undefined,
    createdAt: String(dto.createdAt),
    updatedAt: String(dto.updatedAt),
  };
}

async function saveDesktop(input: Record<string, unknown>): Promise<UserTemplate> {
  const dto = await dbCall<Record<string, unknown>>('save_user_template', { input });
  return fromDto(dto);
}

async function ensureDesktopMigrated(): Promise<void> {
  if (lsGet<boolean>(USER_TEMPLATES_SQLITE_MIGRATION_KEY)) return;
  const local = localGetAll();
  if (local.length > 0) {
    const existing = new Set(
      (await dbCall<Record<string, unknown>[]>('list_user_templates')).map((row) => String(row.id)),
    );
    for (const template of local) {
      if (existing.has(template.id)) continue;
      try {
        await saveDesktop({
          id: template.id,
          name: template.name,
          type: template.type,
          description: template.description,
          content: template.content,
          tags: template.tags,
          variables: template.variables,
          source: template.source,
          fileName: template.fileName ?? null,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        });
      } catch {
        // A legacy row that fails validation stays in LocalStorage only and never blocks the rest.
      }
    }
  }
  lsSet(USER_TEMPLATES_SQLITE_MIGRATION_KEY, true);
}

export const templateService = {
  /** 获取所有用户模板（按更新时间倒序） */
  async getAll(): Promise<UserTemplate[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const rows = await dbCall<Record<string, unknown>[]>('list_user_templates');
      return rows.map(fromDto);
    }
    return sortByUpdated(localGetAll());
  },

  /** 按类型筛选 */
  async getByType(type: TemplateType): Promise<UserTemplate[]> {
    return (await this.getAll()).filter((t) => t.type === type);
  },

  /** 获取单个 */
  async getById(id: string): Promise<UserTemplate | null> {
    return (await this.getAll()).find((t) => t.id === id) ?? null;
  },

  /** 创建模板 */
  async create(input: CreateUserTemplateInput): Promise<UserTemplate> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      return saveDesktop({
        name: input.name,
        type: input.type,
        description: input.description ?? '',
        content: input.content,
        tags: input.tags ?? [],
        variables: input.variables ?? [],
        source: input.source,
        fileName: input.fileName ?? null,
      });
    }
    const list = localGetAll();
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
    localSaveAll(list);
    return template;
  },

  /** 更新模板 */
  async update(id: string, input: UpdateUserTemplateInput): Promise<UserTemplate | null> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const existing = await this.getById(id);
      if (!existing) return null;
      const merged = { ...existing, ...input };
      return saveDesktop({
        id,
        name: merged.name,
        type: merged.type,
        description: merged.description,
        content: merged.content,
        tags: merged.tags,
        variables: merged.variables,
        source: merged.source,
        fileName: merged.fileName ?? null,
      });
    }
    const list = localGetAll();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    localSaveAll(list);
    return list[idx];
  },

  /** 删除模板 */
  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<void>('delete_user_template', { templateId: id });
      return;
    }
    localSaveAll(localGetAll().filter((t) => t.id !== id));
  },

  /** 清空所有用户模板 */
  async clearAll(): Promise<void> {
    if (getDbMode() === 'tauri') {
      for (const template of await this.getAll()) {
        await dbCall<void>('delete_user_template', { templateId: template.id });
      }
      return;
    }
    localSaveAll([]);
  },
};
