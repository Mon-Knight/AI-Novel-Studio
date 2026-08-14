// 逐来源 baselineRevision 加载器（v3.1.0）。
// 语义：
//   outline            = 当前章节大纲的最新 version（chapter_outlines.version）
//   chapter_context    = 章节工程状态的 activeVersion（chapter_engineering_states）
//   style_profile      = 激活风格方案的 updatedAt（unix 毫秒；无则 0）
//   output_control     = 激活/默认输出控制方案的 updatedAt（unix 毫秒；无则 0）
//   character_states   = 本章最新角色状态的 updatedAt（unix 毫秒；无则 0）
//   memory_index       = 最新记忆文档的 updatedAt（unix 毫秒；无则 0）
// 全部为调用方已知事实的确定性快照；Proposal 必须原样回显，Validator 做一致性校验。

import type {
  ChapterBaselineRevision,
  ChapterBaselineSource,
} from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import { chapterOutlineService } from '../outlines/outlineService';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { styleProfileService } from '../styles/styleProfileService';
import { outputProfileService } from '../styles/outputProfileService';
import { characterStateService } from '../context/characterStateService';
import { memoryService } from '../memory/memoryService';
import { appLogger } from '../observability/appLogger';

export interface BaselineRevisionDependencies {
  outlineVersions: (novelId: string, chapterId: string) => Promise<{ version?: number }[]>;
  engineeringActiveVersion: (chapterId: string) => Promise<number>;
  activeStyleUpdatedAt: (novelId: string) => Promise<string | undefined>;
  activeOutputUpdatedAt: (novelId: string) => Promise<string | undefined>;
  latestChapterStateUpdatedAt: (chapterId: string) => Promise<string | undefined>;
  latestMemoryUpdatedAt: (novelId: string) => Promise<string | undefined>;
}

export function toUnixMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultDependencies(): BaselineRevisionDependencies {
  return {
    outlineVersions: async (novelId, chapterId) =>
      chapterOutlineService.getVersions(novelId, chapterId) as Promise<{ version?: number }[]>,
    engineeringActiveVersion: async (chapterId) => {
      const bundle = await chapterEngineeringService.getBundle(chapterId);
      return bundle.activeState?.activeVersion ?? 0;
    },
    activeStyleUpdatedAt: async (novelId) => {
      const styles = await styleProfileService.getAll(novelId);
      const active =
        styles.find(
          (item) =>
            (item as { isActive?: unknown }).isActive === true ||
            (item as { isActive?: unknown }).isActive === 1,
        ) ?? styles[0];
      return (active as { updatedAt?: string } | undefined)?.updatedAt;
    },
    activeOutputUpdatedAt: async (novelId) => {
      const outputs = await outputProfileService.getAll(novelId);
      const preferred =
        outputs.find(
          (item) =>
            (item as { isDefault?: unknown }).isDefault === true ||
            (item as { isDefault?: unknown }).isDefault === 1,
        ) ?? outputs[0];
      return (preferred as { updatedAt?: string } | undefined)?.updatedAt;
    },
    latestChapterStateUpdatedAt: async (chapterId) => {
      const states = await characterStateService.getByChapterId(chapterId);
      return states[0]?.createdAt;
    },
    latestMemoryUpdatedAt: async (novelId) => {
      const page = await memoryService.listDocuments({ novelId, limit: 50 });
      const items = (page.items ?? []) as { updatedAt?: string }[];
      const latestMs = Math.max(0, ...items.map((item) => toUnixMs(item.updatedAt)));
      return latestMs > 0 ? new Date(latestMs).toISOString() : undefined;
    },
  };
}

export interface BaselineRevisionLoadResult {
  revisions: ChapterBaselineRevision[];
  warnings: string[];
}

const SOURCE_LABELS: Record<ChapterBaselineSource, string> = {
  outline: 'outline',
  chapter_context: 'chapter_context',
  style_profile: 'style_profile',
  output_control: 'output_control',
  character_states: 'character_states',
  memory_index: 'memory_index',
};

export async function loadBaselineRevisions(
  novelId: string,
  chapterId: string,
  dependencies: BaselineRevisionDependencies = defaultDependencies(),
): Promise<ChapterBaselineRevision[]> {
  // 逐来源容错：单来源失败（如浏览器开发模式下 memory 无 localStorage 回退）
  // 不阻断整体加载，该来源按 0 计入并给出告警。
  const warnings: string[] = [];
  const safe = async <T>(
    source: ChapterBaselineSource,
    task: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await task();
    } catch (reason) {
      warnings.push(
        SOURCE_LABELS[source] +
          ' 修订号读取失败：' +
          (reason instanceof Error ? reason.message : String(reason)),
      );
      return fallback;
    }
  };

  const [
    outlineVersions,
    engineeringVersion,
    styleUpdatedAt,
    outputUpdatedAt,
    stateUpdatedAt,
    memoryUpdatedAt,
  ] = await Promise.all([
    safe('outline', () => dependencies.outlineVersions(novelId, chapterId), []),
    safe('chapter_context', () => dependencies.engineeringActiveVersion(chapterId), 0),
    safe('style_profile', () => dependencies.activeStyleUpdatedAt(novelId), undefined),
    safe('output_control', () => dependencies.activeOutputUpdatedAt(novelId), undefined),
    safe('character_states', () => dependencies.latestChapterStateUpdatedAt(chapterId), undefined),
    safe('memory_index', () => dependencies.latestMemoryUpdatedAt(novelId), undefined),
  ]);

  const revisions: Record<ChapterBaselineSource, number> = {
    outline: outlineVersions[0]?.version ?? 0,
    chapter_context: engineeringVersion,
    style_profile: toUnixMs(styleUpdatedAt),
    output_control: toUnixMs(outputUpdatedAt),
    character_states: toUnixMs(stateUpdatedAt),
    memory_index: toUnixMs(memoryUpdatedAt),
  };

  if (warnings.length > 0) {
    // 不静默：告警进入结构化日志（修订号仍可用，只是部分来源为 0）。
    appLogger.warn('[baselineRevisions] ' + warnings.join(' | '));
  }

  return CHAPTER_PREPARATION_SOURCES.map((source) => ({
    source,
    revision: revisions[source],
  }));
}
