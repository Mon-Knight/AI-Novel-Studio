// src/agent-tools/project-tools.ts
// AI Novel Studio — 项目相关 Agent Tools（只读）
// 版本：v1.0.46
// 用途：提供项目/作品上下文的只读 Tool 接口
// 安全：只读，不创建/修改/删除数据

import type { AgentToolResult, AgentToolContext } from './tool-types';
import { errorResult, resolveNovelId, successResult } from './tool-types';
import { novelService } from '../services/novels/novelService';
import { volumeRepository } from '../services/database/volumeRepository';
import { chapterRepository } from '../services/database/chapterRepository';
import { settingRepository } from '../services/database/settingRepository';
import { protagonistRepository } from '../services/database/protagonistRepository';
import { novelRepository } from '../services/database/novelRepository';
import { getDbMode } from '../services/database/db';

function dataSource(): 'sqlite' | 'localstorage' {
  return getDbMode() === 'tauri' ? 'sqlite' : 'localstorage';
}

/**
 * 读取项目上下文
 * 包括：作品基本信息、世界设定、主角信息、卷章结构概览
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 作品上下文信息
 */
export async function readProjectContext(
  context: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID（projectId / novelId / workId）', {
      source: 'tool-layer',
    });
  }

  try {
    const novel = await novelRepository.getById(novelId);
    if (!novel) {
      return errorResult(`作品 ${novelId} 不存在`, { source: dataSource() });
    }

    const warnings: string[] = [];

    // 读取世界设定
    let worldSettings: unknown = null;
    try {
      worldSettings = await settingRepository.getWorldSettings(novelId);
    } catch {
      warnings.push('无法读取世界设定');
    }

    // 读取主角
    let protagonists: unknown = null;
    try {
      protagonists = await protagonistRepository.getByNovelId(novelId);
    } catch {
      warnings.push('无法读取主角信息');
    }

    // 读取卷结构
    let volumes: unknown = null;
    try {
      volumes = await volumeRepository.getByNovelId(novelId);
    } catch {
      warnings.push('无法读取分卷信息');
    }

    // 读取章节列表
    let chapters: unknown = null;
    try {
      chapters = await chapterRepository.getByNovelId(novelId);
    } catch {
      warnings.push('无法读取章节列表');
    }

    return successResult(
      {
        novel: {
          id: novel.id,
          title: novel.title,
          description: (novel as unknown as Record<string, unknown>).description ?? '',
          status: novel.status,
          totalWordCount: novel.totalWordCount,
          updatedAt: (novel as unknown as Record<string, unknown>).updatedAt ?? '',
        },
        worldSettings,
        protagonists,
        volumes,
        chapters,
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取项目上下文失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 读取作品列表
 *
 * @param context - Agent Tool 执行上下文（可选）
 * @returns Promise<AgentToolResult> — 作品列表摘要
 */
export async function readProjectList(
  context?: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>[]>> {
  void context;
  try {
    const novels = await novelService.listNovels();
    const summaries = novels.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      totalWordCount: n.totalWordCount,
      updatedAt: (n as unknown as Record<string, unknown>).updatedAt ?? '',
    }));
    return successResult(summaries, { source: dataSource() });
  } catch (err) {
    return errorResult(`读取作品列表失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 读取作品设置摘要
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 作品设置信息
 */
export async function readProjectSettings(
  context: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID', { source: 'tool-layer' });
  }

  try {
    const novel = await novelRepository.getById(novelId);
    if (!novel) {
      return errorResult(`作品 ${novelId} 不存在`, { source: dataSource() });
    }

    const warnings: string[] = [];

    let worldSettings: unknown = null;
    try {
      worldSettings = await settingRepository.getWorldSettings(novelId);
    } catch {
      warnings.push('无法读取世界设定');
    }

    let protagonists: unknown = null;
    try {
      protagonists = await protagonistRepository.getByNovelId(novelId);
    } catch {
      warnings.push('无法读取主角信息');
    }

    return successResult(
      {
        novelId: novel.id,
        novelTitle: novel.title,
        status: novel.status,
        worldSettings,
        protagonists,
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取作品设置失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}
