// src/agent-tools/chapter-tools.ts
// AI Novel Studio — 章节相关 Agent Tools（只读）
// 版本：v1.0.46
// 用途：提供章节/大纲的只读 Tool 接口
// 安全：只读，不创建/修改/删除章节正文

import type { AgentToolResult, AgentToolContext } from './tool-types';
import { errorResult, notImplemented, resolveNovelId, successResult } from './tool-types';
import { chapterRepository } from '../services/database/chapterRepository';
import { volumeRepository } from '../services/database/volumeRepository';
import { draftService } from '../services/database/draftService';
import { getDbMode } from '../services/database/db';

function dataSource(): 'sqlite' | 'localstorage' {
  return getDbMode() === 'tauri' ? 'sqlite' : 'localstorage';
}

/**
 * 读取章节大纲
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 章节大纲信息
 */
export async function readChapterOutline(
  context: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID（novelId）', { source: 'scope' });
  }
  const chapterId = context.chapterId;
  if (!chapterId) {
    return errorResult('缺少章节 ID（chapterId）', { source: 'tool-layer' });
  }

  try {
    const chapter = await chapterRepository.getById(chapterId);
    if (!chapter) {
      return errorResult(`章节 ${chapterId} 不存在`, { source: dataSource() });
    }
    if (chapter.novelId !== novelId) {
      return errorResult(`章节 ${chapterId} 不属于当前作品`, { source: 'scope' });
    }

    const warnings: string[] = [];

    // 读取所属卷
    let volume: unknown = null;
    try {
      volume = await volumeRepository.getById(chapter.volumeId ?? '');
      if (volume && (volume as Record<string, unknown>).novelId !== novelId) {
        return errorResult(`章节 ${chapterId} 引用的分卷不属于当前作品`, {
          source: 'scope',
        });
      }
    } catch {
      warnings.push('无法读取所属分卷信息');
    }

    // 读取草稿
    let drafts: unknown = null;
    try {
      drafts = await draftService.getByChapterId(chapterId);
    } catch {
      warnings.push('无法读取章节草稿');
    }

    return successResult(
      {
        chapter: {
          id: chapter.id,
          novelId: chapter.novelId,
          volumeId: chapter.volumeId,
          title: chapter.title,
          outline: chapter.outline ?? '',
          goal: chapter.goal ?? '',
          status: chapter.status,
          targetWordCount: chapter.targetWordCount,
          wordCount: chapter.wordCount,
          adoptedDraftId: (chapter as unknown as Record<string, unknown>).adoptedDraftId ?? null,
        },
        volume: volume
          ? {
              id: (volume as Record<string, unknown>).id,
              novelId: (volume as Record<string, unknown>).novelId,
              title: (volume as Record<string, unknown>).title,
              orderIndex: (volume as Record<string, unknown>).orderIndex,
            }
          : null,
        drafts,
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取章节大纲失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 读取章节完整上下文
 * 包括：章节信息 + 所属作品 + 所属卷 + 当前草稿 + 出场角色/事件
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 章节上下文信息
 */
export async function readChapterContext(
  context: AgentToolContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult('缺少作品 ID（novelId）', { source: 'scope' });
  }
  const chapterId = context.chapterId;
  if (!chapterId) {
    return errorResult('缺少章节 ID（chapterId）', { source: 'tool-layer' });
  }

  try {
    const chapter = await chapterRepository.getById(chapterId);
    if (!chapter) {
      return errorResult(`章节 ${chapterId} 不存在`, { source: dataSource() });
    }

    if (chapter.novelId !== novelId) {
      return errorResult(`章节 ${chapterId} 不属于当前作品`, { source: 'scope' });
    }
    const warnings: string[] = [];

    // 尝试读取出场角色
    let chapterCharacters: unknown = null;
    try {
      const { chapterCharacterService } =
        await import('../services/characters/chapterCharacterService');
      chapterCharacters = await chapterCharacterService.getByChapterId(chapterId);
      if (
        Array.isArray(chapterCharacters) &&
        chapterCharacters.some(
          (item) =>
            item &&
            typeof item === 'object' &&
            ((item as Record<string, unknown>).novelId !== novelId ||
              (item as Record<string, unknown>).chapterId !== chapterId),
        )
      ) {
        return errorResult(`章节 ${chapterId} 的角色关联归属不一致`, { source: 'scope' });
      }
    } catch {
      warnings.push('无法读取本章出场角色');
    }

    // 尝试读取章节事件
    let chapterEvents: unknown = null;
    try {
      const { chapterEventService } = await import('../services/characters/chapterEventService');
      chapterEvents = await chapterEventService.getByChapterId(chapterId);
      if (
        Array.isArray(chapterEvents) &&
        chapterEvents.some(
          (item) =>
            item &&
            typeof item === 'object' &&
            ((item as Record<string, unknown>).novelId !== novelId ||
              (item as Record<string, unknown>).chapterId !== chapterId),
        )
      ) {
        return errorResult(`章节 ${chapterId} 的事件归属不一致`, { source: 'scope' });
      }
    } catch {
      warnings.push('无法读取本章事件');
    }

    return successResult(
      {
        chapter: {
          id: chapter.id,
          novelId: chapter.novelId,
          volumeId: chapter.volumeId,
          title: chapter.title,
          status: chapter.status,
          targetWordCount: chapter.targetWordCount,
          wordCount: chapter.wordCount,
        },
        novelId,
        chapterCharacters,
        chapterEvents,
      },
      {
        source: dataSource(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    );
  } catch (err) {
    return errorResult(`读取章节上下文失败: ${err instanceof Error ? err.message : String(err)}`, {
      source: dataSource(),
    });
  }
}

/**
 * 保存候选草稿
 *
 * 重要：本版本保持安全策略，不实际写入数据。
 * dryRun 默认开启，不写入正式正文。
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 草稿文本内容
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function saveCandidateDraft(
  context: AgentToolContext,
  draft: string,
): Promise<AgentToolResult> {
  void context;
  void draft;
  // v1.0.46: 仍然保持安全策略，不实际写入
  // 后续版本在确认候选稿数据结构后再接入
  return notImplemented('saveCandidateDraft');
}
